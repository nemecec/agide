import type { ReactNode } from 'react';
import { RadioGroup as Primitive } from 'radix-ui';
import { cx } from './cx';
import './RadioGroup.css';

export interface RadioGroupProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly 'aria-label'?: string;
  readonly name?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The group root: arrow keys move between its items, and the checked one holds the tab stop. */
export function RadioGroup({ value, onValueChange, className, children, ...rest }: RadioGroupProps) {
  return (
    <Primitive.Root {...rest} value={value} onValueChange={onValueChange} className={cx('ui-radio-group', className)}>
      {children}
    </Primitive.Root>
  );
}

export interface RadioItemProps {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** A 14 px circle with its label to the right. Where the options are short words, a SegmentedControl or Select is better. */
export function RadioItem({ value, label, disabled, className, 'data-testid': testId }: RadioItemProps) {
  return (
    <label className={cx('ui-radio-row', className)} data-disabled={disabled || undefined}>
      <Primitive.Item className="ui-radio" value={value} disabled={disabled} data-testid={testId}>
        <Primitive.Indicator className="ui-radio-dot" />
      </Primitive.Item>
      <span>{label}</span>
    </label>
  );
}
