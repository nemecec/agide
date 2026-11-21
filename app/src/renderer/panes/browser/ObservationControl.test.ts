// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';
import { render, type Rendered } from '../../testing/render';
import { ObservationControl } from './ObservationControl';
import type { ObserveMode } from '../../../core/surfaces/types';

let rendered: Rendered | undefined;
let fake: FakeApi;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

async function mount(props: { mode?: ObserveMode; forcedOff?: boolean; entries?: unknown[] } = {}) {
  fake = installFakeApi({ browser_access_log: { entries: props.entries ?? [] }, ui_set_observation: {} });
  rendered = await render(createElement(ObservationControl, { leafId: 'leaf1', mode: props.mode ?? 'on-demand', reading: false, forcedOff: props.forcedOff ?? false }));
}
const q = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);
const open = () => act(async () => q<HTMLButtonElement>('[data-testid="observation-button"]')!.click());
const radios = () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

describe('ObservationControl', () => {
  it('shows the indicator only and reads no log until the switch is opened', async () => {
    await mount();
    expect(q('[data-testid="observation-popover"]'), 'closed').toBeNull();
    expect(fake.invoke, 'no log read while closed').not.toHaveBeenCalled();
  });

  it('offers the three modes with the current one selected', async () => {
    await mount({ mode: 'live' });
    await open();
    expect(radios().map((radio) => radio.getAttribute('aria-checked') === 'true'), 'off, on demand, live').toEqual([false, false, true]);
    expect(q('[aria-expanded="true"]'), 'button reports it is open').not.toBeNull();
  });

  it('sets the observation of the tab when the user picks another mode', async () => {
    await mount({ mode: 'on-demand' });
    await open();
    await act(async () => radios()[0]!.click());
    expect(fake.invoke, 'switch to off').toHaveBeenCalledWith('ui_set_observation', { nodeId: 'leaf1', mode: 'off' });
  });

  it('disables the switch and says why while a blocked address keeps observation off', async () => {
    await mount({ mode: 'off', forcedOff: true });
    await open();
    expect(radios().every((radio) => radio.disabled), 'all disabled').toBe(true);
    expect(q('.observation-popover')?.textContent, 'reason shown').toContain('A blocked address keeps observation off.');
  });

  it('leaves the switch enabled and shows no blocked notice otherwise', async () => {
    await mount();
    await open();
    expect(radios().some((radio) => radio.disabled), 'none disabled').toBe(false);
    expect(q('.observation-popover')?.textContent, 'no notice').not.toContain('blocked');
  });

  it('lists the recent access entries or says that no agent has read the tab', async () => {
    await mount();
    await open();
    expect(q('.observation-log')?.textContent, 'empty log').toContain('No agent has read this tab.');
    await rendered!.unmount();
    await mount({ entries: [{ id: 1, at: '2026-11-17T10:00:00.000Z', kind: 'read_page', outcome: 'ok' }, { id: 2, at: '2026-11-17T10:01:00.000Z', kind: 'act', outcome: 'refused_site' }] });
    await open();
    expect(fake.invoke, 'asks for eight entries of this node').toHaveBeenCalledWith('browser_access_log', { nodeId: 'leaf1', limit: 8 });
    const lines = [...document.querySelectorAll('.observation-log li')].map((li) => li.textContent);
    expect(lines.length, 'two entries').toBe(2);
    expect(lines[0], 'first entry').toContain('read_page ok');
    expect(lines[1], 'second entry').toContain('act refused_site');
  });

  it('closes the switch when the button is pressed again', async () => {
    await mount();
    await open();
    await open();
    expect(q('[data-testid="observation-popover"]'), 'closed again').toBeNull();
  });
});
