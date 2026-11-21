import { useSyncExternalStore } from 'react';
import { DEFAULT_APPEARANCE, DEFAULT_THEME_ID } from '../../core/theme/index';
import type { AppearanceApi } from '../../shared/appearanceIpc';
import { createThemeStore, fallbackSnapshot, type ThemeSnapshot, type ThemeStore } from './themeStore';

declare global {
  interface Window {
    readonly appearance?: AppearanceApi;
  }
}

let installed: ThemeStore | undefined;
const FALLBACK = fallbackSnapshot();

export const installThemeStore = (store: ThemeStore | undefined): void => void (installed = store);

export const themeSnapshot = (): ThemeSnapshot => installed?.get() ?? FALLBACK;

export const subscribeTheme = (listener: () => void): (() => void) => installed?.subscribe(listener) ?? (() => undefined);

/** The current theme snapshot; the component renders again when the OS appearance or the choice changes. */
export const useTheme = (): ThemeSnapshot => useSyncExternalStore(subscribeTheme, themeSnapshot);

/** What the page uses when the preload is absent (unit tests, a plain browser): System, light, no accent. */
export const defaultAppearanceApi = (): AppearanceApi => {
  const message = { state: DEFAULT_APPEARANCE, themeId: DEFAULT_THEME_ID };
  return { get: async () => message, subscribe: () => () => undefined };
};

/** Reads the OS state and the theme choice, writes the tokens to `:root` and installs the store the components read. */
export async function startTheme(): Promise<ThemeStore> {
  const store = await createThemeStore({ api: window.appearance ?? defaultAppearanceApi(), document });
  installThemeStore(store);
  return store;
}
