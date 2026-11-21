// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinTheme, DEFAULT_APPEARANCE, resolveTheme, type AppearanceMessage } from '../../../core/theme/index';
import type { ThemeSummary } from '../../../core/theme/summary';
import { installFakeApi } from '../../testing/fakeApi';
import { flush, render, type Rendered } from '../../testing/render';
import { installThemeStore } from '../../theme/themeContext';
import type { ThemeStore } from '../../theme/themeStore';
import { ThemePicker } from './ThemePicker';

const summary = (id: string, extra: Partial<ThemeSummary> = {}): ThemeSummary => ({ id, name: id, kind: 'dark', source: 'builtin', license: undefined, detail: 'Built in', active: false, lowContrast: false, ...extra });

function installStore(message: AppearanceMessage): { set: (next: AppearanceMessage) => void } {
  const system = builtinTheme('system');
  if (!system) throw new Error('system theme missing');
  const listeners = new Set<() => void>();
  let snapshot = { message, theme: system, reducedMotion: false, resolved: resolveTheme({ theme: system }) };
  const store: ThemeStore = {
    get: () => snapshot,
    subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    dispose: () => undefined,
  };
  installThemeStore(store);
  return {
    set: (next) => {
      snapshot = { ...snapshot, message: next };
      listeners.forEach((listener) => listener());
    },
  };
}

const message = (extra: Partial<AppearanceMessage> = {}): AppearanceMessage => ({ themeId: 'system', state: DEFAULT_APPEARANCE, revision: 4, ...extra });

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  installThemeStore(undefined);
});

const row = (id: string) => rendered?.container.querySelector<HTMLElement>(`[data-testid="theme-row-${id}"]`);
const press = async (element: Element | null | undefined) => {
  if (!element) throw new Error('control not found');
  await act(async () => (element as HTMLElement).click());
  await flush();
};
const button = (id: string, name: string) => [...(row(id)?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === name);

describe('ThemePicker', () => {
  const themes = [
    summary('system', { name: 'System', active: true }),
    summary('github-dark-default', { name: 'GitHub Dark Default (port)', license: 'MIT', detail: 'MIT · GitHub.github-vscode-theme 6.3.5', source: 'builtin' }),
    summary('faint-theme', { name: 'Faint', lowContrast: true, detail: 'License unknown · Yours', source: 'vscode-file' }),
  ];

  it('lists each theme with its license and source line, and marks the active and low-contrast ones', async () => {
    installStore(message());
    installFakeApi({ theme_list: { themes, revision: 4 } });
    rendered = await render(createElement(ThemePicker));
    expect(rendered.container.querySelector('[data-testid="theme-detail-github-dark-default"]')?.textContent, 'license and source of the port').toBe('MIT · GitHub.github-vscode-theme 6.3.5');
    expect(row('system')?.textContent, 'the active theme is marked').toContain('Active');
    expect(row('faint-theme')?.textContent, 'low contrast chip').toContain('Low contrast');
    expect(row('faint-theme')?.textContent, 'unknown license chip').toContain('License unknown');
    expect(row('github-dark-default')?.textContent, 'no low contrast chip on a passing theme').not.toContain('Low contrast');
    expect(button('system', 'Use')?.disabled, 'the active theme cannot be applied again').toBe(true);
    const primaries = rendered.container.querySelectorAll('.ui-button[data-variant="primary"]');
    expect(primaries.length, 'the theme rows hold no primary button; Use is secondary').toBe(0);
  });

  it('previews through theme_preview and applies through theme_apply with the current revision', async () => {
    installStore(message());
    const fake = installFakeApi({ theme_list: { themes, revision: 4 }, theme_preview: { previewId: 'p1' }, theme_apply: { revision: 5 } });
    rendered = await render(createElement(ThemePicker));
    await press(button('github-dark-default', 'Preview'));
    expect(fake.invoke, 'preview command').toHaveBeenCalledWith('theme_preview', { id: 'github-dark-default' });
    await press(button('faint-theme', 'Use'));
    expect(fake.invoke, 'apply command with the revision the message carried').toHaveBeenCalledWith('theme_apply', { id: 'faint-theme', expectedRevision: 4 });
  });

  it('shows the refusal of a stale revision', async () => {
    installStore(message());
    installFakeApi({ theme_list: { themes, revision: 4 }, theme_apply: { ok: false, error: { code: 'invalid_input', message: 'the theme choice is at revision 5, not 4' } } });
    rendered = await render(createElement(ThemePicker));
    await press(button('faint-theme', 'Use'));
    expect(rendered.container.textContent, 'the message of the command').toContain('at revision 5, not 4');
  });

  it('shows Keep and Revert while a preview runs and sends them to the commands', async () => {
    const mocha = builtinTheme('catppuccin-mocha');
    if (!mocha) throw new Error('missing theme');
    installStore(message({ preview: { previewId: 'p9', name: mocha.name, expiresAt: Date.now() + 60_000, theme: mocha } }));
    const fake = installFakeApi({ theme_list: { themes, revision: 4 }, theme_apply: { revision: 5 }, theme_revert_preview: { reverted: true } });
    rendered = await render(createElement(ThemePicker));
    const bar = rendered.container.querySelector('[data-testid="theme-preview-bar"]');
    expect(bar?.textContent, 'the bar names the theme').toContain('Previewing Catppuccin Mocha');
    const keep = [...(bar?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === 'Keep');
    await press(keep);
    expect(fake.invoke, 'Keep applies the preview').toHaveBeenCalledWith('theme_apply', { previewId: 'p9', expectedRevision: 4 });
    const revert = [...(bar?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === 'Revert');
    await press(revert);
    expect(fake.invoke, 'Revert ends the preview').toHaveBeenCalledWith('theme_revert_preview', { previewId: 'p9' });
  });

  it('reverts a preview on Escape', async () => {
    const mocha = builtinTheme('catppuccin-mocha');
    if (!mocha) throw new Error('missing theme');
    installStore(message({ preview: { previewId: 'p2', name: mocha.name, expiresAt: Date.now() + 60_000, theme: mocha } }));
    const fake = installFakeApi({ theme_list: { themes, revision: 4 }, theme_revert_preview: { reverted: true } });
    rendered = await render(createElement(ThemePicker));
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(fake.invoke, 'Escape sends the revert').toHaveBeenCalledWith('theme_revert_preview', { previewId: 'p2' });
  });
});
