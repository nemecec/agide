import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { ACTION_ICONS, TONE_ICONS, type IconComponent, type Tone } from './icons';
import { IconButton } from './IconButton';
import './Banner.css';

export interface BannerProps extends Omit<ComponentProps<'div'>, 'children' | 'role'> {
  readonly tone?: Exclude<Tone, 'neutral'>;
  /** Replaces the glyph of the tone, for a banner about something specific such as an agent. */
  readonly icon?: IconComponent;
  readonly message: ReactNode;
  /** Buttons (size `sm`) after the message. */
  readonly actions?: ReactNode;
  readonly onDismiss?: () => void;
}

/** A full-width bar across a pane or the dock. A danger banner is an alert; the others are status messages. */
export function Banner({ tone = 'info', icon, message, actions, onDismiss, className, ...rest }: BannerProps) {
  return (
    <div {...rest} className={cx('ui-banner', className)} data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon icon={icon ?? TONE_ICONS[tone].icon} size="md" className="ui-banner-icon" />
      <span className="ui-banner-message">{message}</span>
      {actions ? <span className="ui-banner-actions">{actions}</span> : null}
      {onDismiss ? <IconButton label={ACTION_ICONS.close.label} icon={ACTION_ICONS.close.icon} size="sm" onClick={onDismiss} /> : null}
    </div>
  );
}
