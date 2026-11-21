// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceMessage } from '../../core/theme/index';
import type { AppearanceApi } from '../../shared/appearanceIpc';
import { applyTheme, createThemeStore, dockOverrideCss, type ThemeStore } from './themeStore';

const message = (over: Partial<AppearanceMessage['state']> = {}, themeId = 'system'): AppearanceMessage => ({
  themeId,
  state: { dark: false, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false, ...over },
});

function fakeApi(initial: AppearanceMessage) {
  let listener: ((m: AppearanceMessage) => void) | undefined;
  const api: AppearanceApi = { get: async () => initial, subscribe: (l) => ((listener = l), () => void (listener = undefined)) };
  return { api, push: (m: AppearanceMessage) => listener?.(m), subscribed: () => listener !== undefined };
}

function fakeMotion(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('reduced-motion') && matches;
    },
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
  }));
  return { set: (value: boolean) => ((matches = value), listeners.forEach((l) => l())), count: () => listeners.size };
}

const token = (name: string) => document.documentElement.style.getPropertyValue(name);

let store: ThemeStore | undefined;
beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.getElementById('agide-dock-overrides')?.remove();
});
afterEach(() => {
  store?.dispose();
  store = undefined;
  vi.unstubAllGlobals();
});

describe('theme store', () => {
  it('writes every token to the root element before the first render', async () => {
    fakeMotion(false);
    store = await createThemeStore({ api: fakeApi(message()).api, document });
    expect(token('--agide-surface-content'), 'content surface').toBe('#ffffff');
    expect(token('--agide-text-primary'), 'primary text').toBe('#1d1d1f');
    expect(token('--agide-density-row'), 'density variable').toBe('24px');
    expect(document.documentElement.style.colorScheme, 'color scheme on the root').toBe('light');
    expect(document.documentElement.dataset['scheme'], 'scheme attribute').toBe('light');
  });

  it('follows an appearance message without a reload and tells subscribers', async () => {
    fakeMotion(false);
    const fake = fakeApi(message());
    store = await createThemeStore({ api: fake.api, document });
    const seen: string[] = [];
    store.subscribe(() => seen.push(store?.get().resolved.scheme ?? ''));
    fake.push(message({ dark: true }));
    expect(token('--agide-surface-content'), 'dark content surface').toBe('#1b1b1e');
    expect(document.documentElement.style.colorScheme, 'dark color scheme').toBe('dark');
    expect(store.get().resolved.terminal['background'], 'terminal background follows the token').toBe('#1b1b1e');
    expect(seen, 'one notification').toEqual(['dark']);
  });

  it('applies the OS accent to the System theme and keeps the Agide blue for a fixed theme', async () => {
    fakeMotion(false);
    const fake = fakeApi(message({ accent: '#f74f9e' }));
    store = await createThemeStore({ api: fake.api, document });
    expect(token('--agide-accent'), 'derived pink fill').toBe('#cb4182');
    fake.push(message({ accent: '#f74f9e' }, 'agide-light'));
    expect(token('--agide-accent'), 'Agide Light keeps its blue').toBe('#0062cc');
  });

  it('sets the contrast and accessibility attributes', async () => {
    fakeMotion(false);
    const fake = fakeApi(message());
    store = await createThemeStore({ api: fake.api, document });
    fake.push(message({ highContrast: true, reducedTransparency: true, differentiateWithoutColour: true }));
    const data = document.documentElement.dataset;
    expect([data['contrast'], data['reduceTransparency'], data['differentiate']], 'attributes').toEqual(['more', 'true', 'true']);
    expect(token('--agide-focus-width'), 'thicker focus ring').toBe('3px');
  });

  it('zeroes the motion durations under reduced motion and follows the preference', async () => {
    const motion = fakeMotion(true);
    store = await createThemeStore({ api: fakeApi(message()).api, document });
    expect(token('--agide-motion-base'), 'reduced motion at start').toBe('0ms');
    motion.set(false);
    expect(token('--agide-motion-base'), 'preference turned off').toBe('160ms');
  });

  it('stops listening on dispose', async () => {
    const motion = fakeMotion(false);
    const fake = fakeApi(message());
    store = await createThemeStore({ api: fake.api, document });
    store.dispose();
    expect([fake.subscribed(), motion.count()], 'listeners removed').toEqual([false, 0]);
  });

  it('reads an unknown theme id as System', async () => {
    fakeMotion(false);
    store = await createThemeStore({ api: fakeApi(message({ dark: true }, 'gone-theme')).api, document });
    expect(store.get().resolved.id, 'fell back to System').toBe('system');
  });
});

describe('dock overrides', () => {
  it('writes the dock block of a theme into one style element', () => {
    expect(dockOverrideCss({}), 'no block, no rule').toBe('');
    expect(dockOverrideCss({ '--dv-tab-font-size': '11px' }), 'rule').toBe('.agide-dock.agide-dock { --dv-tab-font-size: 11px; }');
  });

  it('creates the style element once and rewrites it', async () => {
    fakeMotion(false);
    store = await createThemeStore({ api: fakeApi(message()).api, document });
    applyTheme(document, store.get());
    expect(document.querySelectorAll('#agide-dock-overrides').length, 'one style element').toBe(1);
  });
});

describe('start of the theme', () => {
  it('uses the default appearance when the page has no preload API and installs the store', async () => {
    fakeMotion(false);
    const { startTheme, themeSnapshot, installThemeStore, defaultAppearanceApi } = await import('./themeContext');
    expect(await defaultAppearanceApi().get(), 'default API answers with System').toMatchObject({ themeId: 'system' });
    store = await startTheme();
    expect(themeSnapshot().resolved.id, 'the installed store is read').toBe('system');
    expect(document.documentElement.style.getPropertyValue('--agide-surface-content'), 'tokens written').toBe('#ffffff');
    installThemeStore(undefined);
  });
});
