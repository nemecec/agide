import type { WindowCapturer } from '../core/layout/index';

/**
 * What the browser module adds to a window capture: a script that draws the views as stills and one that removes
 * them. The apply script resolves with the leaf ids it drew as "page not captured".
 */
export interface CaptureOverlay {
  readonly apply: string;
  readonly remove: string;
}

/** What the overlay needs to know about the caller of a capture. */
export interface CaptureScope {
  /** Set for a caller scoped to a folder: the tree nodes it may see. */
  readonly inScope?: ((nodeId: string) => boolean) | undefined;
  /** Leaf ids of the browser views that sit in a pane the capture masks. */
  readonly maskedLeafIds: ReadonlySet<string>;
}

let overlayProvider: ((scope: CaptureScope) => Promise<CaptureOverlay>) | undefined;

/** Set by the browser module. A capture of the app window does not include child views, so the overlay composes them. */
export function setCaptureOverlay(provider: ((scope: CaptureScope) => Promise<CaptureOverlay>) | undefined): void {
  overlayProvider = provider;
}

const MASK_ATTRIBUTE = 'data-capture-mask';

/** Attribute of an element outside the panes that shows data of every folder; the capture hides it from a scoped caller. */
export const SCOPED_ATTRIBUTE = 'data-capture-scoped';

/** Set on the document element for a scoped caller; the style sheet fills each element with the scoped attribute below it, also one that mounts later. */
export const SCOPED_MASK_ATTRIBUTE = 'data-capture-scoped-mask';

/** Takes the pane frame and the dock tab of each instance id, and for a scoped caller the document root, which hides every element that carries the scoped attribute. */
export const maskScript = (ids: readonly string[], scoped = false): string => `(() => {
  const ids = new Set(${JSON.stringify(ids)});
  for (const el of document.querySelectorAll('[data-instance-id], [data-pane-tab]')) {
    if (ids.has(el.getAttribute('data-instance-id') ?? el.getAttribute('data-pane-tab'))) el.setAttribute('${MASK_ATTRIBUTE}', '');
  }
  if (${scoped}) document.documentElement.setAttribute('${SCOPED_MASK_ATTRIBUTE}', '');
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
})()`;

/** Leaf ids of the browser slots inside the pane frames of the given instance ids. */
export const maskedSlotsScript = (ids: readonly string[]): string => `(() => {
  const ids = new Set(${JSON.stringify(ids)});
  const leafIds = [];
  for (const frame of document.querySelectorAll('[data-instance-id]')) {
    if (!ids.has(frame.getAttribute('data-instance-id'))) continue;
    for (const slot of frame.querySelectorAll('[data-browser-slot]')) leafIds.push(slot.getAttribute('data-browser-slot'));
  }
  return leafIds;
})()`;

const unmaskScript = `document.querySelectorAll('[${MASK_ATTRIBUTE}]').forEach((el) => el.removeAttribute('${MASK_ATTRIBUTE}')); document.documentElement.removeAttribute('${SCOPED_MASK_ATTRIBUTE}')`;

/** How often a capture takes the mask again when the layout or the context changed while it ran. */
const MASK_ATTEMPTS = 3;

const sameInstances = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * PNG of the first app window. Electron is loaded on demand so modules that register the capture command
 * still load in plain Node, where the command fails with a message.
 *
 * The instances to hide are read again after the overlay has waited for the views and again after the pixels
 * are taken. A capture whose mask changed meanwhile is taken again, so the PNG never shows a pane the final
 * mask would hide, and the result names the mask that was applied.
 */
export const captureAppWindow: WindowCapturer = async ({ masked, inScope }) => {
  const electron = (await import('electron')) as { BrowserWindow?: typeof import('electron').BrowserWindow };
  const window = electron.BrowserWindow?.getAllWindows().find((w) => !w.isDestroyed());
  if (!window) throw new Error('no app window to capture; the app runs without Electron here');
  const { webContents } = window;
  const maskedLeaves = async (ids: readonly string[]): Promise<Set<string>> =>
    new Set(ids.length > 0 ? ((await webContents.executeJavaScript(maskedSlotsScript(ids))) as string[]) : []);
  const overlay = await overlayProvider?.({ inScope, maskedLeafIds: await maskedLeaves(masked()) });
  try {
    for (let attempt = 1; ; attempt++) {
      const applied = masked();
      if (applied.length > 0 || inScope) await webContents.executeJavaScript(maskScript(applied, inScope !== undefined));
      const unavailable = overlay ? ((await webContents.executeJavaScript(overlay.apply)) as string[]) : [];
      const image = await webContents.capturePage();
      if (sameInstances(masked(), applied)) {
        const { width, height } = image.getSize();
        if (width === 0 || height === 0) throw new Error('the window produced an empty image');
        return { data: image.toPNG().toString('base64'), width, height, masked: applied, unavailable };
      }
      if (attempt >= MASK_ATTEMPTS) throw new Error('the window changed while it was captured; try again');
      await webContents.executeJavaScript(unmaskScript);
      if (overlay) await webContents.executeJavaScript(overlay.remove);
    }
  } finally {
    await webContents.executeJavaScript(unmaskScript).catch(() => undefined);
    if (overlay) await webContents.executeJavaScript(overlay.remove).catch(() => undefined);
  }
};
