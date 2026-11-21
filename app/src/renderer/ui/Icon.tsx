import { cx } from './cx';
import type { IconComponent } from './icons';
import './Icon.css';

/** Size and stroke width per icon size token. Thinner strokes at small sizes keep the line weight near the text weight. */
export const ICON_SIZES = {
  xs: { px: 12, stroke: 2 },
  sm: { px: 14, stroke: 1.75 },
  md: { px: 16, stroke: 1.5 },
  lg: { px: 20, stroke: 1.5 },
  xl: { px: 32, stroke: 1.25 },
} as const;
export type IconSize = keyof typeof ICON_SIZES;

export interface IconProps {
  readonly icon: IconComponent;
  readonly size?: IconSize;
  /** Turns the icon one turn per second; it stays still under reduced motion. */
  readonly spin?: boolean;
  readonly className?: string;
}

/** A decorative glyph. It sits beside visible text, or its control carries the accessible name. */
export function Icon({ icon: Glyph, size = 'md', spin = false, className }: IconProps) {
  const { px, stroke } = ICON_SIZES[size];
  return <Glyph size={px} strokeWidth={stroke} absoluteStrokeWidth={false} aria-hidden="true" focusable="false" className={cx('ui-icon', spin && 'ui-spin', className)} />;
}
