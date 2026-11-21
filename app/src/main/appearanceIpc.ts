import { app, BrowserWindow, ipcMain, nativeTheme, systemPreferences, type IpcMainInvokeEvent } from 'electron';
import { type AppearanceMessage, type AppearanceState } from '../core/theme/appearance';
import type { ThemeService } from '../core/theme/service';
import { APPEARANCE_IPC } from '../shared/appearanceIpc';
import { createAppearance, type AppearanceAdapter } from './appearance';
import { isTrustedSource } from './ipcPolicy';
import { isAppFrameUrl } from './window';

/** The test hook of `__agideTestHooks`: tests change what the adapter reports, through `app.evaluate`. */
export interface AppearanceTestHook {
  override(fields: Partial<AppearanceState> | undefined): void;
  current(): AppearanceState;
}

export interface AppearanceWiring {
  readonly hook: AppearanceTestHook;
  dispose(): void;
}

/**
 * Starts the adapter, answers `appearance:get` from app pages and sends one
 * `appearance:changed` message per change of the OS state or the theme service to every window that shows an app page.
 * A preview limited to one window goes to that window only.
 */
export function wireAppearance(theme: ThemeService): AppearanceWiring {
  const message = (state: AppearanceState, windowId?: number): AppearanceMessage => {
    const { preview, ...rest } = theme.state();
    const { windowId: previewWindow, ...shown } = preview ?? { windowId: undefined };
    const visible = preview !== undefined && (previewWindow === undefined || previewWindow === windowId);
    return { state, ...rest, ...(visible ? { preview: shown as NonNullable<typeof preview> } : {}) };
  };
  const broadcast = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && isAppFrameUrl(window.webContents.getURL())) window.webContents.send(APPEARANCE_IPC.changed, message(adapter.current(), window.id));
    }
  };
  const adapter: AppearanceAdapter = createAppearance({
    nativeTheme,
    systemPreferences,
    platform: process.platform,
    onChange: () => {
      theme.setAppearance(adapter.current());
      broadcast();
    },
  });
  theme.setAppearance(adapter.current());
  const unsubscribe = theme.subscribe(broadcast);
  const onWindowCreated = (_event: unknown, window: BrowserWindow): void => void window.once('closed', () => theme.windowClosed(window.id));
  app.on('browser-window-created', onWindowCreated);

  const trusted = (event: IpcMainInvokeEvent): boolean =>
    isTrustedSource(
      { inAppWindow: BrowserWindow.fromWebContents(event.sender) !== null, isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url ?? '' },
      isAppFrameUrl,
    );

  ipcMain.handle(APPEARANCE_IPC.get, (event) => message(adapter.current(), BrowserWindow.fromWebContents(event.sender)?.id));

  return {
    hook: { override: (fields) => adapter.override(fields), current: () => adapter.current() },
    dispose: () => {
      unsubscribe();
      app.removeListener('browser-window-created', onWindowCreated);
      adapter.dispose();
      ipcMain.removeHandler(APPEARANCE_IPC.get);
    },
  };
}
