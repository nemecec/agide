// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../../core/events/index';
import { installFakeApi } from '../../testing/fakeApi';
import { renderHook } from '../../testing/render';
import type { BrowserTabView } from './model';
import { useBrowserTab } from './useBrowserTab';

const view = (over: Record<string, unknown> = {}): BrowserTabView =>
  ({ known: true, leafId: 'leaf1', tabNumber: 1, service: 'web', url: 'https://a.test/', title: 'A', loading: false, canGoBack: false, canGoForward: false, crashed: false, dialog: false, mode: 'on-demand', blocked: false, acting: false, approvals: [], ...over }) as BrowserTabView;

const accessed = (over: Record<string, unknown> = {}): AppEvent =>
  ({ type: 'browser.accessed', entry: { id: 1, at: '', sessionId: 's', folderId: 'f', nodeId: 'leaf1', kind: 'read_page', origin: 'https://a.test', bytes: 1, outcome: 'ok', ...over } }) as unknown as AppEvent;

let unmount: (() => Promise<void>) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  vi.useRealTimers();
});

const settle = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
async function mount(key: { leafId?: string; surfaceId?: string }, options?: { poll?: boolean }) {
  const hook = await renderHook(() => useBrowserTab(key, options));
  unmount = hook.unmount;
  return hook;
}

describe('useBrowserTab', () => {
  it('asks for the state by leaf id and by surface id, whichever the pane has', async () => {
    const fake = installFakeApi({ browser_tab_state: view() });
    await mount({ leafId: 'leaf1' });
    expect(fake.invoke, 'by leaf').toHaveBeenCalledWith('browser_tab_state', { leafId: 'leaf1' });
    await unmount?.();
    const other = installFakeApi({ browser_tab_state: view() });
    await mount({ surfaceId: 'surf1' });
    expect(other.invoke, 'by surface').toHaveBeenCalledWith('browser_tab_state', { surfaceId: 'surf1' });
  });

  it('shows the state of the tab and keeps polling for changes of the page', async () => {
    let title = 'A';
    const fake = installFakeApi({ browser_tab_state: () => view({ title }) });
    const hook = await mount({ leafId: 'leaf1' });
    expect(hook.current().state, 'first state').toMatchObject({ title: 'A' });
    title = 'B';
    await settle(700);
    expect(hook.current().state, 'state after a poll').toMatchObject({ title: 'B' });
    expect(fake.invoke.mock.calls.length, 'polled again').toBeGreaterThan(1);
  });

  it('does not poll when polling is off and refreshes on demand', async () => {
    const fake = installFakeApi({ browser_tab_state: view() });
    const hook = await mount({ leafId: 'leaf1' }, { poll: false });
    await settle(5000);
    expect(fake.invoke, 'one read').toHaveBeenCalledTimes(1);
    hook.current().refresh();
    await settle();
    expect(fake.invoke, 'a refresh reads again').toHaveBeenCalledTimes(2);
  });

  it('keeps the same state object when a poll returns the same content', async () => {
    installFakeApi({ browser_tab_state: () => view() });
    const hook = await mount({ leafId: 'leaf1' });
    const first = hook.current().state;
    await settle(700);
    expect(hook.current().state, 'same object').toBe(first);
  });

  it('keeps the last state when a read fails', async () => {
    let fail = false;
    installFakeApi({ browser_tab_state: () => (fail ? { ok: false, error: { code: 'failed', message: 'x' } } : view()) });
    const hook = await mount({ leafId: 'leaf1' });
    fail = true;
    await settle(700);
    expect(hook.current().state, 'last good state').toMatchObject({ known: true, title: 'A' });
  });

  it('flags reading for two seconds after an agent read of this tab, and for no other access', async () => {
    const fake = installFakeApi({ browser_tab_state: view() });
    const hook = await mount({ leafId: 'leaf1' }, { poll: false });
    fake.emit(accessed({ nodeId: 'other' }));
    await settle();
    expect(hook.current().reading, 'other tab').toBe(false);
    fake.emit(accessed({ kind: 'act' }));
    await settle();
    expect(hook.current().reading, 'acting call').toBe(false);
    fake.emit(accessed({ outcome: 'refused_off' }));
    await settle();
    expect(hook.current().reading, 'refused read').toBe(false);
    fake.emit(accessed());
    await settle();
    expect(hook.current().reading, 'read of this tab').toBe(true);
    await settle(1999);
    expect(hook.current().reading, 'still flagged before two seconds').toBe(true);
    await settle(2);
    expect(hook.current().reading, 'cleared after two seconds').toBe(false);
  });

  it('follows the leaf the state names when the pane knows only the surface', async () => {
    const fake = installFakeApi({ browser_tab_state: view({ leafId: 'leaf9' }) });
    const hook = await mount({ surfaceId: 'surf1' }, { poll: false });
    fake.emit(accessed({ nodeId: 'leaf9' }));
    await settle();
    expect(hook.current().reading, 'read of the leaf behind the surface').toBe(true);
  });

  it('refreshes on access and observation events and stops listening on unmount', async () => {
    const fake = installFakeApi({ browser_tab_state: view() });
    await mount({ leafId: 'leaf1' }, { poll: false });
    const before = fake.invoke.mock.calls.length;
    fake.emit({ type: 'browser.observation_changed', nodeId: 'leaf1', mode: 'off' } as unknown as AppEvent);
    await settle();
    expect(fake.invoke.mock.calls.length, 'observation change refreshes').toBe(before + 1);
    expect(fake.subscriberCount(), 'subscribed').toBe(1);
    await unmount?.();
    unmount = undefined;
    expect(fake.subscriberCount(), 'unsubscribed on unmount').toBe(0);
  });
});
