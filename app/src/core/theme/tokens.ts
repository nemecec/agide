/** The token catalogue of 0035 section 1. A theme file names tokens with dotted keys; the CSS name replaces dots with dashes. */

export type TokenType = 'colour' | 'cssColour' | 'shadow' | 'length' | 'duration' | 'font' | 'integer' | 'easing' | 'text';

export interface TokenDefinition {
  readonly key: string;
  readonly type: TokenType;
  /** A theme without `extends` must define every required token. */
  readonly required: boolean;
}

const SURFACES = ['window', 'sidebar', 'content', 'raised', 'overlay', 'inset'] as const;
const STATUSES = ['success', 'warning', 'danger', 'info'] as const;
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
const capitalised = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export const SURFACE_KEYS = SURFACES.map((name) => `surface.${name}`);
export const STATUS_KEYS = STATUSES.flatMap((name) => [`${name}.fg`, `${name}.bg`]);
export const TERMINAL_COLOUR_NAMES = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selection',
  'selectionInactive',
  ...ANSI,
  ...ANSI.map((name) => `bright${capitalised(name)}`),
] as const;

const colours = (keys: readonly string[]): TokenDefinition[] => keys.map((key) => ({ key, type: 'colour', required: true }));

const THEMED: TokenDefinition[] = [
  ...colours(SURFACE_KEYS),
  { key: 'surface.backdrop', type: 'cssColour', required: true },
  ...colours(['text.primary', 'text.secondary', 'text.tertiary', 'text.inverse', 'text.link']),
  ...colours(['border.subtle', 'border.default', 'border.strong']),
  ...colours(['accent', 'accent.hover', 'accent.active', 'accent.subtle', 'accent.text', 'accent.on']),
  ...colours(STATUS_KEYS),
  ...colours(['danger.fill', 'selection', 'selection.inactive', 'focus.ring', 'tooltip.bg']),
  ...colours(TERMINAL_COLOUR_NAMES.map((name) => `terminal.${name}`)),
  ...[1, 2, 3].map((level): TokenDefinition => ({ key: `shadow.${level}`, type: 'shadow', required: true })),
  { key: 'font.ui', type: 'font', required: true },
  { key: 'font.mono', type: 'font', required: true },
];

const SCALED: TokenDefinition[] = [
  ...['xs', 'sm', 'md', 'lg', 'xl', 'full'].map((name): TokenDefinition => ({ key: `radius.${name}`, type: 'length', required: false })),
  ...['0', '0_5', '1', '1_5', '2', '2_5', '3', '4', '5', '6', '8'].map((step): TokenDefinition => ({ key: `space.${step}`, type: 'length', required: false })),
  ...['dock-overlay', 'pane-chrome', 'popover', 'menu', 'dialog', 'tooltip', 'capture-mask'].map((name): TokenDefinition => ({ key: `z.${name}`, type: 'integer', required: false })),
  ...['regular', 'medium', 'semibold'].map((name): TokenDefinition => ({ key: `font.weight.${name}`, type: 'integer', required: false })),
  { key: 'font.numeric', type: 'text', required: false },
  ...['xs', 'sm', 'md', 'lg', 'xl'].map((name): TokenDefinition => ({ key: `icon.${name}`, type: 'length', required: false })),
  ...['fast', 'base', 'slow'].map((name): TokenDefinition => ({ key: `motion.${name}`, type: 'duration', required: false })),
  ...['standard', 'enter', 'exit'].map((name): TokenDefinition => ({ key: `ease.${name}`, type: 'easing', required: false })),
  { key: 'focus.width', type: 'length', required: false },
];

/** Tokens the app computes from `text.primary`; a theme file cannot set them. */
export const COMPUTED_TOKENS = ['surface.hover', 'surface.pressed', 'scrollbar.thumb'] as const;

export const TOKENS: readonly TokenDefinition[] = [...THEMED, ...SCALED];
export const TOKEN_KEYS: readonly string[] = [...TOKENS.map((token) => token.key), ...COMPUTED_TOKENS];
export const REQUIRED_TOKEN_KEYS: readonly string[] = TOKENS.filter((token) => token.required).map((token) => token.key);

const BY_KEY = new Map(TOKENS.map((token) => [token.key, token]));

export const tokenDefinition = (key: string): TokenDefinition | undefined => BY_KEY.get(key);
export const isComputedToken = (key: string): boolean => (COMPUTED_TOKENS as readonly string[]).includes(key);

/** `surface.window` becomes `--agide-surface-window`. */
export const cssName = (key: string): string => `--agide-${key.replaceAll('.', '-')}`;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const CSS_COLOUR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([0-9a-z .,%/]+\))$/i;
const LENGTH = /^(?:0|-?\d+(?:\.\d+)?px)$/;
const DURATION = /^\d+(?:\.\d+)?ms$/;
const EASING = /^cubic-bezier\(\s*[\d.\s,-]+\)$/;
const SHADOW = /^[0-9a-z .,()%/#-]+$/i;

/** True when `value` is a legal value for the token type. */
export function isValidValue(type: TokenType, value: string): boolean {
  switch (type) {
    case 'colour':
      return HEX.test(value);
    case 'cssColour':
      return CSS_COLOUR.test(value);
    case 'length':
      return LENGTH.test(value);
    case 'duration':
      return DURATION.test(value);
    case 'easing':
      return EASING.test(value);
    case 'shadow':
      return SHADOW.test(value) && value.length <= 300;
    case 'integer':
      return /^\d{1,4}$/.test(value);
    case 'font':
    case 'text':
      return /^[^;{}<>]{1,200}$/.test(value);
  }
}

export const TYPE_DESCRIPTION: Record<TokenType, string> = {
  colour: 'a hex colour (#rgb or #rrggbb)',
  cssColour: 'a hex colour or an rgb() colour',
  shadow: 'a CSS box-shadow value',
  length: 'a length in px',
  duration: 'a duration in ms',
  font: 'a font stack',
  integer: 'a whole number',
  easing: 'a cubic-bezier() value',
  text: 'a plain value',
};

/** The token names closest to an unknown one: shared words first, then edit distance. */
export function closestTokens(unknown: string, limit = 3): string[] {
  const words = unknown.split('.');
  const score = (key: string): number => {
    const shared = key.split('.').filter((word) => words.includes(word)).length;
    return shared * 100 - editDistance(unknown, key);
  };
  return [...TOKEN_KEYS].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}
