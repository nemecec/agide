import type { HTMLAttributes } from 'react';
import { VisuallyHidden } from 'radix-ui';
import { cx } from './cx';
import './Badge.css';

const MAX_SHOWN = 99;

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** A count, or nothing for a dot. */
  readonly count?: number;
  /** What is counted or marked, read after the count: "unread", "running". */
  readonly label: string;
}

/** An unread count or a running dot. It is drawn in the fill colour of danger or success with a ring in the surface behind it. */
export function Badge({ count, label, className, ...rest }: BadgeProps) {
  const dot = count === undefined;
  return (
    <span {...rest} className={cx('ui-badge', className)} data-kind={dot ? 'dot' : 'count'}>
      {dot ? null : <span aria-hidden="true">{count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}</span>}
      <VisuallyHidden.Root>{dot ? label : `${count} ${label}`}</VisuallyHidden.Root>
    </span>
  );
}
