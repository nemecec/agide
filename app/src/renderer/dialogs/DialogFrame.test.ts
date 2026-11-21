// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '../testing/render';
import { DialogContent } from '../ui/Dialog';
import { DialogFrame } from './DialogFrame';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  document.body.innerHTML = '';
});

const key = (target: Element, name: string) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));

function dialog(onCancel: () => void, onClose: () => void = () => undefined, withCancel = true) {
  const content = createElement(DialogContent, {
    title: 'A dialog',
    children: [
      createElement('input', { key: 'a', id: 'first', 'aria-label': 'First' }),
      createElement('input', { key: 'b', id: 'second', 'aria-label': 'Second' }),
      withCancel ? createElement('button', { key: 'c', id: 'cancel', type: 'button', 'data-dialog-cancel': true, onClick: onCancel }, 'Cancel') : null,
    ],
  });
  return createElement(DialogFrame, { onClose, children: content });
}

describe('DialogFrame', () => {
  it('names the dialog by its title and draws a backdrop behind it', async () => {
    rendered = await render(dialog(() => undefined));
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby'), 'the dialog is named by its title').toBe(document.querySelector('h2')?.id);
    expect(document.querySelector('.ui-dialog-backdrop'), 'backdrop is drawn').not.toBeNull();
  });

  it('puts focus inside the dialog when it opens', async () => {
    rendered = await render(dialog(() => undefined));
    const dialogElement = document.querySelector('[role="dialog"]')!;
    expect(dialogElement.contains(document.activeElement), 'focus is inside the dialog').toBe(true);
  });

  it('presses the Cancel button on Escape', async () => {
    const cancel = vi.fn();
    const close = vi.fn();
    rendered = await render(dialog(cancel, close));
    await key(document.activeElement!, 'Escape');
    expect(cancel, 'Cancel ran once').toHaveBeenCalledTimes(1);
    expect(close, 'the generic close did not run beside it').not.toHaveBeenCalled();
  });

  it('closes through onClose on Escape when the dialog has no Cancel button', async () => {
    const close = vi.fn();
    rendered = await render(dialog(() => undefined, close, false));
    await key(document.activeElement!, 'Escape');
    expect(close, 'onClose ran once').toHaveBeenCalledTimes(1);
  });

  it('gives focus back to the element that opened the dialog', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    rendered = await render(dialog(() => undefined));
    expect(document.activeElement, 'focus moved off the opener').not.toBe(opener);
    await rendered.unmount();
    rendered = undefined;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(document.activeElement, 'focus returned to the opener').toBe(opener);
  });

  it('focuses the element marked data-autofocus in place of the first one', async () => {
    const content = createElement(DialogContent, { title: 'A dialog', children: [createElement('input', { key: 'a', id: 'first' }), createElement('input', { key: 'b', id: 'wanted', 'data-autofocus': true })] });
    rendered = await render(createElement(DialogFrame, { onClose: () => undefined, children: content }));
    expect(document.activeElement?.id, 'the marked field has focus').toBe('wanted');
  });
});
