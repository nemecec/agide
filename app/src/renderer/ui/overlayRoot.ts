const ROOT_ID = 'agide-overlays';

/** The one element at the end of `body` that every Radix portal renders into, so no pane stacking context traps an overlay. */
export function overlayRoot(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.append(root);
  return root;
}
