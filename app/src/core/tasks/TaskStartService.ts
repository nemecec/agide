import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BrowserTabOpener } from '../browser/types';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { requireInScope } from '../commands/scope';
import { CommandError, type Caller } from '../commands/types';
import { cleanLine } from '../inbox/text';
import type { InboxService } from '../inbox/types';
import type { PermissionMode, SessionService } from '../session/types';
import type { FolderNode, TreeService } from '../tree/types';
import type { GitWorkingDirectoryManager } from './GitWorkingDirectoryManager';
import { newNonce, composePrompt, composeTaskSourceFile } from './promptComposer';
import { parseTaskSource, sourceTitle } from './parseSource';
import { slugOf } from './remotes';
import type { StartedBy, TaskStartStore } from './TaskStartStore';
import {
  TaskStartError,
  type PullRequestInfo,
  type PullRequestReader,
  type SpawnContext,
  type TaskSource,
  type TaskStartInput,
  type TaskStartRecord,
  type TaskStartResult,
  type TaskStarter,
  type TasksEvent,
} from './types';

export const AGENT_START_CAP = 4;

const MODE_RANK: Record<PermissionMode, number> = { plan: 0, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 3 };
const TITLE_CAP = 80;

export interface TaskStartDeps {
  readonly tree: TreeService;
  readonly sessions: Pick<SessionService, 'get' | 'list'>;
  readonly commands: CommandRegistry;
  readonly inbox: InboxService;
  readonly browser: BrowserTabOpener;
  readonly reader: PullRequestReader;
  readonly directories: GitWorkingDirectoryManager;
  readonly store: TaskStartStore;
  /** Where `task-source.md` of a folder's session lives, outside the application's data directory. */
  readonly sourceDir: (folderId: string) => string;
  readonly emit: (event: TasksEvent) => void;
  readonly now?: () => Date;
  readonly nonce?: () => string;
  readonly agentCap?: number;
  /**
   * The cap shared with the other app-started agents (0037 section 3.2): when given, its `cap` replaces `agentCap`
   * and its `otherLive` agents, such as swarm agents, count with the sessions agents started here.
   */
  readonly appStarted?: { readonly cap: () => number; readonly otherLive: () => number };
}

interface AgentStart {
  readonly sessionTitle: string;
  readonly mode: PermissionMode;
  readonly spawnDepth: number;
}

interface Plan {
  readonly source: TaskSource;
  readonly title: string;
  readonly pr?: PullRequestInfo;
  readonly repoRoot?: string;
  readonly remote: string;
}

/**
 * Runs a task start (0028 sections 9 to 12): reads the source, creates the folder, the working directory and
 * the session, composes the first prompt and links the browser tab and the task row. A start that fails
 * after it created something removes what it created.
 */
export class TaskStartService implements TaskStarter {
  /** Agent starts that passed the cap check and have no task row yet. */
  private pendingAgentStarts = 0;

  private spawnContext: SpawnContext = () => undefined;

  constructor(private readonly deps: TaskStartDeps) {}

  setSpawnContext(context: SpawnContext): void {
    this.spawnContext = context;
  }

  async start(input: TaskStartInput, caller: Caller): Promise<TaskStartResult> {
    const source = parseTaskSource(input.source);
    const agent = caller.kind === 'mcp' ? this.agentContext(caller, input) : undefined;
    if (agent === undefined) return this.run(input, caller, source, undefined);
    this.pendingAgentStarts++;
    try {
      return await this.run(input, caller, source, agent);
    } finally {
      this.pendingAgentStarts--;
    }
  }

  private async run(input: TaskStartInput, caller: Caller, source: TaskSource, agent: AgentStart | undefined): Promise<TaskStartResult> {
    const { tree, directories, store, commands } = this.deps;
    const parentId = input.parentFolderId ?? (caller.kind === 'mcp' ? caller.folderId : null);
    if (parentId !== null) {
      const parent = tree.get(parentId);
      if (parent?.kind !== 'folder') throw new TaskStartError('invalid_source', `${parentId} is not a folder`);
    }
    requireInScope(tree, caller, parentId);

    const plan = await this.plan(source, input);
    const folder: FolderNode = tree.createFolder({ title: plan.title, parentId });
    let worktree: Awaited<ReturnType<GitWorkingDirectoryManager['createWorktree']>> | undefined;
    try {
      if (plan.repoRoot !== undefined) {
        worktree = await directories.createWorktree({
          repoPath: plan.repoRoot,
          remote: plan.remote,
          folderId: folder.id,
          branch: plan.pr === undefined ? `agide/${[slugOf(plan.title), folder.id.slice(0, 6)].filter(Boolean).join('-')}` : `agide/pr-${plan.pr.number}`,
          ...(plan.pr === undefined ? (input.base === undefined ? {} : { base: input.base }) : { pullRequest: plan.pr.number }),
        });
      }
      const cwd = worktree?.path ?? directories.defaultDir(folder.id);

      let sourceFile: string | undefined;
      if (plan.pr !== undefined && source.kind === 'pull-request') {
        const dir = this.deps.sourceDir(folder.id);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        sourceFile = join(dir, 'task-source.md');
        writeFileSync(sourceFile, composeTaskSourceFile(source, plan.pr, (this.deps.nonce ?? newNonce)()), { mode: 0o600 });
      }

      const guidanceRevision = plan.pr === undefined ? worktree?.base : `${plan.remote}/${plan.pr.baseRefName}`;
      const claudeMd = guidanceRevision && plan.repoRoot ? await directories.readFileAtRevision(plan.repoRoot, guidanceRevision, 'CLAUDE.md') : undefined;
      const prompt = composePrompt({
        source,
        author: agent === undefined ? { kind: 'user' } : { kind: 'agent', sessionTitle: agent.sessionTitle },
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        workdir:
          worktree === undefined
            ? {}
            : {
                repository: source.kind === 'pull-request' ? `${source.owner}/${source.repo}` : basename(plan.repoRoot ?? ''),
                branch: worktree.branch,
                commit: worktree.base,
                base: plan.pr?.baseRefName ?? input.base ?? 'origin/HEAD',
              },
        ...(claudeMd === undefined ? {} : { claudeMd }),
        ...(sourceFile === undefined ? {} : { sourceFile }),
        ...(plan.pr?.isCrossRepository === true ? { crossRepository: true } : {}),
      });

      const created = await commands.invoke(
        'session_create',
        {
          folderId: folder.id,
          title: plan.title,
          prompt,
          ...(worktree === undefined ? {} : { cwd }),
          ...(agent?.mode === undefined ? (input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }) : { permissionMode: agent.mode }),
          ...(input.confirmBypassPermissions === undefined ? {} : { confirmBypassPermissions: input.confirmBypassPermissions }),
        },
        { kind: 'ui' },
      );
      if (!created.ok) throw new TaskStartError('not_allowed', created.error.message);
      const { sessionId, leafId } = created.value as { sessionId: string; leafId: string };
      const session = this.deps.sessions.get(sessionId);

      const record: TaskStartRecord = {
        folderId: folder.id,
        sourceKind: source.kind,
        sourceRef: refOf(source, plan.title),
        ...(plan.repoRoot === undefined ? {} : { repoPath: plan.repoRoot }),
        ...(worktree === undefined ? {} : { worktreePath: worktree.path, branch: worktree.branch, base: worktree.base }),
        sessionId,
        permissionMode: session?.permissionMode ?? input.permissionMode ?? 'default',
        createdAt: (this.deps.now ?? (() => new Date()))().toISOString(),
      };
      store.insert(record, agent === undefined ? 'user' satisfies StartedBy : 'agent', agent?.spawnDepth);
      await this.link(folder.id, sessionId, source, plan);
      if (caller.kind === 'ui') await commands.invoke('ui_focus_node', { nodeId: leafId }, { kind: 'ui' });
      this.deps.emit({ type: 'tasks.started', record });
      return { folderId: folder.id, sessionId, leafId, ...(worktree === undefined ? {} : { worktreePath: worktree.path, branch: worktree.branch }) };
    } catch (error) {
      tree.remove(folder.id);
      rmSync(this.deps.sourceDir(folder.id), { recursive: true, force: true });
      if (worktree !== undefined && plan.repoRoot !== undefined) {
        // The worktree and its branch were made by this start, so nothing of the user's is lost.
        await directories.removeWorktree({ ...worktree, repoPath: plan.repoRoot }, { force: true, deleteBranch: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** What an agent may start (0028 section 13). */
  private agentContext(caller: Extract<Caller, { kind: 'mcp' }>, input: TaskStartInput): AgentStart {
    const { sessions, store, inbox, tree } = this.deps;
    const callerSession = sessions.get(caller.sessionId);
    const callerMode = callerSession?.permissionMode ?? 'default';
    if (input.confirmBypassPermissions === true || input.permissionMode === 'bypassPermissions') {
      throw new TaskStartError('not_allowed', 'an agent cannot start a session in bypassPermissions mode');
    }
    const mode = input.permissionMode ?? (callerMode === 'bypassPermissions' ? 'auto' : callerMode);
    if (MODE_RANK[mode] > MODE_RANK[callerMode]) {
      throw new TaskStartError('not_allowed', `an agent cannot start a session in ${mode} mode while its own mode is ${callerMode}`);
    }
    if (input.repoPath !== undefined && !store.repositories().includes(input.repoPath)) {
      throw new TaskStartError('not_allowed', 'repoPath must be a repository the user already used in a task start');
    }
    const live = store.agentSessionIds().filter((id) => sessions.get(id)?.status !== undefined && sessions.get(id)?.status !== 'exited').length;
    const cap = this.deps.appStarted?.cap() ?? this.deps.agentCap ?? AGENT_START_CAP;
    const others = this.deps.appStarted?.otherLive() ?? 0;
    if (live + others + this.pendingAgentStarts >= cap) {
      if (tree.get(caller.folderId)) {
        inbox.post({
          folderId: caller.folderId,
          kind: 'alert',
          source: 'app',
          origin: 'tasks:agent_cap',
          sessionId: caller.sessionId,
          message: `A session asked to start a task, but ${cap} app-started agents already run`,
          textAuthor: 'app',
          dedupeKey: `tasks:agent_cap:${caller.sessionId}`,
        });
      }
      throw new TaskStartError('at_cap', `${cap} app-started agents already run; wait for one to end`);
    }
    // A session below a swarm agent keeps counting up, so a hop through task_start does not reset the depth.
    const callerDepth = this.spawnContext(caller.sessionId)?.depth ?? store.depthOf(caller.sessionId);
    return { sessionTitle: callerSession?.title ?? 'unknown', mode, spawnDepth: callerDepth > 0 ? callerDepth + 1 : 0 };
  }

  private async plan(source: TaskSource, input: TaskStartInput): Promise<Plan> {
    const { reader, directories } = this.deps;
    if (source.kind === 'pull-request') {
      const pr = await reader.read(source);
      let found: { repoPath: string; remote: string } | undefined;
      if (input.repoPath === undefined) {
        found = await directories.findRepository(source.owner, source.repo);
      } else {
        const root = await directories.repositoryRoot(input.repoPath);
        const remote = await directories.remoteOf(root, source.owner, source.repo);
        found = remote === undefined ? undefined : { repoPath: root, remote };
      }
      if (found === undefined) {
        throw new TaskStartError('no_repository', `no local repository with a remote for ${source.owner}/${source.repo}; choose its path`);
      }
      return { source, pr, title: cleanLine(`PR #${pr.number} ${pr.title}`).slice(0, TITLE_CAP), repoRoot: found.repoPath, remote: found.remote };
    }
    const title = cleanLine(sourceTitle(source)) || 'New task';
    if (input.repoPath === undefined) return { source, title, remote: 'origin' };
    return { source, title, repoRoot: await directories.repositoryRoot(input.repoPath), remote: 'origin' };
  }

  private async link(folderId: string, sessionId: string, source: TaskSource, plan: Plan): Promise<void> {
    const { commands, browser } = this.deps;
    const url = sourceUrl(source, plan.pr);
    const scope = { kind: 'mcp', sessionId, folderId } as const;
    try {
      const created = await commands.invoke('task_create', { title: plan.title.slice(0, 200), folderId, linkNodeId: folderId, ...(url === undefined ? {} : { externalUrl: url }) }, scope);
      if (created.ok) await commands.invoke('task_update', { taskId: (created.value as { id: string }).id, state: 'in_progress' }, scope);
    } catch (error) {
      console.warn('task start: the task row was not created:', error);
    }
    if (url !== undefined) {
      try {
        await browser.openTab({ folderId, url, createdBy: 'user' });
      } catch (error) {
        console.warn('task start: the browser tab was not opened:', error instanceof CommandError ? error.message : error);
      }
    }
  }
}

function refOf(source: TaskSource, title: string): string {
  switch (source.kind) {
    case 'pull-request':
      return `${source.owner}/${source.repo}#${source.number}`;
    case 'jira':
      return source.key;
    case 'prompt':
      return title;
  }
}

function sourceUrl(source: TaskSource, pr: PullRequestInfo | undefined): string | undefined {
  if (source.kind === 'pull-request') return pr?.url ?? `https://github.com/${source.owner}/${source.repo}/pull/${source.number}`;
  if (source.kind === 'jira' && source.site !== undefined) return `https://${source.site}/browse/${source.key}`;
  return undefined;
}
