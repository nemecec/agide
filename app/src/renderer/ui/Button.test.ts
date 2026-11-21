// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click } from '../testing/dom';
import { render, type Rendered } from '../testing/render';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { ACTION_ICONS } from './icons';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const button = () => rendered!.container.querySelector('button')!;

describe('Button', () => {
  it('runs onClick and reports its variant and size for the stylesheet', async () => {
    const onClick = vi.fn();
    rendered = await render(createElement(Button, { variant: 'primary', size: 'sm', onClick, children: 'Save' }));
    await click(button());
    expect(onClick, 'click ran the handler').toHaveBeenCalledTimes(1);
    expect(button().dataset['variant'], 'variant').toBe('primary');
    expect(button().dataset['size'], 'size').toBe('sm');
    expect(button().type, 'a button does not submit a form unless asked').toBe('button');
  });

  it('ignores clicks and says it is busy while loading, without becoming disabled', async () => {
    const onClick = vi.fn();
    rendered = await render(createElement(Button, { loading: true, onClick, children: 'Start' }));
    await click(button());
    expect(onClick, 'no click while loading').not.toHaveBeenCalled();
    expect(button().getAttribute('aria-busy'), 'busy is announced').toBe('true');
    expect(button().disabled, 'the button stays focusable').toBe(false);
    expect(button().querySelector('svg'), 'the loader is drawn').not.toBeNull();
  });

  it('stays focusable when disabled on request and marks itself aria-disabled', async () => {
    const onClick = vi.fn();
    rendered = await render(createElement(Button, { disabled: true, focusableWhenDisabled: true, onClick, children: 'Save' }));
    await click(button());
    expect(onClick, 'no click while disabled').not.toHaveBeenCalled();
    expect(button().disabled, 'not natively disabled, so it can show its reason').toBe(false);
    expect(button().getAttribute('aria-disabled'), 'aria-disabled is set').toBe('true');
  });

  it('is natively disabled by default when disabled', async () => {
    rendered = await render(createElement(Button, { disabled: true, children: 'Save' }));
    expect(button().disabled, 'native disabled').toBe(true);
  });
});

describe('IconButton', () => {
  it('takes its accessible name from the required label and draws a hidden icon', async () => {
    rendered = await render(createElement(IconButton, { label: 'Close', icon: ACTION_ICONS.close.icon, tooltip: false }));
    expect(button().getAttribute('aria-label'), 'accessible name').toBe('Close');
    expect(button().querySelector('svg')?.getAttribute('aria-hidden'), 'the glyph is hidden from assistive technology').toBe('true');
  });

  it('keeps the name when a tooltip wraps it and passes clicks on', async () => {
    const onClick = vi.fn();
    rendered = await render(createElement(IconButton, { label: 'Reload', icon: ACTION_ICONS.reload.icon, onClick }));
    await click(button());
    expect(onClick, 'click ran').toHaveBeenCalledTimes(1);
    expect(button().getAttribute('aria-label'), 'name with tooltip').toBe('Reload');
  });
});
