// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../testing/fakeApi';
import { flush, renderHook } from '../testing/render';
import type { ProfileList } from './profileModel';
import { useProfiles } from './useProfiles';

const list = (own: string): ProfileList => ({ own, persistent: true, palette: [], profiles: [] });
let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function mount() {
  const hook = await renderHook(useProfiles);
  unmount = hook.unmount;
  return hook;
}

describe('useProfiles', () => {
  it('loads the profile list once on mount', async () => {
    const fake = installFakeApi({ profile_list: list('work') });
    const hook = await mount();
    expect(hook.current().list?.own, 'list').toBe('work');
    expect(fake.invoke, 'one call').toHaveBeenCalledTimes(1);
  });

  it('loads again on a registry status event and when the window gets focus', async () => {
    let own = 'work';
    const fake = installFakeApi({ profile_list: () => list(own) });
    const hook = await mount();
    own = 'home';
    fake.emit({ type: 'tree.changed' } as never);
    await flush();
    expect(hook.current().list?.own, 'unrelated event').toBe('work');
    fake.emit({ type: 'profile.statuses_changed' } as never);
    await flush();
    expect(hook.current().list?.own, 'status event').toBe('home');
    own = 'third';
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(hook.current().list?.own, 'focus').toBe('third');
  });

  it('keeps the list when a reload fails', async () => {
    const fake = installFakeApi({ profile_list: list('work') });
    const hook = await mount();
    fake.respond('profile_list', { ok: false, error: { code: 'failed', message: 'x' } });
    await act(async () => hook.current().reload());
    expect(hook.current().list?.own, 'previous list').toBe('work');
  });

  it('removes the event and focus listeners on unmount', async () => {
    const fake = installFakeApi({ profile_list: list('work') });
    const hook = await mount();
    await hook.unmount();
    unmount = undefined;
    fake.invoke.mockClear();
    window.dispatchEvent(new Event('focus'));
    expect(fake.subscriberCount(), 'unsubscribed').toBe(0);
    expect(fake.invoke, 'focus no longer reloads').not.toHaveBeenCalled();
  });
});
