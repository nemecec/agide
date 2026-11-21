import type { Unsubscribe } from '../events/EventBus';
import type { PermissionMode, SessionId } from '../session/types';
import type { NodeId } from '../tree/types';
import type { AgentSpend, SwarmBudget } from './budget';
import type { AgentRole, Effort, SwarmDefinition, Tier, Workspace } from './definition';
import type { CanUseToolRequest } from './runtime/types';

export type SwarmId = string;

/** Run states of a swarm agent (0037 section 3.1). The 0027 agent store keeps its own four states. */
export const AGENT_RUN_STATES = ['queued', 'running', 'waiting', 'interrupted', 'done', 'failed', 'stopped'] as const;
export type AgentRunState = (typeof AGENT_RUN_STATES)[number];
export const ENDED_RUN_STATES: readonly AgentRunState[] = ['done', 'failed', 'stopped'];

export const SWARM_STATES = ['running', 'paused', 'done', 'failed', 'stopped'] as const;
export type SwarmState = (typeof SWARM_STATES)[number];

/** Why an agent is `failed` or `stopped`, or why a swarm is `stopped`. */
export type EndReason =
  'error-result' | 'exit' | 'spawn' | 'mode-mismatch' | 'agent-budget' | 'turns' | 'dependency' | 'user' | 'caller' | 'swarm-budget' | 'wall-clock' | 'policy';

export type InterruptedBy = 'user' | 'caller' | 'pause' | 'quit' | 'crash';

/** What a `queued` agent waits for. */
export type QueueReason = 'dependencies' | 'slot' | 'budget' | 'pause';

/**
 * Who calls the manager. The user acts through the UI. A session calls through the app MCP server: its folder
 * scope, spawn depth (0 for a user session) and current mode come from the session module; `swarmAgent` is set
 * when the session is itself an agent of a swarm.
 */
export type SwarmCaller =
  | { readonly kind: 'ui' }
  | {
      readonly kind: 'session';
      readonly sessionId: SessionId;
      readonly folderId: NodeId;
      readonly depth: number;
      readonly permissionMode: PermissionMode;
      readonly swarmAgent?: { readonly swarmId: SwarmId; readonly mayStartSwarms: boolean };
    };

export interface SwarmStartRequest {
  /** Parsed with `swarmDefinitionSchema` by the manager; the raw value is kept for the error message. */
  readonly definition: unknown;
  /** Default: the caller's folder; must be within the caller's scope. `null` places the swarm at the top level (UI only). */
  readonly parentFolderId?: NodeId | null;
  /** The start dialog's confirmed bypass on a qualifying provider; refused for any other caller. */
  readonly bypass?: boolean;
}

export interface SwarmAgentRef {
  readonly name: string;
  readonly state: AgentRunState;
  readonly sessionId?: SessionId;
  readonly branch?: string;
}

export interface SwarmStartResult {
  readonly swarmId: SwarmId;
  readonly folderId: NodeId;
  readonly agents: readonly SwarmAgentRef[];
  readonly warnings: readonly string[];
}

export interface OpenApproval {
  readonly requestId: string;
  readonly request: CanUseToolRequest;
  readonly openedAt: string;
}

export interface SwarmAgentStatus {
  readonly name: string;
  readonly position: number;
  readonly role: AgentRole;
  readonly stage: number;
  readonly state: AgentRunState;
  readonly reason?: EndReason;
  readonly interruptedBy?: InterruptedBy;
  readonly queuedFor?: QueueReason;
  readonly sessionId?: SessionId;
  readonly tier: Tier;
  readonly model: string;
  readonly effort: Effort;
  /** The effective mode (strictest of agent, swarm and caller). */
  readonly permissionMode: PermissionMode;
  readonly workspace: Workspace;
  readonly cwd?: string;
  readonly branch?: string;
  readonly turns: number;
  readonly spend: AgentSpend;
  readonly openApprovals: readonly OpenApproval[];
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
}

export interface SwarmStatus {
  readonly id: SwarmId;
  readonly folderId: NodeId;
  readonly goal: string;
  /** Absent when the user started it. */
  readonly callerSessionId?: SessionId;
  readonly depth: number;
  readonly state: SwarmState;
  readonly stopReason?: EndReason;
  readonly definition: SwarmDefinition;
  readonly budget: SwarmBudget;
  readonly agents: readonly SwarmAgentStatus[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
  readonly endedAt?: string;
}

export interface SwarmSummary {
  readonly id: SwarmId;
  readonly folderId: NodeId;
  readonly goal: string;
  readonly state: SwarmState;
  readonly counts: Readonly<Record<AgentRunState, number>>;
  readonly createdAt: string;
}

/** One agent's results (0037 section 4.3). Text fields are agent text. */
export interface AgentResult {
  readonly name: string;
  readonly state: AgentRunState;
  readonly reason?: EndReason;
  readonly text?: string;
  readonly branch?: string;
  readonly worktreePath?: string;
  readonly commits: readonly { readonly sha: string; readonly subject: string }[];
  readonly numstat: readonly { readonly path: string; readonly added: number; readonly removed: number }[];
  readonly outsideOwns: readonly string[];
  readonly overlapsWith: readonly string[];
  readonly editedInputs: boolean;
  readonly conflict?: string;
  /** Only with `patch: true`, capped at 100 KB. */
  readonly patch?: string;
}

export interface SwarmResults {
  readonly swarmId: SwarmId;
  readonly agents: readonly AgentResult[];
}

export type SwarmEvent =
  | { readonly type: 'swarm.changed'; readonly swarmId: SwarmId; readonly state: SwarmState }
  | { readonly type: 'swarm.agent_changed'; readonly swarmId: SwarmId; readonly agent: string; readonly state: AgentRunState; readonly sessionId?: SessionId }
  | { readonly type: 'swarm.removed'; readonly swarmId: SwarmId };

export type SwarmErrorCode = 'invalid_input' | 'not_found' | 'out_of_scope' | 'limit_reached' | 'refused' | 'failed';

export class SwarmError extends Error {
  constructor(
    readonly code: SwarmErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SwarmError';
  }
}

/**
 * Owns swarms and their agents' run states (0037 section 3). The commands `swarm_*` call it with the caller of
 * the command. Implementations: `InMemorySwarmManager` and w-manager's persistent manager; both pass
 * `describeSwarmManagerContract`.
 */
export interface SwarmManager {
  start(request: SwarmStartRequest, caller: SwarmCaller): Promise<SwarmStartResult>;
  list(filter: { readonly states?: readonly SwarmState[]; readonly limit?: number }, caller: SwarmCaller): SwarmSummary[];
  status(swarmId: SwarmId, caller: SwarmCaller): SwarmStatus;
  /** Without `agent`: unpause the swarm and continue every interrupted agent (0037 section 8). */
  send(swarmId: SwarmId, input: { readonly agent?: string; readonly message?: string; readonly now?: boolean }, caller: SwarmCaller): Promise<void>;
  /** Without `agent`: pause the swarm. */
  interrupt(swarmId: SwarmId, input: { readonly agent?: string }, caller: SwarmCaller): Promise<void>;
  /** Without `agent`: stop the swarm. Worktrees stay. */
  stop(swarmId: SwarmId, input: { readonly agent?: string }, caller: SwarmCaller): Promise<void>;
  results(swarmId: SwarmId, input: { readonly agent?: string; readonly patch?: boolean }, caller: SwarmCaller): Promise<SwarmResults>;
  /** Answers an open `can_use_tool` request. The user only: `swarm_approval_answer` is not an MCP tool. */
  answerApproval(swarmId: SwarmId, agent: string, requestId: string, decision: 'allow' | 'deny'): void;
  subscribe(listener: (event: SwarmEvent) => void): Unsubscribe;
  /** App quit: interrupt running agents, end their processes, pause the swarms (0037 section 2.4). */
  shutdown(): Promise<void>;
}

/** What the swarm module gives the other modules. */
export interface SwarmService {
  readonly manager: SwarmManager;
}

/** Inbox origin of approval items made from `can_use_tool` (0037 section 7.2). */
export const SWARM_APPROVAL_ORIGIN = 'swarm:can_use_tool';

/**
 * The `payload` of an inbox item of origin `SWARM_APPROVAL_ORIGIN`. The manager writes it; the inbox card reads
 * `swarmId`, `agent` and `requestId` for `swarm_approval_answer`, shows `request` in the Details disclosure and
 * the automatic denial from `expiresAt`.
 */
export interface SwarmApprovalPayload {
  readonly swarmId: SwarmId;
  readonly agent: string;
  readonly requestId: string;
  /** The raw request as the CLI sent it. */
  readonly request: CanUseToolRequest;
  /** The agent's effective mode. */
  readonly permissionMode: PermissionMode;
  /** When the app answers deny on its own (`swarm.approvalTimeoutMinutes`). */
  readonly expiresAt: string;
  /** The inspector record of 0028 section 4 for the same tool name and input hash, when one exists. */
  readonly inspector?: { readonly classId?: string; readonly mode?: string; readonly audience?: string };
}
