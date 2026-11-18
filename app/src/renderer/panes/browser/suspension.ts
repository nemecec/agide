import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../api';

export interface Still {
  readonly leafId: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly dataUrl?: string;
}

let stills: readonly Still[] = [];
let dragging = false;
let holds = 0;
let applied = false;
let chain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const publish = (next: readonly Still[]): void => {
  stills = next;
  for (const listener of listeners) listener();
};

/**
 * Native views draw above the DOM and swallow mouse events, so a drag, a dialog, a menu or a popover hides them
 * behind a still of each (0026 section 1). The views stay hidden while a drag is on or any overlay holds them.
 * Calls to the main process run one after the other, so a resume never overtakes the suspend before it.
 */
function sync(): Promise<void> {
  chain = chain.then(async () => {
    const wanted = dragging || holds > 0;
    if (wanted === applied) return;
    applied = wanted;
    if (wanted) {
      const result = await api().invoke<{ stills: Still[] }>('browser_views_suspend');
      publish(result.ok ? (result.value?.stills ?? []) : []);
    } else {
      await api().invoke('browser_views_resume');
      publish([]);
    }
  });
  return chain;
}

export function suspendViews(): Promise<void> {
  dragging = true;
  return sync();
}

export function resumeViews(): Promise<void> {
  dragging = false;
  return sync();
}

/** Keeps the views hidden until the returned function is called. Holds add up; the last release shows the views. */
export function holdViews(): () => void {
  holds++;
  void sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    void sync();
  };
}

/** Hides the native views while `open` is true; for dialogs, menus and popovers that can reach a browser slot. */
export function useViewSuspension(open: boolean): void {
  useEffect(() => (open ? holdViews() : undefined), [open]);
}

export function useStill(leafId: string): Still | undefined {
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => stills,
  );
  return all.find((still) => still.leafId === leafId);
}

/** Installs the drag listeners once: docking and tree drags (HTML5 drag events) and split divider drags (pointer on a sash). */
export function installDragSuspension(target: Document = document): () => void {
  const onDragStart = (): void => void suspendViews();
  const onEnd = (): void => void resumeViews();
  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('.dv-sash')) void suspendViews();
  };
  target.addEventListener('dragstart', onDragStart, true);
  target.addEventListener('dragend', onEnd, true);
  target.addEventListener('drop', onEnd, true);
  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('pointerup', onEnd, true);
  return () => {
    target.removeEventListener('dragstart', onDragStart, true);
    target.removeEventListener('dragend', onEnd, true);
    target.removeEventListener('drop', onEnd, true);
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('pointerup', onEnd, true);
  };
}
