import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { BrowserService } from '../../core/browser/index';
import { CommandError } from '../../core/commands/index';
import type { InboxService } from '../../core/inbox/index';
import type { PermissionService } from '../../core/permissions/index';
import { profilePaths, type ProfileService } from '../../core/profile/index';
import { profileLaunchSpec, type LaunchContributors, type SessionEvent, type SessionService } from '../../core/session/index';
import {
  claudeJsonPath,
  GhPullRequestReader,
  GitWorkingDirectoryManager,
  isFolderTrusted,
  parseTaskSource,
  taskBaseDir,
  TaskStartError,
  TaskStartService,
  TaskStartStore,
  taskStartInputSchema,
  TrustAutomation,
  type TasksService,
  type TrustState,
} from '../../core/tasks/index';
import { previewTaskStart } from '../../core/tasks/preview';
import type { TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';

const TRUST_ITEM_MESSAGE = 'Claude asks whether to trust this folder; answer in the terminal';

/**
 * Task start module (0028 Part 2). Owner: w-tasks.
 * The `task_starts` table, `task_start` and the commands the new-task dialog uses, the working directory
 * manager, the pull request reader over `gh`, the source directory as a launch contribution (`--add-dir`), the
 * folder-trust handling on session output, and the 0021 task link.
 */
export function init(
  ctx: ModuleContext,
  deps: {
    tree: TreeService;
    sessions: SessionService;
    profile: ProfileService;
    permissions: PermissionService;
    inbox: InboxService;
    browser: BrowserService;
    launch: LaunchContributors;
  },
): ModuleHandle<TasksService> {
  const { tree, sessions, profile, permissions, inbox } = deps;
  const appRoot = ctx.profile?.root ?? ctx.dataDir;
  const paths = profilePaths(appRoot, profile.id);
  const launchEnv = (): NodeJS.ProcessEnv => profileLaunchSpec(profile.settings(), paths, process.env).env;
  const store = new TaskStartStore(ctx.db);
  const baseDir = taskBaseDir();
  const directories = new GitWorkingDirectoryManager({ baseDir, appRoot, env: launchEnv, knownRepositories: () => store.repositories() });
  const sourceDir = (folderId: string): string => join(baseDir, 'sources', folderId);
  const starter = new TaskStartService({
    tree,
    sessions,
    commands: ctx.commands,
    inbox,
    browser: deps.browser,
    reader: new GhPullRequestReader({ env: launchEnv }),
    directories,
    store,
    sourceDir,
    emit: (event) => ctx.events.emit(event),
  });

  const trustStates = new Map<string, TrustState>();
  const setTrustState = (sessionId: string, state: TrustState): void => {
    if (state === 'none') trustStates.delete(sessionId);
    else trustStates.set(sessionId, state);
    ctx.events.emit({ type: 'tasks.trust_changed', sessionId, state });
    const session = sessions.get(sessionId);
    if (state === 'user_input' || state === 'needs_user') {
      if (session !== undefined && tree.get(session.folderId)) {
        inbox.post({
          folderId: session.folderId,
          kind: 'input',
          urgency: 'high',
          source: 'app',
          origin: 'tasks:trust',
          sessionId,
          message: TRUST_ITEM_MESSAGE,
          textAuthor: 'app',
          dedupeKey: `tasks:trust:${sessionId}`,
        });
      }
    } else {
      inbox.resolveByDedupeKey(`tasks:trust:${sessionId}`, 'answered');
    }
  };
  const trust = new TrustAutomation({
    write: (sessionId, data) => sessions.write(sessionId, data),
    setTimer: (work, ms) => setTimeout(work, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    onState: setTrustState,
  });

  const onSessionEvent = (event: SessionEvent): void => {
    switch (event.type) {
      case 'session.created':
        watch(event.session.id, event.session.cwd, event.session.launchPath);
        break;
      case 'session.status_changed':
        if (event.session.status === 'starting') watch(event.session.id, event.session.cwd, event.session.launchPath);
        break;
      case 'session.output':
        trust.output(event.sessionId, event.data);
        break;
      case 'session.hook':
        if (event.hookEvent === 'SessionStart') trust.started(event.sessionId);
        break;
      case 'session.exited':
        trust.ended(event.session.id);
        break;
      case 'session.closed':
        trust.ended(event.sessionId);
        break;
    }
  };
  const watch = (sessionId: string, cwd: string, launchPath: string): void => {
    if (launchPath !== 'pty') return;
    if (isFolderTrusted(cwd, claudeJsonPath(launchEnv()))) return;
    trust.watch(sessionId, { answer: permissions.settings().trustAppCreatedFolders && directories.createdByApp(cwd) });
  };
  const unsubscribe = sessions.subscribe(onSessionEvent);

  const unregisterLaunch = deps.launch.register({
    id: 'tasks',
    contribute: ({ session, toEnv }) => {
      const dir = sourceDir(session.folderId);
      return existsSync(join(dir, 'task-source.md')) ? { args: ['--add-dir', toEnv(dir)] } : {};
    },
  });

  const fail = (error: unknown): never => {
    if (error instanceof TaskStartError) throw new CommandError(error.code === 'not_allowed' || error.code === 'at_cap' ? 'invalid_input' : 'failed', error.message, { code: error.code });
    throw error;
  };

  const unregister = [
    ctx.commands.register({
      id: 'task_start',
      title: 'Start a task',
      description:
        'Starts a Claude session for a task in a new folder. The source is a prompt, a GitHub pull request (a github.com URL or owner/repo#n) or a Jira key or URL. With repoPath the session runs in a new git worktree of that repository, which must be one the user already used in a task start. An agent starts the session in a mode no looser than its own; the user approves the call. Returns the folder, session and leaf ids, and the worktree path and branch when there is one.',
      input: taskStartInputSchema,
      ui: { menu: 'tree-node', accelerator: 'CmdOrCtrl+Shift+N' },
      mcp: true,
      run: async (input, { caller }) => {
        try {
          return await starter.start(input, caller);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    ctx.commands.register({
      id: 'task_repositories',
      title: 'Repositories of earlier task starts',
      description: 'Lists the repositories earlier task starts used, newest first.',
      input: z.object({}).strict(),
      ui: false,
      mcp: false,
      run: () => ({ repositories: store.repositories() }),
    }),
    ctx.commands.register({
      id: 'task_preview',
      title: 'Preview a task start',
      description: 'Shows the commands a start would run and the first prompt it would type, without running anything.',
      input: z.object({ source: z.string().trim().min(1).max(20_000), instruction: z.string().max(4_000).optional(), repoPath: z.string().min(1).optional(), base: z.string().min(1).max(200).optional() }).strict(),
      ui: false,
      mcp: false,
      run: async (input) => {
        const source = parseTaskSource(input.source);
        let repoPath = input.repoPath;
        let remote: string | undefined;
        if (repoPath === undefined && source.kind === 'pull-request') {
          const found = await directories.findRepository(source.owner, source.repo);
          repoPath = found?.repoPath;
          remote = found?.remote;
        }
        return previewTaskStart({
          source: input.source,
          ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
          ...(repoPath === undefined ? {} : { repoPath }),
          ...(input.base === undefined ? {} : { base: input.base }),
          ...(remote === undefined ? {} : { remote }),
          worktreeDir: join(baseDir, 'worktrees', '<repository>-<folder id>'),
        });
      },
    }),
    ctx.commands.register({
      id: 'task_trust_state',
      title: 'Folder-trust state of sessions',
      description: 'Lists the sessions that wait for the folder-trust question to be answered.',
      input: z.object({}).strict(),
      ui: false,
      mcp: false,
      run: () => ({ states: Object.fromEntries(trustStates) }),
    }),
  ];

  return {
    service: { starter, directories },
    dispose: () => {
      for (const off of [...unregister, unsubscribe, unregisterLaunch]) off();
      trust.dispose();
    },
  };
}
