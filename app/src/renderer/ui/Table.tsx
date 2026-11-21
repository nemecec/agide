import type { ComponentProps } from 'react';
import { cx } from './cx';
import './Table.css';

/**
 * A plain table: caption-size headers on the window surface, rules between rows, numbers right aligned with
 * tabular figures. A state column shows the status icon and word (StatusChip), never colour alone.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table {...props} className={cx('ui-table', className)} />;
}

export const TableHead = (props: ComponentProps<'thead'>) => <thead {...props} />;
export const TableBody = (props: ComponentProps<'tbody'>) => <tbody {...props} />;

export function TableRow({ selected, className, ...props }: ComponentProps<'tr'> & { readonly selected?: boolean }) {
  return <tr {...props} className={cx('ui-table-row', className)} data-selected={selected || undefined} />;
}

export function TableHeader({ numeric, className, ...props }: ComponentProps<'th'> & { readonly numeric?: boolean }) {
  return <th scope="col" {...props} className={cx('ui-table-header', className)} data-numeric={numeric || undefined} />;
}

export function TableCell({ numeric, className, ...props }: ComponentProps<'td'> & { readonly numeric?: boolean }) {
  return <td {...props} className={cx('ui-table-cell', className)} data-numeric={numeric || undefined} />;
}
