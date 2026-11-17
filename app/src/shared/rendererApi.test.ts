import { describe, expect, it } from 'vitest';
import type { AppEvent } from '../core/events/index';
import { IPC } from './ipc';
import { createRendererApi, type IpcRendererLike } from './rendererApi';

function fakeIpc() {
  const calls: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  const ipc: IpcRendererLike = {
    invoke: (channel, ...args) => {
      calls.push({ channel, args });
      return Promise.resolve({ ok: true, value: channel });
    },
    on: (channel, listener) => {
      listeners.set(channel, (listeners.get(channel) ?? new Set()).add(listener));
    },
    removeListener: (channel, listener) => {
      listeners.get(channel)?.delete(listener);
    },
  };
  const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((l) => l({ sender: 'ipc' }, payload));
  return { ipc, calls, listeners, emit };
}

describe('createRendererApi', () => {
  it('sends commands and the command list over the fixed channels only', async () => {
    const { ipc, calls } = fakeIpc();
    const api = createRendererApi(ipc);
    await api.invoke('ui_list_tree', { a: 1 });
    await api.listCommands();
    expect(calls, 'channels and arguments').toEqual([
      { channel: IPC.invoke, args: ['ui_list_tree', { a: 1 }] },
      { channel: IPC.list, args: [] },
    ]);
  });

  it('exposes nothing beyond the three calls', () => {
    expect(Object.keys(createRendererApi(fakeIpc().ipc)).sort(), 'api surface').toEqual(['invoke', 'listCommands', 'subscribe']);
  });

  it('passes the event payload to the listener without the Electron event object', () => {
    const { ipc, emit } = fakeIpc();
    const seen: unknown[] = [];
    createRendererApi(ipc).subscribe((event) => seen.push(event));
    const appEvent = { type: 'tree.changed' } as unknown as AppEvent;
    emit(IPC.event, appEvent);
    expect(seen, 'listener got the payload').toEqual([appEvent]);
  });

  it('stops delivering after unsubscribe', () => {
    const { ipc, emit, listeners } = fakeIpc();
    const seen: unknown[] = [];
    const off = createRendererApi(ipc).subscribe((event) => seen.push(event));
    off();
    emit(IPC.event, { type: 'x' });
    expect(seen, 'no delivery').toEqual([]);
    expect(listeners.get(IPC.event)?.size, 'handler removed from the channel').toBe(0);
  });
});
