import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip as Primitive } from 'radix-ui';
import { useViewSuspension } from '../panes/browser/suspension';
import { overlayRoot } from './overlayRoot';
import './Tooltip.css';

const OPEN_DELAY_MS = 600;
const SKIP_DELAY_MS = 300;

const ProviderPresent = createContext(false);

/** Shares the tooltip delays between all tooltips below it, so moving from one control to the next shows the next at once. */
export function TooltipProvider({ children }: { readonly children: ReactNode }) {
  return (
    <ProviderPresent.Provider value>
      <Primitive.Provider delayDuration={OPEN_DELAY_MS} skipDelayDuration={SKIP_DELAY_MS}>
        {children}
      </Primitive.Provider>
    </ProviderPresent.Provider>
  );
}

export interface TooltipProps {
  readonly content: ReactNode;
  /** A shortcut shown after the text, for example "Cmd+B". */
  readonly shortcut?: string | undefined;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  /** Set when the trigger sits over a native browser view, which draws above the DOM. */
  readonly suspendViews?: boolean | undefined;
  /** The element that triggers the tooltip. It must take a ref and pass props to a DOM element. */
  readonly children: ReactElement;
}

/** A text tooltip with the open and skip delays of the design record. */
export function Tooltip({ content, shortcut, side = 'bottom', suspendViews = false, children }: TooltipProps) {
  const inProvider = useContext(ProviderPresent);
  const [open, setOpen] = useState(false);
  useViewSuspension(suspendViews && open);
  const tooltip = (
    <Primitive.Root onOpenChange={setOpen}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal container={overlayRoot()}>
        <Primitive.Content className="ui-tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
          {shortcut ? <kbd className="ui-tooltip-shortcut">{shortcut}</kbd> : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
  return inProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}
