import type { WindowCapturer } from '../core/layout/index';

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
  try {
    if (masked.length > 0) await webContents.executeJavaScript(maskScript(masked));
    const image = await webContents.capturePage();
    const { width, height } = image.getSize();
    if (width === 0 || height === 0) throw new Error('the window produced an empty image');
    return { data: image.toPNG().toString('base64'), width, height };
  } finally {
    if (masked.length > 0) await webContents.executeJavaScript(unmaskScript).catch(() => undefined);
  }
};
