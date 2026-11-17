import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { CommandRegistry } from '../core/commands/index';
import type { AppEventBus } from '../core/events/index';
import { IPC } from '../shared/ipc';
import { isAppFrameUrl } from './window';

/**
 * Generic IPC: command invocation and event broadcast. Only the main frame of an app window may invoke;
 * browser surfaces (`WebContentsView`) get no preload and no IPC.
 */
export function registerIpc(commands: CommandRegistry, events: AppEventBus): () => void {
  const trusted = (event: IpcMainInvokeEvent): boolean =>
    BrowserWindow.fromWebContents(event.sender) !== null &&
    event.senderFrame === event.sender.mainFrame &&
    isAppFrameUrl(event.senderFrame.url);

  ipcMain.handle(IPC.invoke, (event, commandId: unknown, input: unknown) => {
    if (!trusted(event) || typeof commandId !== 'string') {
      return { ok: false, error: { code: 'not_found', message: 'rejected' } };
    }
    return commands.invoke(commandId, input, { kind: 'ui' });
  });
  ipcMain.handle(IPC.list, (event) => (trusted(event) ? commands.describe() : []));

  const unsubscribe = events.onAny((appEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.event, appEvent);
    }
  });

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC.invoke);
    ipcMain.removeHandler(IPC.list);
  };
}
