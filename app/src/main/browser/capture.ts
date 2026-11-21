import type { ViewStill } from './views';

/**
 * Script that draws each still (or a mask) over its slot, waits until the images are decoded and two frames have passed, and returns. The window
 * capture takes the image after it; `removeOverlayScript` takes the elements away again. A capture of the
 * app window does not include child views (probe, 2026-11-17), so the capture composes.
 */
export const OVERLAY_ATTRIBUTE = 'data-capture-view';

/**
 * Stacking level of a still. Dialogs, menus and the tab chrome with its popovers draw above it. While one of
 * them is open the renderer hides the native views behind stills of its own (`suspension.ts`), so the capture
 * keeps the page under them in the same way.
 */
export const STILL_Z_INDEX = 9;

export const NOT_SHARED_LABEL = 'not shared';
export const NOT_CAPTURED_LABEL = 'page not captured';

/**
 * Draws each item as a still, a "not shared" fill or a "page not captured" fill at its bounds. An item whose
 * slot is not in the document when the script runs is skipped. The script returns the leaf ids it drew as
 * "page not captured".
 */
export function overlayScript(items: readonly (ViewStill & { readonly shared: boolean })[]): string {
  return `(() => {
  const items = ${JSON.stringify(items.map((item) => ({ leafId: item.leafId, bounds: item.bounds, dataUrl: item.shared ? (item.dataUrl ?? null) : null, label: item.shared ? NOT_CAPTURED_LABEL : NOT_SHARED_LABEL })))};
  const unavailable = [];
  for (const item of items) {
    const slot = [...document.querySelectorAll('[data-browser-slot]')].find((candidate) => candidate.getAttribute('data-browser-slot') === item.leafId);
    if (!slot) continue;
    if (slot.closest('[data-capture-mask]')) {
      item.dataUrl = null;
      item.label = ${JSON.stringify(NOT_SHARED_LABEL)};
    } else if (!item.dataUrl && item.label === ${JSON.stringify(NOT_CAPTURED_LABEL)}) {
      unavailable.push(item.leafId);
    }
    const el = document.createElement('div');
    el.setAttribute('${OVERLAY_ATTRIBUTE}', '');
    const b = item.bounds;
    el.style.cssText = 'position:fixed;z-index:${STILL_Z_INDEX};left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.width + 'px;height:' + b.height + 'px;overflow:hidden;';
    if (item.dataUrl) {
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;';
      el.appendChild(img);
    } else {
      el.style.cssText += 'background:#555;color:#fff;font:14px system-ui;display:flex;align-items:center;justify-content:center;';
      el.textContent = item.label;
    }
    document.body.appendChild(el);
  }
  const decoded = [...document.querySelectorAll('[${OVERLAY_ATTRIBUTE}] img')].map((img) => img.decode().catch(() => undefined));
  return Promise.all(decoded).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(unavailable)))));
})()`;
}

export const removeOverlayScript = `document.querySelectorAll('[${OVERLAY_ATTRIBUTE}]').forEach((el) => el.remove())`;
