import type { PermissionMode, SessionId } from '../../session/types';
import type { NodeId } from '../../tree/types';
import type { AgentSpec, SwarmDefinition } from '../definition';
import type { ResolvedTier } from '../tiers';
import type { AgentRunState, EndReason, InterruptedBy, OpenApproval, SwarmId, SwarmState } from '../types';
import type { BudgetLedger } from './BudgetLedger';

/** What collecting an agent's workspace found; stored as `result_meta` (0037 section 12). */
export interface ResultMeta {
  commits: { sha: string; subject: string }[];
  numstat: { path: string; added: number; removed: number }[];
  outsideOwns: string[];
  editedInputs: boolean;
  conflict?: string;
  /** The commit the collection diffs against: the base, or the merge preview's commit. */
  workspaceBase?: string;
  /** A readonly agent changed files; the changes are in its stored patch. */
  readonlyChanged?: boolean;
  collectError?: string;
  /** The agent's patch is in the swarm's patch directory. */
  patchStored?: boolean;
  inputsDir?: string;
}

export const emptyMeta = (): ResultMeta => ({ commits: [], numstat: [], outsideOwns: [], editedInputs: false });

export interface ApprovalEntry {
  readonly open: OpenApproval;
}

export interface AgentEntry {
  readonly spec: AgentSpec;
  readonly position: number;
  readonly tier: ResolvedTier;
  readonly permissionMode: PermissionMode;
  state: AgentRunState;
  reason?: EndReason | undefined;
  interruptedBy?: InterruptedBy | undefined;
  sessionId?: SessionId | undefined;
  /** How the agent ends when its process exits. */
  ending?: { state: AgentRunState; reason?: EndReason | undefined } | undefined;
  /** A message to resume the agent with, waiting for a slot. */
  resumeWith?: string | undefined;
  /** The process has reported `started`; a failure before that retries as a fresh launch. */
  started: boolean;
  retries: number;
  /** The earliest time a pending retry may start, in ms. */
  retryAt?: number | undefined;
  retryTimer?: unknown;
  keepTimer?: unknown;
  /** When the agent began waiting for a free slot, in ms. */
  slotWaitSince?: number | undefined;
  /** The wait alert was raised for this wait. */
  capAlerted?: boolean;
  pid?: number | undefined;
  turns: number;
  text?: string | undefined;
  terminalReason?: string | undefined;
  errors: string[];
  /** Permission denials the agent's results reported in its current run, and the tools they named; reset when a run starts, read by the review, not stored. */
  denials: number;
  deniedTools: string[];
  cwd?: string | undefined;
  branch?: string | undefined;
  meta: ResultMeta;
  collecting?: Promise<void> | undefined;
  readonly approvals: Map<string, ApprovalEntry>;
  readonly queuedAt: string;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
}

export interface SwarmEntry {
  readonly id: SwarmId;
  readonly seq: number;
  readonly folderId: NodeId | null;
  readonly callerSessionId?: SessionId | undefined;
  readonly depth: number;
  readonly definition: SwarmDefinition;
  readonly repoRoot?: string | undefined;
  readonly baseCommit?: string | undefined;
  readonly agents: AgentEntry[];
  readonly warnings: string[];
  readonly createdAt: string;
  readonly ledger: BudgetLedger;
  state: SwarmState;
  stopReason?: EndReason | undefined;
  endedAt?: string | undefined;
  updatedAt: string;
  wallClockMs: number;
  lastTickMs: number;
  alertedShare: boolean;
  finalized: boolean;
}
