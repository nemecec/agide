import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { CONTROL_ICONS, type IconComponent } from './icons';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-quiet';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Leading icon. */
  readonly icon?: IconComponent;
  /** A chevron after the label, for buttons that open a menu. */
  readonly chevron?: boolean;
  /** Shows the loader in place of the icon, keeps the width and ignores clicks. */
  readonly loading?: boolean;
  /** Keeps a disabled button focusable (`aria-disabled`), so a Tooltip can say why it does nothing. */
  readonly focusableWhenDisabled?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon, chevron = false, loading = false, focusableWhenDisabled = false, disabled = false, type = 'button', className, children, onClick, ref, ...rest }: ButtonProps) {
  const softDisabled = disabled && focusableWhenDisabled;
  const press = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading || softDisabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const leading = loading ? CONTROL_ICONS.loading : icon;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx('ui-button', className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-overlay-spinner={loading && icon === undefined ? true : undefined}
      disabled={disabled && !focusableWhenDisabled}
      aria-disabled={softDisabled || undefined}
      aria-busy={loading || undefined}
      onClick={press}
    >
      {leading ? <Icon icon={leading} size="md" spin={loading} className="ui-button-icon" /> : null}
      {children === undefined ? null : <span className="ui-button-label">{children}</span>}
      {chevron ? <Icon icon={CONTROL_ICONS.menu} size="sm" /> : null}
    </button>
  );
}
