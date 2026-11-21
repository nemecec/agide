import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinTheme } from './builtin/index';
import { ThemeError, ThemeService } from './service';

class FakeTimers {
  private next = 1;
  readonly pending = new Map<number, { run: () => void; at: number }>();
  clock = 1_000;
  set = (run: () => void, ms: number): number => {
    const id = this.next++;
    this.pending.set(id, { run, at: this.clock + ms });
    return id;
  };
  clear = (handle: unknown): void => void this.pending.delete(handle as number);
  advance(ms: number): void {
    this.clock += ms;
    for (const [id, timer] of [...this.pending]) {
      if (timer.at <= this.clock) {
        this.pending.delete(id);
        timer.run();
      }
    }
  }
}

let dir: string;
let timers: FakeTimers;
const create = (): ThemeService => new ThemeService({ dataDir: dir, now: () => timers.clock, timers, previewMs: 60_000 });
const userTheme = (id: string, name = 'My Theme') => ({ schema: 1, id, name, kind: 'dark', extends: 'agide-dark', tokens: { accent: '#2f6fd0' }, source: { kind: 'user' } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agide-theme-service-'));
  timers = new FakeTimers();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the theme choice and its revisions', () => {
  it('starts on System at revision 1 and lists the built-in themes', () => {
    const service = create();
    expect(service.state(), 'default choice').toMatchObject({ themeId: 'system', revision: 1 });
    expect(service.list().map((theme) => [theme.id, theme.active]), 'built-in themes in picker order').toEqual([
      ['system', true],
      ['agide-light', false],
      ['agide-dark', false],
      ['github-dark-default', false],
      ['catppuccin-mocha', false],
    ]);
  });

  it('applies a theme as a new revision and keeps it across a restart', () => {
    const service = create();
    const applied = service.apply({ id: 'agide-dark' }, 'ui', 1);
    expect(applied, 'new revision with undo arguments').toMatchObject({ revision: 2, themeId: 'agide-dark', undo: { tool: 'theme_undo', arguments: { revision: 1 } } });
    expect(create().state().themeId, 'a new service reads the saved choice').toBe('agide-dark');
  });

  it('refuses a stale expected revision and reports the current one', () => {
    const service = create();
    service.apply({ id: 'agide-dark' }, 'ui', 1);
    try {
      service.apply({ id: 'agide-light' }, 'mcp', 1);
      expect.unreachable('a stale revision must be refused');
    } catch (error) {
      expect(error, 'stale_revision error').toBeInstanceOf(ThemeError);
      expect(error as ThemeError, 'carries the current revision').toMatchObject({ code: 'stale_revision', details: { currentRevision: 2, themeId: 'agide-dark' } });
    }
    expect(service.state().themeId, 'the choice did not change').toBe('agide-dark');
  });

  it('undo restores the previous choice as a new revision, and undo can be undone', () => {
    const service = create();
    service.apply({ id: 'agide-dark' }, 'ui', 1);
    const undone = service.undo();
    expect(undone, 'undo is revision 3 and restores revision 1').toMatchObject({ revision: 3, themeId: 'system', restoredRevision: 1 });
    const redone = service.undo();
    expect(redone, 'undoing the undo brings the dark theme back').toMatchObject({ revision: 4, themeId: 'agide-dark' });
    expect(service.undo(1), 'a named revision').toMatchObject({ themeId: 'system', revision: 5 });
  });

  it('refuses an undo when no earlier revision exists', () => {
    expect(() => create().undo(), 'nothing to restore').toThrow(/no earlier revision/);
  });

  it('announces the last change with its revision', () => {
    const service = create();
    service.apply({ id: 'agide-light' }, 'ui', 1);
    expect(service.state().change, 'change for the notice').toMatchObject({ kind: 'apply', revision: 2, name: 'Agide Light' });
  });

  it('reads the older file with only a theme id, and refuses an unknown id', () => {
    writeFileSync(join(dir, 'appearance.json'), JSON.stringify({ schema: 1, themeId: 'agide-light' }));
    expect(create().state(), 'older file').toMatchObject({ themeId: 'agide-light', revision: 1 });
    expect(() => create().apply({ id: 'no-such-theme' }, 'ui'), 'unknown id').toThrow(/no theme/);
  });

  it('reads a damaged file as System', () => {
    writeFileSync(join(dir, 'appearance.json'), '{broken');
    expect(create().state().themeId, 'damaged file').toBe('system');
  });
});

describe('previews', () => {
  it('shows a theme without saving it and reverts after 60 seconds without Keep', () => {
    const service = create();
    const { previewId } = service.startPreview({ id: 'catppuccin-mocha' });
    expect(service.state().preview?.theme.id, 'the preview shows the theme').toBe('catppuccin-mocha');
    expect(service.state().themeId, 'the saved choice is unchanged').toBe('system');
    timers.advance(59_000);
    expect(service.state().preview?.previewId, 'still previewing before the timeout').toBe(previewId);
    timers.advance(1_000);
    expect(service.state().preview, 'reverted at the timeout').toBeUndefined();
  });

  it('reverts on request and ignores a revert for another preview', () => {
    const service = create();
    const { previewId } = service.startPreview({ id: 'agide-dark' });
    expect(service.endPreview('some-other-id'), 'another id leaves the preview').toBe(false);
    expect(service.endPreview(previewId), 'the right id ends it').toBe(true);
    expect(service.state().preview, 'no preview left').toBeUndefined();
    expect(timers.pending.size, 'the timeout was cancelled').toBe(0);
  });

  it('reverts when its window closes and not when another window closes', () => {
    const service = create();
    service.startPreview({ id: 'agide-dark' }, 7);
    service.windowClosed(8);
    expect(service.state().preview, 'another window closed').toBeDefined();
    service.windowClosed(7);
    expect(service.state().preview, 'its window closed').toBeUndefined();
  });

  it('replaces an earlier preview', () => {
    const service = create();
    service.startPreview({ id: 'agide-dark' });
    service.startPreview({ id: 'agide-light' });
    expect(service.state().preview?.theme.id, 'the latest preview').toBe('agide-light');
    expect(timers.pending.size, 'one timer').toBe(1);
  });

  it('keeps a previewed document as a user theme when it is applied', () => {
    const service = create();
    const { previewId } = service.startPreview({ document: userTheme('proposed-theme') });
    const applied = service.apply({ previewId }, 'mcp', 1);
    expect(applied, 'applied as revision 2').toMatchObject({ revision: 2, themeId: 'proposed-theme' });
    expect(JSON.parse(readFileSync(join(dir, 'themes', 'proposed-theme.json'), 'utf8')).name, 'the file is saved').toBe('My Theme');
    expect(create().state().theme?.id, 'a new service loads it as the user theme of the choice').toBe('proposed-theme');
    expect(service.state().preview, 'the preview ended').toBeUndefined();
  });

  it('refuses an invalid document and a previewed id that exists', () => {
    const service = create();
    expect(() => service.startPreview({ document: { schema: 1, id: 'bad-theme', name: 'Bad', kind: 'dark', tokens: { accent: 'blue' } } }), 'invalid document').toThrow(/not valid/);
    expect(() => service.startPreview({ document: userTheme('agide-dark') }), 'id of a built-in theme').toThrow(/not valid/);
  });

  it('refuses to apply a preview that is over', () => {
    const service = create();
    const { previewId } = service.startPreview({ id: 'agide-dark' });
    service.endPreview(previewId);
    expect(() => service.apply({ previewId }, 'ui', 1), 'ended preview').toThrow(/over/);
  });

  it('notifies subscribers of every change', () => {
    const service = create();
    let calls = 0;
    service.subscribe(() => void calls++);
    const { previewId } = service.startPreview({ id: 'agide-dark' });
    service.endPreview(previewId);
    service.apply({ id: 'agide-light' }, 'ui', 1);
    expect(calls, 'preview, revert and apply each notify').toBe(3);
  });
});

describe('user themes and imports', () => {
  it('lists user theme files and reports an invalid one as a problem', () => {
    const service = create();
    service.importTheme({ bytes: Buffer.from('{"colors":{"editor.background":"#101010","foreground":"#eeeeee"}}'), fileName: 'Plain Dark.json', license: { spdx: 'LicenseRef-unknown', copyright: 'unknown', text: 'unknown' } }, true);
    writeFileSync(join(dir, 'themes', 'broken-theme.json'), '{nope');
    service.rescan();
    expect(service.list().some((theme) => theme.id === 'plain-dark' && theme.source === 'vscode-file'), 'imported theme is listed').toBe(true);
    expect(service.userThemeProblems().map((problem) => problem.file), 'broken file reported').toEqual(['broken-theme.json']);
  });

  it('does not save a dry run', () => {
    const service = create();
    const outcome = service.importTheme({ bytes: Buffer.from('{"colors":{"editor.background":"#101010","foreground":"#eeeeee"}}'), fileName: 'x-theme.json', license: { spdx: 'MIT', copyright: 'c', text: 't' } }, false);
    expect(outcome.ok, 'import analysed').toBe(true);
    expect(service.list().length, 'only the built-in themes').toBe(5);
  });

  it('flags low contrast in the list and the validation result', () => {
    const faint = { ...userTheme('faint-theme'), tokens: { 'text.secondary': '#4a4a52' } };
    const service = create();
    const validation = service.validate(faint);
    expect(validation.ok, 'valid document').toBe(true);
    expect(validation.warnings[0]?.code, 'contrast warning').toBe('contrast_below_target');
    expect(validation.adjustments[0], 'the value the clamp would use').toMatchObject({ token: 'text.secondary', from: '#4a4a52' });
  });

  it('returns the document, resolved tokens, contrast report and JSON Schema from get', () => {
    const result = create().get('github-dark-default');
    expect(result.theme.id, 'document').toBe('github-dark-default');
    expect(result.resolved.scheme, 'dark scheme').toBe('dark');
    expect(result.resolved.tokens['surface.content'], 'resolved token').toBe(builtinTheme('github-dark-default')?.tokens?.['surface.content']);
    expect(result.contrast, 'a built-in theme has no pair under target').toEqual([]);
    expect(result.jsonSchema, 'schema included').toMatchObject({ type: 'object' });
    expect(() => create().get('missing-theme'), 'unknown id').toThrow(ThemeError);
  });
});
