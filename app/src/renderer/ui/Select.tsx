import { useState } from 'react';
import { Select as Primitive } from 'radix-ui';
import { useViewSuspension } from '../panes/browser/suspension';
import { cx } from './cx';
import { Icon } from './Icon';
import { CONTROL_ICONS } from './icons';
import { overlayRoot } from './overlayRoot';
import './Select.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** Radix refuses an item with an empty value, so an empty option travels under this name. */
const EMPTY = '\u0000empty';
const toItem = (value: string): string => (value === '' ? EMPTY : value);
const fromItem = (value: string): string => (value === EMPTY ? '' : value);

export interface SelectProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly className?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly 'aria-describedby'?: string;
  readonly 'data-testid'?: string;
}

/** A Field-styled trigger over a Menu-styled list. The trigger carries the chosen value in `data-value`. */
export function Select({ value, onValueChange, options, placeholder, disabled, invalid, id, name, className, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'aria-describedby': describedBy, 'data-testid': testId }: SelectProps) {
  const [open, setOpen] = useState(false);
  useViewSuspension(open);
  return (
    <Primitive.Root value={toItem(value)} onValueChange={(next) => onValueChange(fromItem(next))} disabled={disabled} name={name} onOpenChange={setOpen}>
      <Primitive.Trigger
        id={id}
        className={cx('ui-select-trigger', className)}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        aria-describedby={describedBy}
        data-testid={testId}
        data-value={value}
      >
        <Primitive.Value placeholder={placeholder} />
        <Primitive.Icon asChild>
          <Icon icon={CONTROL_ICONS.menu} size="sm" />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal container={overlayRoot()}>
        <Primitive.Content className="ui-select-content" position="popper" sideOffset={4} collisionPadding={4}>
          <Primitive.Viewport className="ui-select-viewport">
            {options.map((option) => (
              <Primitive.Item key={option.value} value={toItem(option.value)} disabled={option.disabled} className="ui-select-item">
                <span className="ui-select-check">
                  <Primitive.ItemIndicator>
                    <Icon icon={CONTROL_ICONS.check} size="sm" />
                  </Primitive.ItemIndicator>
                </span>
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
