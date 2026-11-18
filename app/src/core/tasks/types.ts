import { z } from 'zod';
import type { Caller } from '../commands/types';
import type { PermissionMode, SessionId } from '../session/types';
import type { NodeId } from '../tree/types';

/** Task start (S2, design 0028 Part 2): a session started from a prompt, a GitHub pull request or a Jira issue. */

export type TaskSource =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'pull-request'; readonly host: 'github.com'; readonly owner: string; readonly repo: string; readonly number: number }
  | { readonly kind: 'jira'; readonly key: string; readonly site?: string };

export type TaskSourceKind = TaskSource['kind'];

/** `task_start` input (0028 section 13). */
export const taskStartInputSchema = z
  .object({
    source: z.string().trim().min(1).max(20_000),
    instruction: z.string().trim().max(4_000).optional(),
    repoPath: z.string().min(1).optional(),
    base: z.string().min(1).max(200).optional(),
    parentFolderId: z.string().min(1).optional(),
    permissionMode: z.enum(['auto', 'default', 'acceptEdits', 'plan', 'bypassPermissions']).optional(),
    confirmBypassPermissions: z.boolean().optional(),
  })
  .strict();

export type TaskStartInput = z.output<typeof taskStartInputSchema>;

export interface TaskStartResult {
  readonly folderId: NodeId;
  readonly sessionId: SessionId;
  readonly leafId: NodeId;
  readonly worktreePath?: string;
  readonly branch?: string;
}

/** A row of `task_starts` (0028 section 10). */
export interface TaskStartRecord {
  readonly folderId: NodeId;
  readonly sourceKind: TaskSourceKind;
  /** `owner/repo#n`, the Jira key, or the first line of the prompt. */
  readonly sourceRef: string;
  readonly repoPath?: string;
  readonly worktreePath?: string;
  readonly branch?: string;
  /** Commit id the worktree was created from. */
  readonly base?: string;
  readonly sessionId: SessionId;
  readonly permissionMode: PermissionMode;
  readonly createdAt: string;
}

export type TaskStartErrorCode = 'invalid_source' | 'gh_failed' | 'no_repository' | 'git_failed' | 'at_cap' | 'not_allowed';

export class TaskStartError extends Error {
  constructor(
    readonly code: TaskStartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskStartError';
  }
}

/** Runs a start: reads the source, creates the folder, worktree, leaves and task row, launches the session. */
export interface TaskStarter {
  start(input: TaskStartInput, caller: Caller): Promise<TaskStartResult>;
}

/** What `gh pr view` gives the start (0028 section 9). Text fields are untrusted. */
export interface PullRequestInfo {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly author: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly isCrossRepository: boolean;
  readonly body: string;
  readonly files: readonly string[];
}

/** Reads a pull request through `gh` with `execFile`, the profile's environment and a timeout. */
export interface PullRequestReader {
  read(source: Extract<TaskSource, { kind: 'pull-request' }>): Promise<PullRequestInfo>;
}

export interface WorktreeSpec {
  readonly repoPath: string;
  /** Remote that matched `owner/repo` for a pull request, else `origin`. */
  readonly remote: string;
  readonly folderId: NodeId;
  readonly branch: string;
  /** A pull request number fetches `pull/<n>/head`; otherwise `base` is resolved to a commit. */
  readonly pullRequest?: number;
  readonly base?: string;
}

export interface WorktreeInfo {
  readonly path: string;
  readonly branch: string;
  /** The commit id the worktree starts from. */
  readonly base: string;
  /** Steps that failed without stopping the start, such as a fetch that fell back to the local base. */
  readonly warnings?: readonly string[];
}

/**
 * Working directories of sessions and tasks. Every git step runs outside the Bash sandbox with `execFile`, the
 * profile's git configuration and a timeout; nothing is removed without the user's answer.
 */
export interface WorkingDirectoryManager {
  /** `~/Agide/<folder id>`, created 0700; the session default without a repository. */
  defaultDir(folderId: NodeId): string;
  /** The local repository whose remote matches `owner/repo`, with that remote's name. */
  findRepository(owner: string, repo: string): Promise<{ readonly repoPath: string; readonly remote: string } | undefined>;
  createWorktree(spec: WorktreeSpec): Promise<WorktreeInfo>;
  /** `git worktree remove`; `force` and `deleteBranch` only after the user confirmed them. */
  removeWorktree(info: WorktreeInfo & { readonly repoPath: string }, options: { readonly force: boolean; readonly deleteBranch: boolean }): Promise<void>;
  /** Whether the app created `dir` in this start, so it may answer Claude's folder-trust question for it. */
  createdByApp(dir: string): boolean;
}

/**
 * What the session pane shows about Claude's folder-trust question (0028 section 11): `user_input` waits for
 * the user, `answering` is the app answering for a folder it created, `needs_user` is an answer that did not
 * work and `none` clears the banner.
 */
export type TrustState = 'none' | 'user_input' | 'answering' | 'needs_user';

export type TasksEvent =
  | { readonly type: 'tasks.started'; readonly record: TaskStartRecord }
  | { readonly type: 'tasks.trust_changed'; readonly sessionId: SessionId; readonly state: TrustState };

/** What the tasks module gives the other modules. */
export interface TasksService {
  readonly starter: TaskStarter;
  readonly directories: WorkingDirectoryManager;
}
