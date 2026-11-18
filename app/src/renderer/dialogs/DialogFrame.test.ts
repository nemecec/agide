// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '../testing/render';
import { DialogFrame, nextFocus } from './DialogFrame';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const key = (target: Element, name: string, shiftKey = false) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })));

function dialog(onCancel: () => void) {
  return createElement(
    DialogFrame,
    null,
    createElement('form', { role: 'dialog' }, createElement('input', { id: 'first' }), createElement('input', { id: 'second' }), createElement('button', { id: 'cancel', type: 'button', 'data-dialog-cancel': true, onClick: onCancel }, 'Cancel')),
  );
}

describe('DialogFrame', () => {
  it('puts focus on the first field when the dialog opens and draws a backdrop behind it', async () => {
    rendered = await render(dialog(() => undefined));
    expect(document.activeElement?.id, 'first field has focus').toBe('first');
    expect(rendered.container.querySelector('.dialog-backdrop'), 'backdrop is drawn').not.toBeNull();
  });

  it('keeps Tab inside the dialog by wrapping from the last element to the first and back', async () => {
    rendered = await render(dialog(() => undefined));
    const cancel = rendered.container.querySelector<HTMLElement>('#cancel')!;
    cancel.focus();
    await key(cancel, 'Tab');
    expect(document.activeElement?.id, 'Tab after the last element').toBe('first');
    await key(document.activeElement!, 'Tab', true);
    expect(document.activeElement?.id, 'Shift+Tab before the first element').toBe('cancel');
  });

  it('presses the Cancel button on Escape', async () => {
    const cancel = vi.fn();
    rendered = await render(dialog(cancel));
    await key(document.activeElement!, 'Escape');
    expect(cancel, 'Cancel ran once').toHaveBeenCalledTimes(1);
  });

  it('gives focus back to the element that opened the dialog', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    rendered = await render(dialog(() => undefined));
    expect(document.activeElement?.id, 'focus moved into the dialog').toBe('first');
    await rendered.unmount();
    rendered = undefined;
    expect(document.activeElement, 'focus returned to the opener').toBe(opener);
    opener.remove();
  });
});

describe('nextFocus', () => {
  const [a, b] = [document.createElement('input'), document.createElement('input')];
  it('leaves normal movement to the browser and wraps only at the ends', () => {
    expect(nextFocus([a, b], a, false), 'middle of the order').toBeUndefined();
    expect(nextFocus([a, b], b, false), 'forward from the end').toBe(a);
    expect(nextFocus([a, b], a, true), 'backward from the start').toBe(b);
    expect(nextFocus([a, b], null, false), 'focus outside the dialog').toBe(a);
    expect(nextFocus([], null, false), 'no focusable element').toBeUndefined();
  });
});
