import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { cx } from './cx';
import { overlayRoot } from './overlayRoot';
import './Dialog.css';

export type DialogSize = 400 | 480 | 640;

/** The root, the portal into the overlay root and the backdrop. A dialog body adds `DialogContent` inside it. */
export function DialogRoot({ open, onOpenChange, children }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly children: ReactNode }) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange} modal>
      <Primitive.Portal container={overlayRoot()}>
        <Primitive.Overlay className="ui-dialog-backdrop" />
        {children}
      </Primitive.Portal>
    </Primitive.Root>
  );
}

/** True while the element holds more content than it shows. */
function useOverflow(element: RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setOverflowing(node.scrollHeight > node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return overflowing;
}

export interface DialogContentProps extends Omit<ComponentProps<'div'>, 'title' | 'onSubmit'> {
  readonly title: ReactNode;
  /** Text after the title that is not part of the dialog name, such as the profile name. */
  readonly meta?: ReactNode;
  readonly description?: ReactNode;
  readonly size?: DialogSize;
  /** Buttons at the right, the primary one last. */
  readonly footer?: ReactNode;
  /** Wraps the body and footer in a form, so Enter outside a text area presses the primary button. */
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  readonly children: ReactNode;
}

/**
 * Title, optional description, scrolling body and footer. Focus goes to the element marked `data-autofocus`, or
 * to the first focusable element, and returns to the element that had it before the dialog opened. A press
 * outside does not close it, because a form holds typed values.
 */
export function DialogContent({ title, meta, description, size = 480, footer, onSubmit, className, children, ...rest }: DialogContentProps) {
  const body = useRef<HTMLDivElement>(null);
  const scrolls = useOverflow(body);
  const opener = useRef(document.activeElement);
  const inner = (
    <>
      <div ref={body} className="ui-dialog-body" data-scrolls={scrolls || undefined}>
        {children}
      </div>
      {footer ? <footer className="ui-dialog-footer">{footer}</footer> : null}
    </>
  );
  return (
    <Primitive.Content
      {...rest}
      {...(description === undefined ? { 'aria-describedby': undefined } : {})}
      className={cx('ui-dialog', className)}
      data-size={size}
      onOpenAutoFocus={(event) => {
        const target = event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelector<HTMLElement>('[data-autofocus]') : null;
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
      onInteractOutside={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      }}
    >
      <header className="ui-dialog-header">
        <Primitive.Title className="ui-dialog-title">{title}</Primitive.Title>
        {meta === undefined ? null : <span className="ui-dialog-meta">{meta}</span>}
      </header>
      {description === undefined ? null : <Primitive.Description className="ui-dialog-description">{description}</Primitive.Description>}
      {onSubmit ? (
        <form className="ui-dialog-form" onSubmit={onSubmit}>
          {inner}
        </form>
      ) : (
        inner
      )}
    </Primitive.Content>
  );
}

export interface DialogProps extends DialogContentProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** A complete dialog for callers that own an open state. */
export function Dialog({ open, onOpenChange, ...content }: DialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent {...content} />
    </DialogRoot>
  );
}
