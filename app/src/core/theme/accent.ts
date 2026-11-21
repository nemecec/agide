import { clampTo, clampUntil, mix, ratio } from './colour';
import type { TokenValues } from './contrast';

const STATUS_FOREGROUNDS = ['success.fg', 'warning.fg', 'danger.fg', 'info.fg'];
const TEXT_CARRIERS = ['surface.sidebar', 'surface.content', 'surface.raised', 'surface.overlay'];

const need = (tokens: TokenValues, key: string): string => {
  const found = tokens[key];
  if (found === undefined) throw new Error(`token ${key} is missing`);
  return found;
};

/** Rule 5 of 7.1: a mix of the OS accent into the sidebar, lowered until tertiary and status colours stay readable on it. */
export function deriveSelection(base: TokenValues, dark: boolean, osAccent: string): { colour: string; percent: number } {
  const sidebar = need(base, 'surface.sidebar');
  for (let percent = dark ? 30 : 18; percent >= 0; percent -= 2) {
    const candidate = mix(sidebar, osAccent, percent / 100);
    if (['text.tertiary', ...STATUS_FOREGROUNDS].every((key) => ratio(need(base, key), candidate) >= 4.5)) return { colour: candidate, percent };
  }
  return { colour: sidebar, percent: 0 };
}

/** Rule 3 of 7.1: the accent as text on the carrier surfaces and as a mark on the window and the selection. */
export function deriveAccentText(base: TokenValues, dark: boolean, osAccent: string, selection: string): { colour: string; step: number } | undefined {
  const reaches = (candidate: string): boolean =>
    TEXT_CARRIERS.every((key) => ratio(candidate, need(base, key)) >= 4.5) && [need(base, 'surface.window'), selection].every((surface) => ratio(candidate, surface) >= 3);
  const result = clampUntil(osAccent, dark ? '#ffffff' : '#000000', reaches);
  return result.colour === undefined ? undefined : { colour: result.colour, step: result.step };
}

/**
 * Rule 4 of 7.1: a mix of the accent text into the content surface, lowered until the text colours and the accent
 * keep 4.5 to 1 on it. The table of 1.8 also asks this of secondary and tertiary text, so they join the check.
 */
function deriveSubtle(base: TokenValues, accentText: string, dark: boolean): string {
  const content = need(base, 'surface.content');
  const readers = [accentText, need(base, 'text.primary'), need(base, 'text.secondary'), need(base, 'text.tertiary')];
  for (let percent = dark ? 20 : 14; percent >= 0; percent -= 2) {
    const candidate = mix(content, accentText, percent / 100);
    if (readers.every((reader) => ratio(reader, candidate) >= 4.5)) return candidate;
  }
  return content;
}

/** Links reach 4.5 to 1 on the window surface as well, where the accent text form has to reach only 3 to 1. */
function deriveLink(base: TokenValues, dark: boolean, accentText: string): string {
  const window = need(base, 'surface.window');
  return clampUntil(accentText, dark ? '#ffffff' : '#000000', (candidate) => ratio(candidate, window) >= 4.5).colour ?? accentText;
}

/**
 * The token overrides that make a theme follow the OS accent (7.1, rules 1 to 5). `base` is the resolved token set
 * of the Agide theme for the current appearance. Returns nothing when no derivation reaches its targets, so the
 * Agide accent stays.
 */
export function deriveAccent(base: TokenValues, dark: boolean, osAccent: string): Record<string, string> | undefined {
  const fill = clampTo(osAccent, '#000000', '#ffffff', 4.5).colour;
  if (fill === undefined) return undefined;
  const selection = deriveSelection(base, dark, osAccent);
  const text = deriveAccentText(base, dark, osAccent, selection.colour);
  if (text === undefined) return undefined;
  return {
    accent: fill,
    'accent.on': '#ffffff',
    'accent.hover': mix(fill, '#000000', 0.08),
    'accent.active': mix(fill, '#000000', 0.16),
    'accent.text': text.colour,
    'accent.subtle': deriveSubtle(base, text.colour, dark),
    'text.link': deriveLink(base, dark, text.colour),
    'focus.ring': text.colour,
    selection: selection.colour,
  };
}
