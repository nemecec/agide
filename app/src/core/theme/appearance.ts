import type { ThemeDocument } from './schema';

/** What the OS says about appearance. The main process reads it and the renderer turns it into tokens. */
export interface AppearanceState {
  readonly dark: boolean;
  /** `#rrggbb` of the OS accent, or null when it is unknown or the OS reports multicolour. */
  readonly accent: string | null;
  readonly highContrast: boolean;
  readonly reducedTransparency: boolean;
  readonly differentiateWithoutColour: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceState = { dark: false, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false };

export const DEFAULT_THEME_ID = 'system';

/** A theme shown in place without being saved. The renderer offers Keep and Revert until `expiresAt`. */
export interface PreviewState {
  readonly previewId: string;
  readonly name: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
  readonly theme: ThemeDocument;
}

/** The last saved change, which the renderer announces with an Undo action. */
export interface ThemeChange {
  readonly kind: 'apply' | 'undo';
  readonly revision: number;
  readonly name: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
}

/** The one message the main process sends: the OS state and the profile's theme choice. */
export interface AppearanceMessage {
  readonly state: AppearanceState;
  readonly themeId: string;
  /** The theme document, when the choice is not a built-in theme. */
  readonly theme?: ThemeDocument;
  readonly revision?: number;
  readonly preview?: PreviewState;
  readonly change?: ThemeChange;
}

/** `RRGGBBAA` or `#rrggbb` from the OS to `#rrggbb`; null for anything else. */
export function normaliseAccent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  return match?.[1] ? `#${match[1].toLowerCase()}` : null;
}

const flag = (value: unknown): boolean => value === true;
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/**
 * A theme document by shape only: this module runs in the sandboxed preload, which cannot load the schema library.
 * The renderer validates the document before it draws it.
 */
function document(value: unknown): ThemeDocument | undefined {
  const found = record(value);
  return typeof found['id'] === 'string' && typeof found['name'] === 'string' && typeof found['kind'] === 'string' ? (value as ThemeDocument) : undefined;
}

function preview(value: unknown): PreviewState | undefined {
  const found = record(value);
  const theme = document(found['theme']);
  if (!theme || typeof found['previewId'] !== 'string' || typeof found['expiresAt'] !== 'number') return undefined;
  return { previewId: found['previewId'], name: typeof found['name'] === 'string' ? found['name'] : theme.name, expiresAt: found['expiresAt'], theme };
}

function change(value: unknown): ThemeChange | undefined {
  const found = record(value);
  if ((found['kind'] !== 'apply' && found['kind'] !== 'undo') || typeof found['revision'] !== 'number' || typeof found['name'] !== 'string' || typeof found['at'] !== 'number') return undefined;
  return { kind: found['kind'], revision: found['revision'], name: found['name'], at: found['at'] };
}

/** Reads a message from the wire; unknown shapes give the defaults. */
export function parseAppearanceMessage(value: unknown): AppearanceMessage {
  const message = record(value);
  const state = record(message['state']);
  const themeId = typeof message['themeId'] === 'string' && /^[a-z0-9-]{3,48}$/.test(message['themeId']) ? message['themeId'] : DEFAULT_THEME_ID;
  const theme = document(message['theme']);
  const shownPreview = message['preview'] === undefined ? undefined : preview(message['preview']);
  const shownChange = message['change'] === undefined ? undefined : change(message['change']);
  return {
    themeId,
    state: {
      dark: flag(state['dark']),
      accent: normaliseAccent(state['accent']),
      highContrast: flag(state['highContrast']),
      reducedTransparency: flag(state['reducedTransparency']),
      differentiateWithoutColour: flag(state['differentiateWithoutColour']),
    },
    ...(theme && theme.id === themeId ? { theme } : {}),
    ...(typeof message['revision'] === 'number' ? { revision: message['revision'] } : {}),
    ...(shownPreview ? { preview: shownPreview } : {}),
    ...(shownChange ? { change: shownChange } : {}),
  };
}
