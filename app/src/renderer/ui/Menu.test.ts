// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { Menu } from './Menu';
import { menuRows, type MenuEntry } from './menuModel';
import { Popover } from './Popover';

const entry = (label: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({ label, run: () => undefined, ...extra });

describe('menuRows', () => {
  it('puts a rule above an entry that asks for one but never at the top', () => {
    const rows = menuRows([entry('A', { separated: true }), entry('B', { separated: true })]);
    expect(rows.map((row) => row.kind), 'no leading rule, one before the second entry').toEqual(['item', 'separator', 'item']);
  });

  it('sets the first destructive entry apart from the safe entries before it', () => {
    const rows = menuRows([entry('Copy'), entry('Remove', { danger: true }), entry('Clear', { danger: true })]);
    expect(rows.map((row) => row.kind), 'one rule before the destructive group').toEqual(['item', 'separator', 'item', 'item']);
  });

  it('does not draw a rule before a destructive entry that opens the menu', () => {
    expect(menuRows([entry('Remove', { danger: true }), entry('Copy')]).map((row) => row.kind), 'destructive first').toEqual(['item', 'item']);
  });

  it('draws a group label above the entry that starts the group, after a rule', () => {
    const rows = menuRows([entry('A'), entry('B', { heading: 'Group' })]);
    expect(rows.map((row) => row.kind), 'rule then label then entry').toEqual(['item', 'separator', 'heading', 'item']);
  });
});

let rendered: Rendered | undefined;
beforeEach(() => void installFakeApi());
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  document.body.innerHTML = '';
});

const key = (name: string) => act(async () => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));
const trigger = () => rendered!.container.querySelector<HTMLButtonElement>('button')!;
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

async function mountMenu(run = vi.fn()) {
  rendered = await render(createElement(Menu, { trigger: createElement('button', { type: 'button', 'aria-label': 'Tab menu' }, 'more'), entries: [entry('Copy URL', { run }), entry('Remove', { danger: true })] }));
  trigger().focus();
  await key('ArrowDown');
  return run;
}

describe('Menu', () => {
  it('opens from its button with the keyboard and lists the entries as menu items', async () => {
    await mountMenu();
    expect(items().map((item) => item.textContent), 'entries in order').toEqual(['Copy URL', 'Remove']);
    expect(trigger().getAttribute('aria-expanded'), 'the button reports the open menu').toBe('true');
  });

  it('runs the highlighted entry on Enter and closes', async () => {
    const run = await mountMenu();
    await vi.waitFor(() => expect(document.activeElement?.closest('[role="menu"]'), 'focus moved into the open menu').not.toBeNull());
    if (document.activeElement?.textContent !== 'Copy URL') await key('ArrowDown');
    expect(document.activeElement?.textContent, 'the first entry is highlighted').toBe('Copy URL');
    await key('Enter');
    expect(run, 'the entry ran').toHaveBeenCalledTimes(1);
    expect(items(), 'the menu closed').toEqual([]);
  });

  it('keeps no icon gutter when no entry has an icon', async () => {
    await mountMenu();
    expect(document.querySelector('.ui-menu-icon'), 'no empty gutter beside the labels').toBeNull();
  });

  it('closes on Escape and gives focus back to its button', async () => {
    await mountMenu();
    await key('Escape');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(items(), 'menu closed').toEqual([]);
    expect(document.activeElement, 'focus back on the button').toBe(trigger());
  });
});

describe('Popover', () => {
  it('opens from its button, is named by its title and closes on Escape', async () => {
    rendered = await render(createElement(Popover, { trigger: createElement('button', { type: 'button' }, 'Open'), title: 'New profile', children: 'Body' }));
    await act(async () => trigger().click());
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.getAttribute('aria-label'), 'named by its title').toBe('New profile');
    await key('Escape');
    expect(document.querySelector('[role="dialog"]'), 'closed on Escape').toBeNull();
  });
});
