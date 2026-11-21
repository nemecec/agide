import { describe, expect, it } from 'vitest';
import { deriveAccent } from './accent';
import { builtinTheme } from './builtin/index';
import { ratio } from './colour';
import { checkPairs } from './contrast';
import { resolveTheme } from './resolve';

const system = builtinTheme('system');
if (!system) throw new Error('system theme missing');
const appearance = (dark: boolean, accent: string | null) => ({ dark, accent, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false });
const tokensFor = (dark: boolean, accent: string | null) => resolveTheme({ theme: system, appearance: appearance(dark, accent) }).tokens;

/** Sample OS accents of table 1.8 with the fill, the text form and the selection that the derivation gives. */
const SAMPLES = [
  { name: 'blue', os: '#007aff', fill: '#0070eb', textLight: '#006be0', textDark: '#3d9aff', selectionLight: '#d1e2f6', selectionDark: '#1c395c' },
  { name: 'purple', os: '#953d96', fill: '#953d96', textLight: '#953d96', textDark: '#bd87be', selectionLight: '#e8ddea', selectionDark: '#472c49' },
  { name: 'pink', os: '#f74f9e', fill: '#cb4182', textLight: '#bc3c78', textDark: '#f861a8', selectionLight: '#f4d9e7', selectionDark: '#532e42' },
  { name: 'yellow', os: '#ffc600', fill: '#8f6f00', textLight: '#8a6b00', textDark: '#ffc600', selectionLight: '#f5ebc9', selectionDark: '#3f3823' },
  { name: 'graphite', os: '#8c8c8c', fill: '#767676', textLight: '#6d6d6d', textDark: '#989898', selectionLight: '#e0e0e2', selectionDark: '#38383a' },
];

const ALL_ACCENTS = ['#007aff', '#953d96', '#f74f9e', '#e0383e', '#f7821b', '#ffc600', '#62ba46', '#8c8c8c', '#000000', '#ffffff'];

describe('System theme accent derivation', () => {
  it.each(SAMPLES)('gives the documented values for the $name accent', (sample) => {
    const light = tokensFor(false, sample.os);
    const dark = tokensFor(true, sample.os);
    expect(light['accent'], 'fill for white text').toBe(sample.fill);
    expect(light['accent.text'], 'text form on light surfaces').toBe(sample.textLight);
    expect(dark['accent.text'], 'text form on dark surfaces').toBe(sample.textDark);
    expect(light['selection'], 'selection, light').toBe(sample.selectionLight);
    expect(dark['selection'], 'selection, dark').toBe(sample.selectionDark);
  });

  it.each(ALL_ACCENTS.flatMap((os) => [false, true].map((dark) => ({ os, dark }))))('keeps every pair of the contrast table for $os (dark: $dark)', ({ os, dark }) => {
    const misses = checkPairs(tokensFor(dark, os)).filter((pair) => !pair.ok);
    expect(misses.map((pair) => `${pair.foreground} on ${pair.background} ${pair.ratio.toFixed(2)}`), 'pairs below target').toEqual([]);
  });

  it('keeps white text readable on the derived fills', () => {
    const tokens = tokensFor(false, '#ffc600');
    for (const fill of ['accent', 'accent.hover', 'accent.active']) {
      expect(ratio('#ffffff', tokens[fill] ?? '#000000'), `white on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the Agide accent when the OS accent is unknown or multicolour', () => {
    const agide = builtinTheme('agide-light')?.tokens?.['accent'];
    expect(tokensFor(false, null)['accent'], 'no accent reported').toBe(agide);
  });

  it('gives no override when no derivation reaches its targets', () => {
    const base = tokensFor(false, null);
    expect(deriveAccent({ ...base, 'surface.window': '#000000', 'surface.content': '#808080', 'surface.sidebar': '#808080', 'surface.raised': '#808080', 'surface.overlay': '#808080' }, false, '#808080'), 'derivation fails on mid grey surfaces').toBeUndefined();
  });

  it('leaves Agide Light and Agide Dark on the Agide blue', () => {
    for (const id of ['agide-light', 'agide-dark']) {
      const theme = builtinTheme(id);
      if (!theme) throw new Error(id);
      const resolved = resolveTheme({ theme, appearance: appearance(id === 'agide-dark', '#f74f9e') });
      expect(resolved.tokens['accent'], `${id} accent`).toBe(theme.tokens?.['accent']);
    }
  });
});
