// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseOption, click, setValue } from '../../testing/dom';
import { flush, render, type Rendered } from '../../testing/render';
import { ChangesetView } from './ChangesetView';
import { CHANGESET, changesetRecord, checkRecord, commentRecord, detailFixture, fileRecord, hex, hunkRecord, reasonRecord, reportRecord, runRecord, summaryRecord } from './reviewFixtures';
import { installReviewApi, type ReviewServer } from './reviewTestApi';

let rendered: Rendered | undefined;
let server: ReviewServer;
const onOpenChangeset = vi.fn();
const onBack = vi.fn();

afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  onOpenChangeset.mockClear();
  onBack.mockClear();
});
beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const text = (id: string) => byId(id)?.textContent ?? '';

async function mount(detail: Parameters<typeof detailFixture>[0] = {}, responders: Record<string, unknown> = {}, hunks = [hunkRecord(0, 0, ' keep\n-old\n+new')]): Promise<void> {
  server = installReviewApi({ detail: detailFixture(detail), hunks, list: [] }, responders);
  rendered = await render(createElement(ChangesetView, { changesetId: CHANGESET, onBack, onOpenChangeset }));
  await flush();
}

describe('ChangesetView content', () => {
  it('shows the state, the rung with its meaning and the counts', async () => {
    await mount();
    expect(text('review-state'), 'state word').toBe('Needs you');
    expect(text('review-rung'), 'rung and its meaning').toBe('Rung C: Your decision');
    expect(text('review-title'), 'agent and sequence').toContain('worker');
  });

  it('lists every reason with its source, its evidence and its rung, and says which ones are hard', async () => {
    await mount({
      reasons: [
        reasonRecord('size.large', { source: 'rule', evidence: { added: 410 }, minRung: 'C' }),
        reasonRecord('path.protected', { source: 'rule', subject: '.github/workflows/ci.yml', evidence: { glob: { untrusted: true, text: '.github/**' } }, minRung: 'E', hard: true }),
        reasonRecord('claim.low_confidence', { source: 'claim', minRung: 'B' }),
      ],
    });
    const rows = all('review-reason');
    expect(rows.map((row) => row.getAttribute('data-reason')), 'highest rung first').toEqual(['path.protected', 'size.large', 'claim.low_confidence']);
    expect(rows[0]!.textContent, 'source in words, subject and rung').toContain('Rule');
    expect(rows[0]!.textContent, 'the subject path shows').toContain('.github/workflows/ci.yml');
    expect(rows[0]!.textContent, 'hard reasons say so').toContain('Hard: a policy cannot lower it');
    expect(rows[0]!.textContent, 'agent text inside evidence is labelled').toContain('(text from the agent)');
    expect(rows[1]!.textContent, 'evidence key and value').toContain('added410');
    expect(rows[2]!.textContent, 'the claim source').toContain('Agent claim');
  });

  it('says when no reason raised the rung', async () => {
    await mount({ reasons: [], changeset: changesetRecord({ rung: 'A', state: 'accepted' }) });
    expect(text('review-no-reasons'), 'empty reasons').toContain('so it is A');
  });

  it('shows the check result with its output tail as text and the base comparison', async () => {
    await mount({ checks: [checkRecord({ outcome: 'failed', exitCode: 1, outputTail: '<script>1</script>\nFAIL one' }), checkRecord({ id: 'b', target: 'base', changesetId: null, outcome: 'failed' })] });
    expect(text('review-check-chip'), 'check outcome').toBe('Check failed');
    expect(text('review-check'), 'command and exit code').toContain('pnpm test');
    expect(text('review-check-output'), 'output as characters').toContain('<script>1</script>');
    expect(document.querySelector('script'), 'no element came from the output').toBeNull();
    expect(text('review-check'), 'untrusted note').toContain('untrusted');
    expect(text('review-check-base'), 'a failing check on a red base cannot tell good changes from bad, and the user decides').toBe('The same check fails on the base commit as well, so it cannot tell good changes from bad. You decide.');
  });

  it('says that a change made a red base green, and what a green base showed', async () => {
    await mount({ checks: [checkRecord({ outcome: 'passed' }), checkRecord({ id: 'b', target: 'base', changesetId: null, outcome: 'failed' })] });
    expect(text('review-check-base'), 'the change made the base pass').toBe('The same check fails on the base commit, and this change made it pass.');
    await rendered?.unmount();
    await mount({ checks: [checkRecord({ outcome: 'failed', exitCode: 1 }), checkRecord({ id: 'b', target: 'base', changesetId: null, outcome: 'passed' })] });
    expect(text('review-check-base'), 'the base passed, so the failure is the change').toBe('On the base commit the same check passed.');
  });

  it('says that no check ran when there is none', async () => {
    await mount({ checks: [] });
    expect(text('review-no-check'), 'no check').toContain('No project check ran');
  });

  it('shows the reviewer report with the author line, the model, the claim check and the findings', async () => {
    await mount({ report: reportRecord({ summary: 'Looks <i>mostly</i> fine' }), runs: [runRecord({ model: 'sonnet', promptVersion: 'v7' })] });
    expect(text('review-verdict'), 'verdict').toBe('Reviewer: revise');
    expect(text('review-report'), 'author line names the reviewer, model and prompt').toContain('Summary written by the reviewer agent (sonnet, prompt v7)');
    expect(text('review-report-summary'), 'summary as text').toBe('Looks <i>mostly</i> fine');
    expect(document.querySelector('i'), 'no element came from the summary').toBeNull();
    expect(text('review-report'), 'claim check in words').toContain('confirmed the claim in part');
    expect(all('review-finding'), 'the finding').toHaveLength(1);
  });

  it('says what happened when the reviewer did not report', async () => {
    await mount({ runs: [runRecord({ state: 'failed', failure: 'timeout' })] });
    expect(text('review-no-report'), 'failed run').toContain('failed (timeout)');
    await rendered!.unmount();
    await mount({ runs: [] });
    expect(text('review-no-report'), 'no run').toContain('No reviewer ran');
  });

  it('marks the claim as not verified and shows who wrote it, with its tests and what it could not verify', async () => {
    await mount();
    const claim = text('review-claim');
    expect(claim, 'not verified by Agide').toContain('Claim, not verified by Agide');
    expect(claim, 'author').toContain('written by the working agent');
    expect(claim, 'summary').toContain('Validated the signup form.');
    expect(claim, 'tests it says it ran').toContain('pnpm test');
    expect(claim, 'what it could not verify').toContain('browser behaviour');
    await rendered!.unmount();
    await mount({ changeset: changesetRecord({ claim: { source: 'result', text: 'all done' } }) });
    expect(text('review-claim'), 'a result text claim says it is not a report').toContain('did not call report_outcome');
    await rendered!.unmount();
    await mount({ changeset: changesetRecord({ claim: null }) });
    expect(text('review-no-claim'), 'no claim').toContain('no account');
  });

  it('lists the files with their reasons, findings and seen state', async () => {
    await mount({
      reasons: [reasonRecord('config.ci', { subject: 'src/rules.ts' })],
      report: reportRecord(),
      seenHunks: [],
    });
    const rows = all('review-file-row');
    expect(rows.map((row) => row.getAttribute('data-file')), 'both files').toEqual(['0', '1']);
    expect(rows[0]!.textContent, 'finding count of the first file').toContain('1');
    expect(rows[1]!.textContent, 'reason id of the second file').toContain('config.ci');
    expect(text('review-unseen-total'), 'the total of unseen hunks').toBe('2 hunks not seen');
  });
});

describe('ChangesetView decisions', () => {
  it('accepts with the content hash and rung it shows, then reloads', async () => {
    await mount({ report: reportRecord({ verdict: 'accept', findings: [] }) });
    await click(byId('review-accept')!);
    expect(server.calls('review_accept'), 'the expected hash and rung of the loaded changeset').toEqual([{ changesetId: CHANGESET, expectedHash: hex(5), expectedRung: 'C', withoutReviewer: false }]);
  });

  it('shows the refusal of a stale accept and keeps the view', async () => {
    await mount({ report: reportRecord({ verdict: 'accept', findings: [] }) }, { review_accept: { ok: false, error: { code: 'refused', message: 'the changeset changed since you looked' } } });
    await click(byId('review-accept')!);
    expect(text('review-action-error'), 'the manager message shows').toContain('the changeset changed since you looked');
    expect(byId('review-accept'), 'the button stays').not.toBeNull();
  });

  it('asks for the without-the-reviewer tick at rung B without a report and records it in the call', async () => {
    await mount({ changeset: changesetRecord({ rung: 'B', state: 'queued_for_budget' }), runs: [] });
    const accept = byId('review-accept') as HTMLButtonElement;
    expect(accept.disabled, 'accept waits for the tick').toBe(true);
    await click(byId('review-without-reviewer')!);
    expect(accept.disabled, 'the tick enables it').toBe(false);
    await click(accept);
    expect(server.calls('review_accept'), 'the call carries the tick').toEqual([{ changesetId: CHANGESET, expectedHash: hex(5), expectedRung: 'B', withoutReviewer: true }]);
  });

  it('disables every decision of a superseded changeset, says why and opens the newest one', async () => {
    server = installReviewApi({
      detail: detailFixture({ changeset: changesetRecord({ state: 'superseded' }) }),
      list: [summaryRecord({ id: 'cs_0000000000000001', seq: 1, state: 'superseded' }), summaryRecord({ id: 'cs_0000000000000002', seq: 2 })],
    });
    rendered = await render(createElement(ChangesetView, { changesetId: CHANGESET, onBack, onOpenChangeset }));
    await flush();
    expect(text('review-superseded'), 'the banner explains').toContain('newer changeset replaced this one');
    for (const id of ['review-accept', 'review-send-back', 'review-reject', 'review-escalate']) expect((byId(id) as HTMLButtonElement).disabled, `${id} is disabled`).toBe(true);
    expect(byId('review-mark-summary'), 'no marking on a closed changeset').toBeNull();
    await click(byId('review-open-newest')!);
    expect(onOpenChangeset, 'the newest changeset of the same agent').toHaveBeenCalledWith('cs_0000000000000002');
  });

  it('rejects only with a reason and sends the hash it shows', async () => {
    await mount();
    await click(byId('review-reject')!);
    const confirm = byId('review-reject-dialog-confirm') as HTMLButtonElement;
    expect(confirm.disabled, 'no reason, no reject').toBe(true);
    await setValue(byId('review-reject-reason') as HTMLTextAreaElement, 'Out of scope');
    await click(confirm);
    expect(server.calls('review_reject'), 'hash and reason').toEqual([{ changesetId: CHANGESET, expectedHash: hex(5), reason: 'Out of scope' }]);
  });

  it('sends back with the message, shows the drafts that go with it and the findings to include', async () => {
    await mount({ comments: [commentRecord()], report: reportRecord() });
    await click(byId('review-send-back')!);
    expect(text('review-send-back-drafts'), 'drafts listed with path and line').toContain('src/form.ts:11');
    await setValue(byId('review-send-back-message') as HTMLTextAreaElement, 'Please fix');
    await click(byId('review-send-back-finding')!);
    await click(byId('review-send-back-dialog-confirm')!);
    expect(server.calls('review_send_back'), 'message and the chosen finding id').toEqual([{ changesetId: CHANGESET, expectedHash: hex(5), message: 'Please fix', findingIds: ['rep1:0'] }]);
  });

  it('raises the rung to a chosen higher rung with a reason', async () => {
    await mount();
    await click(byId('review-escalate')!);
    await chooseOption(byId('review-escalate-rung')!, 'E: Read everything');
    await setValue(byId('review-escalate-reason') as HTMLTextAreaElement, 'touches billing');
    await click(byId('review-escalate-dialog-confirm')!);
    expect(server.calls('review_escalate'), 'target rung and reason').toEqual([{ changesetId: CHANGESET, toRung: 'E', reason: 'touches billing' }]);
  });

  it('lowers the rung with a reason of ten characters, and asks a second time below the floor', async () => {
    let calls = 0;
    await mount(
      { reasons: [reasonRecord('path.migration', { minRung: 'D', hard: true })], changeset: changesetRecord({ rung: 'D', floor: 'D' }) },
      {
        review_demote: () => {
          calls += 1;
          return calls === 1 ? { committed: false, confirmToken: 'tok', expiresAt: '2026-11-21T10:02:00.000Z' } : { committed: true, changeset: changesetRecord({ rung: 'C', floor: 'C' }) };
        },
      },
    );
    await click(byId('review-demote')!);
    const confirm = byId('review-demote-dialog-confirm') as HTMLButtonElement;
    await setValue(byId('review-demote-reason') as HTMLTextAreaElement, 'too short');
    expect(confirm.disabled, 'under ten characters').toBe(true);
    await setValue(byId('review-demote-reason') as HTMLTextAreaElement, 'The migration is reviewed elsewhere');
    expect(text('review-demote-floor'), 'the hard reasons are named before the first call').toContain('path.migration');
    await click(confirm);
    expect(byId('review-demote-dialog'), 'the dialog stays for the second confirmation').not.toBeNull();
    expect(text('review-demote-floor'), 'the second step says so').toContain('Press the button again');
    await click(confirm);
    expect(server.calls('review_demote'), 'the second call carries the token').toEqual([
      { changesetId: CHANGESET, toRung: 'C', reason: 'The migration is reviewed elsewhere' },
      { changesetId: CHANGESET, toRung: 'C', reason: 'The migration is reviewed elsewhere', confirmToken: 'tok' },
    ]);
    expect(byId('review-demote-dialog'), 'closed after the commit').toBeNull();
  });

  it('shows an unreadable answer as an error with a retry', async () => {
    server = installReviewApi({ detail: detailFixture() }, { review_get: { ok: false, error: { code: 'not_found', message: 'no such changeset' } } });
    rendered = await render(createElement(ChangesetView, { changesetId: CHANGESET, onBack, onOpenChangeset }));
    await flush();
    expect(text('review-changeset-error'), 'the message').toContain('no such changeset');
  });
});

describe('ChangesetView seen marks and drafts', () => {
  it('marks the summary read by hand and shows the mark', async () => {
    await mount();
    await click(byId('review-mark-summary')!);
    expect(server.calls('review_seen'), 'summary level, marked by hand').toEqual([{ changesetId: CHANGESET, level: 'summary', how: 'marked' }]);
    expect(byId('review-summary-seen'), 'the read chip shows after the reload').not.toBeNull();
  });

  it('marks the summary after the dwell time in view', async () => {
    vi.useFakeTimers();
    let observe: (ratio: number) => void = () => undefined;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
        observe = (ratio) => callback([{ isIntersecting: true, intersectionRatio: ratio }]);
      }
      observe(): void {}
      disconnect(): void {}
    };
    await mount();
    await act(async () => observe(0.7));
    await act(async () => void vi.advanceTimersByTime(1_600));
    expect(server.calls('review_seen'), 'a dwell mark at the summary level').toEqual([{ changesetId: CHANGESET, level: 'summary', how: 'dwell' }]);
  });

  it('lists the drafts as one batch, marks one whose hunk is gone and deletes on request', async () => {
    const live = commentRecord({ id: 'live', changesetId: CHANGESET, hunkHash: hex(1000) });
    const gone = commentRecord({ id: 'gone', changesetId: 'cs_0000000000000009', hunkHash: hex(77), body: 'old comment' });
    await mount({ comments: [live, gone] }, {}, [hunkRecord(0, 0, ' keep\n-old\n+new')]);
    const rows = all('review-draft-row');
    expect(rows.map((row) => row.getAttribute('data-outdated')), 'one live and one outdated').toEqual([null, 'true']);
    expect(rows[1]!.textContent, 'the outdated one says it is not sent').toContain('Outdated, not sent');
    await click(rows[0]!.querySelector('[data-testid="review-draft-row-delete"]')!);
    expect(server.calls('review_comment'), 'a delete call').toEqual([{ commentId: 'live', delete: true }]);
  });

  it('opens a file from the list and goes back', async () => {
    await mount({ files: [fileRecord(0, 'src/form.ts')] });
    await click(byId('review-file-open')!);
    expect(byId('review-file'), 'the file view replaces the list').not.toBeNull();
    await click(byId('review-file-back')!);
    expect(byId('review-files'), 'the files table is back').not.toBeNull();
  });

  it('shows hostile agent text as text everywhere in the changeset', async () => {
    const hostile = '<img src=x onerror=alert(1)>‮';
    await mount({
      files: [fileRecord(0, `src/${hostile}.ts`)],
      reasons: [reasonRecord('config.ci', { subject: hostile, evidence: { note: { untrusted: true, text: hostile } } })],
      report: reportRecord({ summary: hostile, findings: [{ ...reportRecord().findings[0]!, title: hostile, body: hostile }] }),
      changeset: changesetRecord({ claim: { source: 'result', text: hostile } }),
      checks: [checkRecord({ outputTail: hostile })],
      comments: [commentRecord({ body: hostile })],
    });
    expect(document.querySelector('img'), 'no element came from any agent string').toBeNull();
    expect(document.body.textContent, 'the override character is escaped everywhere').not.toContain('‮');
    expect(document.body.textContent, 'the escape shows').toContain('\\u{202E}');
  });
});
