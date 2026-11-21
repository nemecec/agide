// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { ContextMenu } from './ContextMenu';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  document.body.innerHTML = '';
});

const key = (name: string) => act(async () => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

async function open(run = vi.fn(), onClose = vi.fn()) {
  installFakeApi();
  const entries = [
    { label: 'Rename', run },
    { label: 'Remove', run: vi.fn(), danger: true },
  ];
  rendered = await render(createElement(ContextMenu, { menu: { x: 40, y: 50, entries }, onClose }));
  return { run, onClose };
}

describe('ContextMenu', () => {
  it('lists its entries as menu items and sets the destructive one apart behind a separator', async () => {
    await open();
    expect(items().map((item) => item.textContent), 'entries in order').toEqual(['Rename', 'Remove']);
    expect(document.querySelectorAll('[role="separator"]').length > 0, 'a separator precedes the destructive entry').toBe(true);
    expect(items()[1]?.getAttribute('data-danger'), 'the destructive entry is marked').toBe('true');
  });

  it('runs the chosen entry with the keyboard', async () => {
    const { run } = await open();
    await key('ArrowDown');
    await key('Enter');
    expect(run, 'the first entry ran').toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without running an entry', async () => {
    const { run, onClose } = await open();
    await key('Escape');
    expect(onClose, 'closed once').toHaveBeenCalled();
    expect(run, 'nothing ran').not.toHaveBeenCalled();
  });
});
