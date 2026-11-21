import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, builtinTheme } from '../builtin/index';
import { checkPairs } from '../contrast';
import { resolveTheme } from '../resolve';
import { detectKind } from './kind';
import { mapVsCodeTheme, type MappedTheme } from './mapping';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const mapped = (file: unknown, uiTheme?: 'vs' | 'vs-dark'): MappedTheme => {
  const result = mapVsCodeTheme({ file, uiTheme });
  if (!result.ok) throw new Error(`mapping failed: ${result.issues[0]?.code}`);
  return result.theme;
};
const minimal = (colors: Record<string, string>, extra: Record<string, unknown> = {}) => ({ colors: { 'editor.background': '#101010', foreground: '#e0e0e0', ...colors }, ...extra });

describe('mapping of the ported GitHub Dark Default colours', () => {
  const theme = mapped(fixture('github-dark-default'), 'vs-dark');

  it('takes each surface from the first key of its fallback order', () => {
    expect(theme.kind, 'kind from uiTheme').toBe('dark');
    expect(
      ['surface.content', 'surface.window', 'surface.sidebar', 'surface.raised', 'surface.overlay', 'surface.inset'].map((key) => theme.tokens[key]),
      'content, window, sidebar, raised, overlay, inset',
    ).toEqual(['#0d1117', '#0d1117', '#010409', '#161b22', '#161b22', '#0d1117']);
  });

  it('composites alpha colours over the surface they sit on', () => {
    expect(theme.tokens['selection'], 'list.activeSelectionBackground #6e768166 over the sidebar').toBe('#2d3239');
    expect(theme.tokens['selection.inactive'], 'inactive selection over the sidebar').toBe('#2d3239');
  });

  it('derives what the theme does not define', () => {
    expect(theme.tokens['border.strong'], 'input.border is under 3 to 1, so the border mixes 45% of the text into the content').toBe('#6f747a');
    expect(theme.tokens['terminal.background'], 'terminal.background falls back to panel.background').toBe('#010409');
    expect(theme.tokens['tooltip.bg'], 'tooltip background is the primary text').toBe('#e6edf3');
    expect(theme.tokens['warning.bg'], 'status background mixes 16% of the colour into the content').toBe('#2d2719');
  });

  it('lists the clamp adjustments with the original value and the reason', () => {
    const byToken = new Map(theme.adjustments.map((adjustment) => [adjustment.token, adjustment]));
    expect([byToken.get('text.secondary')?.from, byToken.get('text.secondary')?.to], 'secondary text moved toward white').toEqual(['#7d8590', '#949ba4']);
    expect([byToken.get('focus.ring')?.from, byToken.get('focus.ring')?.to], 'focus ring').toEqual(['#1f6feb', '#2c78ec']);
    expect([byToken.get('accent.hover')?.from, byToken.get('accent.hover')?.to], 'hover moved away from white text').toEqual(['#2ea043', '#278638']);
    expect([byToken.get('danger.fg')?.to, byToken.get('info.fg')?.to], 'status colours').toEqual(['#f96d66', '#599af9']);
    expect(byToken.get('text.secondary')?.reason, 'the reason names the pair and the target').toContain('target 4.5');
  });

  it('keeps the original values for a user who keeps them', () => {
    expect(theme.original['text.secondary'], 'unclamped secondary text').toBe('#7d8590');
    expect(theme.warnings, 'the clamped tokens leave no warning').toEqual([]);
  });

  it('maps terminal.ansi* to the terminal palette', () => {
    expect([theme.tokens['terminal.red'], theme.tokens['terminal.brightRed'], theme.tokens['terminal.white'], theme.tokens['terminal.brightWhite']], 'ansi red, bright red, white, bright white').toEqual(['#ff7b72', '#ffa198', '#b1bac4', '#ffffff']);
  });

  it('keeps the original colours for the --vscode aliases', () => {
    expect(theme.vscode['list.activeSelectionBackground'], 'alpha colour as written').toBe('#6e768166');
    expect(theme.vscode['button.background'], 'button background').toBe('#238636');
    expect(theme.vscode['menu.background'], 'a key the theme does not define is absent').toBeUndefined();
  });
});

describe('mapping of the ported Catppuccin Mocha colours', () => {
  const theme = mapped(fixture('catppuccin-mocha'));

  it('reads kind from the theme type', () => {
    expect(theme.kind, 'type dark').toBe('dark');
  });

  it('treats a secondary colour equal to the primary as missing and mixes it', () => {
    expect(theme.tokens['text.secondary'], 'derived: 30% of the content into the primary').toBe('#999fb9');
  });

  it('clamps tertiary text and the derived field border against the inset surface', () => {
    expect([theme.original['text.tertiary'], theme.tokens['text.tertiary']], 'tertiary text over the inset').toEqual(['#777c93', '#989bad']);
    expect([theme.original['border.strong'], theme.tokens['border.strong']], 'border').toEqual(['#6d7187', '#797c91']);
  });

  it('takes a dark accent text from the theme when the accent is light', () => {
    expect([theme.tokens['accent'], theme.tokens['accent.on'], theme.tokens['accent.hover']], 'accent, text on it, hover').toEqual(['#cba6f7', '#11111b', '#dec7fa']);
  });

  it('recolours the shadows from widget.shadow and keeps the other parts', () => {
    expect(theme.tokens['shadow.2'], 'shadow colour replaced, light ring kept').toMatch(/^0 6px 18px rgb\(27 27 41 \/ 45%\), 0 0 0 1px rgb\(255 255 255 \/ 9%\)$/);
  });
});

describe('ported built-in themes', () => {
  it.each([
    ['github-dark-default', 'vs-dark'],
    ['catppuccin-mocha', 'vs-dark'],
  ] as const)('%s ships what the mapping produces from its colours', (id, uiTheme) => {
    const result = mapped(fixture(id), uiTheme);
    expect(builtinTheme(id)?.tokens, 'the shipped tokens equal the mapped tokens').toEqual(result.tokens);
  });

  it('pass every contrast pair for the scheme they resolve to', () => {
    for (const theme of BUILTIN_THEMES) {
      const resolved = resolveTheme({ theme });
      expect(checkPairs(resolved.tokens).filter((pair) => !pair.ok), `${theme.id} has no pair under its target`).toEqual([]);
    }
  });

  it('carry the full MIT text, the copyright line and the source', () => {
    for (const id of ['github-dark-default', 'catppuccin-mocha']) {
      const theme = builtinTheme(id);
      expect(theme?.license?.spdx, `${id} license id`).toBe('MIT');
      expect(theme?.license?.text, `${id} license text`).toContain('Permission is hereby granted, free of charge');
      expect(theme?.license?.copyright, `${id} copyright line`).toMatch(/^Copyright \(c\) 20\d\d /);
      expect(theme?.source?.url, `${id} source repository`).toMatch(/^https:\/\/github\.com\//);
    }
    expect(builtinTheme('github-dark-default')?.name, 'the GitHub trademark is not claimed').toBe('GitHub Dark Default (port)');
  });
});

describe('fallback orders and derived values', () => {
  it('derives every surface and accent for a theme with only an editor background and a foreground', () => {
    const dark = mapped(minimal({}));
    expect(dark.kind, 'luminance of #101010 is dark').toBe('dark');
    expect(dark.tokens['surface.window'], 'dark window: content mixed 15% toward black').toBe('#0e0e0e');
    expect(dark.tokens['surface.sidebar'], 'sidebar falls back to content').toBe('#101010');
    expect(dark.tokens['surface.inset'], 'inset: 6% toward black').toBe('#0f0f0f');
    expect(dark.tokens['accent'], 'accent falls back to the Agide accent of the kind').toBe(builtinTheme('agide-dark')?.tokens?.['accent']);
    expect(dark.tokens['danger.fg'], 'status colours fall back to the Agide values').toBe(builtinTheme('agide-dark')?.tokens?.['danger.fg']);
    const light = mapped(minimal({ 'editor.background': '#ffffff', foreground: '#222222' }));
    expect(light.kind, 'white is light').toBe('light');
    expect(light.tokens['surface.window'], 'light window: content mixed 4% toward black').toBe('#f5f5f5');
  });

  it('prefers the title bar over the activity bar over the tab strip for the window', () => {
    expect(mapped(minimal({ 'titleBar.activeBackground': '#111111', 'activityBar.background': '#222222' })).tokens['surface.window'], 'first key').toBe('#111111');
    expect(mapped(minimal({ 'activityBar.background': '#222222', 'editorGroupHeader.tabsBackground': '#333333' })).tokens['surface.window'], 'second key').toBe('#222222');
    expect(mapped(minimal({ 'editorGroupHeader.tabsBackground': '#333333' })).tokens['surface.window'], 'third key').toBe('#333333');
  });

  it('uses the editor widget for raised and the menu for overlay before the editor widget', () => {
    const theme = mapped(minimal({ 'editorWidget.background': '#202020', 'menu.background': '#2a2a2a' }));
    expect([theme.tokens['surface.raised'], theme.tokens['surface.overlay']], 'raised, overlay').toEqual(['#202020', '#2a2a2a']);
  });

  it('uses input.border only when it reaches 3 to 1 against the content', () => {
    expect(mapped(minimal({ 'input.border': '#777777' })).original['border.strong'], 'strong enough').toBe('#777777');
    expect(mapped(minimal({ 'input.border': '#202020' })).original['border.strong'], 'too faint, derived instead').not.toBe('#202020');
  });

  it('counts a fully transparent border as missing', () => {
    const faint = mapped(minimal({ 'panel.border': '#ffffff00', 'sideBar.border': '#303030' }));
    expect(faint.tokens['border.default'], 'the next key supplies the border').toBe('#303030');
  });

  it('composites the accent text colour keys over the content', () => {
    const theme = mapped(minimal({ 'textLink.foreground': '#4080ffcc' }));
    expect(theme.original['text.link'], 'alpha link over the content').toBe('#366acf');
  });

  it('maps the terminal background through terminal, panel and editor', () => {
    expect(mapped(minimal({ 'terminal.background': '#050505', 'panel.background': '#060606' })).tokens['terminal.background'], 'terminal key').toBe('#050505');
    expect(mapped(minimal({ 'panel.background': '#060606' })).tokens['terminal.background'], 'panel key').toBe('#060606');
    expect(mapped(minimal({})).tokens['terminal.background'], 'editor key').toBe('#101010');
  });

  it('fills a missing ANSI colour with the Agide value of the same kind', () => {
    const theme = mapped(minimal({ 'terminal.ansiRed': '#ff0000' }));
    expect(theme.tokens['terminal.red'], 'defined colour').toBe('#ff0000');
    expect(theme.tokens['terminal.green'], 'missing colour').toBe(builtinTheme('agide-dark')?.tokens?.['terminal.green']);
  });
});

describe('kind detection', () => {
  it('prefers the theme type, then uiTheme, then the luminance of the editor background', () => {
    expect(detectKind({ type: 'light', uiTheme: 'vs-dark', editorBackground: '#000000' }), 'type wins').toEqual({ kind: 'light', highContrast: false });
    expect(detectKind({ uiTheme: 'vs', editorBackground: '#000000' }), 'uiTheme vs').toEqual({ kind: 'light', highContrast: false });
    expect(detectKind({ uiTheme: 'hc-black', editorBackground: '#ffffff' }), 'hc-black is dark with high contrast').toEqual({ kind: 'dark', highContrast: true });
    expect(detectKind({ uiTheme: 'hc-light', editorBackground: '#000000' }), 'hc-light is light with high contrast').toEqual({ kind: 'light', highContrast: true });
    expect(detectKind({ type: 'hc', editorBackground: '#ffffff' }), 'type hc').toEqual({ kind: 'dark', highContrast: true });
    expect(detectKind({ editorBackground: '#2b2b2b' }).kind, 'dark luminance').toBe('dark');
    expect(detectKind({ editorBackground: '#9a9a9a' }).kind, 'light luminance').toBe('light');
  });
});

describe('refusals', () => {
  it('refuses a theme that uses include', () => {
    const result = mapVsCodeTheme({ file: { include: './base.json', colors: {} } });
    expect(result.ok ? undefined : result.issues[0]?.code, 'include_unsupported').toBe('include_unsupported');
  });

  it('refuses a theme without an editor background or a foreground, with the key as JSON Pointer', () => {
    const noEditor = mapVsCodeTheme({ file: { colors: { foreground: '#ffffff' } } });
    expect(noEditor.ok ? undefined : [noEditor.issues[0]?.code, noEditor.issues[0]?.path], 'missing editor.background').toEqual(['missing_token', '/colors/editor.background']);
    const noText = mapVsCodeTheme({ file: { colors: { 'editor.background': '#000000' } } });
    expect(noText.ok ? undefined : noText.issues[0]?.path, 'missing foreground').toBe('/colors/foreground');
  });
});
