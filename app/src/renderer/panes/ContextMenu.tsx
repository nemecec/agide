import { useEffect } from 'react';
import { useViewSuspension } from './browser/suspension';

export interface MenuEntry {
  readonly label: string;
  readonly run: () => void;
}

export interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly entries: readonly MenuEntry[];
}

/** A small popup menu. It closes on any click outside, on Escape and after an entry runs. */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  useViewSuspension(true);
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <ul className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {menu.entries.map((entry) => (
        <li key={entry.label} role="none">
          <button
            type="button"
            role="menuitem"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              onClose();
              entry.run();
            }}
          >
            {entry.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
