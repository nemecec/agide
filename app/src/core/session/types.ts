import type { Unsubscribe } from '../events/EventBus';
import { MODE_ORDER } from '../permissions/modes';
import type { NodeId } from '../tree/types';

/** The Claude session id. The app chooses it and passes it with `--session-id`, so it is known before launch. */
export type SessionId = string;

/**
 * - `starting`: process spawned, no `SessionStart` hook yet.
 * - `idle`: waiting for the user (after `SessionStart` or `Stop`).
 * - `busy`: a turn runs (after `UserPromptSubmit`).
 * - `waiting`: a permission prompt is open (after `PermissionRequest`).
 * - `exited`: the process ended; `resume` starts a new process on the same session id.
 */
export type SessionStatus = 'starting' | 'idle' | 'busy' | 'waiting' | 'exited';

/** Decision 0004: user-facing sessions run the TUI in a PTY; app-started background agents use stream-json. */
export type LaunchPath = 'pty' | 'stream-json';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';

/** The mode the session itself reported in an authenticated hook request (0043 section 4.3). */
export interface ReportedMode {
  readonly mode: PermissionMode;
  readonly at: string;
  /** `http`: an authenticated hook request; payload files of `inbox-dir` are never a source. */
  readonly transport: 'http';
}

/** The index of a mode in `MODE_ORDER`: strictest first, bypass last. */
export const MODE_RANK: Readonly<Record<PermissionMode, number>> = Object.fromEntries(MODE_ORDER.map((mode, rank) => [mode, rank])) as Record<PermissionMode, number>;

export interface SessionInfo {
  readonly id: SessionId;
  /** The folder the session belongs to. The app MCP server scopes this session's tool calls to it. */
  readonly folderId: NodeId;
  readonly title: string;
  readonly cwd: string;
  readonly launchPath: LaunchPath;
  /** The mode passed with `--permission-mode` at the latest launch; `setPermissionMode` changes it for the next one. */
  readonly permissionMode: PermissionMode;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly exitCode?: number | null;
  /** The latest mode the session reported over `http`. A reported mode at or below the launch mode's rank is stored for the next launch; a looser one is shown and never stored (0043 section 4.3). */
  readonly reportedMode?: ReportedMode;
}

export interface SessionCreateInput {
  /** App-chosen session id, for a caller that must know it before the launch (swarm agents). Must be unused. */
  readonly id?: SessionId;
  readonly folderId: NodeId;
  /** Working directory of the `claude` process. */
  readonly cwd: string;
  readonly title?: string;
  /** Typed and submitted once the session is idle for the first time. */
  readonly prompt?: string;
  /** Always passed to `claude` (0004: the app sets the mode on every launch). Defaults to `default`. */
  readonly permissionMode?: PermissionMode;
  readonly launchPath?: LaunchPath;
  readonly cols?: number;
  readonly rows?: number;
}

export type SessionErrorCode = 'not_found' | 'not_running' | 'already_running' | 'launch_failed' | 'limit_reached';

export class SessionError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export type SessionEvent =
  | { readonly type: 'session.created'; readonly session: SessionInfo }
  | { readonly type: 'session.status_changed'; readonly session: SessionInfo; readonly previous: SessionStatus }
  /** Raw terminal output of a PTY session, in order. High frequency; consumers must not do heavy work per event. */
  | { readonly type: 'session.output'; readonly sessionId: SessionId; readonly data: string }
  /**
   * A hook payload the session's `--settings` hooks delivered (0004 decision 1). `hookEvent` is the hook name,
   * such as `Stop` or `SubagentStart`. The payload format belongs to the CLI and is not a stable contract;
   * 0009 turns these into agent records later.
   */
  | { readonly type: 'session.hook'; readonly sessionId: SessionId; readonly hookEvent: string; readonly payload: unknown }
  /** A mode the session reported in an `http` hook request, with the mode of the launch it was reported in. */
  | { readonly type: 'session.mode_reported'; readonly sessionId: SessionId; readonly reported: ReportedMode; readonly launchMode: PermissionMode }
  | { readonly type: 'session.exited'; readonly session: SessionInfo; readonly exitCode: number | null; readonly signal: string | null }
  | { readonly type: 'session.closed'; readonly sessionId: SessionId };

/**
 * Runs Claude sessions. `create` and `resume` resolve once the process is spawned, not when it is ready;
 * readiness shows as `session.status_changed` to `idle`.
 */
export interface SessionService {
  create(input: SessionCreateInput): Promise<SessionInfo>;
  /** Starts a new process with `--resume <id>` for an exited session. Throws `already_running` otherwise. */
  resume(id: SessionId): Promise<SessionInfo>;
  /** Ends the process if it runs and forgets the session. Emits `session.closed`. */
  close(id: SessionId): Promise<void>;
  /** Ends the process (SIGTERM, then SIGKILL after the kill timeout) and keeps the session as `exited`, so it can be resumed. */
  stop(id: SessionId): Promise<void>;
  /** Stores the mode the next launch passes, for example the mode the CLI reported after a Shift+Tab switch. */
  setPermissionMode(id: SessionId, mode: PermissionMode): void;
  /** Types `text` as a prompt and submits it. Text sent while the session is `starting` is typed once it leaves `starting`. */
  sendText(id: SessionId, text: string): void;
  /** Passes raw terminal input (keystrokes, paste) to the PTY unchanged. */
  write(id: SessionId, data: string): void;
  resize(id: SessionId, cols: number, rows: number): void;
  get(id: SessionId): SessionInfo | undefined;
  list(): SessionInfo[];
  subscribe(listener: (event: SessionEvent) => void): Unsubscribe;
}
