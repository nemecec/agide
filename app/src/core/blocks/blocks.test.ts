import { describe, expect, it } from 'vitest';
import { describeBlockRegistryContract } from './blockRegistryContract';
import { InMemoryBlockRegistry } from './InMemoryBlockRegistry';
import { validateLayout } from './layout';
import { blockManifestSchema } from './manifest';
import { PAIR_PRESET, PRESETS, SESSION_PRESET } from './presets';
import { satisfiesRange } from './versionRange';
import { FIRST_PARTY_MANIFEST } from './firstParty';

describeBlockRegistryContract('InMemoryBlockRegistry', () => new InMemoryBlockRegistry());

describe('layout documents', () => {
  it('accepts the shipped presets', () => {
    for (const preset of PRESETS) expect(validateLayout(preset), `${preset.id} preset validates`).toMatchObject({ ok: true });
  });

  it('resolves every preset instance against the first-party block', () => {
    const registry = new InMemoryBlockRegistry();
    registry.register(FIRST_PARTY_MANIFEST, 'first-party');
    for (const preset of PRESETS) {
      for (const [id, instance] of Object.entries(preset.instances)) {
        expect(registry.resolve(instance).status, `${preset.id}/${id} resolves`).toBe('ok');
      }
    }
  });

  it('reports an arrangement entry without an instance by its JSON Pointer', () => {
    const broken = structuredClone(SESSION_PRESET) as { arrangement: { children: { tabs: { panes: string[] } }[] } };
    const treeGroup = broken.arrangement.children[1];
    if (treeGroup) treeGroup.tabs.panes = ['ghost'];
    const result = validateLayout(broken);
    expect(result.ok, 'invalid layout').toBe(false);
    const paths = result.ok ? [] : result.issues.map((issue) => issue.path);
    expect(paths, 'pointer to the unknown pane').toContain('/arrangement/children/1/tabs/panes/0');
    expect(paths, 'the tree instance is now placed nowhere').toContain('/instances/tree');
  });

  it('refuses an instance placed twice and a newer schema version', () => {
    const twice = structuredClone(PAIR_PRESET) as { arrangement: { children: { tabs: { panes: string[] } }[] } };
    const last = twice.arrangement.children[3];
    if (last) last.tabs.panes = ['side', 'main'];
    expect(validateLayout(twice).ok, 'main placed twice').toBe(false);
    expect(validateLayout({ ...SESSION_PRESET, schemaVersion: 2 }).ok, 'schema version 2 is unknown').toBe(false);
  });
});

describe('active pane of a tab group', () => {
  it('must be listed in the group and is reported at /arrangement/tabs/active', () => {
    const doc = structuredClone(SESSION_PRESET) as { arrangement: { children: { tabs: { panes: string[]; active?: string } }[] } };
    const group = doc.arrangement.children[1];
    if (group) group.tabs.active = 'main';
    const result = validateLayout(doc);
    expect(result.ok, 'an active pane of another group is invalid').toBe(false);
    const paths = result.ok ? [] : result.issues.map((issue) => issue.path);
    expect(paths, 'pointer to the active field').toContain('/arrangement/children/1/tabs/active');
  });
});

describe('block manifests', () => {
  it('requires emitted event types under the block namespace', () => {
    const manifest = {
      apiVersion: '1.0',
      id: 'acme-board',
      version: '1.0.0',
      title: 'Board',
      engines: { agide: '*' },
      events: { emits: [{ type: 'tree.node_created', schema: 'e.json' }] },
    };
    expect(blockManifestSchema.safeParse(manifest).success, 'first-party event type refused').toBe(false);
    manifest.events.emits[0] = { type: 'ext.acme_board.card_opened', schema: 'e.json' };
    expect(blockManifestSchema.safeParse(manifest).success, 'namespaced event type accepted').toBe(true);
  });

  it('requires an entry for code panes and none for others', () => {
    const base = { apiVersion: '1.0', id: 'b', version: '1.0.0', title: 'B', engines: { agide: '*' } };
    const code = { type: 'b/p', title: 'P', tier: 'code', configVersion: 1 };
    expect(blockManifestSchema.safeParse({ ...base, panes: [code] }).success, 'code pane without entry').toBe(false);
    expect(blockManifestSchema.safeParse({ ...base, panes: [{ ...code, tier: 'builtin', entry: 'x.html' }] }).success, 'builtin pane with entry').toBe(false);
  });
});

describe('version ranges', () => {
  it('matches caret, exact and any ranges', () => {
    expect(satisfiesRange('1.4.2', '^1'), 'same major').toBe(true);
    expect(satisfiesRange('2.0.0', '^1'), 'next major').toBe(false);
    expect(satisfiesRange('1.2.0', '^1.3'), 'lower minor').toBe(false);
    expect(satisfiesRange('1.3.1', '^1.3.2'), 'lower patch').toBe(false);
    expect(satisfiesRange('1.4.0', '^1.3.2'), 'higher minor').toBe(true);
    expect(satisfiesRange('1.0.0', '1.0.0'), 'exact').toBe(true);
    expect(satisfiesRange('0.1.0', '*'), 'any').toBe(true);
    expect(satisfiesRange('1.0.0', '>=1'), 'unsupported syntax').toBe(false);
  });
});
