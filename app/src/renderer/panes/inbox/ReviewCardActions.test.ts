// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemRow } from '../../../core/inbox/viewTypes';
import { REVIEW_ITEM_ORIGIN } from '../../../core/review/types';
import { click, setValue } from '../../testing/dom';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';
import { render, type Rendered } from '../../testing/render';
import { hex } from '../review/reviewFixtures';
import { ReviewCardActions } from './ReviewCardActions';

let rendered: Rendered | undefined;
let fake: FakeApi;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const payload = { swarmId: 'sw1', agent: 'worker', changesetId: 'cs_0000000000000001', rung: 'C', contentHash: hex(5), state: 'awaiting_human', cardAccept: true, hasReport: true };
const item = (patch: Partial<ItemRow> = {}): ItemRow => ({
  id: 'i1',
  folderId: null,
  folderRemoved: false,
  kind: 'review',
  state: 'new',
  urgency: 'normal',
  source: 'app',
  origin: REVIEW_ITEM_ORIGIN,
  message: 'worker: rung C',
  textAuthor: 'app',
  payload,
  occurrences: 1,
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
  ...patch,
});

async function mount(row: ItemRow, responders: Record<string, unknown> = {}): Promise<void> {
  fake = installFakeApi({ layout_get: { layoutId: 'default', revision: 1, layout: { instances: { main: { type: 'agide/surface-host', config: {} } }, arrangement: { tabs: { panes: ['main'], active: 'main' } } } }, layout_apply: {}, review_accept: {}, review_reject: {}, review_send_back: {}, ...responders });
  rendered = await render(createElement(ReviewCardActions, { item: row }));
}

describe('ReviewCardActions on the repository alert', () => {
  const alert = (payload: unknown) => item({ kind: 'alert', origin: 'review:repo', payload });

  it('accepts the change the alert shows with its hash, and shows a refusal', async () => {
    await mount(alert({ swarmId: 'sw1', repoDifferenceHash: 'abc' }), { review_accept_repo_change: {} });
    await click(byId('review-repo-accept')!);
    expect(fake.invoke, 'the swarm and the hash of the change are sent').toHaveBeenCalledWith('review_accept_repo_change', { swarmId: 'sw1', expectedHash: 'abc' });
    fake.respond('review_accept_repo_change', { ok: false, error: { code: 'refused', message: 'the repository changed again since the alert' } });
    await click(byId('review-repo-accept')!);
    expect(byId('review-repo-error')?.textContent, 'the refusal shows on the card').toContain('changed again');
  });

  it('offers Open swarm and no accept when the alert carries no hash of its change', async () => {
    await mount(alert({ swarmId: 'sw1' }), { review_accept_repo_change: {} });
    expect(byId('review-repo-accept'), 'nothing to bind an accept to').toBeNull();
    expect(byId('review-repo-open-swarm'), 'the swarm can still be opened').not.toBeNull();
  });

  it('renders nothing for an alert without a swarm in its payload', async () => {
    await mount(alert({}));
    expect(rendered!.container.childElementCount, 'no actions').toBe(0);
  });
});

describe('ReviewCardActions', () => {
  it('renders nothing for an item of another origin', async () => {
    await mount(item({ origin: 'hook:Stop' }));
    expect(rendered!.container.childElementCount, 'no card actions').toBe(0);
  });

  it('says so when the payload is incomplete and offers no decision', async () => {
    await mount(item({ payload: { swarmId: 'sw1' } }));
    expect(byId('review-card-unreadable'), 'a note instead of buttons').not.toBeNull();
    expect(byId('review-card-accept'), 'no accept without a payload').toBeNull();
  });

  it('opens the review pane on the changeset of the card', async () => {
    await mount(item());
    await click(byId('review-card-open')!);
    expect(fake.invoke, 'the layout gets a review pane with the changeset').toHaveBeenCalledWith(
      'layout_apply',
      expect.objectContaining({ patch: expect.arrayContaining([expect.objectContaining({ value: expect.objectContaining({ type: 'agide/review', config: { swarmId: 'sw1', changesetId: 'cs_0000000000000001' } }) })]) }),
    );
  });

  it('accepts with the hash and rung of the payload, so a card that shows old content is refused', async () => {
    await mount(item());
    await click(byId('review-card-accept')!);
    expect(fake.invoke, 'expected values come from the payload').toHaveBeenCalledWith('review_accept', { changesetId: 'cs_0000000000000001', expectedHash: hex(5), expectedRung: 'C', withoutReviewer: false });
  });

  it('shows the refusal of a stale accept on the card', async () => {
    await mount(item(), { review_accept: { ok: false, error: { code: 'refused', message: 'the changeset changed since you looked' } } });
    await click(byId('review-card-accept')!);
    expect(byId('review-card-error')?.textContent, 'the refusal shows').toContain('changed since you looked');
  });

  it('offers no accept or send back once a finding is major or above, or above rung C', async () => {
    await mount(item({ payload: { ...payload, cardAccept: false } }));
    expect(byId('review-card-accept'), 'a major finding').toBeNull();
    expect(byId('review-card-send-back'), 'no send back either').toBeNull();
    expect(byId('review-card-open'), 'open stays').not.toBeNull();
    await rendered!.unmount();
    await mount(item({ payload: { ...payload, rung: 'D' } }));
    expect(byId('review-card-accept'), 'rung D is decided in the pane').toBeNull();
  });

  it('sends back without a message and rejects only with a reason', async () => {
    await mount(item());
    await click(byId('review-card-send-back')!);
    expect(fake.invoke, 'send back with the hash only').toHaveBeenCalledWith('review_send_back', { changesetId: 'cs_0000000000000001', expectedHash: hex(5) });
    await click(byId('review-card-reject')!);
    expect((byId('review-card-reject-confirm') as HTMLButtonElement).disabled, 'no reason, no reject').toBe(true);
    await setValue(byId('review-card-reason') as HTMLInputElement, 'not needed');
    await click(byId('review-card-reject-confirm')!);
    expect(fake.invoke, 'reject with the reason').toHaveBeenCalledWith('review_reject', { changesetId: 'cs_0000000000000001', expectedHash: hex(5), reason: 'not needed' });
  });

  it('offers Raise budget and an accept without the reviewer for work that waits for budget', async () => {
    await mount(item({ payload: { ...payload, state: 'queued_for_budget', rung: 'B' } }));
    expect(byId('review-card-accept')?.textContent, 'the button names what it does').toBe('Accept without the reviewer');
    await click(byId('review-card-accept')!);
    expect(fake.invoke, 'the tick travels with the call').toHaveBeenCalledWith('review_accept', { changesetId: 'cs_0000000000000001', expectedHash: hex(5), expectedRung: 'B', withoutReviewer: true });
    expect(byId('review-card-raise-budget'), 'raise budget').not.toBeNull();
  });
});
