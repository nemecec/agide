import { deriveAccent } from './accent';
import { DEFAULT_APPEARANCE, type AppearanceState } from './appearance';
import { builtinTheme } from './builtin/index';
import { withAlpha } from './colour';
import type { TokenValues } from './contrast';
import { SCALE_DEFAULTS, typeAndDensityVariables, type Density } from './scale';
import type { ThemeDocument, ThemeVariant } from './schema';
import { cssName, TERMINAL_COLOUR_NAMES } from './tokens';

export interface ResolveInput {
  readonly theme: ThemeDocument;
  readonly appearance?: AppearanceState;
  readonly density?: Density;
  readonly reducedMotion?: boolean;
}

/** An xterm `ITheme`, as plain strings. */
export type TerminalTheme = Record<string, string>;

export interface ResolvedTheme {
  readonly id: string;
  /** The appearance the tokens belong to; sets `color-scheme` and the dock scheme. */
  readonly scheme: 'light' | 'dark';
  readonly contrast: 'normal' | 'more';
  /** Every token by dotted key, computed tokens included. */
  readonly tokens: TokenValues;
  /** The same tokens by CSS custom property name, with the type and density variables. */
  readonly variables: Readonly<Record<string, string>>;
  readonly terminal: TerminalTheme;
  readonly dock: Readonly<Record<string, string>>;
}

const HOVER_PERCENT = { light: 6, dark: 8 } as const;
const PRESSED_PERCENT = { light: 10, dark: 12 } as const;
const SCROLLBAR_PERCENT = { light: 25, dark: 30 } as const;
const REDUCED_MOTION_TOKENS = ['motion.fast', 'motion.base', 'motion.slow'];

function variantOf(theme: ThemeDocument, scheme: 'light' | 'dark'): ThemeVariant {
  if (theme.kind !== 'system') return theme;
  const side = theme[scheme];
  if (!side) throw new Error(`system theme ${theme.id} has no ${scheme} variant`);
  return side;
}

function baseOf(variant: ThemeVariant, scheme: 'light' | 'dark'): ThemeVariant {
  const base = builtinTheme(variant.extends ?? `agide-${scheme}`) ?? builtinTheme(`agide-${scheme}`);
  if (!base) throw new Error(`built-in theme agide-${scheme} is missing`);
  return base;
}

/** The XTerm field name of a `terminal.*` token. */
const xtermField = (name: string): string => (name === 'selection' ? 'selectionBackground' : name === 'selectionInactive' ? 'selectionInactiveBackground' : name);

/** The xterm theme: the terminal tokens, the scrollbar at rising strengths of `text.primary`, then the theme's own `terminal` block. */
function terminalTheme(tokens: TokenValues, overrides: Readonly<Record<string, string>>, scheme: 'light' | 'dark'): TerminalTheme {
  const theme: TerminalTheme = {};
  for (const name of TERMINAL_COLOUR_NAMES) theme[xtermField(name)] = tokens[`terminal.${name}`] ?? '';
  const thumb = tokens['text.primary'] ?? '#000000';
  const strength = SCROLLBAR_PERCENT[scheme];
  theme['scrollbarSliderBackground'] = withAlpha(thumb, strength / 100);
  theme['scrollbarSliderHoverBackground'] = withAlpha(thumb, (strength + 15) / 100);
  theme['scrollbarSliderActiveBackground'] = withAlpha(thumb, (strength + 30) / 100);
  return { ...theme, ...overrides };
}

/** Resolves a theme for the OS appearance, the density and the motion preference into tokens and CSS variables. */
export function resolveTheme(input: ResolveInput): ResolvedTheme {
  const appearance = input.appearance ?? DEFAULT_APPEARANCE;
  const theme = input.theme;
  const scheme: 'light' | 'dark' = theme.kind === 'system' ? (appearance.dark ? 'dark' : 'light') : theme.kind;
  const variant = variantOf(theme, scheme);
  const base = baseOf(variant, scheme);
  const tokens: Record<string, string> = { ...SCALE_DEFAULTS, ...base.tokens };

  if (theme.kind === 'system' && appearance.accent) Object.assign(tokens, deriveAccent(tokens, scheme === 'dark', appearance.accent));
  Object.assign(tokens, variant.tokens);

  const contrast = appearance.highContrast ? 'more' : 'normal';
  if (contrast === 'more') {
    const overrides = variant.increasedContrast ?? base.increasedContrast ?? {};
    if (overrides['border.default'] !== undefined) tokens['border.subtle'] = tokens['border.default'] ?? '';
    Object.assign(tokens, overrides);
    tokens['focus.width'] = '3px';
  }

  const primary = 'var(--agide-text-primary)';
  const multiplier = contrast === 'more' ? 2 : 1;
  tokens['surface.hover'] = `color-mix(in srgb, ${primary} ${HOVER_PERCENT[scheme] * multiplier}%, transparent)`;
  tokens['surface.pressed'] = `color-mix(in srgb, ${primary} ${PRESSED_PERCENT[scheme]}%, transparent)`;
  tokens['scrollbar.thumb'] = `color-mix(in srgb, ${primary} ${SCROLLBAR_PERCENT[scheme]}%, transparent)`;

  if (input.reducedMotion) for (const key of REDUCED_MOTION_TOKENS) tokens[key] = '0ms';

  const terminal = terminalTheme(tokens, { ...base.terminal, ...variant.terminal }, scheme);
  const variables: Record<string, string> = typeAndDensityVariables(input.density ?? 'regular');
  for (const [key, value] of Object.entries(tokens)) variables[cssName(key)] = value;
  return { id: theme.id, scheme, contrast, tokens, variables, terminal, dock: { ...base.dock, ...variant.dock } };
}
