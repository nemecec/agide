// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinTheme, DEFAULT_APPEARANCE, resolveTheme, type AppearanceMessage } from '../../core/theme/index';
import { installFakeApi } from '../testing/fakeApi';
import { flush, render, type Rendered } from '../testing/render';
import { ThemeNotice } from './ThemeNotice';
import { installThemeStore } from './themeContext';
import type { ThemeStore } from './themeStore';

function installStore(message: AppearanceMessage): { set: (next: AppearanceMessage) => void } {
  const system = builtinTheme('system');
  if (!system) throw new Error('system theme missing');
  const listeners = new Set<() => void>();
  let snapshot = { message, theme: system, reducedMotion: false, resolved: resolveTheme({ theme: system }) };
  const store: ThemeStore = { get: () => snapshot, subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)), dispose: () => undefined };
  installThemeStore(store);
  return {
    set: (next) => {
      snapshot = { ...snapshot, message: next };
      listeners.forEach((listener) => listener());
    },
  };
}

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  installThemeStore(undefined);
});

describe('ThemeNotice', () => {
  it('shows nothing without a preview or a change', async () => {
    installStore({ themeId: 'system', state: DEFAULT_APPEARANCE });
    installFakeApi();
    rendered = await render(createElement(ThemeNotice));
    expect(rendered.container.textContent, 'empty').toBe('');
  });

  it('announces a change that arrives after it opened, with Undo, and not one that was there already', async () => {
    const earlier = { kind: 'apply' as const, revision: 2, name: 'Agide Dark', at: 100 };
    const handle = installStore({ themeId: 'agide-dark', state: DEFAULT_APPEARANCE, revision: 2, change: earlier });
    const fake = installFakeApi({ theme_undo: { revision: 3 } });
    rendered = await render(createElement(ThemeNotice));
    expect(rendered.container.querySelector('[data-testid="theme-change-bar"]'), 'an old change is not announced').toBeNull();
    await act(async () => handle.set({ themeId: 'agide-light', state: DEFAULT_APPEARANCE, revision: 3, change: { kind: 'apply', revision: 3, name: 'Agide Light', at: 200 } }));
    const bar = rendered.container.querySelector('[data-testid="theme-change-bar"]');
    expect(bar?.textContent, 'the bar names the new theme').toContain('Theme changed to Agide Light');
    const undo = [...(bar?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === 'Undo');
    await act(async () => undo?.click());
    await flush();
    expect(fake.invoke, 'Undo calls theme_undo').toHaveBeenCalledWith('theme_undo', {});
    expect(rendered.container.querySelector('[data-testid="theme-change-bar"]'), 'the bar closes after Undo').toBeNull();
  });

  it('announces the first change of a window that had none', async () => {
    const handle = installStore({ themeId: 'system', state: DEFAULT_APPEARANCE, revision: 1 });
    installFakeApi();
    rendered = await render(createElement(ThemeNotice));
    await act(async () => handle.set({ themeId: 'agide-dark', state: DEFAULT_APPEARANCE, revision: 2, change: { kind: 'apply', revision: 2, name: 'Agide Dark', at: 50 } }));
    expect(rendered.container.querySelector('[data-testid="theme-change-bar"]')?.textContent, 'the first change is announced').toContain('Agide Dark');
  });

  it('shows the preview bar with Keep and Revert when no dialog is open', async () => {
    const mocha = builtinTheme('catppuccin-mocha');
    if (!mocha) throw new Error('missing theme');
    installStore({ themeId: 'system', state: DEFAULT_APPEARANCE, revision: 7, preview: { previewId: 'p3', name: mocha.name, expiresAt: Date.now() + 60_000, theme: mocha } });
    const fake = installFakeApi({ theme_apply: { revision: 8 } });
    rendered = await render(createElement(ThemeNotice));
    const keep = [...rendered.container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Keep');
    await act(async () => keep?.click());
    await flush();
    expect(fake.invoke, 'Keep applies the preview at the current revision').toHaveBeenCalledWith('theme_apply', { previewId: 'p3', expectedRevision: 7 });
  });
});
