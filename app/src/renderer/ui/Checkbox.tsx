import type { ReactNode } from 'react';
import { Checkbox as Primitive } from 'radix-ui';
import { cx } from './cx';
import { Icon } from './Icon';
import { CONTROL_ICONS } from './icons';
import './Checkbox.css';

export interface CheckboxProps {
  readonly checked: boolean | 'indeterminate';
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** A 14 px box with its label to the right. The whole row is the click target. */
export function Checkbox({ checked, onCheckedChange, label, description, invalid, disabled, className, 'data-testid': testId }: CheckboxProps) {
  return (
    <label className={cx('ui-check-row', className)} data-disabled={disabled || undefined}>
      <Primitive.Root
        className="ui-check"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      >
        <Primitive.Indicator className="ui-check-indicator">
          <Icon icon={checked === 'indeterminate' ? CONTROL_ICONS.indeterminate : CONTROL_ICONS.check} size="xs" />
        </Primitive.Indicator>
      </Primitive.Root>
      <span className="ui-check-text">
        {label}
        {description ? <span className="ui-check-description">{description}</span> : null}
      </span>
    </label>
  );
}
