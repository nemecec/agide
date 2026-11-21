// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click } from '../testing/dom';
import { render, type Rendered } from '../testing/render';
import { Disclosure } from './Disclosure';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const button = () => rendered!.container.querySelector<HTMLButtonElement>('button')!;
const region = () => rendered!.container.querySelector<HTMLElement>('[role="region"]')!;

describe('Disclosure', () => {
  it('starts closed with the region hidden and links the button to the region', async () => {
    rendered = await render(createElement(Disclosure, { label: 'Details', children: 'Body' }));
    expect(button().getAttribute('aria-expanded'), 'closed').toBe('false');
    expect(region().hidden, 'region hidden').toBe(true);
    expect(button().getAttribute('aria-controls'), 'button controls the region').toBe(region().id);
  });

  it('opens and closes on a click and keeps the region content mounted', async () => {
    rendered = await render(createElement(Disclosure, { label: 'Details', children: 'Body' }));
    await click(button());
    expect(button().getAttribute('aria-expanded'), 'open').toBe('true');
    expect(region().hidden, 'region visible').toBe(false);
    await click(button());
    expect(region().hidden, 'region hidden again').toBe(true);
    expect(region().textContent, 'content stays mounted while closed').toBe('Body');
  });

  it('follows the owner when controlled and reports the requested state', async () => {
    const onOpenChange = vi.fn();
    rendered = await render(createElement(Disclosure, { label: 'Details', open: false, onOpenChange, children: 'Body' }));
    await click(button());
    expect(onOpenChange, 'the request is reported').toHaveBeenCalledWith(true);
    expect(button().getAttribute('aria-expanded'), 'the owner has not opened it, so it stays closed').toBe('false');
  });
});
