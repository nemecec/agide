import { useState, type ReactElement } from 'react';
import { DropdownMenu as Primitive } from 'radix-ui';
import { useViewSuspension } from '../panes/browser/suspension';
import { Icon } from './Icon';
import { menuRows, type MenuEntry } from './menuModel';
import { overlayRoot } from './overlayRoot';
import './Menu.css';

export type { MenuEntry } from './menuModel';

/** The rows of a menu, shared by the trigger menu and the pointer menu. The icon gutter exists only when an entry has an icon. */
export function MenuItems({ entries }: { readonly entries: readonly MenuEntry[] }) {
  const gutter = entries.some((entry) => entry.icon !== undefined);
  return menuRows(entries).map((row) => {
    if (row.kind === 'separator') return <Primitive.Separator key={row.key} className="ui-menu-separator" />;
    if (row.kind === 'heading') return <Primitive.Label key={row.key} className="ui-menu-heading">{row.text}</Primitive.Label>;
    const { entry } = row;
    return (
      <Primitive.Item key={row.key} className="ui-menu-item" data-danger={entry.danger === true ? 'true' : undefined} disabled={entry.disabled} onSelect={() => entry.run()}>
        {gutter ? <span className="ui-menu-icon">{entry.icon ? <Icon icon={entry.icon} size="md" /> : null}</span> : null}
        <span className="ui-menu-label">{entry.label}</span>
        {entry.shortcut ? <span className="ui-menu-shortcut">{entry.shortcut}</span> : null}
      </Primitive.Item>
    );
  });
}

export interface MenuProps {
  /** The button that opens the menu. It must take a ref and pass props to a DOM element. */
  readonly trigger: ReactElement;
  readonly entries: readonly MenuEntry[];
  readonly align?: 'start' | 'center' | 'end';
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * A menu that opens from a button. Arrow keys, Home, End and typing move the highlight, Escape closes and returns
 * focus to the button, and the list stays inside the window.
 */
export function Menu({ trigger, entries, align = 'end', open, onOpenChange }: MenuProps) {
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  useViewSuspension(shown);
  return (
    <Primitive.Root
      open={shown}
      modal={false}
      onOpenChange={(next) => {
        setOwn(next);
        onOpenChange?.(next);
      }}
    >
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal container={overlayRoot()}>
        <Primitive.Content className="ui-menu" align={align} sideOffset={4} collisionPadding={4} loop>
          <MenuItems entries={entries} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
