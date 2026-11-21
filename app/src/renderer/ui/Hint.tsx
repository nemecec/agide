import type { ComponentProps } from 'react';
import { cx } from './cx';
import './Hint.css';

/** A line of secondary text under a control or a section heading. */
export function Hint({ className, ...props }: ComponentProps<'p'>) {
  return <p {...props} className={cx('ui-hint', className)} />;
}
