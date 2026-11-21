import { luminance } from '../colour';
import type { UiTheme } from './vsix';

export interface DetectedKind {
  readonly kind: 'light' | 'dark';
  readonly highContrast: boolean;
}

export interface KindHints {
  /** The `type` key of the theme file: `light`, `dark`, `hc` or `hcLight`. */
  readonly type?: unknown;
  /** The `uiTheme` of the extension's `contributes.themes` entry. */
  readonly uiTheme?: UiTheme | undefined;
  /** Opaque `editor.background`. */
  readonly editorBackground: string;
}

const DARK_LUMINANCE = 0.18;

/** The theme's own `type`, else the extension's `uiTheme`, else the luminance of the editor background. */
export function detectKind(hints: KindHints): DetectedKind {
  switch (hints.type) {
    case 'light':
      return { kind: 'light', highContrast: false };
    case 'dark':
      return { kind: 'dark', highContrast: false };
    case 'hc':
      return { kind: 'dark', highContrast: true };
    case 'hcLight':
      return { kind: 'light', highContrast: true };
  }
  switch (hints.uiTheme) {
    case 'vs':
      return { kind: 'light', highContrast: false };
    case 'vs-dark':
      return { kind: 'dark', highContrast: false };
    case 'hc-black':
      return { kind: 'dark', highContrast: true };
    case 'hc-light':
      return { kind: 'light', highContrast: true };
  }
  return { kind: luminance(hints.editorBackground) < DARK_LUMINANCE ? 'dark' : 'light', highContrast: false };
}
