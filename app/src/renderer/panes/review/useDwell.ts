import { useEffect, useRef, type RefObject } from 'react';

/** Time in view before something counts as seen: the `review.dwellMs` default of 0041. */
export const DEFAULT_DWELL_MS = 1_500;

export interface DwellOptions {
  /** False when there is nothing to record (already seen, or nothing to mark). */
  readonly enabled: boolean;
  /** The share of the element that must be in view. */
  readonly ratio: number;
  readonly ms?: number;
  readonly onSeen: () => void;
}

/**
 * Calls `onSeen` once the element has been at least `ratio` in view for `ms` while the window has focus. Leaving
 * the view or losing focus restarts the count. Without IntersectionObserver nothing is recorded, and the explicit
 * "Mark seen" buttons remain.
 */
export function useDwell(element: RefObject<Element | null>, { enabled, ratio, ms = DEFAULT_DWELL_MS, onSeen }: DwellOptions): void {
  const callback = useRef(onSeen);
  callback.current = onSeen;
  useEffect(() => {
    const target = element.current;
    if (!enabled || target === null || typeof IntersectionObserver === 'undefined') return undefined;
    let inView = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const start = (): void => {
      stop();
      if (!inView || !document.hasFocus()) return;
      timer = setTimeout(() => {
        timer = undefined;
        callback.current();
      }, ms);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last === undefined) return;
        inView = last.isIntersecting && last.intersectionRatio >= ratio;
        start();
      },
      { threshold: [ratio] },
    );
    observer.observe(target);
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', stop);
    };
  }, [element, enabled, ratio, ms]);
}
