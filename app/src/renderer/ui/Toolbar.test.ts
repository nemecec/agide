// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '../testing/render';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { ACTION_ICONS } from './icons';
import { Toolbar, ToolbarItem, ToolbarSeparator } from './Toolbar';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

describe('Toolbar', () => {
  it('keeps one tab stop and moves between its items with the arrow keys', async () => {
    rendered = await render(
      createElement(Toolbar, {
        'aria-label': 'Browser',
        children: [
          createElement(ToolbarItem, { key: 'a', asChild: true, children: createElement(IconButton, { label: 'Back', icon: ACTION_ICONS.back.icon, tooltip: false }) }),
          createElement(ToolbarSeparator, { key: 's' }),
          createElement(ToolbarItem, { key: 'b', asChild: true, children: createElement(Button, { children: 'Open in Chrome' }) }),
        ],
      }),
    );
    const [back, open] = [...rendered.container.querySelectorAll<HTMLButtonElement>('button')] as [HTMLButtonElement, HTMLButtonElement];
    expect(rendered.container.querySelector<HTMLElement>('[role="toolbar"]')?.tabIndex, 'the toolbar is the one tab stop').toBe(0);
    expect([back.tabIndex, open.tabIndex], 'the items are reached with arrow keys, not Tab').toEqual([-1, -1]);
    back.focus();
    await act(async () => {
      back.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement, 'ArrowRight moved focus to the next item').toBe(open);
    expect(rendered.container.querySelector('[role="separator"]'), 'the separator is drawn between the groups').not.toBeNull();
  });
});
