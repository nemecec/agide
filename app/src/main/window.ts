import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';

export const APP_TITLE = 'Agide';

/** The dev server of `pnpm dev`. A packaged app ignores it, so the privileged preload loads only the app's own page. */
function devServerUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
}

const RENDERER_DIR_URL = pathToFileURL(join(import.meta.dirname, '../renderer')).href;

/** True for a frame URL that belongs to the app: its own built page, or the dev server. */
export function isAppFrameUrl(url: string): boolean {
  if (url.startsWith(`${RENDERER_DIR_URL}/`)) return true;
  const dev = devServerUrl();
  return dev !== undefined && new URL(url).origin === new URL(dev).origin;
}

export function createMainWindow(options: { show: boolean }): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_TITLE,
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The app window needs no web permission (camera, notifications and the like).
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);

  if (options.show) window.once('ready-to-show', () => window.show());

  // Links open in the default browser; the app window never navigates away from the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devUrl = devServerUrl();
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return window;
}
