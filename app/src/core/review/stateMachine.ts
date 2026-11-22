import { rungIndex } from './rungs';
import type { ChangesetState, DecisionActor, ReviewAction, Rung } from './schemas';

/**
 * The transition table of 0040 section 9.2. `to: 'same'` keeps the state (a rung change). Guards that need
 * more than the state, the actor and the rungs (the check outcome, the report, the budget, the attempts left)
 * are the manager's; the rules here are the ones no actor may break whatever the manager decides.
 */
export interface TransitionRule {
  readonly action: ReviewAction;
  readonly actors: readonly DecisionActor[];
  readonly from: readonly ChangesetState[];
  readonly to: readonly ChangesetState[] | 'same';
}

const OPEN: readonly ChangesetState[] = ['captured', 'checking', 'assessed', 'in_review', 'queued_for_budget', 'awaiting_human', 'accepted', 'sent_back'];
const USER_DECIDES: readonly ChangesetState[] = ['in_review', 'queued_for_budget', 'awaiting_human'];

export const TRANSITIONS: readonly TransitionRule[] = [
  { action: 'start_check', actors: ['app'], from: ['captured'], to: ['checking'] },
  { action: 'assess', actors: ['app'], from: ['captured', 'checking'], to: ['assessed'] },
  { action: 'auto_accept', actors: ['app'], from: ['assessed'], to: ['accepted'] },
  { action: 'auto_send_back', actors: ['app'], from: ['assessed'], to: ['sent_back'] },
  { action: 'start_review', actors: ['app'], from: ['assessed', 'queued_for_budget'], to: ['in_review'] },
  { action: 'queue_budget', actors: ['app'], from: ['assessed', 'in_review'], to: ['queued_for_budget'] },
  { action: 'report', actors: ['reviewer'], from: ['in_review'], to: ['accepted', 'sent_back', 'awaiting_human'] },
  { action: 'review_failed', actors: ['app'], from: ['in_review'], to: ['awaiting_human'] },
  { action: 'accept', actors: ['user'], from: USER_DECIDES, to: ['accepted'] },
  { action: 'reject', actors: ['user'], from: [...USER_DECIDES, 'accepted', 'sent_back'], to: ['rejected'] },
  { action: 'send_back', actors: ['user'], from: [...USER_DECIDES, 'accepted'], to: ['sent_back'] },
  { action: 'reopen', actors: ['app'], from: ['accepted'], to: ['awaiting_human'] },
  { action: 'escalate', actors: ['user'], from: OPEN, to: 'same' },
  { action: 'request_escalation', actors: ['agent'], from: OPEN, to: 'same' },
  { action: 'demote', actors: ['user'], from: USER_DECIDES, to: 'same' },
  { action: 'supersede', actors: ['app'], from: OPEN, to: ['superseded'] },
  { action: 'undeliverable', actors: ['app'], from: ['sent_back'], to: ['awaiting_human'] },
  { action: 'no_new_capture', actors: ['app'], from: ['sent_back'], to: ['awaiting_human'] },
  { action: 'merge', actors: ['app'], from: ['accepted'], to: 'same' },
];

export interface TransitionRequest {
  readonly action: ReviewAction;
  readonly actor: DecisionActor;
  readonly from: ChangesetState;
  readonly to: ChangesetState;
  readonly fromRung: Rung;
  readonly toRung: Rung;
  /** The floor before the change. */
  readonly floor: Rung;
  /** The changeset has a `mergedCommit`. */
  readonly merged: boolean;
  /** A demotion below the floor came with the second confirmation. */
  readonly floorConfirmed?: boolean;
}

export type TransitionVerdict = { readonly ok: true } | { readonly ok: false; readonly why: string };

const refuse = (why: string): TransitionVerdict => ({ ok: false, why });

/** Whether a state or rung change is allowed (0040 sections 9.2 and 9.3). */
export function checkTransition(request: TransitionRequest): TransitionVerdict {
  const rule = TRANSITIONS.find((candidate) => candidate.action === request.action);
  if (rule === undefined) return refuse(`unknown action ${request.action}`);
  if (!rule.actors.includes(request.actor)) return refuse(`${request.actor} may not ${request.action}`);
  if (!rule.from.includes(request.from)) return refuse(`${request.action} is not possible from ${request.from}`);
  const targets = rule.to === 'same' ? [request.from] : rule.to;
  if (!targets.includes(request.to)) return refuse(`${request.action} cannot lead from ${request.from} to ${request.to}`);
  if (request.merged && request.action !== 'escalate') return refuse('a merged changeset is final');

  const up = rungIndex(request.toRung) - rungIndex(request.fromRung);
  if (request.action === 'demote') {
    if (up >= 0) return refuse('a demotion lowers the rung');
    if (rungIndex(request.toRung) < rungIndex(request.floor) && request.floorConfirmed !== true) return refuse('lowering below the floor needs the second confirmation');
  } else if (up < 0) {
    return refuse('only the user lowers a rung, with review_demote');
  }
  if ((request.action === 'escalate' || request.action === 'request_escalation') && up <= 0) return refuse('an escalation raises the rung');
  if (rungIndex(request.toRung) < rungIndex(request.floor) && request.action !== 'demote') return refuse('the rung is never below the floor');

  if (request.to === 'accepted' && request.from !== 'accepted') {
    if (request.actor === 'app' && request.toRung !== 'A') return refuse('the app accepts at rung A only');
    if (request.actor === 'reviewer' && rungIndex(request.toRung) > rungIndex('B')) return refuse('a reviewer accepts at rung B only');
  }
  return { ok: true };
}
