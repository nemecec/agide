import { clampTo } from './colour';

const BLACK = '#000000';
const WHITE = '#ffffff';
const TILE_TEXT_TARGET = 4.5;
const MARK_TARGET = 3;

/** The stored profile colour darkened in 2% steps until the white letter on it reaches 4.5 to 1. */
export const profileTileColour = (stored: string): string => clampTo(stored, BLACK, WHITE, TILE_TEXT_TARGET).colour ?? stored;

/** The stored colour moved toward black (light window) or white (dark window) until it reaches 3 to 1 against the window surface. */
export const profileMarkColour = (stored: string, windowSurface: string, dark: boolean): string =>
  clampTo(stored, dark ? WHITE : BLACK, windowSurface, MARK_TARGET).colour ?? stored;
