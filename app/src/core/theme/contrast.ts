import { clampTo, ratio } from './colour';

/** Token values by dotted key. */
export type TokenValues = Readonly<Record<string, string>>;

export interface PairSpec {
  readonly use: string;
  readonly foreground: string;
  readonly backgrounds: readonly string[];
  readonly target: number;
}

const TEXT_SURFACES = ['surface.window', 'surface.sidebar', 'surface.content', 'surface.raised', 'surface.overlay', 'surface.inset', 'selection', 'selection.inactive'];
const CARRIER_SURFACES = ['surface.window', 'surface.content', 'surface.sidebar', 'surface.raised', 'surface.overlay'];
const STATUS_SURFACES = [...CARRIER_SURFACES, 'selection', 'selection.inactive'];
const STATUSES = ['success', 'warning', 'danger', 'info'] as const;

/** The pairs of table 1.8 of 0035. Text targets 4.5 to 1; non-text marks 3 to 1. */
export const PAIR_SPECS: readonly PairSpec[] = [
  ...['text.primary', 'text.secondary', 'text.tertiary'].map((foreground): PairSpec => ({ use: `${foreground} text`, foreground, backgrounds: TEXT_SURFACES, target: 4.5 })),
  { use: 'link', foreground: 'text.link', backgrounds: CARRIER_SURFACES, target: 4.5 },
  { use: 'text on fill', foreground: 'accent.on', backgrounds: ['accent', 'accent.hover', 'accent.active', 'danger.fill'], target: 4.5 },
  { use: 'tooltip text', foreground: 'text.inverse', backgrounds: ['tooltip.bg'], target: 4.5 },
  { use: 'accent text on subtle', foreground: 'accent.text', backgrounds: ['accent.subtle'], target: 4.5 },
  ...['text.primary', 'text.secondary', 'text.tertiary'].map((foreground): PairSpec => ({ use: `${foreground} on accent subtle`, foreground, backgrounds: ['accent.subtle'], target: 4.5 })),
  ...STATUSES.flatMap((status): PairSpec[] => [
    { use: 'status chip', foreground: `${status}.fg`, backgrounds: [`${status}.bg`], target: 4.5 },
    { use: 'banner and notice text', foreground: 'text.primary', backgrounds: [`${status}.bg`], target: 4.5 },
    { use: 'status text and icon', foreground: `${status}.fg`, backgrounds: STATUS_SURFACES, target: 4.5 },
  ]),
  { use: 'focus ring', foreground: 'focus.ring', backgrounds: [...TEXT_SURFACES, 'accent.subtle'], target: 3 },
  { use: 'field border', foreground: 'border.strong', backgrounds: TEXT_SURFACES.slice(0, 6), target: 3 },
  { use: 'accent indicator', foreground: 'accent.text', backgrounds: [...CARRIER_SURFACES, 'selection'], target: 3 },
];

export interface PairResult {
  readonly use: string;
  readonly foreground: string;
  readonly background: string;
  readonly target: number;
  readonly ratio: number;
  readonly ok: boolean;
}

function value(tokens: TokenValues, key: string): string {
  const found = tokens[key];
  if (found === undefined) throw new Error(`token ${key} is missing`);
  return found;
}

/** Measures every pair of the table against one resolved token set. */
export function checkPairs(tokens: TokenValues): PairResult[] {
  return PAIR_SPECS.flatMap((spec) =>
    spec.backgrounds.map((background) => {
      const measured = ratio(value(tokens, spec.foreground), value(tokens, background));
      return { use: spec.use, foreground: spec.foreground, background, target: spec.target, ratio: measured, ok: measured >= spec.target };
    }),
  );
}

/** The override tokens of 7.2 and the target each must keep over every surface and both selection colours. */
export const INCREASED_TARGETS: Readonly<Record<string, number>> = {
  'text.primary': 7,
  'text.secondary': 7,
  'text.tertiary': 4.5,
  'border.default': 3,
  'border.strong': 4.5,
  'focus.ring': 4.5,
};

export interface IncreasedResult {
  readonly token: string;
  readonly value: string;
  readonly lowest: number;
  readonly target: number;
  readonly ok: boolean;
}

/** Measures the increased-contrast overrides against the surfaces of `tokens`. */
export function checkIncreased(tokens: TokenValues, overrides: TokenValues): IncreasedResult[] {
  return Object.entries(INCREASED_TARGETS).map(([token, target]) => {
    const override = value(overrides, token);
    const lowest = Math.min(...TEXT_SURFACES.map((surface) => ratio(override, value(tokens, surface))));
    return { token, value: override, lowest, target, ok: lowest >= target };
  });
}

export interface ContrastWarning {
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly target: number;
  /** The foreground moved toward white or black until it passes, when such a value exists. */
  readonly adjusted: string | undefined;
}

/** The pairs below target, with the value a clamp would use. */
export function contrastWarnings(tokens: TokenValues, dark: boolean): ContrastWarning[] {
  const towards = dark ? '#ffffff' : '#000000';
  return checkPairs(tokens)
    .filter((pair) => !pair.ok)
    .map((pair) => ({
      foreground: pair.foreground,
      background: pair.background,
      ratio: pair.ratio,
      target: pair.target,
      adjusted: clampTo(value(tokens, pair.foreground), towards, value(tokens, pair.background), pair.target).colour,
    }));
}
