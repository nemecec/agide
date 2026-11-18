// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '../../testing/render';
import { ObservationIndicator } from './ObservationIndicator';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

describe('ObservationIndicator', () => {
  it('writes the word Live next to the eye for live observation and for no other mode', async () => {
    rendered = await render(createElement(ObservationIndicator, { mode: 'live', reading: false }));
    expect(rendered.container.querySelector('[data-testid="observation-live"]')?.textContent, 'live badge').toBe('Live');
    await rendered.rerender(createElement(ObservationIndicator, { mode: 'on-demand', reading: false }));
    expect(rendered.container.querySelector('[data-testid="observation-live"]'), 'no badge on demand').toBeNull();
    await rendered.rerender(createElement(ObservationIndicator, { mode: 'off', reading: false }));
    expect(rendered.container.querySelector('[data-testid="observation-live"]'), 'no badge when off').toBeNull();
  });
});
