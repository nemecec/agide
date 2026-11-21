import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, builtinTheme } from './builtin/index';
import { resolveTheme } from './resolve';
import { REQUIRED_TOKEN_KEYS, TOKEN_KEYS, cssName } from './tokens';

const system = builtinTheme('system');
const lightTheme = builtinTheme('agide-light');
if (!system || !lightTheme) throw new Error('built-in themes missing');
const state = { dark: false, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false };

describe('token set', () => {
  it.each(BUILTIN_THEMES.map((theme) => ({ id: theme.id, theme })))('$id resolves every token of section 1', ({ theme }) => {
    for (const dark of [false, true]) {
      const resolved = resolveTheme({ theme, appearance: { ...state, dark } });
      const missing = TOKEN_KEYS.filter((key) => resolved.tokens[key] === undefined);
      expect(missing, `tokens missing in ${theme.id} (dark: ${dark})`).toEqual([]);
      expect(resolved.variables[cssName('surface.window')], 'the CSS variable of a token').toBe(resolved.tokens['surface.window']);
    }
  });

  it('defines every required token in the two Agide files without extends', () => {
    for (const id of ['agide-light', 'agide-dark']) {
      const tokens = builtinTheme(id)?.tokens ?? {};
      expect(REQUIRED_TOKEN_KEYS.filter((key) => !(key in tokens)), `required tokens missing in ${id}`).toEqual([]);
    }
  });

  it('names CSS variables by replacing dots with dashes', () => {
    expect(cssName('surface.window'), 'dotted key').toBe('--agide-surface-window');
    expect(cssName('space.0_5'), 'half step').toBe('--agide-space-0_5');
  });
});

describe('resolveTheme', () => {
  it('picks the scheme of a System theme from the OS appearance', () => {
    expect(resolveTheme({ theme: system, appearance: { ...state, dark: true } }).scheme, 'dark OS').toBe('dark');
    expect(resolveTheme({ theme: system, appearance: state }).scheme, 'light OS').toBe('light');
  });

  it('keeps a fixed theme in its own scheme whatever the OS says', () => {
    expect(resolveTheme({ theme: lightTheme, appearance: { ...state, dark: true } }).scheme, 'Agide Light in a dark OS').toBe('light');
  });

  it('computes hover, pressed and scrollbar tokens from the primary text token', () => {
    const resolved = resolveTheme({ theme: lightTheme });
    expect(resolved.tokens['surface.hover'], 'hover fill').toBe('color-mix(in srgb, var(--agide-text-primary) 6%, transparent)');
    expect(resolved.tokens['surface.pressed'], 'press fill').toContain('10%');
    expect(resolved.tokens['scrollbar.thumb'], 'scrollbar thumb').toContain('25%');
  });

  it('applies the increased contrast overrides, moves the old default border to subtle and doubles hover', () => {
    const normal = resolveTheme({ theme: lightTheme });
    const more = resolveTheme({ theme: lightTheme, appearance: { ...state, highContrast: true } });
    expect(more.contrast, 'contrast mode').toBe('more');
    expect(more.tokens['text.primary'], 'primary text override').toBe('#000000');
    expect(more.tokens['border.subtle'], 'subtle takes the old default border').toBe(normal.tokens['border.default']);
    expect(more.tokens['focus.width'], 'focus ring width').toBe('3px');
    expect(more.tokens['surface.hover'], 'hover percentage doubles').toContain('12%');
  });

  it('sets the motion durations to zero under reduced motion', () => {
    const resolved = resolveTheme({ theme: lightTheme, reducedMotion: true });
    expect([resolved.tokens['motion.fast'], resolved.tokens['motion.base'], resolved.tokens['motion.slow']], 'durations').toEqual(['0ms', '0ms', '0ms']);
  });

  it('builds the terminal theme from the terminal tokens and the scrollbar strengths', () => {
    const resolved = resolveTheme({ theme: system, appearance: { ...state, dark: true } });
    expect(resolved.terminal['background'], 'terminal background equals the content surface').toBe(resolved.tokens['surface.content']);
    expect(resolved.terminal['selectionBackground'], 'selection field').toBe(resolved.tokens['terminal.selection']);
    expect(resolved.terminal['brightWhite'], 'bright white').toBe('#ffffff');
    expect(resolved.terminal['scrollbarSliderBackground'], 'scrollbar at 30 percent').toMatch(/^#[0-9a-f]{6}4d$/);
  });

  it('lets a theme override terminal fields and dock variables', () => {
    const theme = { ...lightTheme, id: 'custom-light', terminal: { red: '#111111' }, dock: { '--dv-tab-font-size': '11px' } };
    const resolved = resolveTheme({ theme });
    expect(resolved.terminal['red'], 'terminal block wins over tokens').toBe('#111111');
    expect(resolved.dock['--dv-tab-font-size'], 'dock block').toBe('11px');
  });

  it('emits type and density variables for the chosen density', () => {
    expect(resolveTheme({ theme: lightTheme, density: 'compact' }).variables['--agide-density-row'], 'compact row').toBe('22px');
    expect(resolveTheme({ theme: lightTheme }).variables['--agide-density-row'], 'regular row').toBe('24px');
    expect(resolveTheme({ theme: lightTheme }).variables['--agide-type-body-size'], 'body size').toBe('13px');
  });

  it('refuses a system theme without a variant', () => {
    expect(() => resolveTheme({ theme: { ...system, dark: undefined }, appearance: { ...state, dark: true } }), 'missing dark variant').toThrow(/no dark variant/);
  });
});
