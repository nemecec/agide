import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], summary, [tabindex]:not([tabindex="-1"])';

/** The focusable elements inside a dialog, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest('[hidden]') && (element.tagName === 'SUMMARY' || !element.closest('details:not([open])')));
}

/** The element a Tab press moves to: wraps around the ends so focus never leaves the dialog. */
export function nextFocus(items: readonly HTMLElement[], current: Element | null, backwards: boolean): HTMLElement | undefined {
  if (items.length === 0) return undefined;
  const at = current instanceof HTMLElement ? items.indexOf(current) : -1;
  if (at === -1) return backwards ? items[items.length - 1] : items[0];
  if (backwards) return at === 0 ? items[items.length - 1] : undefined;
  return at === items.length - 1 ? items[0] : undefined;
}

/**
 * Holds a dialog: a backdrop behind it, focus on its first field when it opens, Tab kept inside, Escape pressing
 * the Cancel button (the element marked `data-dialog-cancel`) and focus back on the element that opened it.
 */
export function DialogFrame({ children }: { readonly children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const root = layer.current;
    if (root) {
      const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(root)[0];
      first?.focus();
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const root = layer.current;
    if (!root) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      root.querySelector<HTMLElement>('[data-dialog-cancel]')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const target = nextFocus(focusableIn(root), document.activeElement, event.shiftKey);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  return (
    <div ref={layer} className="dialog-layer" onKeyDown={onKeyDown}>
      <div className="dialog-backdrop" aria-hidden="true" />
      {children}
    </div>
  );
}
