// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemRow } from '../../../core/inbox/viewTypes';
import { installFakeApi } from '../../testing/fakeApi';
import { renderHook } from '../../testing/render';
import { useInbox, type Filter } from './useInbox';

const item = (id: string) => ({ id }) as ItemRow;
let unmount: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  vi.useRealTimers();
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(50)));

async function mount(filter: Filter = 'open') {
  const hook = await renderHook(useInbox, filter);
  unmount = hook.unmount;
  return hook;
}

describe('useInbox', () => {
  it('lists open items with the states that wait for the user and reports the unread count', async () => {
    const fake = installFakeApi({ inbox_list: { items: [item('a')], unread: 2 } });
    const hook = await mount('open');
    expect(fake.invoke, 'open filter states').toHaveBeenCalledWith('inbox_list', { states: ['new', 'seen', 'snoozed'], limit: 200 });
    expect(hook.current(), 'loaded state').toMatchObject({ items: [item('a')], unread: 2, loaded: true });
  });

  it('lists done items for the done filter and reloads when the filter changes', async () => {
    const fake = installFakeApi({ inbox_list: { items: [], unread: 0 } });
    const hook = await mount('open');
    await hook.rerender('done');
    expect(fake.invoke, 'done filter states').toHaveBeenLastCalledWith('inbox_list', { states: ['done'], limit: 200 });
  });

  it('shows the items of the newest filter when an older response arrives last', async () => {
    let releaseOpen: (() => void) | undefined;
    const fake = installFakeApi({
      inbox_list: async (input: unknown) => {
        const states = (input as { states: string[] }).states;
        if (states.includes('new')) await new Promise<void>((resolve) => (releaseOpen = resolve));
        return { items: [item(states.includes('new') ? 'open-item' : 'done-item')], unread: 0 };
      },
    });
    const hook = await renderHook(useInbox, 'open' as Filter);
    unmount = hook.unmount;
    await hook.rerender('done');
    await settle();
    expect(hook.current().items, 'done items shown').toEqual([item('done-item')]);
    releaseOpen?.();
    await settle();
    expect(hook.current().items, 'the late open response is dropped').toEqual([item('done-item')]);
    expect(fake.invoke, 'both requests were made').toHaveBeenCalledTimes(2);
  });

  it('reloads once after a burst of item changes', async () => {
    const fake = installFakeApi({ inbox_list: { items: [], unread: 0 } });
    await mount();
    fake.invoke.mockClear();
    for (let i = 0; i < 5; i += 1) fake.emit({ type: 'inbox.item_changed' } as never);
    await settle();
    expect(fake.invoke, 'one reload for the burst').toHaveBeenCalledTimes(1);
  });

  it('takes the unread count from the unread event without a reload', async () => {
    const fake = installFakeApi({ inbox_list: { items: [], unread: 0 } });
    const hook = await mount();
    fake.invoke.mockClear();
    act(() => fake.emit({ type: 'inbox.unread_changed', count: 7 } as never));
    expect(hook.current().unread, 'unread from the event').toBe(7);
    expect(fake.invoke, 'no list call').not.toHaveBeenCalled();
  });

  it('keeps the previous items when the list fails', async () => {
    const fake = installFakeApi({ inbox_list: { items: [item('a')], unread: 1 } });
    const hook = await mount();
    fake.respond('inbox_list', { ok: false, error: { code: 'failed', message: 'x' } });
    fake.emit({ type: 'inbox.item_changed' } as never);
    await settle();
    expect(hook.current().items, 'items unchanged').toEqual([item('a')]);
  });

  it('stops reloading and unsubscribes on unmount', async () => {
    const fake = installFakeApi({ inbox_list: { items: [], unread: 0 } });
    const hook = await mount();
    fake.emit({ type: 'inbox.item_changed' } as never);
    fake.invoke.mockClear();
    await hook.unmount();
    unmount = undefined;
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.invoke, 'pending reload cancelled').not.toHaveBeenCalled();
    expect(fake.subscriberCount(), 'unsubscribed').toBe(0);
  });
});
