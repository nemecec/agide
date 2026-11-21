import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, builtinTheme } from './builtin/index';
import { ratio } from './colour';
import { checkIncreased, checkPairs, PAIR_SPECS } from './contrast';
import { resolveTheme } from './resolve';

const light = builtinTheme('agide-light');
const dark = builtinTheme('agide-dark');
if (!light || !dark) throw new Error('built-in themes missing');

const cases = [
  ...BUILTIN_THEMES.flatMap((theme) =>
    theme.kind === 'system'
      ? [
          { name: 'system (light)', tokens: resolveTheme({ theme }).tokens },
          { name: 'system (dark)', tokens: resolveTheme({ theme, appearance: { dark: true, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false } }).tokens },
        ]
      : [{ name: theme.id, tokens: resolveTheme({ theme }).tokens }],
  ),
];

describe('contrast table of 0035 section 1.8', () => {
  it.each(cases)('every pair reaches its target in $name', ({ tokens }) => {
    const misses = checkPairs(tokens).filter((pair) => !pair.ok);
    expect(
      misses.map((pair) => `${pair.use}: ${pair.foreground} on ${pair.background} is ${pair.ratio.toFixed(2)}, target ${pair.target}`),
      'pairs below their target',
    ).toEqual([]);
  });

  it('measures the pairs of the table with the documented ratios', () => {
    const tokens = resolveTheme({ theme: light }).tokens;
    const measured = (foreground: string, background: string) => checkPairs(tokens).find((pair) => pair.foreground === foreground && pair.background === background)?.ratio ?? 0;
    expect(measured('text.primary', 'surface.window').toFixed(2), 'primary on window, light').toBe('14.27');
    expect(measured('text.tertiary', 'selection').toFixed(2), 'tertiary on selection, light').toBe('4.83');
    expect(measured('border.strong', 'surface.raised').toFixed(2), 'field border on raised, light').toBe('3.61');
    const darkTokens = resolveTheme({ theme: dark }).tokens;
    expect(ratio(darkTokens['accent.on'] ?? '', darkTokens['accent'] ?? '').toFixed(2), 'text on accent, dark').toBe('4.88');
  });

  it('covers the use groups of the table', () => {
    const uses = new Set(PAIR_SPECS.map((spec) => spec.use));
    for (const use of ['link', 'text on fill', 'tooltip text', 'status chip', 'focus ring', 'field border', 'accent indicator']) {
      expect(uses.has(use), `the table has the group "${use}"`).toBe(true);
    }
  });

  it('detects a pair below target', () => {
    const tokens = { ...resolveTheme({ theme: light }).tokens, 'text.tertiary': '#cccccc' };
    expect(checkPairs(tokens).some((pair) => pair.foreground === 'text.tertiary' && !pair.ok), 'a pale tertiary colour fails').toBe(true);
  });
});

describe('increased contrast overrides', () => {
  it.each([light, dark])('keep their targets over every surface in $id', (theme) => {
    const tokens = resolveTheme({ theme }).tokens;
    const results = checkIncreased(tokens, theme.increasedContrast ?? {});
    expect(
      results.filter((result) => !result.ok).map((result) => `${result.token} lowest ${result.lowest.toFixed(2)}, target ${result.target}`),
      'overrides below their target',
    ).toEqual([]);
    expect(results.length, 'every override of 7.2 is checked').toBeGreaterThan(0);
  });

  it('reports the lowest ratios of the table', () => {
    const results = checkIncreased(resolveTheme({ theme: light }).tokens, light.increasedContrast ?? {});
    const lowest = (token: string) => results.find((result) => result.token === token)?.lowest.toFixed(2);
    expect(lowest('text.primary'), 'primary, light').toBe('16.80');
    expect(lowest('border.default'), 'default border, light').toBe('3.40');
  });
});
