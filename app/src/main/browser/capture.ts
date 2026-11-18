import type { ViewStill } from './views';

/**
 * Script that draws each still (or a "not shared" mask) over its slot, waits two frames and returns. The window
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

export function overlayScript(items: readonly (ViewStill & { readonly shared: boolean })[]): string {
  return `(() => {
  const items = ${JSON.stringify(items.map((item) => ({ leafId: item.leafId, bounds: item.bounds, dataUrl: item.shared ? (item.dataUrl ?? null) : null })))};
  for (const item of items) {
    const slot = document.querySelector('[data-browser-slot="' + CSS.escape(item.leafId) + '"]');
    if (slot && slot.closest('[data-capture-mask]')) item.dataUrl = null;
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
      el.textContent = 'not shared';
    }
    document.body.appendChild(el);
  }
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
})()`;
}

export const removeOverlayScript = `document.querySelectorAll('[${OVERLAY_ATTRIBUTE}]').forEach((el) => el.remove())`;
