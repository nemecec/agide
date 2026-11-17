import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { CommandRegistry } from '../core/commands/index';
import type { AppEventBus } from '../core/events/index';
import { IPC } from '../shared/ipc';
import { invokeFromRenderer, isTrustedSource, listFromRenderer } from './ipcPolicy';
import { isAppFrameUrl } from './window';

/**
 * Generic IPC: command invocation and event broadcast. Only the main frame of an app window may invoke;
 * browser surfaces (`WebContentsView`) get no preload and no IPC.
 */
export function registerIpc(commands: CommandRegistry, events: AppEventBus): () => void {
  const trusted = (event: IpcMainInvokeEvent): boolean =>
    isTrustedSource(
      {
        inAppWindow: BrowserWindow.fromWebContents(event.sender) !== null,
        isMainFrame: event.senderFrame === event.sender.mainFrame,
        frameUrl: event.senderFrame?.url ?? '',
      },
      isAppFrameUrl,
    );

  ipcMain.handle(IPC.invoke, (event, commandId: unknown, input: unknown) => invokeFromRenderer(commands, trusted(event), commandId, input));
  ipcMain.handle(IPC.list, (event) => listFromRenderer(commands, trusted(event)));

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
