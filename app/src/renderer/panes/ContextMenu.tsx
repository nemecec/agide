import { useEffect, useRef } from 'react';
import { DropdownMenu as Primitive } from 'radix-ui';
import { useViewSuspension } from './browser/suspension';
import { MenuItems } from '../ui/Menu';
import type { MenuEntry } from '../ui/menuModel';
import { overlayRoot } from '../ui/overlayRoot';
import '../ui/Menu.css';

export type { MenuEntry } from '../ui/menuModel';

export interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly entries: readonly MenuEntry[];
}

/**
 * A menu at a pointer position. It opens on a point of the window, takes arrow keys, Escape and typing, keeps
 * inside the window, and closes on a press outside, on losing the window focus and after an entry runs. A focus
 * change inside the window does not close it: the tree moves focus between rows while a menu is open.
 */
export function ContextMenu({ menu, onClose }: { readonly menu: MenuState; readonly onClose: () => void }) {
  useViewSuspension(true);
  const opener = useRef(document.activeElement);
  const entries = menu.entries.map((entry) => ({
    ...entry,
    run: () => {
      // The entry may open a dialog; the dialog should find the element that had focus before the menu, not the menu item.
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      entry.run();
    },
  }));
  useEffect(() => {
    window.addEventListener('blur', onClose);
    return () => window.removeEventListener('blur', onClose);
  }, [onClose]);

  return (
    <Primitive.Root
      open
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Primitive.Trigger asChild>
        <span className="ui-menu-anchor" aria-hidden="true" style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }} />
      </Primitive.Trigger>
      <Primitive.Portal container={overlayRoot()}>
        <Primitive.Content
          className="ui-menu"
          align="start"
          side="bottom"
          sideOffset={0}
          collisionPadding={4}
          loop
          onFocusOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const active = document.activeElement;
            if ((active === null || active === document.body) && opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
          }}
        >
          <MenuItems entries={entries} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
