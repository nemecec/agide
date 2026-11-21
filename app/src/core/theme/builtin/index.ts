import { validateThemeDocument, type ThemeDocument } from '../schema';
import agideDark from './agide-dark.json';
import agideLight from './agide-light.json';
import catppuccinMocha from './catppuccin-mocha.json';
import githubDarkDefault from './github-dark-default.json';
import system from './system.json';

const EXTENDABLE = { 'agide-light': 'light', 'agide-dark': 'dark' } as const;

function load(document: unknown): ThemeDocument {
  const result = validateThemeDocument(document, { extendable: EXTENDABLE });
  if (!result.ok || !result.theme) {
    const first = result.issues[0];
    throw new Error(`built-in theme is invalid: ${first?.code ?? 'unknown'} at ${first?.path ?? '/'}`);
  }
  return result.theme;
}

export const SYSTEM_THEME_ID = 'system';

/** The built-in themes in picker order. They ship inside the app and cannot be changed. */
export const BUILTIN_THEMES: readonly ThemeDocument[] = [load(system), load(agideLight), load(agideDark), load(githubDarkDefault), load(catppuccinMocha)];

export const builtinTheme = (id: string): ThemeDocument | undefined => BUILTIN_THEMES.find((theme) => theme.id === id);

export const isBuiltinThemeId = (id: string): boolean => builtinTheme(id) !== undefined;
