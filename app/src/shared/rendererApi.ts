import type { CommandDescriptor, CommandResult } from '../core/commands/types';
import type { AppEvent } from '../core/events/index';
import { IPC, type RendererApi } from './ipc';

type Listener = (event: unknown, ...args: unknown[]) => void;

/** The part of Electron's `ipcRenderer` the API uses. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
}

/** What the preload exposes as `window.api`: three calls, all through the fixed IPC channels. */
export function createRendererApi(ipc: IpcRendererLike): RendererApi {
  return {
    invoke: <O>(commandId: string, input?: unknown) => ipc.invoke(IPC.invoke, commandId, input) as Promise<CommandResult<O>>,
    listCommands: () => ipc.invoke(IPC.list) as Promise<CommandDescriptor[]>,
    subscribe: (listener) => {
      const handler: Listener = (_event, appEvent) => listener(appEvent as AppEvent);
      ipc.on(IPC.event, handler);
      return () => {
        ipc.removeListener(IPC.event, handler);
      };
    },
  };
}
