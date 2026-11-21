import { builtinTheme, DEFAULT_APPEARANCE, DEFAULT_THEME_ID, resolveTheme, validateThemeDocument, type AppearanceMessage, type ResolvedTheme, type ThemeDocument } from '../../core/theme/index';
import type { AppearanceApi } from '../../shared/appearanceIpc';
import { aliasVariables } from './aliases';

export interface ThemeSnapshot {
  readonly message: AppearanceMessage;
  /** The document that was resolved: a preview, a user theme or a built-in theme. */
  readonly theme: ThemeDocument;
  readonly resolved: ResolvedTheme;
  readonly reducedMotion: boolean;
}

export interface ThemeStore {
  get(): ThemeSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** The snapshot before a store is installed: System, light, no accent. */
export const fallbackSnapshot = (): ThemeSnapshot => snapshotOf({ state: DEFAULT_APPEARANCE, themeId: DEFAULT_THEME_ID }, false);

export interface ThemeStoreDeps {
  readonly api: AppearanceApi;
  readonly document: Document;
}

const DOCK_STYLE_ID = 'agide-dock-overrides';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const checked = (document: ThemeDocument | undefined): ThemeDocument | undefined => {
  if (!document) return undefined;
  const result = validateThemeDocument(document);
  return result.ok ? result.theme : undefined;
};

/** The theme a message shows: its preview, else the document it carries, else a built-in theme; an id that names no theme reads as System. */
function snapshotOf(message: AppearanceMessage, reducedMotion: boolean): ThemeSnapshot {
  const theme = checked(message.preview?.theme) ?? checked(message.theme) ?? builtinTheme(message.themeId) ?? builtinTheme(DEFAULT_THEME_ID);
  if (!theme) throw new Error('the System theme is missing');
  return { message, theme, reducedMotion, resolved: resolveTheme({ theme, appearance: message.state, reducedMotion }) };
}

/** CSS rules for the `dock` block of a theme; doubled class names beat the stylesheet of the dock theme. */
export function dockOverrideCss(dock: Readonly<Record<string, string>>): string {
  const declarations = Object.entries(dock).map(([name, value]) => `${name}: ${value};`);
  return declarations.length === 0 ? '' : `.agide-dock.agide-dock { ${declarations.join(' ')} }`;
}

/** Writes every token to `:root` and the scheme, contrast and accessibility flags to its attributes. */
export function applyTheme(document: Document, snapshot: ThemeSnapshot): void {
  const root = document.documentElement;
  const { resolved, message } = snapshot;
  for (const [name, value] of Object.entries({ ...resolved.variables, ...aliasVariables(snapshot.theme, resolved) })) root.style.setProperty(name, value);
  root.style.colorScheme = resolved.scheme;
  root.dataset['theme'] = resolved.id;
  root.dataset['scheme'] = resolved.scheme;
  root.dataset['contrast'] = resolved.contrast;
  root.dataset['reduceTransparency'] = String(message.state.reducedTransparency);
  root.dataset['differentiate'] = String(message.state.differentiateWithoutColour);

  let style = document.getElementById(DOCK_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = DOCK_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = dockOverrideCss(resolved.dock);
}

/** The store that the CSS tokens, the dock and the terminals read; it follows the OS through the appearance API. */
export async function createThemeStore(deps: ThemeStoreDeps): Promise<ThemeStore> {
  const { api, document } = deps;
  const media = document.defaultView?.matchMedia?.(REDUCED_MOTION_QUERY);
  let current = snapshotOf(await api.get(), media?.matches ?? false);
  const listeners = new Set<() => void>();
  const apply = (snapshot: ThemeSnapshot): void => {
    current = snapshot;
    applyTheme(document, snapshot);
    listeners.forEach((listener) => listener());
  };
  applyTheme(document, current);

  const stop = api.subscribe((message) => apply(snapshotOf(message, current.reducedMotion)));
  const onMotion = (): void => apply(snapshotOf(current.message, media?.matches ?? false));
  media?.addEventListener('change', onMotion);

  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: () => {
      stop();
      media?.removeEventListener('change', onMotion);
      listeners.clear();
    },
  };
}
