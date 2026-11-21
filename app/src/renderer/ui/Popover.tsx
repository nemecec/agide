import { useState, type ReactElement, type ReactNode } from 'react';
import { Popover as Primitive } from 'radix-ui';
import { useViewSuspension } from '../panes/browser/suspension';
import { cx } from './cx';
import { overlayRoot } from './overlayRoot';
import './Popover.css';

export interface PopoverProps {
  /** The button that opens the popover. It must take a ref and pass props to a DOM element. */
  readonly trigger: ReactElement;
  /** The title, also the accessible name of the popover. */
  readonly title?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly align?: 'start' | 'center' | 'end';
  readonly className?: string;
  readonly children: ReactNode;
}

/** A panel anchored to a button, without an arrow. Escape and a press outside close it and focus returns to the button. */
export function Popover({ trigger, title, open, onOpenChange, align = 'start', className, children }: PopoverProps) {
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  useViewSuspension(shown);
  return (
    <Primitive.Root
      open={shown}
      onOpenChange={(next) => {
        setOwn(next);
        onOpenChange?.(next);
      }}
    >
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal container={overlayRoot()}>
        <Primitive.Content className={cx('ui-popover', className)} align={align} sideOffset={4} collisionPadding={4} aria-label={title}>
          {title ? <h3 className="ui-popover-title">{title}</h3> : null}
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export const PopoverClose = Primitive.Close;
