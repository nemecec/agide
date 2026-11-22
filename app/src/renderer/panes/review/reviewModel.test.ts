import { describe, expect, it } from 'vitest';
import { BODY, changesetRecord, commentRecord, detailFixture, fileRecord, hex, hunkRecord, reasonRecord, reportRecord, summaryRecord } from './reviewFixtures';
import { acceptBlock, actionState, cardButtons, evidenceItems, findingId, fileLabel, hunklessNotice, readReviewPayload, reasonIdsText, reasonsOfFile, sortReasons, splitDrafts, splitLatest } from './reviewModel';

describe('accepting at rung D and E', () => {
  const seenFiles = (seen: boolean[]) => seen.map((value, idx) => ({ idx, seen: value, unseenHunks: value ? 0 : 1 }));
  const at = (rung: 'D' | 'E', seen: boolean[], extra: Parameters<typeof detailFixture>[0] = {}) =>
    detailFixture({ changeset: changesetRecord({ state: 'awaiting_human', rung }), seen: { summaryHash: hex(7), summary: false, files: seenFiles(seen), hunks: [] }, ...extra });

  it('blocks Accept at E until every file is seen, and says why', () => {
    expect(actionState(at('E', [true, false])).accept, 'one file unseen').toBe(false);
    expect(acceptBlock(at('E', [true, false])), 'the reason is in words').toContain('every hunk and every file');
    expect(actionState(at('E', [true, true])).accept, 'all seen').toBe(true);
  });

  it('blocks Accept at D until the files flagged by a reason are seen', () => {
    const flagged = { reasons: [reasonRecord('path.sensitive', { subject: 'src/rules.ts', minRung: 'D' })] };
    expect(actionState(at('D', [true, false], flagged)).accept, 'the flagged file is unseen').toBe(false);
    expect(actionState(at('D', [false, true], flagged)).accept, 'only the flagged file counts').toBe(true);
  });

  it('blocks Accept at D that came from an escalation until the summary is seen or every file is', () => {
    const escalated = { reasons: [reasonRecord('user.escalated', { subject: 'to:D@t', minRung: 'D' })] };
    expect(actionState(at('D', [false, true], escalated)).accept, 'nothing points at a file and one is unseen').toBe(false);
    expect(actionState(at('D', [true, true], escalated)).accept, 'every file seen').toBe(true);
    expect(actionState(detailFixture({ ...escalated, changeset: changesetRecord({ state: 'awaiting_human', rung: 'D' }), seen: { summaryHash: hex(7), summary: true, files: seenFiles([false, false]), hunks: [] } })).accept, 'the summary seen').toBe(true);
  });

  it('matches a reason to a file whose name has control characters through the escaped subject', () => {
    const odd = fileRecord(0, 'src/auth/\tlogin.ts');
    const reason = reasonRecord('path.sensitive', { subject: 'src/auth/\\tlogin.ts', minRung: 'D' });
    expect(reasonsOfFile([reason], odd), 'the escaped subject finds the file').toEqual([reason]);
  });
});

describe('actionState', () => {
  const state = (patch: Parameters<typeof changesetRecord>[0], extra: Parameters<typeof detailFixture>[0] = {}) => actionState(detailFixture({ changeset: changesetRecord(patch), ...extra }));

  it('lets the user decide only work that waits for a decision', () => {
    expect(state({ state: 'awaiting_human' }).accept, 'awaiting a person').toBe(true);
    expect(state({ state: 'in_review' }).accept, 'while the reviewer runs').toBe(true);
    expect(state({ state: 'superseded' }).accept, 'a superseded changeset is never accepted').toBe(false);
    expect(state({ state: 'rejected' }).accept, 'a rejected changeset is never accepted').toBe(false);
    expect(state({ state: 'accepted' }).accept, 'accepting twice does nothing').toBe(false);
  });

  it('allows reject and send back after an accept until the work is merged', () => {
    expect(state({ state: 'accepted' }).reject, 'accepted, not merged').toBe(true);
    expect(state({ state: 'accepted', mergedCommit: hex(9, 40) }).reject, 'merged').toBe(false);
    expect(state({ state: 'accepted', mergedCommit: hex(9, 40) }).sendBack, 'merged work cannot go back').toBe(false);
  });

  it('keeps escalation open for every live state and offers a demotion only above rung A', () => {
    expect(state({ state: 'accepted' }).escalate, 'an accepted changeset can be raised').toBe(true);
    expect(state({ state: 'rejected' }).escalate, 'a rejected one cannot').toBe(false);
    expect(state({ state: 'awaiting_human', rung: 'A' }).demote, 'rung A has nothing lower').toBe(false);
    expect(state({ state: 'awaiting_human', rung: 'C' }).demote, 'rung C can go lower').toBe(true);
  });

  it('asks for the "without the reviewer" tick from rung B up when no report is stored', () => {
    expect(state({ rung: 'B' }).needsWithoutReviewer, 'rung B without a report').toBe(true);
    expect(state({ rung: 'B' }, { report: reportRecord() }).needsWithoutReviewer, 'rung B with a report').toBe(false);
    expect(state({ rung: 'A' }).needsWithoutReviewer, 'rung A needs no reviewer').toBe(false);
  });
});

describe('splitLatest', () => {
  it('puts the highest sequence of each agent first and the rest under earlier', () => {
    const items = [
      summaryRecord({ id: 'c3', agent: 'a', seq: 2, updatedAt: '2026-11-21T12:00:00.000Z' }),
      summaryRecord({ id: 'c2', agent: 'b', seq: 1, updatedAt: '2026-11-21T11:00:00.000Z' }),
      summaryRecord({ id: 'c1', agent: 'a', seq: 1, updatedAt: '2026-11-21T10:00:00.000Z' }),
    ];
    const { latest, earlier } = splitLatest(items);
    expect(latest.map((item) => item.id), 'latest per agent, newest activity first').toEqual(['c3', 'c2']);
    expect(earlier.map((item) => item.id), 'the superseded one').toEqual(['c1']);
  });
});

describe('evidenceItems', () => {
  it('marks agent text, escapes hidden characters and shortens long values with a flag', () => {
    const items = evidenceItems({ lines: 12, path: { untrusted: true, text: 'a‮b' }, note: 'x'.repeat(400), list: ['a', 'b'] });
    expect(items.find((item) => item.key === 'lines')?.value, 'a number as text').toBe('12');
    expect(items.find((item) => item.key === 'path'), 'agent text is marked and escaped').toMatchObject({ untrusted: true, value: 'a\\u{202E}b' });
    expect(items.find((item) => item.key === 'note'), 'a long value is shortened and flagged').toMatchObject({ shortened: true, untrusted: false });
    expect(items.find((item) => item.key === 'list')?.value, 'structures as JSON').toBe('["a","b"]');
  });
});

describe('reasons and files', () => {
  it('orders reasons by rung, hard first within a rung', () => {
    const sorted = sortReasons([reasonRecord('b.low', { minRung: 'B' }), reasonRecord('c.soft', { minRung: 'C' }), reasonRecord('c.hard', { minRung: 'C', hard: true }), reasonRecord('e.top', { minRung: 'E', hard: true })]);
    expect(sorted.map((reason) => reason.id), 'highest rung first, hard before soft').toEqual(['e.top', 'c.hard', 'c.soft', 'b.low']);
    expect(reasonIdsText(sorted), 'three ids and the rest counted').toBe('e.top, c.hard, c.soft and 1 more');
  });

  it('writes a rename with both paths and escapes the names', () => {
    expect(fileLabel(fileRecord(0, 'x', { status: 'R', oldPath: 'a.ts', newPath: 'b‮.ts' })), 'renamed file').toBe('a.ts → b\\u{202E}.ts');
  });

  it('says why a file has no hunks', () => {
    expect(hunklessNotice(fileRecord(0, 'a.png', { kind: 'binary' })), 'binary').toContain('Binary');
    expect(hunklessNotice(fileRecord(0, 'big.sql', { kind: 'large' })), 'large').toContain('no line can be commented');
    expect(hunklessNotice(fileRecord(0, 'run.sh', { oldMode: '100644', newMode: '100755' })), 'mode change').toContain('Mode changed');
  });

  it('finds the draft of a hunk that is gone only when the hunks of its file are loaded', () => {
    const live = commentRecord({ id: 'live', hunkHash: hunkRecord(0, 0, BODY).hunkHash });
    const gone = commentRecord({ id: 'gone', hunkHash: hex(77) });
    const loaded = new Map([[0, [hunkRecord(0, 0, BODY)]]]);
    expect(splitDrafts([live, gone], loaded), 'one live and one outdated').toEqual({ live: [live], outdated: [gone] });
    expect(splitDrafts([gone], new Map()).live, 'without the hunks it cannot tell, so the draft counts as live').toEqual([gone]);
    expect(splitDrafts([commentRecord({ state: 'sent', sentIn: 'd1' })], new Map()), 'sent comments are not drafts').toEqual({ live: [], outdated: [] });
  });

  it('names a finding by its report and index, as the send-back command expects', () => {
    const report = reportRecord();
    expect(findingId(report, report.findings[0]!), 'report id and finding index').toBe('rep1:0');
  });
});

describe('card payload', () => {
  const payload = { swarmId: 'sw1', agent: 'worker', changesetId: 'cs_0000000000000001', rung: 'C', contentHash: hex(5), state: 'awaiting_human', cardAccept: true, hasReport: true };

  it('reads a complete payload and refuses a record with a missing or foreign field', () => {
    expect(readReviewPayload(payload), 'complete payload').toEqual(payload);
    expect(readReviewPayload({ ...payload, rung: 'Z' }), 'unknown rung').toBeUndefined();
    expect(readReviewPayload({ ...payload, cardAccept: 'yes' }), 'wrong kind').toBeUndefined();
    expect(readReviewPayload(null), 'no payload').toBeUndefined();
  });

  it('offers Accept and Send back only at rung C without a major finding, and Raise budget for queued work', () => {
    const read = (patch: object) => cardButtons(readReviewPayload({ ...payload, ...patch })!);
    expect(read({}), 'rung C, no major finding').toMatchObject({ accept: true, sendBack: true, raiseBudget: false });
    expect(read({ cardAccept: false }), 'a major finding').toMatchObject({ accept: false, sendBack: false });
    expect(read({ rung: 'D' }), 'rung D is decided in the pane').toMatchObject({ accept: false, sendBack: false });
    expect(read({ state: 'queued_for_budget', rung: 'B' }), 'queued for budget').toMatchObject({ accept: true, sendBack: false, raiseBudget: true, withoutReviewer: true });
    expect(read({ state: 'queued_for_budget', rung: 'E' }), 'queued work above C is decided in the pane').toMatchObject({ accept: false, raiseBudget: true });
  });

  it('offers no Accept on the card at rung A or B, or while the reviewer runs', () => {
    const read = (patch: object) => cardButtons(readReviewPayload({ ...payload, ...patch })!);
    expect(read({ rung: 'A' }), 'rung A waiting for a person').toMatchObject({ accept: false, sendBack: false });
    expect(read({ rung: 'B' }), 'rung B waiting for a person').toMatchObject({ accept: false, sendBack: false });
    expect(read({ state: 'in_review' }), 'a reviewer is running').toMatchObject({ accept: false, sendBack: false });
  });

  it('sends the "without the reviewer" tick from the card when no report exists', () => {
    const read = (patch: object) => cardButtons(readReviewPayload({ ...payload, ...patch })!);
    expect(read({ hasReport: false }), 'rung C after the reviewer failed twice').toMatchObject({ accept: true, withoutReviewer: true });
    expect(read({}), 'rung C with a report').toMatchObject({ accept: true, withoutReviewer: false });
    const { hasReport: _dropped, ...older } = payload;
    expect(cardButtons(readReviewPayload(older)!), 'a payload that cannot tell asks for the tick').toMatchObject({ withoutReviewer: true });
  });
});
