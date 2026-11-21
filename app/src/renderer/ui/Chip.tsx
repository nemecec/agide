import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { STATUS_ICONS, STATUS_TONES, type IconComponent, type StatusKind, type Tone } from './icons';
import { Tooltip } from './Tooltip';
import './Chip.css';

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly tone?: Tone;
  readonly icon?: IconComponent;
  readonly spin?: boolean;
  /** The words of the chip. With `iconOnly` they become the accessible name and the tooltip. */
  readonly label: string;
  /** Draws the icon alone where space is short (tree rows, tabs). */
  readonly iconOnly?: boolean;
}

export function Chip({ tone = 'neutral', icon, spin = false, label, iconOnly = false, className, ...rest }: ChipProps) {
  const chip = (
    <span {...rest} className={cx('ui-chip', className)} data-tone={tone} data-icon-only={iconOnly || undefined} role={iconOnly || rest['aria-label'] ? 'img' : undefined} aria-label={iconOnly ? label : rest['aria-label']}>
      {icon ? <Icon icon={icon} size="xs" spin={spin} /> : null}
      {iconOnly ? null : label}
    </span>
  );
  return iconOnly ? <Tooltip content={label}>{chip}</Tooltip> : chip;
}

export interface StatusChipProps extends Omit<ChipProps, 'tone' | 'icon' | 'spin' | 'label'> {
  readonly status: StatusKind;
  /** Replaces the default word of the status. */
  readonly label?: string;
}

/** The chip of a surface status: its own glyph, tone and word, so the status never rests on colour alone. */
export function StatusChip({ status, label, ...rest }: StatusChipProps) {
  const { icon, label: word } = STATUS_ICONS[status];
  return <Chip {...rest} tone={STATUS_TONES[status]} icon={icon} spin={status === 'busy'} label={label ?? word} data-status={status} />;
}
