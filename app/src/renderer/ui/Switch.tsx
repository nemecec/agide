import type { ReactNode } from 'react';
import { Switch as Primitive } from 'radix-ui';
import { cx } from './cx';
import './Switch.css';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** A 26 by 15 px switch with its label to the right. */
export function Switch({ checked, onCheckedChange, label, disabled, className, 'data-testid': testId }: SwitchProps) {
  return (
    <label className={cx('ui-switch-row', className)} data-disabled={disabled || undefined}>
      <Primitive.Root className="ui-switch" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} data-testid={testId}>
        <Primitive.Thumb className="ui-switch-thumb" />
      </Primitive.Root>
      <span>{label}</span>
    </label>
  );
}
