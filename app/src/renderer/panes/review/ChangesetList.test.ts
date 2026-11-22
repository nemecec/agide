// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, setValue } from '../../testing/dom';
import { flush, render, type Rendered } from '../../testing/render';
import { ChangesetList } from './ChangesetList';
import { detailFixture, hex, summaryRecord } from './reviewFixtures';
import { installReviewApi, type ReviewServer } from './reviewTestApi';

let rendered: Rendered | undefined;
let server: ReviewServer;
const onOpen = vi.fn();

afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
  onOpen.mockClear();
});

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

async function mount(list: ReturnType<typeof summaryRecord>[], responders: Record<string, unknown> = {}): Promise<void> {
  server = installReviewApi({ detail: detailFixture(), list }, responders);
  rendered = await render(createElement(ChangesetList, { swarmId: 'sw1', onOpen }));
  await flush();
}

describe('ChangesetList', () => {
  it('shows the latest changeset of each agent with state, rung, reasons, check, verdict and counts', async () => {
    await mount([
      summaryRecord({ id: 'c2', agent: 'impl', seq: 2, state: 'awaiting_human', rung: 'D', reasonCount: 3, verdict: 'revise', added: 40, removed: 5, updatedAt: '2026-11-21T11:00:00.000Z' }),
      summaryRecord({ id: 'c1', agent: 'impl', seq: 1, state: 'superseded', updatedAt: '2026-11-21T10:00:00.000Z' }),
      summaryRecord({ id: 'c3', agent: 'tests', seq: 1, state: 'accepted', rung: 'A', checkOutcome: 'passed', updatedAt: '2026-11-21T09:00:00.000Z' }),
    ]);
    const [latest, earlier] = all('review-changesets');
    const rows = [...latest!.querySelectorAll<HTMLElement>('[data-testid="review-changeset-row"]')];
    expect(rows.map((row) => row.getAttribute('data-changeset')), 'the latest of each agent in the main table').toEqual(['c2', 'c3']);
    expect([...earlier!.querySelectorAll('[data-testid="review-changeset-row"]')].map((row) => row.getAttribute('data-changeset')), 'the superseded one under earlier changesets').toEqual(['c1']);
    expect(rows[0]!.textContent, 'state, rung, reasons, verdict and counts of the first row').toMatch(/Needs you.*Rung D.*3.*Check passed.*revise.*2 files, \+40 -5/);
    expect(server.calls('review_list'), 'one request for the swarm').toEqual([{ swarmId: 'sw1', limit: 200 }]);
  });

  it('keeps the earlier changesets in a closed disclosure and opens a changeset from its row', async () => {
    await mount([summaryRecord({ id: 'c2', seq: 2 }), summaryRecord({ id: 'c1', seq: 1, state: 'superseded' })]);
    const earlier = byId('review-earlier')!;
    expect(earlier.textContent, 'the count of earlier changesets').toContain('Earlier changesets (1)');
    await click(all('review-open')[0]!);
    expect(onOpen, 'the changeset of the row').toHaveBeenCalledWith('c2');
  });

  it('shows an empty state, a loading state and an error with a retry', async () => {
    await mount([]);
    expect(byId('review-list-empty')?.textContent, 'empty').toContain('Nothing to review yet');
    await rendered!.unmount();
    let attempts = 0;
    await mount([], {
      review_list: () => {
        attempts += 1;
        return attempts === 1 ? { ok: false, error: { code: 'failed', message: 'no database' } } : { changesets: [summaryRecord()] };
      },
    });
    expect(byId('review-list-error')?.textContent, 'failure').toContain('no database');
    await click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!);
    expect(all('review-changeset-row'), 'the retry shows the list').toHaveLength(1);
  });

  it('reloads when a review event arrives', async () => {
    await mount([summaryRecord()]);
    server.list = [summaryRecord(), summaryRecord({ id: 'c9', agent: 'other' })];
    await act(async () => server.fake.emit({ type: 'review.changed', changesetId: 'c9', swarmId: 'sw1', agent: 'other', state: 'awaiting_human', rung: 'C' }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(all('review-changeset-row'), 'the new changeset appears').toHaveLength(2);
  });

  it('counts the accepted changesets that wait for a merge', async () => {
    await mount([summaryRecord({ id: 'c1', agent: 'a', state: 'accepted' }), summaryRecord({ id: 'c2', agent: 'b', state: 'accepted', merged: true }), summaryRecord({ id: 'c3', agent: 'c' })]);
    expect(byId('review-list-summary')?.textContent, 'one accepted changeset waits').toContain('1 accepted changeset waiting to be merged');
  });
});

describe('merge control', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

  const dry = (merged = [{ agent: 'impl', changesetId: 'c1', commit: hex(1, 40) }]) => ({ target: 'main', from: hex(2, 40), to: hex(3, 40), merged });
  const settle = async (): Promise<void> => {
    await act(async () => void vi.advanceTimersByTime(300));
    await flush();
  };

  it('asks for a dry run, shows what would merge and merges only after Confirm', async () => {
    await mount([summaryRecord({ id: 'c1', agent: 'impl', state: 'accepted' })], { swarm_merge: (input: unknown) => ((input as { dryRun: boolean }).dryRun ? dry() : { ...dry(), merged: [{ agent: 'impl', changesetId: 'c1', commit: hex(9, 40) }] }) });
    await click(byId('review-merge')!);
    await settle();
    expect(server.calls('swarm_merge'), 'a dry run first').toEqual([{ swarmId: 'sw1', exclude: [], dryRun: true }]);
    expect(byId('review-merge-preview')?.textContent, 'the agent whose commit would be made').toContain('impl');
    expect((byId('review-merge-confirm') as HTMLButtonElement).disabled, 'confirm is open').toBe(false);
    await click(byId('review-merge-confirm')!);
    expect(server.calls('swarm_merge').at(-1), 'the real merge').toEqual({ swarmId: 'sw1', exclude: [], dryRun: false });
    expect(byId('review-merge-done')?.textContent, 'result').toContain('Merged into main');
    expect(byId('review-merge-done')?.textContent, 'says nothing was pushed').toContain('Nothing was pushed');
  });

  it('shows the gate per agent when the merge is not open and keeps Merge disabled', async () => {
    await mount([summaryRecord({ state: 'awaiting_human' })], {
      swarm_merge: { ok: false, error: { code: 'refused', message: 'the merge gate is closed', details: { refused: [{ agent: 'impl', why: 'the latest changeset is awaiting_human' }] } } },
    });
    await click(byId('review-merge')!);
    await settle();
    expect(byId('review-merge-blocked')?.textContent, 'the gate message').toContain('the merge gate is closed');
    expect(all('review-merge-refusal').map((item) => item.textContent), 'the reason per agent').toEqual(['impl: the latest changeset is awaiting_human']);
    expect((byId('review-merge-confirm') as HTMLButtonElement).disabled, 'no merge while the gate is closed').toBe(true);
  });

  it('shows conflicts and keeps Merge disabled', async () => {
    await mount([summaryRecord({ state: 'accepted' })], { swarm_merge: { ...dry(), merged: [], refused: [{ why: 'conflict' }], conflicts: [{ agents: ['a', 'b'], files: ['src/a.ts'] }] } });
    await click(byId('review-merge')!);
    await settle();
    expect(byId('review-merge-conflict')?.textContent, 'agents and files named').toContain('Conflict between a and b in src/a.ts');
    expect((byId('review-merge-confirm') as HTMLButtonElement).disabled, 'conflicts block the merge').toBe(true);
  });

  it('runs the dry run again for another target and for a left-out agent', async () => {
    await mount([summaryRecord({ agent: 'impl', state: 'accepted' })], { swarm_merge: dry() });
    await click(byId('review-merge')!);
    await settle();
    await setValue(byId('review-merge-target') as HTMLInputElement, 'release');
    await settle();
    await click(byId('review-merge-exclude')!);
    await settle();
    expect(server.calls('swarm_merge').map((input) => input), 'each change asks again').toEqual([
      { swarmId: 'sw1', exclude: [], dryRun: true },
      { swarmId: 'sw1', exclude: [], dryRun: true, target: 'release' },
      { swarmId: 'sw1', exclude: ['impl'], dryRun: true, target: 'release' },
    ]);
  });

  it('shows the failure of the real merge and leaves the dialog open', async () => {
    let real = 0;
    await mount([summaryRecord({ state: 'accepted' })], {
      swarm_merge: (input: unknown) => {
        if ((input as { dryRun: boolean }).dryRun) return dry();
        real += 1;
        return { ok: false, error: { code: 'failed', message: 'the branch moved' } };
      },
    });
    await click(byId('review-merge')!);
    await settle();
    await click(byId('review-merge-confirm')!);
    expect(real, 'the real merge ran').toBe(1);
    expect(byId('review-merge-error')?.textContent, 'the failure shows').toContain('the branch moved');
  });
});
