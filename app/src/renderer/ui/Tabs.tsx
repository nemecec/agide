import type { ComponentProps } from 'react';
import { Tabs as Primitive } from 'radix-ui';
import { cx } from './cx';
import './Tabs.css';

/** Tabs inside a pane. Arrow keys move between tabs; the selected tab has a 2 px underline. */
export function Tabs({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} className={cx('ui-tabs', className)} />;
}

export function TabList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List {...props} className={cx('ui-tab-list', className)} />;
}

export function Tab({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger {...props} className={cx('ui-tab', className)} />;
}

export function TabPanel({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content {...props} className={cx('ui-tab-panel', className)} />;
}
