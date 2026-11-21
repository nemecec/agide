// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '../../testing/render';
import { HeatMarker } from './HeatMarker';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const bars = () => [...rendered!.container.querySelectorAll('rect')].map((bar) => bar.getAttribute('data-filled'));

describe('HeatMarker', () => {
  it('fills as many of its three bars as the level, so the level does not rest on colour', async () => {
    rendered = await render(createElement(HeatMarker, { level: 2, share: 0.4, windowMinutes: 5, costUsdPerMinute: 0.1 }));
    expect(bars(), 'two of three bars filled').toEqual(['true', 'true', 'false']);
    await rendered.rerender(createElement(HeatMarker, { level: 3, share: 0.8, windowMinutes: 5 }));
    expect(bars(), 'all bars filled').toEqual(['true', 'true', 'true']);
  });

  it('names the level in words and carries the estimate as its tooltip', async () => {
    rendered = await render(createElement(HeatMarker, { level: 1, share: 0.2, windowMinutes: 5, costUsdPerMinute: 0.05 }));
    const marker = rendered.container.querySelector('.heat-marker');
    expect(marker?.getAttribute('aria-label'), 'accessible name starts with the level word').toMatch(/^Usage: low\./);
    expect(marker?.getAttribute('title'), 'tooltip').toContain('estimated over the last 5 minutes');
  });

  it('draws nothing below the heat floor', async () => {
    rendered = await render(createElement(HeatMarker, { level: 0, share: 0, windowMinutes: 5 }));
    expect(rendered.container.querySelector('.heat-marker'), 'no marker at level 0').toBeNull();
  });
});
