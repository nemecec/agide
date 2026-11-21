import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from './cx';
import { Icon, type IconSize } from './Icon';
import type { IconComponent } from './icons';
import { Tooltip } from './Tooltip';
import './IconButton.css';

export type IconButtonSize = 'sm' | 'md' | 'lg';
const GLYPH: Record<IconButtonSize, IconSize> = { sm: 'sm', md: 'md', lg: 'lg' };

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** The accessible name and the tooltip text. */
  readonly label: string;
  readonly icon: IconComponent;
  readonly size?: IconButtonSize;
  readonly variant?: 'quiet' | 'danger-quiet';
  readonly shortcut?: string;
  /** Set to false inside another Tooltip or where the name is already visible. */
  readonly tooltip?: boolean;
  readonly suspendViews?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** One icon with a required name. The tooltip repeats the name with the shortcut. */
export function IconButton({ label, icon, size = 'md', variant = 'quiet', shortcut, tooltip = true, suspendViews, type = 'button', className, ref, ...rest }: IconButtonProps) {
  const button = (
    <button {...rest} ref={ref} type={type} aria-label={label} className={cx('ui-icon-button', className)} data-size={size} data-variant={variant}>
      <Icon icon={icon} size={GLYPH[size]} />
    </button>
  );
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut} suspendViews={suspendViews}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
