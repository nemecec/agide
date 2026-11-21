import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';
import { decideWindowOpen, isAppFrameUrl as isAppFrame, mainWindowWebPreferences } from './windowPolicy';

export const APP_TITLE = 'Agide';

/** Centres the traffic lights in the 38 px title bar of the renderer. */
export const TRAFFIC_LIGHT_POSITION = { x: 14, y: 13 } as const;

/** The dev server of `pnpm dev`. A packaged app ignores it, so the privileged preload loads only the app's own page. */
function devServerUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
}

const RENDERER_DIR_URL = pathToFileURL(join(import.meta.dirname, '../renderer')).href;

/** True for a frame URL that belongs to the app: its own built page, or the dev server. */
export const isAppFrameUrl = (url: string): boolean => isAppFrame(url, { rendererDirUrl: RENDERER_DIR_URL, devServerUrl: devServerUrl() });

export function createMainWindow(options: { show: boolean; title?: string }): BrowserWindow {
  const window = new BrowserWindow({
    title: options.title ?? APP_TITLE,
    width: 1280,
    height: 800,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    webPreferences: mainWindowWebPreferences(join(import.meta.dirname, '../preload/index.cjs'), { devTools: !app.isPackaged }),
  });

  // The page title would replace the profile name in the window title.
  if (options.title) window.on('page-title-updated', (event) => event.preventDefault());

  // The app window needs no web permission (camera, notifications and the like).
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);

  if (options.show) window.once('ready-to-show', () => window.show());

  // Links open in the default browser; the app window never navigates away from the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url);
    if (decision.openExternal) void shell.openExternal(decision.openExternal);
    return { action: decision.action };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devUrl = devServerUrl();
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return window;
}
