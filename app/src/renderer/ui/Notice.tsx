import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { TONE_ICONS, type Tone } from './icons';
import './Notice.css';

export interface NoticeProps extends Omit<ComponentProps<'div'>, 'children' | 'role'> {
  readonly tone?: Exclude<Tone, 'neutral'>;
  /** Set to `status` for a note that is already on screen when the dialog opens; an alert is announced when it appears. */
  readonly role?: 'status' | 'alert';
  readonly children: ReactNode;
}

/** An inline note with a tone icon. A danger notice is an alert, so a failure that appears after an action is announced. */
export function Notice({ tone = 'info', role, className, children, ...rest }: NoticeProps) {
  return (
    <div {...rest} className={cx('ui-notice', className)} data-tone={tone} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
      <Icon icon={TONE_ICONS[tone].icon} size="sm" className="ui-notice-icon" />
      <span>{children}</span>
    </div>
  );
}
