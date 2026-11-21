import { normaliseAccent, type AppearanceState } from '../core/theme/appearance';

/** The part of Electron's `nativeTheme` the adapter reads. */
export interface NativeThemeLike {
  themeSource: 'system' | 'light' | 'dark';
  readonly shouldUseDarkColors: boolean;
  readonly shouldUseHighContrastColors: boolean;
  readonly prefersReducedTransparency: boolean;
  readonly shouldDifferentiateWithoutColor: boolean;
  on(event: 'updated', listener: () => void): unknown;
  removeListener(event: 'updated', listener: () => void): unknown;
}

/** The part of Electron's `systemPreferences` the adapter reads. */
export interface SystemPreferencesLike {
  getAccentColor(): string;
  subscribeNotification(event: string, callback: () => void): number;
  unsubscribeNotification(id: number): void;
}

export const ACCENT_NOTIFICATION = 'AppleColorPreferencesChangedNotification';

export interface AppearanceAdapter {
  current(): AppearanceState;
  /** Overrides fields of the state the OS reports, for tests. `undefined` clears the override. */
  override(fields: Partial<AppearanceState> | undefined): void;
  dispose(): void;
}

export interface AppearanceDeps {
  readonly nativeTheme: NativeThemeLike;
  /** Absent where the platform has no accent source. */
  readonly systemPreferences?: SystemPreferencesLike | undefined;
  /** Called once per change of the state, never with an equal state. */
  readonly onChange: (state: AppearanceState) => void;
  /** The accent notification exists on macOS only. */
  readonly platform?: string;
}

function readAccent(preferences: SystemPreferencesLike | undefined): string | null {
  if (!preferences) return null;
  try {
    return normaliseAccent(preferences.getAccentColor());
  } catch {
    return null;
  }
}

const sameState = (a: AppearanceState, b: AppearanceState): boolean =>
  a.dark === b.dark && a.accent === b.accent && a.highContrast === b.highContrast && a.reducedTransparency === b.reducedTransparency && a.differentiateWithoutColour === b.differentiateWithoutColour;

/**
 * Reads the OS appearance (light or dark, accent, increased contrast, reduced transparency, differentiate without
 * colour) and reports each change once. `themeSource` stays `system`, so the native window parts follow the OS
 * while the renderer decides what the page shows (0035 section 7.1).
 */
export function createAppearance(deps: AppearanceDeps): AppearanceAdapter {
  const { nativeTheme, systemPreferences, onChange } = deps;
  nativeTheme.themeSource = 'system';
  let override: Partial<AppearanceState> | undefined;

  const read = (): AppearanceState => ({
    dark: nativeTheme.shouldUseDarkColors,
    accent: readAccent(systemPreferences),
    highContrast: nativeTheme.shouldUseHighContrastColors,
    reducedTransparency: nativeTheme.prefersReducedTransparency,
    differentiateWithoutColour: nativeTheme.shouldDifferentiateWithoutColor,
    ...override,
  });

  let last = read();
  const refresh = (): void => {
    const next = read();
    if (sameState(last, next)) return;
    last = next;
    onChange(next);
  };

  nativeTheme.on('updated', refresh);
  const subscription = deps.platform === 'darwin' && systemPreferences ? systemPreferences.subscribeNotification(ACCENT_NOTIFICATION, refresh) : undefined;

  return {
    current: () => last,
    override: (fields) => {
      override = fields;
      refresh();
    },
    dispose: () => {
      nativeTheme.removeListener('updated', refresh);
      if (subscription !== undefined && systemPreferences) systemPreferences.unsubscribeNotification(subscription);
    },
  };
}
