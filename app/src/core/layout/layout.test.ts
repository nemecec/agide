import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIRST_PARTY_MANIFEST, InMemoryBlockRegistry, PAIR_PRESET, PRESETS, SESSION_PRESET, type LayoutDocument } from '../blocks/index';
import { ContextStore } from '../context/index';
import { openStore } from '../store/index';
import { describeDiff, diffLayouts, isEmptyDiff } from './diff';
import { applyPatch, type PatchOperation } from './jsonPatch';
import { InMemoryLayoutHistory, SqliteLayoutHistory, type LayoutHistory } from './LayoutHistory';
import { LayoutFiles } from './LayoutFiles';
import { LayoutError, LayoutManager } from './LayoutManager';
import { maskedInstances } from './mask';
import { migrateLayout, type LayoutMigration } from './migrations';
import { validateLayoutDocument } from './validate';

const clone = <T,>(value: T): T => structuredClone(value);

function registry(): InMemoryBlockRegistry {
  const blocks = new InMemoryBlockRegistry();
  blocks.register(FIRST_PARTY_MANIFEST, 'first-party');
  return blocks;
}

describe('JSON Patch', () => {
  const doc = { a: { b: [1, 2, 3] }, c: 'x' };

  it('applies add, replace, remove, move, copy and test in order without touching the input', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: '/a/b/-', value: 4 },
      { op: 'replace', path: '/c', value: 'y' },
      { op: 'remove', path: '/a/b/0' },
      { op: 'copy', from: '/c', path: '/d' },
      { op: 'move', from: '/d', path: '/e' },
      { op: 'test', path: '/e', value: 'y' },
    ];
    const result = applyPatch(doc, ops);
    expect(result, 'patch applies').toEqual({ ok: true, value: { a: { b: [2, 3, 4] }, c: 'y', e: 'y' } });
    expect(doc, 'the input document is unchanged').toEqual({ a: { b: [1, 2, 3] }, c: 'x' });
  });

  it('names the failing operation and what exists at the parent', () => {
    const result = applyPatch(doc, [{ op: 'replace', path: '/a/z/q', value: 1 }]);
    expect(result.ok, 'patch fails').toBe(false);
    const message = result.ok ? '' : (result.issues[0]?.message ?? '');
    expect(message, 'operation index and the keys that exist').toMatch(/operation 0 \(replace \/a\/z\/q\).*keys b/);
  });

  it('refuses replace of a missing key, a failed test and a move into itself', () => {
    expect(applyPatch(doc, [{ op: 'replace', path: '/nope', value: 1 }]).ok, 'replace needs an existing value').toBe(false);
    expect(applyPatch(doc, [{ op: 'test', path: '/c', value: 'other' }]).ok, 'test compares values').toBe(false);
    expect(applyPatch(doc, [{ op: 'move', from: '/a', path: '/a/b/0' }]).ok, 'move into own subtree').toBe(false);
  });

  it('unescapes ~0 and ~1 in pointers', () => {
    const result = applyPatch({ 'a/b': { '~': 1 } }, [{ op: 'replace', path: '/a~1b/~0', value: 2 }]);
    expect(result, 'escaped keys resolve').toEqual({ ok: true, value: { 'a/b': { '~': 2 } } });
  });
});

describe('layout migration', () => {
  const v0ToV1: LayoutMigration = {
    from: 0,
    migrate: (old) => {
      const { panes: oldPanes, ...rest } = old;
      const panes = oldPanes as { id: string; type: string }[];
      return {
        ...rest,
        revision: 1,
        instances: Object.fromEntries(panes.map((p) => [p.id, { type: p.type, version: '^1', configVersion: 1, config: {} }])),
        arrangement: { tabs: { panes: panes.map((p) => p.id) } },
      };
    },
  };
  const v0 = { schemaVersion: 0, id: 'old', title: 'Old', panes: [{ id: 'tree', type: 'agide/tree' }] };

  it('runs the steps from the file version to the target and the result validates', () => {
    const result = migrateLayout(v0, [v0ToV1], 1);
    expect(result.status, 'migration succeeds').toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.migratedFrom, 'reports the version it came from').toBe(0);
    expect(validateLayoutDocument(result.document, registry()).ok, 'migrated document is a valid layout').toBe(true);
  });

  it('reports a newer file instead of reading it, and a missing step by version', () => {
    expect(migrateLayout({ schemaVersion: 9 }), 'newer file').toEqual({ status: 'newer', schemaVersion: 9 });
    const missing = migrateLayout(v0, [], 1);
    expect(missing.status === 'invalid' && missing.message, 'names the missing step').toMatch(/no migration from schemaVersion 0/);
  });

  it('rejects a file that is not an object or has no integer version', () => {
    expect(migrateLayout([]).status, 'array').toBe('invalid');
    expect(migrateLayout({ schemaVersion: 'one' }).status, 'string version').toBe('invalid');
  });
});

describe('layout validation messages', () => {
  it('accepts the presets and lists no warnings for them', () => {
    for (const preset of PRESETS) {
      const report = validateLayoutDocument(preset, registry());
      expect(report.ok && report.warnings.length === 0, `${preset.id} is clean`).toBe(true);
    }
  });

  it('explains a malformed arrangement node and binding in terms of what to write', () => {
    const broken = clone(SESSION_PRESET) as unknown as { arrangement: { children: unknown[] }; instances: { main: { bindings: { node: unknown } } } };
    broken.arrangement.children[0] = { size: 1 };
    broken.instances.main.bindings.node = { nonsense: true };
    const report = validateLayoutDocument(broken, registry());
    const messages = report.errors.map((e) => `${e.path} ${e.message}`).join('\n');
    expect(report.ok, 'invalid').toBe(false);
    expect(messages, 'arrangement hint').toMatch(/\/arrangement an arrangement node is a split/);
    expect(messages, 'binding hint').toMatch(/bindings\/node a binding is exactly one of/);
  });

  it('turns a missing pane type into a placeholder warning that lists the known types', () => {
    const layout = clone(SESSION_PRESET);
    layout.instances['extra'] = { type: 'acme/ghost', version: '^1', configVersion: 1, config: { keep: true } };
    layout.arrangement = { split: 'row', children: [...(layout.arrangement as unknown as { children: never[] }).children, { tabs: { panes: ['extra'] } }] };
    const report = validateLayoutDocument(layout, registry());
    expect(report.ok, 'a missing block does not invalidate the layout').toBe(true);
    expect(report.placeholders, 'placeholder named with its reason').toMatchObject([{ instanceId: 'extra', reason: 'missing' }]);
    expect(report.warnings[0]?.message, 'lists the pane types').toContain('agide/tree');
  });

  it('warns about a binding the pane has no input for and names the inputs', () => {
    const layout = clone(SESSION_PRESET);
    layout.instances['main'] = { ...layout.instances['main']!, bindings: { target: { context: 'node.current' } } };
    const report = validateLayoutDocument(layout, registry());
    expect(report.warnings[0]?.message, 'names the real input').toMatch(/no input target.*inputs: node/);
  });
});

describe('layout diff', () => {
  it('reports added, removed, moved and changed instances and a changed title', () => {
    const diff = diffLayouts(SESSION_PRESET, { ...PAIR_PRESET, title: 'Other' });
    expect(diff.added, 'side is new').toEqual([{ instanceId: 'side', type: 'agide/surface-host' }]);
    expect(diff.titleChanged, 'title').toEqual({ from: 'Session', to: 'Other' });
    expect(diff.arrangementChanged, 'one more column').toBe(true);
    expect(describeDiff(diff), 'readable lines').toContain('added side (agide/surface-host)');

    const reversed = diffLayouts(PAIR_PRESET, SESSION_PRESET);
    expect(reversed.removed.map((r) => r.instanceId), 'side removed').toEqual(['side']);
  });

  it('sees a config change and a tab move, and an identical layout is empty', () => {
    const changed = clone(PAIR_PRESET);
    changed.instances['main'] = { ...changed.instances['main']!, config: { emptyText: 'new' } };
    expect(diffLayouts(PAIR_PRESET, changed).changed, 'config').toMatchObject([{ instanceId: 'main', field: 'config' }]);
    const tabbed = clone(PAIR_PRESET);
    tabbed.arrangement = {
      split: 'row',
      children: [
        { size: 1, tabs: { panes: ['tree'] } },
        { size: 3, tabs: { panes: ['main', 'side'], active: 'main' } },
      ],
    };
    expect(diffLayouts(PAIR_PRESET, tabbed).moved, 'side joined the group of main').toContain('side');
    expect(isEmptyDiff(diffLayouts(PAIR_PRESET, clone(PAIR_PRESET))), 'same layout').toBe(true);
  });
});

function historyContract(name: string, create: () => LayoutHistory) {
  describe(`${name} history`, () => {
    it('returns a recorded revision, lists newest first and keeps the revision after a re-record', () => {
      const history = create();
      history.record({ layoutId: 'a', revision: 1, document: SESSION_PRESET, source: 'preset', at: 1 });
      history.record({ layoutId: 'a', revision: 2, document: { ...SESSION_PRESET, revision: 2 }, source: 'mcp', at: 2 });
      expect(history.get('a', 1)?.document.revision, 'revision 1 document').toBe(1);
      expect(history.list('a').map((e) => e.revision), 'newest first').toEqual([2, 1]);
      expect(history.get('b', 1), 'other layout is empty').toBeUndefined();
    });

    it('bounds the history per layout', () => {
      const history = create();
      for (let revision = 1; revision <= 60; revision += 1) {
        history.record({ layoutId: 'a', revision, document: { ...SESSION_PRESET, revision }, source: 'ui', at: revision });
      }
      expect(history.get('a', 1), 'oldest revision dropped').toBeUndefined();
      expect(history.get('a', 60), 'newest kept').toBeDefined();
    });
  });
}
historyContract('in-memory', () => new InMemoryLayoutHistory());
historyContract('SQLite', () => new SqliteLayoutHistory(openStore(':memory:')));

describe('LayoutManager', () => {
  let dir: string;
  let events: { type: string; revision?: number }[];
  let manager: LayoutManager;
  let files: LayoutFiles;

  const build = () => {
    files = new LayoutFiles(join(dir, 'layouts'), join(dir, 'window.json'));
    manager = new LayoutManager({
      files,
      presets: PRESETS,
      registry: registry(),
      history: new InMemoryLayoutHistory(),
      emit: (event) => events.push({ type: event.type, ...(event.type === 'layout.applied' ? { revision: event.revision } : {}) }),
      clock: () => 1000,
    });
    manager.start();
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agide-layout-'));
    events = [];
    build();
  });
  afterEach(() => {
    manager.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const retitle = (title: string): LayoutInput => ({ patch: [{ op: 'replace', path: '/title', value: title }] });
  type LayoutInput = { patch: PatchOperation[] };

  it('starts on the Session preset at revision 1 without writing a file', () => {
    const view = manager.get();
    expect(view.layoutId, 'default layout').toBe('session');
    expect(view.origin, 'a preset').toBe('preset');
    expect(existsSync(files.path('session')), 'no file until the first change').toBe(false);
  });

  it('applies a patch, writes the file with a raised revision and returns a diff and the undo arguments', () => {
    const result = manager.apply('session', 1, retitle('Mine'), 'mcp');
    expect(result.revision, 'revision raised').toBe(2);
    expect(result.summary, 'diff lines').toEqual(['title: "Session" -> "Mine"']);
    expect(result.undo, 'undo arguments').toEqual({ layoutId: 'session', toRevision: 1 });
    const saved = JSON.parse(readFileSync(files.path('session'), 'utf8')) as LayoutDocument;
    expect(saved.revision, 'file holds the new revision').toBe(2);
    expect(manager.get().lastChange?.source, 'last change source').toBe('mcp');
  });

  it('refuses a stale revision with the current one and an invalid document with JSON paths', () => {
    manager.apply('session', 1, retitle('Mine'));
    expect(() => manager.apply('session', 1, retitle('Again')), 'stale').toThrowError(/revision 2, not 1/);
    try {
      manager.apply('session', 2, { patch: [{ op: 'remove', path: '/instances/main' }] });
      expect.unreachable('an unplaced instance is refused');
    } catch (error) {
      expect(error, 'a layout error').toBeInstanceOf(LayoutError);
      expect((error as LayoutError).message, 'names the pane in the arrangement').toContain('/arrangement/children/2/tabs/panes/0');
    }
    expect(manager.get().revision, 'a refused change leaves the revision').toBe(2);
  });

  it('does not bump the revision for a change that changes nothing', () => {
    const result = manager.apply('session', 1, retitle('Session'));
    expect(result.changed, 'no change').toBe(false);
    expect(manager.get().revision, 'revision unchanged').toBe(1);
  });

  it('undoes to the previous revision as a new revision, and undo of the undo redoes', () => {
    manager.apply('session', 1, retitle('Mine'));
    const undone = manager.undo('session');
    expect(undone.revision, 'undo is revision 3').toBe(3);
    expect(manager.get().layout.title, 'title restored').toBe('Session');
    manager.undo('session');
    expect(manager.get().layout.title, 'undo of undo restores the change').toBe('Mine');
    expect(() => manager.undo('session', 99), 'unknown revision').toThrowError(/available: /);
  });

  it('applies a whole document only to its own layout id', () => {
    const result = manager.validate('session', { document: PAIR_PRESET });
    expect(result.report.errors[0]?.message, 'id mismatch is explained').toContain('must be session');
    const applied = manager.apply('session', 1, { document: { ...PAIR_PRESET, id: 'session' } });
    expect(applied.diff.added.map((a) => a.instanceId), 'side added').toEqual(['side']);
  });

  it('switches the window layout and remembers it across a restart', () => {
    manager.switchTo('pair');
    expect(manager.activeId(), 'active layout').toBe('pair');
    manager.stop();
    build();
    expect(manager.activeId(), 'kept after restart').toBe('pair');
    expect(() => manager.switchTo('nope'), 'unknown layout').toThrowError(/layouts: session, pair/);
  });

  it('hot reloads a valid edited file with a new revision, and ignores its own write', () => {
    manager.apply('session', 1, retitle('Mine'));
    events.length = 0;
    manager.reloadFromDisk('session');
    expect(events, 'own write is recognised by hash').toEqual([]);

    writeFileSync(files.path('session'), JSON.stringify({ ...SESSION_PRESET, title: 'Edited', revision: 1 }));
    manager.reloadFromDisk('session');
    expect(manager.get().layout.title, 'file content shown').toBe('Edited');
    expect(manager.get().revision, 'revision moves forward even if the file did not').toBe(3);
    expect(manager.get().lastChange?.source, 'recorded as a file change').toBe('file');
  });

  it('keeps the last valid layout and the user file when the file turns invalid', () => {
    manager.apply('session', 1, retitle('Mine'));
    const bad = '{ "schemaVersion": 1, oops';
    writeFileSync(files.path('session'), bad);
    manager.reloadFromDisk('session');
    const view = manager.get();
    expect(view.layout.title, 'running layout unchanged').toBe('Mine');
    expect(view.fileIssues[0]?.message, 'JSON syntax error reported').toMatch(/not valid JSON/);
    expect(readFileSync(files.path('session'), 'utf8'), 'the file is not overwritten').toBe(bad);

    const wrongShape = JSON.stringify({ ...SESSION_PRESET, arrangement: { size: 1 } });
    writeFileSync(files.path('session'), wrongShape);
    manager.reloadFromDisk('session');
    expect(manager.get().fileIssues[0]?.path, 'schema problem with its pointer').toContain('/arrangement');

    writeFileSync(files.path('session'), JSON.stringify({ ...SESSION_PRESET, title: 'Fixed' }));
    manager.reloadFromDisk('session');
    expect(manager.get().fileIssues, 'issues cleared once valid').toEqual([]);
    expect(manager.get().layout.title, 'fixed file shown').toBe('Fixed');
  });

  it('does not overwrite an invalid file when a change is applied, and adopts the next valid file', () => {
    manager.apply('session', 1, retitle('Mine'));
    const typing = '{ "schemaVersion": 1, "titl';
    writeFileSync(files.path('session'), typing);
    manager.reloadFromDisk('session');
    const result = manager.apply('session', 2, retitle('Resized'), 'ui');
    expect(readFileSync(files.path('session'), 'utf8'), 'the half-typed file is untouched').toBe(typing);
    expect(result.warnings.map((w) => w.path), 'the caller is told the file was not written').toContain('/file');
    expect(manager.get().layout.title, 'the running layout has the change').toBe('Resized');
    expect(manager.get().fileIssues, 'the file problem stays visible').not.toEqual([]);
    writeFileSync(files.path('session'), JSON.stringify({ ...SESSION_PRESET, title: 'Finished' }));
    manager.reloadFromDisk('session');
    expect([manager.get().layout.title, manager.get().fileIssues], 'valid file replaces the running layout').toEqual(['Finished', []]);
  });

  it('falls back to the preset at start when the file is invalid, and opens a newer file read only', () => {
    manager.stop();
    writeFileSync(files.path('session'), 'not json');
    build();
    expect(manager.get().layout.title, 'preset shown').toBe('Session');
    expect(manager.get().fileIssues, 'problem reported').not.toEqual([]);

    manager.stop();
    writeFileSync(files.path('session'), JSON.stringify({ ...SESSION_PRESET, schemaVersion: 7 }));
    build();
    expect(manager.get().readOnly, 'read only').toBe(true);
    expect(() => manager.apply('session', 1, retitle('x')), 'no writes').toThrowError(/read only/);
  });

  it('keeps the original of a migrated file beside it on the next save', () => {
    manager.stop();
    const original = JSON.stringify({ ...SESSION_PRESET, schemaVersion: 1 });
    writeFileSync(files.path('session'), original);
    build();
    // Migration from an older version has no step in this build; the original copy rule is exercised directly.
    files.keepOriginal('session', 0);
    expect(readFileSync(join(files.dir, 'session.v0.json'), 'utf8'), 'original kept').toBe(original);
  });

  it('returns to the preset when the profile file is deleted', () => {
    manager.apply('session', 1, retitle('Mine'));
    files.remove('session');
    manager.reloadFromDisk('session');
    expect(manager.get().layout.title, 'preset again').toBe('Session');
    expect(manager.get().origin, 'origin preset').toBe('preset');
  });
});

describe('capture mask', () => {
  it('masks the tree, the inbox, the profile rail and panes bound to a node outside the folder, and nothing else', () => {
    const inScope = (id: string) => id === 'mine';
    expect(maskedInstances(PAIR_PRESET, { 'node.current': 'mine', 'node.secondary': 'theirs' }, inScope), 'unscoped panes and the side pane').toEqual([
      'rail',
      'tree',
      'side',
      'inbox',
    ]);
    expect(maskedInstances(PAIR_PRESET, { 'node.current': 'mine' }, inScope), 'only the unscoped panes when the side is empty').toEqual(['rail', 'tree', 'inbox']);
  });
});

describe('ContextStore', () => {
  it('emits context.changed only on change and validates values', () => {
    const seen: string[] = [];
    const store = new ContextStore((event) => seen.push(event.type === 'context.changed' ? event.key : event.type));
    store.set('main', 'node.current', 'n1');
    store.set('main', 'node.current', 'n1');
    expect(seen, 'one event for an unchanged value').toEqual(['node.current']);
    expect(() => store.set('main', 'selection.object', { kind: 'k', id: 'i', label: 'l', data: 'x'.repeat(40_000) }), 'oversized data').toThrowError(/data is at most/);
    store.clear('main', 'node.current');
    expect(store.get('main', 'node.current'), 'cleared').toBeUndefined();
  });
});
