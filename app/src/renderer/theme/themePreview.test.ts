// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinTheme, type AppearanceMessage } from '../../core/theme/index';
import type { AppearanceApi } from '../../shared/appearanceIpc';
import { createThemeStore, type ThemeStore } from './themeStore';

const state = { dark: false, accent: null, highContrast: false, reducedTransparency: false, differentiateWithoutColour: false } as const;
const token = (name: string) => document.documentElement.style.getPropertyValue(name);

let store: ThemeStore | undefined;
let push: ((message: AppearanceMessage) => void) | undefined;
const start = async (initial: AppearanceMessage): Promise<ThemeStore> => {
  const api: AppearanceApi = { get: async () => initial, subscribe: (listener) => ((push = listener), () => void (push = undefined)) };
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  store = await createThemeStore({ api, document });
  return store;
};

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.getElementById('agide-dock-overrides')?.remove();
});
afterEach(() => {
  store?.dispose();
  store = undefined;
  vi.unstubAllGlobals();
});

describe('theme store with previews and user themes', () => {
  it('draws the preview theme while it runs and the saved theme after it ends', async () => {
    await start({ themeId: 'system', state });
    expect(token('--agide-surface-content'), 'saved System light').toBe('#ffffff');
    const mocha = builtinTheme('catppuccin-mocha');
    if (!mocha) throw new Error('catppuccin-mocha is missing');
    push?.({ themeId: 'system', state, preview: { previewId: 'p1', name: mocha.name, expiresAt: Date.now() + 60_000, theme: mocha } });
    expect(token('--agide-surface-content'), 'the preview colours').toBe('#1e1e2e');
    expect(document.documentElement.dataset['theme'], 'the preview theme id').toBe('catppuccin-mocha');
    push?.({ themeId: 'system', state });
    expect(token('--agide-surface-content'), 'reverted to the saved theme').toBe('#ffffff');
  });

  it('ignores a carried document that fails validation and draws the saved built-in theme', async () => {
    const bad = { schema: 1, id: 'my-theme', name: 'Mine', kind: 'dark' as const, extends: 'agide-dark', tokens: { accent: 'blue' } };
    await start({ themeId: 'my-theme', theme: bad, state });
    expect(token('--agide-accent'), 'the System accent, not the invalid value').not.toBe('blue');
  });

  it('draws the user theme that a message carries', async () => {
    const user = { schema: 1, id: 'my-theme', name: 'Mine', kind: 'dark' as const, extends: 'agide-dark', tokens: { accent: '#123456' } };
    await start({ themeId: 'my-theme', theme: user, state });
    expect(token('--agide-accent'), 'the user accent').toBe('#123456');
    expect(token('--vscode-button-background'), 'the alias reads the token').toBe('var(--agide-accent)');
  });

  it('writes the --vscode aliases with the original value of an imported theme', async () => {
    const mocha = builtinTheme('catppuccin-mocha');
    await start({ themeId: 'catppuccin-mocha', state });
    expect(token('--vscode-button-background'), 'original colour of the file').toBe(mocha?.vscode?.['button.background']);
  });
});
