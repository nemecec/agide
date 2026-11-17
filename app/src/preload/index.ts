import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppEvent } from '../core/events/index';
import { IPC, type RendererApi } from '../shared/ipc';

const api: RendererApi = {
  invoke: (commandId, input) => ipcRenderer.invoke(IPC.invoke, commandId, input),
  listCommands: () => ipcRenderer.invoke(IPC.list),
  subscribe: (listener) => {
    const handler = (_event: IpcRendererEvent, appEvent: AppEvent) => listener(appEvent);
    ipcRenderer.on(IPC.event, handler);
    return () => {
      ipcRenderer.removeListener(IPC.event, handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
