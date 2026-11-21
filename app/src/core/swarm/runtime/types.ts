import type { TokenUsage } from '../../agents/types';
import type { Unsubscribe } from '../../events/EventBus';
import type { PermissionMode, SessionId } from '../../session/types';
import type { NodeId } from '../../tree/types';
import type { Effort } from '../definition';

/**
 * Everything one launch or resume of a swarm agent needs (0037 section 2.1). The runtime turns it into the
 * stream-json arguments on top of `buildLaunchArgs`, so hooks, ask rules, the inspector and the sandbox
 * settings of 0028 come with every launch.
 */
export interface AgentLaunchSpec {
  /** App-chosen; `--session-id` on launch, `--resume` on resume. */
  readonly sessionId: SessionId;
  /** The swarm's folder: the MCP grant of the agent is scoped to it. */
  readonly folderId: NodeId;
  readonly title: string;
  readonly cwd: string;
  readonly model: string;
  readonly effort: Effort;
  /** The effective mode (0037 section 7.1); `default` goes out as `manual`. */
  readonly permissionMode: PermissionMode;
  /** The reservation of 0037 section 6.2, passed as `--max-budget-usd`. */
  readonly maxBudgetUsd: number;
  readonly maxTurnsPerMessage: number;
  /** False adds `--strict-mcp-config`. */
  readonly connectors: boolean;
  /** `--tools`; absent keeps the CLI's default set. */
  readonly tools?: readonly string[];
  /** Extra `permissions.deny` entries, such as the `readonly` workspace rules. */
  readonly denyRules: readonly string[];
  /** `--add-dir` entries, such as the inputs directory. */
  readonly addDirs: readonly string[];
  /** Launch variables on top of the profile environment, such as `CLAUDE_CODE_SUBAGENT_MODEL`. */
  readonly env?: Readonly<Record<string, string>>;
  /** Written to stdin at once after the spawn (P33: nothing comes before it). */
  readonly firstMessage: string;
}

/** The raw `can_use_tool` request as the CLI sent it (P30). Unknown keys are kept. */
export interface CanUseToolRequest {
  readonly subtype: 'can_use_tool';
  readonly tool_name: string;
  readonly display_name?: string;
  readonly input: Record<string, unknown>;
  readonly description?: string;
  readonly permission_suggestions?: readonly unknown[];
  readonly tool_use_id?: string;
  readonly [key: string]: unknown;
}

/** The app's answer to a `can_use_tool` request. Always and Edit wait (0037 section 7.2). */
export type PermissionAnswer = { readonly behavior: 'allow'; readonly updatedInput: Record<string, unknown> } | { readonly behavior: 'deny'; readonly message: string };

/** The `result` message of one turn, reduced to what the manager reads. */
export interface TurnResult {
  /** `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd` and others the CLI adds. */
  readonly subtype: string;
  readonly isError: boolean;
  /** `completed`, `aborted_streaming`, `aborted_tools`, `budget_exhausted`, `max_turns`, `api_error` and others. */
  readonly terminalReason: string | undefined;
  /** Cumulative over the process (P34); a resumed process starts from zero (P33). */
  readonly totalCostUsd: number;
  readonly numTurns: number;
  readonly text: string | undefined;
  /** `errors` of the result without the `[ede_diagnostic]` lines (P31). */
  readonly errors: readonly string[];
  readonly permissionDenials: readonly unknown[];
  /** True when the turn ended because the app sent `interrupt`; such a result is not a failure. */
  readonly interrupted: boolean;
}

/**
 * What a runtime reports, per agent session, in order. `message` carries every parsed stdout line so the agents
 * module can feed `AgentsController.streamMessage`; the other events are the parts the manager reads.
 */
export type RuntimeEvent =
  | { readonly type: 'started'; readonly sessionId: SessionId; readonly pid: number; readonly resumed: boolean }
  | {
      readonly type: 'init';
      readonly sessionId: SessionId;
      /**
       * As the CLI reports it in `system/init`; a `manual` launch reports `default` (P30). The manager compares it
       * with the effective mode: a stricter mode stays with a warning, a looser or unknown one ends the agent with
       * `mode-mismatch` (0037 section 2.1).
       */
      readonly permissionMode: string;
      readonly model: string;
      readonly apiKeySource: string | undefined;
      readonly tools: readonly string[];
    }
  | {
      readonly type: 'assistant';
      readonly sessionId: SessionId;
      readonly messageId: string;
      readonly model: string;
      readonly usage: TokenUsage | undefined;
      readonly text: string | undefined;
      readonly toolNames: readonly string[];
    }
  | { readonly type: 'permission_request'; readonly sessionId: SessionId; readonly requestId: string; readonly request: CanUseToolRequest }
  /** The CLI cancelled an open request (`control_cancel_request`), for example after an interrupt. */
  | { readonly type: 'permission_cancelled'; readonly sessionId: SessionId; readonly requestId: string }
  | { readonly type: 'result'; readonly sessionId: SessionId; readonly result: TurnResult }
  | { readonly type: 'rate_limit'; readonly sessionId: SessionId; readonly info: Record<string, unknown> }
  | { readonly type: 'message'; readonly sessionId: SessionId; readonly raw: unknown }
  | {
      readonly type: 'exited';
      readonly sessionId: SessionId;
      readonly code: number | null;
      readonly signal: string | null;
      /** True when the app ended it (`end`, `stop`, `dispose`). */
      readonly byApp: boolean;
    };

export type RuntimeErrorCode = 'not_found' | 'already_running' | 'not_running' | 'spawn' | 'unsupported' | 'timeout';

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/**
 * Runs swarm agents as `claude -p` stream-json processes (0037 section 2). One live process per session id.
 * Implementations: `InMemoryAgentRuntime` (tests) and the stream-json runtime of w-runtime. Both pass
 * `describeAgentRuntimeContract`.
 */
export interface AgentRuntime {
  /** Spawns a new session and writes `spec.firstMessage`. `already_running` when the id is live, `spawn` when it cannot start. */
  launch(spec: AgentLaunchSpec): Promise<void>;
  /**
   * Starts a new process with `--resume` and writes `spec.firstMessage`. `already_running` while a process for the
   * id lives, `not_found` for an id that was never launched.
   */
  resume(spec: AgentLaunchSpec): Promise<void>;
  /**
   * Writes a user message. While a turn runs the message waits for the turn's `result`, so each message starts
   * its own turn. With `now` the runtime interrupts the turn first and writes the message after its `result`.
   * `not_running` when no process lives.
   */
  send(sessionId: SessionId, text: string, options?: { readonly now?: boolean }): void;
  /** Answers an open `can_use_tool` request. Answers to unknown or cancelled requests are ignored. */
  answer(sessionId: SessionId, requestId: string, answer: PermissionAnswer): void;
  /** Ends the running turn; resolves after its `result`, or at once when no turn runs. The process stays alive. */
  interrupt(sessionId: SessionId): Promise<void>;
  /** Closes stdin after the running turn and any queued messages; resolves when the process exited. */
  end(sessionId: SessionId): Promise<void>;
  /** Interrupt, close stdin, then SIGTERM and SIGKILL through the environment; resolves when the process exited. */
  stop(sessionId: SessionId): Promise<void>;
  /** A control request such as `initialize`; resolves with its response, `timeout` after 20 s. */
  control(sessionId: SessionId, request: { readonly subtype: string; readonly [key: string]: unknown }): Promise<Record<string, unknown>>;
  /** True while a process for the id lives. */
  isLive(sessionId: SessionId): boolean;
  /** True when the runtime closed the session itself, after a start that failed; any other close came from outside. */
  closedByRuntime?(sessionId: SessionId): boolean;
  /**
   * True while a turn of the live process runs or a written message waits for one. From a turn's `result` event
   * on it is false unless a queued message starts the next turn, so a listener of `result` can tell whether the
   * agent has nothing left to do.
   */
  isBusy(sessionId: SessionId): boolean;
  subscribe(listener: (event: RuntimeEvent) => void): Unsubscribe;
  /** Stops every live process. For app quit; the manager interrupts first (0037 section 2.4). */
  dispose(): Promise<void>;
}
