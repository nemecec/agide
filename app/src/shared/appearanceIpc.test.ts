import { describe, expect, it } from 'vitest';
import { APPEARANCE_IPC, createAppearanceApi, type AppearanceIpcRenderer } from './appearanceIpc';

function fakeIpc(reply: unknown) {
  const calls: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  const ipc: AppearanceIpcRenderer = {
    invoke: (channel, ...args) => {
      calls.push({ channel, args });
      return Promise.resolve(reply);
    },
    on: (channel, listener) => {
      listeners.set(channel, (listeners.get(channel) ?? new Set()).add(listener));
    },
    removeListener: (channel, listener) => {
      listeners.get(channel)?.delete(listener);
    },
  };
  return { ipc, calls, listeners };
}

const message = { themeId: 'agide-dark', state: { dark: true, accent: '#007aff', highContrast: false, reducedTransparency: false, differentiateWithoutColour: false } };

describe('createAppearanceApi', () => {
  it('reads the appearance over the fixed channel and parses the answer', async () => {
    const { ipc, calls } = fakeIpc({ ...message, extra: 'ignored' });
    const api = createAppearanceApi(ipc);
    expect(await api.get(), 'get answer').toEqual(message);
    expect(calls, 'channel and arguments').toEqual([{ channel: APPEARANCE_IPC.get, args: [] }]);
  });

  it('delivers parsed messages without the Electron event and stops after unsubscribe', () => {
    const { ipc, listeners } = fakeIpc(undefined);
    const seen: unknown[] = [];
    const off = createAppearanceApi(ipc).subscribe((received) => seen.push(received));
    const [handler] = [...(listeners.get(APPEARANCE_IPC.changed) ?? [])];
    handler?.({ sender: 'ipc' }, message);
    off();
    expect(seen, 'one parsed message').toEqual([message]);
    expect(listeners.get(APPEARANCE_IPC.changed)?.size, 'listener removed').toBe(0);
  });
});
