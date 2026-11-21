import type { ReactNode } from 'react';
import { DialogRoot } from '../ui/Dialog';
import { overlayRoot } from '../ui/overlayRoot';

/**
 * Holds a dialog on Radix Dialog: a backdrop, inert background, focus on the first field, Tab kept inside and focus
 * back on the opener. Escape presses the Cancel button (the element marked `data-dialog-cancel`), so the dialog
 * ends the same way as when the user presses it; without one, `onClose` runs.
 */
export function DialogFrame({ onClose, children }: { readonly onClose: () => void; readonly children: ReactNode }) {
  const cancel = (): void => {
    const button = overlayRoot().querySelector<HTMLElement>('[data-dialog-cancel]');
    if (button) button.click();
    else onClose();
  };
  return (
    <DialogRoot open onOpenChange={(open) => (open ? undefined : cancel())}>
      {children}
    </DialogRoot>
  );
}
