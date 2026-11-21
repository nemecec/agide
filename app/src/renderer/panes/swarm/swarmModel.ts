import type { StatusKind } from '../../ui/icons';
import {
  AGENT_RUN_STATES,
  ENDED_RUN_STATES,
  type AgentRunState,
  type EndReason,
  type InterruptedBy,
  type QueueReason,
  type SwarmAgentStatus,
  type SwarmApprovalPayload,
  type SwarmState,
  type SwarmStatus,
} from '../../../core/swarm/types';
import type { SwarmBudget } from '../../../core/swarm/budget';

/** The chip each run state of an agent draws: one glyph keeps one meaning (0037 section 10). */
export const RUN_STATUS: Readonly<Record<AgentRunState, StatusKind>> = {
  queued: 'queued',
  running: 'busy',
  waiting: 'waiting',
  interrupted: 'interrupted',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

export const SWARM_STATUS: Readonly<Record<SwarmState, StatusKind>> = {
  running: 'busy',
  paused: 'interrupted',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

/** The word beside a run-state glyph. */
export const RUN_WORDS: Readonly<Record<AgentRunState, string>> = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting',
  interrupted: 'interrupted',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

export const SWARM_WORDS: Readonly<Record<SwarmState, string>> = {
  running: 'running',
  paused: 'paused',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

const END_REASON_TEXT: Readonly<Record<EndReason, string>> = {
  'error-result': 'the agent ended with an error',
  exit: 'the process exited without a result',
  spawn: 'the process did not start',
  'mode-mismatch': 'the process reported a looser permission mode than asked',
  'agent-budget': 'the agent spent its budget',
  turns: 'the agent reached its turn limit',
  dependency: 'a dependency failed',
  user: 'stopped by you',
  caller: 'stopped by the session that started the swarm',
  'swarm-budget': 'the swarm spent its budget',
  'wall-clock': 'the swarm reached its time limit',
  policy: 'stopped by the failure policy',
};

const INTERRUPTED_BY_TEXT: Readonly<Record<InterruptedBy, string>> = {
  user: 'interrupted by you',
  caller: 'interrupted by the session that started the swarm',
  pause: 'the swarm is paused',
  quit: 'Agide was closed',
  crash: 'Agide stopped unexpectedly',
};

const QUEUE_TEXT: Readonly<Record<QueueReason, string>> = {
  dependencies: 'waiting for earlier agents',
  slot: 'waiting for a free slot',
  budget: 'waiting for budget',
  pause: 'waiting while the swarm is paused',
};

export const endReasonText = (reason: EndReason): string => END_REASON_TEXT[reason];

/** Why the agent is in its state, in words; empty for a running or finished agent with nothing to add. */
export function agentDetail(agent: Pick<SwarmAgentStatus, 'state' | 'reason' | 'interruptedBy' | 'queuedFor' | 'openApprovals'>): string {
  switch (agent.state) {
    case 'queued':
      return agent.queuedFor === undefined ? 'waiting' : QUEUE_TEXT[agent.queuedFor];
    case 'interrupted':
      return agent.interruptedBy === undefined ? '' : INTERRUPTED_BY_TEXT[agent.interruptedBy];
    case 'failed':
    case 'stopped':
      return agent.reason === undefined ? '' : END_REASON_TEXT[agent.reason];
    case 'waiting':
      return agent.openApprovals.length === 1 ? 'one approval is open' : `${agent.openApprovals.length} approvals are open`;
    default:
      return '';
  }
}

export interface SwarmTally {
  readonly running: number;
  readonly waiting: number;
  readonly queued: number;
  readonly ended: number;
  readonly total: number;
}

/** Agents holding a slot count as running; a waiting agent holds its slot (0037 section 3.1). */
export function tally(agents: readonly Pick<SwarmAgentStatus, 'state'>[]): SwarmTally {
  const count = (states: readonly AgentRunState[]): number => agents.filter((agent) => states.includes(agent.state)).length;
  return { running: count(['running', 'waiting']), waiting: count(['waiting']), queued: count(['queued']), ended: count(ENDED_RUN_STATES), total: agents.length };
}

/** "2 running, 1 queued" for the tooltip of a swarm row. */
export function tallyText(counts: SwarmTally): string {
  const parts = [`${counts.running} running`, `${counts.queued} queued`];
  if (counts.waiting > 0) parts.push(`${counts.waiting} waiting for an answer`);
  return parts.join(', ');
}

/** "2 of 4 agents running", the cap label of a project folder (0027). */
export const capLabel = (running: number, cap: number): string => `${running} of ${cap} agents running`;

export type MeterLevel = 'normal' | 'warning' | 'danger';

export interface MeterModel {
  readonly spentUsd: number;
  readonly totalUsd: number;
  /** Shares of the total in 0..1 for the reported, estimated and reserved parts, laid out one after the other. */
  readonly reported: number;
  readonly estimated: number;
  readonly reserved: number;
  readonly level: MeterLevel;
  readonly label: string;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const usd = (value: number): string => value.toFixed(2);

export const WARNING_SHARE = 0.8;

/**
 * The budget bar and its words (0037 section 10). The words say that the figures are list-price equivalents and
 * how much of them is estimated from tokens, so the state never rests on colour; swarms run on the subscription.
 */
export function meterModel(budget: Pick<SwarmBudget, 'usdTotal' | 'reportedUsd' | 'estimatedUsd' | 'reservedUsd'>): MeterModel {
  const total = budget.usdTotal;
  const spent = budget.reportedUsd + budget.estimatedUsd;
  // Rounded, so 2.40 of 3.00 reads as 80 percent and not as 79.99999.
  const share = total > 0 ? Math.round((spent / total) * 1e6) / 1e6 : 0;
  const level: MeterLevel = share >= 1 ? 'danger' : share >= WARNING_SHARE ? 'warning' : 'normal';
  const reported = total > 0 ? clamp(budget.reportedUsd / total) : 0;
  const estimated = total > 0 ? clamp(budget.estimatedUsd / total) : 0;
  const reserved = total > 0 ? clamp(budget.reservedUsd / total) : 0;
  const estimate = budget.estimatedUsd > 0 ? `, ${usd(budget.estimatedUsd)} of it estimated from tokens` : '';
  const state = level === 'danger' ? ', limit reached' : level === 'warning' ? ', over 80 percent' : '';
  return {
    spentUsd: spent,
    totalUsd: total,
    reported,
    estimated: Math.min(estimated, 1 - reported),
    reserved: Math.min(reserved, Math.max(0, 1 - reported - estimated)),
    level,
    label: `${usd(spent)} of ${usd(total)} USD, list-price equivalent, not billed${estimate}${state}`,
  };
}

/** Spend of one agent in the table: "0.42 USD", with "(est.)" while part of it is estimated. */
export function agentSpendText(spend: Pick<SwarmAgentStatus['spend'], 'reportedUsd' | 'estimatedUsd' | 'priced'>): string {
  const total = spend.reportedUsd + spend.estimatedUsd;
  if (!spend.priced && total === 0) return 'no price';
  return `${usd(total)} USD${spend.estimatedUsd > 0 ? ' (est.)' : ''}`;
}

/** The group controls the state of a swarm allows. A stopped swarm continues agent by agent, with a message. */
export interface GroupControls {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly stop: boolean;
}

export function groupControls(state: SwarmState): GroupControls {
  return { pause: state === 'running', resume: state === 'paused', stop: state === 'running' || state === 'paused' };
}

export interface AgentControls {
  readonly send: boolean;
  readonly interrupt: boolean;
  readonly stop: boolean;
}

/** An ended agent can be messaged (a resume); only a live one interrupts or stops. */
export function agentControls(state: AgentRunState): AgentControls {
  const live = state === 'running' || state === 'waiting';
  return { send: state !== 'queued', interrupt: live, stop: live || state === 'queued' || state === 'interrupted' };
}

const toUnique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** The warnings a results card shows for one agent, as plain sentences. */
export function resultWarnings(result: {
  readonly outsideOwns: readonly string[];
  readonly overlapsWith: readonly string[];
  readonly editedInputs: boolean;
  readonly conflict?: string | undefined;
}): string[] {
  const warnings: string[] = [];
  if (result.outsideOwns.length > 0) warnings.push(`Changed files outside its owned paths: ${toUnique(result.outsideOwns).join(', ')}`);
  if (result.overlapsWith.length > 0) warnings.push(`Changed files that ${toUnique(result.overlapsWith).join(', ')} also changed`);
  if (result.editedInputs) warnings.push('You edited a tool input of this agent; the agent was not told');
  if (result.conflict !== undefined) warnings.push(`Merge conflict: ${result.conflict}`);
  return warnings;
}

/** Totals over a numstat list, for the one-line summary of changed files. */
export function numstatSummary(numstat: readonly { readonly path: string; readonly added: number; readonly removed: number }[]): string {
  if (numstat.length === 0) return 'no changed files';
  const added = numstat.reduce((sum, file) => sum + file.added, 0);
  const removed = numstat.reduce((sum, file) => sum + file.removed, 0);
  return `${numstat.length === 1 ? '1 file' : `${numstat.length} files`}, +${added} −${removed}`;
}

export const isEndedState = (state: AgentRunState): boolean => ENDED_RUN_STATES.includes(state);
export const isRunState = (value: string): value is AgentRunState => (AGENT_RUN_STATES as readonly string[]).includes(value);

/** The swarm a session belongs to and the agent it runs, when it is a swarm agent. */
export function findAgent(swarms: readonly SwarmStatus[], sessionId: string): { readonly swarm: SwarmStatus; readonly agent: SwarmAgentStatus } | undefined {
  for (const swarm of swarms) {
    const agent = swarm.agents.find((candidate) => candidate.sessionId === sessionId);
    if (agent) return { swarm, agent };
  }
  return undefined;
}

/** What a swarm approval card needs from the item payload; undefined when the payload is not a swarm approval. */
export function readApprovalPayload(payload: unknown): SwarmApprovalPayload | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const value = payload as Partial<SwarmApprovalPayload>;
  const request = value.request;
  if (typeof value.swarmId !== 'string' || typeof value.agent !== 'string' || typeof value.requestId !== 'string') return undefined;
  if (request === null || typeof request !== 'object' || typeof request.tool_name !== 'string') return undefined;
  return value as SwarmApprovalPayload;
}

export interface ApprovalButtons {
  readonly deny: true;
  readonly allow: true;
  /** Shown only when the request suggests a rule for the session and the call needs no closer look (0037 section 7.2). */
  readonly always: boolean;
}

/** True when the request carries an `addRules` suggestion that allows for the session. */
export function hasSessionRuleSuggestion(request: { readonly permission_suggestions?: readonly unknown[] | undefined }): boolean {
  return (request.permission_suggestions ?? []).some((suggestion) => {
    if (suggestion === null || typeof suggestion !== 'object') return false;
    const entry = suggestion as { type?: unknown; behavior?: unknown; destination?: unknown };
    return entry.type === 'addRules' && entry.behavior === 'allow' && entry.destination === 'session';
  });
}

/**
 * The buttons of an approval. Always waits until the manager takes it (the answer command knows allow and deny
 * only), so `alwaysSupported` is off by default; it also needs a session rule suggestion and a call that the
 * inspector did not class as draft or approve.
 */
export function approvalButtons(payload: SwarmApprovalPayload, alwaysSupported: boolean): ApprovalButtons {
  const closerLook = payload.inspector?.classId !== undefined && /draft|approve/.test(payload.inspector.classId);
  return { deny: true, allow: true, always: alwaysSupported && hasSessionRuleSuggestion(payload.request) && !closerLook };
}

/** "denied automatically in 47 minutes", from the time the app answers deny on its own. */
export function expiryText(expiresAt: string, now: number): string {
  const seconds = Math.round((Date.parse(expiresAt) - now) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds <= 0) return 'the app denies it any moment';
  if (seconds < 60) return 'denied automatically in under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `denied automatically in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}`;
  const hours = Math.round(minutes / 60);
  return `denied automatically in ${hours} hours`;
}
