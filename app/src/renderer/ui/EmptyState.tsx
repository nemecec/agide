import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import type { IconComponent } from './icons';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  readonly icon: IconComponent;
  readonly title: string;
  /** One line of help. */
  readonly help?: ReactNode;
  /** An optional secondary Button (size `sm`). */
  readonly action?: ReactNode;
}

/** The content of a pane with nothing to show: centred, with its top at 30% of the pane. */
export function EmptyState({ icon, title, help, action, className, ...rest }: EmptyStateProps) {
  return (
    <div {...rest} className={cx('ui-empty', className)}>
      <Icon icon={icon} size="xl" className="ui-empty-icon" />
      <p className="ui-empty-title">{title}</p>
      {help ? <p className="ui-empty-help">{help}</p> : null}
      {action}
    </div>
  );
}
