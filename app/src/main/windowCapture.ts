import type { WindowCapturer } from '../core/layout/index';

/** What the browser module adds to a window capture: a script that draws the views as stills and one that removes them. */
export interface CaptureOverlay {
  readonly apply: string;
  readonly remove: string;
  readonly shared: readonly string[];
}

let overlayProvider: (() => Promise<CaptureOverlay>) | undefined;

/** Set by the browser module. A capture of the app window does not include child views, so the overlay composes them. */
export function setCaptureOverlay(provider: (() => Promise<CaptureOverlay>) | undefined): void {
  overlayProvider = provider;
}

const MASK_ATTRIBUTE = 'data-capture-mask';

const maskScript = (ids: readonly string[]): string => `(() => {
  const ids = ${JSON.stringify(ids)};
  for (const id of ids) for (const el of document.querySelectorAll('[data-instance-id="' + CSS.escape(id) + '"]')) el.setAttribute('${MASK_ATTRIBUTE}', '');
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
})()`;

const unmaskScript = `document.querySelectorAll('[${MASK_ATTRIBUTE}]').forEach((el) => el.removeAttribute('${MASK_ATTRIBUTE}'))`;

/**
 * PNG of the first app window. Electron is loaded on demand so modules that register the capture command
 * still load in plain Node, where the command fails with a message.
 */
export const captureAppWindow: WindowCapturer = async (masked) => {
  const electron = (await import('electron')) as { BrowserWindow?: typeof import('electron').BrowserWindow };
  const window = electron.BrowserWindow?.getAllWindows().find((w) => !w.isDestroyed());
  if (!window) throw new Error('no app window to capture; the app runs without Electron here');
  const { webContents } = window;
  const overlay = await overlayProvider?.();
  try {
    if (masked.length > 0) await webContents.executeJavaScript(maskScript(masked));
    if (overlay) await webContents.executeJavaScript(overlay.apply);
    const image = await webContents.capturePage();
    const { width, height } = image.getSize();
    if (width === 0 || height === 0) throw new Error('the window produced an empty image');
    return { data: image.toPNG().toString('base64'), width, height };
  } finally {
    if (masked.length > 0) await webContents.executeJavaScript(unmaskScript).catch(() => undefined);
    if (overlay) await webContents.executeJavaScript(overlay.remove).catch(() => undefined);
  }
};
