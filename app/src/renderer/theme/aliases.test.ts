// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { builtinTheme, resolveTheme, type ThemeDocument } from '../../core/theme/index';
import { ALIAS_ROWS } from '../../core/theme/vscode/aliasTable';
import { aliasVariables } from './aliases';

const resolveOf = (id: string, dark = false) => {
  const theme = builtinTheme(id) as ThemeDocument;
  return { theme, resolved: resolveTheme({ theme, appearance: { dark, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false } }) };
};

describe('--vscode-* aliases', () => {
  it.each([
    ['system', false],
    ['system', true],
    ['agide-light', false],
    ['agide-dark', true],
    ['catppuccin-mocha', true],
  ] as const)('defines every alias of the set for %s (OS dark: %s)', (id, dark) => {
    const { theme, resolved } = resolveOf(id, dark);
    const variables = aliasVariables(theme, resolved);
    const missing = ALIAS_ROWS.filter((row) => !variables[row.name]).map((row) => row.name);
    expect(missing, 'aliases without a value').toEqual([]);
    expect(Object.keys(variables), 'the variables are exactly the set of 6.3').toEqual(ALIAS_ROWS.map((row) => row.name));
  });

  it('points an Agide theme at its tokens', () => {
    const { theme, resolved } = resolveOf('agide-light');
    const variables = aliasVariables(theme, resolved);
    expect(variables['--vscode-foreground'], 'foreground reads the primary text').toBe('var(--agide-text-primary)');
    expect(variables['--vscode-button-background'], 'button background reads the accent').toBe('var(--agide-accent)');
    expect(variables['--vscode-panel--background'], 'the double dash spelling of the package').toBe('var(--agide-surface-content)');
    expect(variables['--vscode-font-size'], 'font size literal').toBe('13px');
    expect(variables['--vscode-tree-inactiveIndentGuidesStroke'], 'half strength guide').toBe('color-mix(in srgb, var(--agide-border-subtle) 50%, transparent)');
    expect(variables['--vscode-widget-shadow'], 'colour part of shadow.2').toBe('rgb(0 0 0 / 12%)');
  });

  it('picks the field background by scheme', () => {
    const light = resolveOf('agide-light');
    const dark = resolveOf('agide-dark', true);
    expect(aliasVariables(light.theme, light.resolved)['--vscode-settings-textInputBackground'], 'light field').toBe('var(--agide-surface-content)');
    expect(aliasVariables(dark.theme, dark.resolved)['--vscode-settings-textInputBackground'], 'dark field').toBe('var(--agide-surface-inset)');
  });

  it('gives an imported theme its original value when the key exists and the clamp did not move the token', () => {
    const { theme, resolved } = resolveOf('github-dark-default', true);
    const variables = aliasVariables(theme, resolved);
    expect(variables['--vscode-list-activeSelectionBackground'], 'original alpha colour').toBe('#6e768166');
    expect(variables['--vscode-button-background'], 'original button colour').toBe('#238636');
    expect(variables['--vscode-menu-background'], 'a key the file lacks reads its token').toBe('var(--agide-surface-overlay)');
  });

  it('uses the token when the clamp moved the value behind the alias', () => {
    const { theme, resolved } = resolveOf('github-dark-default', true);
    expect(theme.source?.adjustments?.some((adjustment) => adjustment.token === 'focus.ring'), 'the focus ring was clamped').toBe(true);
    expect(aliasVariables(theme, resolved)['--vscode-focusBorder'], 'the alias follows the clamped token').toBe('var(--agide-focus-ring)');
  });
});
