import type { IconComponent } from './icons';

export interface MenuEntry {
  readonly label: string;
  readonly run: () => void;
  readonly icon?: IconComponent;
  /** Shown at the right, for example "Cmd+N". */
  readonly shortcut?: string;
  /** A rule is drawn above the entry. */
  readonly separated?: boolean;
  /** The entry removes something: drawn in the danger colour and always set apart from the entries before it. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** A group label drawn above the entry. */
  readonly heading?: string;
}

export type MenuRow =
  | { readonly kind: 'separator'; readonly key: string }
  | { readonly kind: 'heading'; readonly key: string; readonly text: string }
  | { readonly kind: 'item'; readonly key: string; readonly entry: MenuEntry };

/**
 * The rows of a menu: a rule above an entry that asks for one and above the first destructive entry that follows a
 * safe one, never at the top, and a group label above the entry that starts the group.
 */
export function menuRows(entries: readonly MenuEntry[]): MenuRow[] {
  const rows: MenuRow[] = [];
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    const dangerStarts = entry.danger === true && previous !== undefined && previous.danger !== true;
    if (index > 0 && (entry.separated === true || dangerStarts || entry.heading !== undefined)) rows.push({ kind: 'separator', key: `rule-${index}` });
    if (entry.heading !== undefined) rows.push({ kind: 'heading', key: `heading-${index}`, text: entry.heading });
    rows.push({ kind: 'item', key: `item-${index}`, entry });
  });
  return rows;
}
