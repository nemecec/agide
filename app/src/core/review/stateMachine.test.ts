import { describe, expect, it } from 'vitest';
import { CHANGESET_STATES, DECISION_ACTORS, REVIEW_ACTIONS, type ChangesetState, type DecisionActor, type ReviewAction, type Rung } from './schemas';
import { checkTransition, type TransitionRequest } from './stateMachine';

const OPEN: ChangesetState[] = ['captured', 'checking', 'assessed', 'in_review', 'queued_for_budget', 'awaiting_human', 'accepted', 'sent_back'];
const DECIDES: ChangesetState[] = ['in_review', 'queued_for_budget', 'awaiting_human'];

/** 0040 section 9.2 written out row by row, independent of the table in `stateMachine.ts`. */
const ALLOWED: readonly (readonly [ReviewAction, DecisionActor, ChangesetState, ChangesetState])[] = [
  ['start_check', 'app', 'captured', 'checking'],
  ['assess', 'app', 'captured', 'assessed'],
  ['assess', 'app', 'checking', 'assessed'],
  ['auto_accept', 'app', 'assessed', 'accepted'],
  ['auto_send_back', 'app', 'assessed', 'sent_back'],
  ['start_review', 'app', 'assessed', 'in_review'],
  ['start_review', 'app', 'queued_for_budget', 'in_review'],
  ['queue_budget', 'app', 'assessed', 'queued_for_budget'],
  ['queue_budget', 'app', 'in_review', 'queued_for_budget'],
  ['report', 'reviewer', 'in_review', 'accepted'],
  ['report', 'reviewer', 'in_review', 'sent_back'],
  ['report', 'reviewer', 'in_review', 'awaiting_human'],
  ['review_failed', 'app', 'in_review', 'awaiting_human'],
  ...DECIDES.map((from) => ['accept', 'user', from, 'accepted'] as const),
  ...[...DECIDES, 'accepted' as const, 'sent_back' as const].map((from) => ['reject', 'user', from, 'rejected'] as const),
  ...[...DECIDES, 'accepted' as const].map((from) => ['send_back', 'user', from, 'sent_back'] as const),
  ['reopen', 'app', 'accepted', 'awaiting_human'],
  ...OPEN.map((from) => ['escalate', 'user', from, from] as const),
  ...OPEN.map((from) => ['request_escalation', 'agent', from, from] as const),
  ...DECIDES.map((from) => ['demote', 'user', from, from] as const),
  ...OPEN.map((from) => ['supersede', 'app', from, 'superseded'] as const),
  ['undeliverable', 'app', 'sent_back', 'awaiting_human'],
  ['no_new_capture', 'app', 'sent_back', 'awaiting_human'],
  ['merge', 'app', 'accepted', 'accepted'],
];

/** Rungs that satisfy the rung rules of each action, so the table test sees the state rules only. */
function rungsFor(action: ReviewAction): Pick<TransitionRequest, 'fromRung' | 'toRung' | 'floor'> {
  if (action === 'escalate' || action === 'request_escalation') return { fromRung: 'A', toRung: 'B', floor: 'A' };
  if (action === 'demote') return { fromRung: 'C', toRung: 'B', floor: 'A' };
  return { fromRung: 'A', toRung: 'A', floor: 'A' };
}

const request = (patch: Partial<TransitionRequest> & Pick<TransitionRequest, 'action' | 'actor' | 'from' | 'to'>): TransitionRequest => ({
  ...rungsFor(patch.action),
  merged: false,
  ...patch,
});

describe('review state machine', () => {
  it('allows exactly the transitions of the table for every action, actor, from and to state', () => {
    const allowed = new Set(ALLOWED.map((row) => row.join(' ')));
    const mismatches: string[] = [];
    for (const action of REVIEW_ACTIONS)
      for (const actor of DECISION_ACTORS)
        for (const from of CHANGESET_STATES)
          for (const to of CHANGESET_STATES) {
            const key = [action, actor, from, to].join(' ');
            const verdict = checkTransition(request({ action, actor, from, to }));
            if (verdict.ok !== allowed.has(key)) mismatches.push(`${key}: ${verdict.ok ? 'allowed' : 'refused'}`);
          }
    expect(mismatches, 'transitions that differ from 0040 section 9.2').toEqual([]);
  });

  it('never lets a transition leave rejected or superseded', () => {
    for (const from of ['rejected', 'superseded'] as const)
      for (const action of REVIEW_ACTIONS)
        for (const actor of DECISION_ACTORS)
          for (const to of CHANGESET_STATES)
            expect(checkTransition(request({ action, actor, from, to })).ok, `${actor} ${action} from ${from} to ${to}`).toBe(false);
  });

  it('lets no action but the user\'s escalate touch a merged changeset', () => {
    for (const action of REVIEW_ACTIONS)
      for (const actor of DECISION_ACTORS)
        for (const to of CHANGESET_STATES) {
          const verdict = checkTransition(request({ action, actor, from: 'accepted', to, merged: true }));
          expect(verdict.ok, `${actor} ${action} to ${to} on a merged changeset`).toBe(action === 'escalate' && actor === 'user' && to === 'accepted');
        }
  });

  it('refuses the app an accept above rung A and an accept out of queued_for_budget', () => {
    expect(checkTransition(request({ action: 'auto_accept', actor: 'app', from: 'assessed', to: 'accepted', fromRung: 'B', toRung: 'B' })).ok, 'auto accept at B').toBe(false);
    for (const action of REVIEW_ACTIONS)
      expect(checkTransition(request({ action, actor: 'app', from: 'queued_for_budget', to: 'accepted' })).ok, `app ${action} from queued_for_budget to accepted`).toBe(false);
  });

  it('refuses the reviewer an accept above rung B, a rejection and any rung change of its own', () => {
    expect(checkTransition(request({ action: 'report', actor: 'reviewer', from: 'in_review', to: 'accepted', fromRung: 'B', toRung: 'B' })).ok, 'accept at B').toBe(true);
    expect(checkTransition(request({ action: 'report', actor: 'reviewer', from: 'in_review', to: 'accepted', fromRung: 'C', toRung: 'C', floor: 'C' })).ok, 'accept at C').toBe(false);
    expect(checkTransition(request({ action: 'report', actor: 'reviewer', from: 'in_review', to: 'awaiting_human', fromRung: 'C', toRung: 'B' })).ok, 'a report that lowers the rung').toBe(false);
    for (const action of REVIEW_ACTIONS)
      for (const from of CHANGESET_STATES) expect(checkTransition(request({ action, actor: 'reviewer', from, to: 'rejected' })).ok, `reviewer ${action} from ${from} to rejected`).toBe(false);
  });

  it('lets the working agent only raise the rung, never decide', () => {
    for (const action of REVIEW_ACTIONS)
      for (const from of CHANGESET_STATES)
        for (const to of ['accepted', 'rejected', 'sent_back', 'superseded'] as const)
          if (from !== to) expect(checkTransition(request({ action, actor: 'agent', from, to })).ok, `agent ${action} from ${from} to ${to}`).toBe(false);
    const base = { action: 'request_escalation', actor: 'agent', from: 'awaiting_human', to: 'awaiting_human', floor: 'A' } as const;
    expect(checkTransition({ ...base, fromRung: 'C', toRung: 'C', merged: false }).ok, 'a request at the current rung').toBe(false);
    expect(checkTransition({ ...base, fromRung: 'C', toRung: 'B', merged: false }).ok, 'a request below the current rung').toBe(false);
    expect(checkTransition({ ...base, fromRung: 'C', toRung: 'D', merged: false }).ok, 'a request above the current rung').toBe(true);
  });

  it('refuses a rung below the current one for every action but demote', () => {
    for (const action of REVIEW_ACTIONS.filter((candidate) => candidate !== 'demote'))
      for (const actor of DECISION_ACTORS)
        for (const from of CHANGESET_STATES)
          for (const to of CHANGESET_STATES)
            expect(checkTransition({ action, actor, from, to, fromRung: 'C', toRung: 'B', floor: 'A', merged: false }).ok, `${actor} ${action} lowering C to B`).toBe(false);
  });

  it('demotes only downwards, and below the floor only with the second confirmation', () => {
    const demote = (fromRung: Rung, toRung: Rung, floor: Rung, floorConfirmed?: boolean) =>
      checkTransition({ action: 'demote', actor: 'user', from: 'awaiting_human', to: 'awaiting_human', fromRung, toRung, floor, merged: false, ...(floorConfirmed === undefined ? {} : { floorConfirmed }) }).ok;
    expect(demote('D', 'C', 'B'), 'above the floor').toBe(true);
    expect(demote('D', 'D', 'B'), 'to the same rung').toBe(false);
    expect(demote('C', 'D', 'B'), 'upwards').toBe(false);
    expect(demote('E', 'C', 'E'), 'below the floor without confirmation').toBe(false);
    expect(demote('E', 'C', 'E', true), 'below the floor with confirmation').toBe(true);
  });

  it('refuses a rung change that ends below the floor unless it is a confirmed demotion', () => {
    const request: TransitionRequest = { action: 'escalate', actor: 'user', from: 'awaiting_human', to: 'awaiting_human', fromRung: 'B', toRung: 'C', floor: 'D', merged: false };
    expect(checkTransition(request), 'a raise that stays under the floor').toMatchObject({ ok: false, why: 'the rung is never below the floor' });
    expect(checkTransition({ ...request, toRung: 'D' }).ok, 'a raise to the floor').toBe(true);
    const demotion: TransitionRequest = { ...request, action: 'demote', fromRung: 'E', toRung: 'C', floor: 'D' };
    expect(checkTransition(demotion), 'a demotion below the floor without the second confirmation').toMatchObject({ ok: false });
    expect(checkTransition({ ...demotion, floorConfirmed: true }).ok, 'the same demotion once confirmed').toBe(true);
  });
});
