// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click } from '../../testing/dom';
import { flush, render, type Rendered } from '../../testing/render';
import { PANE_COMPONENTS } from '../paneComponents';
import { CHANGESET, detailFixture, summaryRecord } from './reviewFixtures';
import { installReviewApi } from './reviewTestApi';
import { ReviewPane } from './ReviewPane';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const pane = (config: Record<string, unknown>) => createElement(ReviewPane, { instanceId: 'p1', config, inputs: {} });

describe('ReviewPane', () => {
  it('is the component of agide/review', () => {
    expect(PANE_COMPONENTS['agide/review'], 'registered pane component').toBe(ReviewPane);
  });

  it('asks for a swarm when none is set', async () => {
    installReviewApi({ detail: detailFixture() });
    rendered = await render(pane({}));
    expect(rendered.container.textContent, 'without a swarm').toContain('No swarm selected');
  });

  it('shows the list for a swarm, opens a changeset from it and returns to the list', async () => {
    installReviewApi({ detail: detailFixture(), list: [summaryRecord()] });
    rendered = await render(pane({ swarmId: 'sw1' }));
    await flush();
    expect(byId('review-list')?.getAttribute('data-swarm'), 'the list of the swarm').toBe('sw1');
    await click(byId('review-open')!);
    expect(byId('review-changeset')?.getAttribute('data-changeset'), 'the changeset view').toBe(CHANGESET);
    await click(byId('review-back')!);
    expect(byId('review-list'), 'back on the list').not.toBeNull();
  });

  it('opens on the changeset of the config and follows a new one', async () => {
    installReviewApi({ detail: detailFixture() });
    rendered = await render(pane({ swarmId: 'sw1', changesetId: CHANGESET }));
    await flush();
    expect(byId('review-changeset'), 'opens on the changeset').not.toBeNull();
    await rendered.rerender(pane({ swarmId: 'sw1' }));
    await flush();
    expect(byId('review-list') ?? byId('review-list-empty'), 'a config without a changeset shows the list').not.toBeNull();
  });
});
