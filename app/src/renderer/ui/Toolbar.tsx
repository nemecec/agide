import type { ComponentProps } from 'react';
import { Toolbar as Primitive } from 'radix-ui';
import { cx } from './cx';
import './Toolbar.css';

/**
 * A row of IconButtons and Buttons with one tab stop; arrow keys move between the items. Wrap each item in
 * `ToolbarItem asChild` so the toolbar controls its focus.
 */
export function Toolbar({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} className={cx('ui-toolbar', className)} />;
}

export const ToolbarItem = Primitive.Button;

export function ToolbarSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator {...props} className={cx('ui-toolbar-separator', className)} />;
}
