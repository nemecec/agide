import { join } from 'node:path';
import { resolveAgentSettings } from '../../core/agents/index';
import type { Caller } from '../../core/commands/types';
import type { InboxService } from '../../core/inbox/index';
import type { PermissionService } from '../../core/permissions/index';
import { profilePaths, type ProfileService } from '../../core/profile/index';
import { profileLaunchSpec, type LaunchContributors, type SessionEvent, type SessionService, type StreamSpawners } from '../../core/session/index';
import {
  InMemoryAgentRuntime,
  registerSwarmCommands,
  resolveSwarmSettings,
  SwarmError,
  type AgentRuntime,
  type SwarmCommandHandlers,
  type SwarmService,
} from '../../core/swarm/index';
import { StreamAgentRuntime } from '../../core/swarm/runtime/StreamAgentRuntime';
import { assertUser, swarmCallerOf, resultsForCaller, statusForCaller } from '../../core/swarm/manager/callerView';
import { countOtherLive } from '../../core/swarm/manager/liveCount';
import { PersistentSwarmManager } from '../../core/swarm/manager/PersistentSwarmManager';
import { SwarmStore } from '../../core/swarm/manager/SwarmStore';
import { TreeFolders } from '../../core/swarm/manager/TreeFolders';
import { Git } from '../../core/swarm/workspace/git';
import { SwarmWorkspaces } from '../../core/swarm/workspace/SwarmWorkspaces';
import { taskBaseDir, TaskStartStore, type TasksService } from '../../core/tasks/index';
import type { NodeId, TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';
import type { AgentsRuntime } from './agents';

/** The manager the module builds, with the steps the swarm pane's "Remove swarm…" dialog calls. */
export interface SwarmModuleService extends SwarmService {
  readonly manager: PersistentSwarmManager;
}

/**
 * Swarm module (0037, 0038). Builds the persistent manager over the `swarm` tables, the runtime, the worktree
 * workspaces, the inbox and the agents controller, registers the `swarm_*` command handlers, puts manager events
 * on the app bus and gives agents their leaves in the swarm's folder.
 *
 * `AGIDE_SWARM_RUNTIME=fake` runs agents on the in-memory runtime instead of `claude -p` processes; the
 * end-to-end tests use it.
 */
export function init(
  ctx: ModuleContext,
  deps: {
    tree: TreeService;
    sessions: SessionService;
    profile: ProfileService;
    permissions: PermissionService;
    inbox: InboxService;
    agents: AgentsRuntime;
    tasks: TasksService;
    launch: LaunchContributors;
    streams: StreamSpawners;
  },
): ModuleHandle<SwarmModuleService> {
  const { tree, sessions, profile, inbox, agents, tasks } = deps;
  const appRoot = ctx.profile?.root ?? ctx.dataDir;
  const paths = profilePaths(appRoot, profile.id);
  const launchEnv = (): NodeJS.ProcessEnv => profileLaunchSpec(profile.settings(), paths, process.env).env;
  const settings = () => resolveSwarmSettings(profile.settings().swarm);
  const cleanups: (() => void)[] = [];

  let runtime: AgentRuntime & { dispose(): Promise<void> };
  if (process.env['AGIDE_SWARM_RUNTIME'] === 'fake') {
    runtime = new InMemoryAgentRuntime();
  } else {
    const real = new StreamAgentRuntime({ sessions });
    cleanups.push(deps.launch.register(real.contributor), deps.streams.set(real));
    runtime = real;
  }

  const workspaces = new SwarmWorkspaces({
    git: new Git(undefined, launchEnv),
    dataRoot: join(ctx.dataDir, 'swarms'),
    agentRoot: join(taskBaseDir(), 'swarms'),
    worktreeBase: join(taskBaseDir(), 'worktrees'),
    appRoot,
  });
  const taskStarts = new TaskStartStore(ctx.db);
  const leaves = new Map<string, NodeId>();
  /** The leaf of an agent's session: remembered, or found in the tree after an app restart. */
  const leafOf = (sessionId: string): NodeId | undefined => {
    const known = leaves.get(sessionId);
    if (known !== undefined) return known;
    const found = tree.list().find((node) => node.kind === 'leaf' && node.surfaceType === 'claude-session' && node.surfaceId === sessionId);
    if (found !== undefined) leaves.set(sessionId, found.id);
    return found?.id;
  };

  const manager = new PersistentSwarmManager({
    runtime,
    store: new SwarmStore(ctx.db),
    inbox,
    workspaces,
    folders: new TreeFolders(tree),
    cap: () => resolveAgentSettings(profile.settings().agents).maxConcurrentAppStarted,
    // Other app-started processes and the live sessions agents started with task_start share the cap.
    otherLive: () =>
      countOtherLive({
        appStarted: agents.store.list({ states: ['running', 'waiting'] }).map((record) => ({ sessionId: record.ref.sessionId, origin: record.origin })),
        isSwarmAgent: (sessionId) => manager.agentOf(sessionId) !== undefined,
        taskStartSessions: taskStarts.agentSessionIds(),
        statusOf: (sessionId) => sessions.get(sessionId)?.status,
      }),
    settings,
    knownRepositories: () => taskStarts.repositories(),
    sessionTitle: (sessionId) => sessions.get(sessionId)?.title,
    leafOf,
    onAnswered: (sessionId, requestId, decision) => agents.controller.streamResponse(sessionId, requestId, decision),
    onStarted: ({ swarmId, folderId, agent, sessionId }) => {
      // The ledger holds what the agent's earlier processes reported, also across an app restart.
      const priorCostUsd = manager.status(swarmId, { kind: 'ui' }).agents.find((candidate) => candidate.name === agent)?.spend.reportedUsd;
      agents.controller.trackAppStarted(sessionId, { description: agent, ...(priorCostUsd === undefined ? {} : { priorCostUsd }) });
      if (folderId === null || leafOf(sessionId) !== undefined || sessions.get(sessionId) === undefined) return;
      leaves.set(sessionId, tree.createLeaf({ title: agent, parentId: folderId, surfaceType: 'claude-session', surfaceId: sessionId }).id);
    },
  });

  // task_start from a swarm agent hands the agent's depth on, so the depth limit holds across a hop through it.
  tasks.setSpawnContext((sessionId) => manager.agentOf(sessionId));

  cleanups.push(
    runtime.subscribe((event) => {
      if (event.type === 'message') agents.controller.streamMessage(event.sessionId, event.raw);
      else if (event.type === 'exited') agents.controller.streamExited(event.sessionId, { stopped: event.byApp });
    }),
    manager.subscribe((event) => ctx.events.emit(event)),
    sessions.subscribe((event: SessionEvent) => {
      if (event.type === 'session.closed') void manager.sessionClosed(event.sessionId);
    }),
  );

  const facts = {
    depth: (sessionId: string) => manager.agentOf(sessionId)?.depth ?? taskStarts.depthOf(sessionId),
    permissionMode: (sessionId: string) => sessions.get(sessionId)?.permissionMode ?? 'default',
    swarmAgent: (sessionId: string) => {
      const found = manager.agentOf(sessionId);
      return found === undefined ? undefined : { swarmId: found.swarmId, mayStartSwarms: found.mayStartSwarms };
    },
  } as const;
  const as = (caller: Caller) => swarmCallerOf(caller, facts);
  const done = { ok: true } as const;

  const handlers: SwarmCommandHandlers = {
    swarm_start: ({ definition, parentFolderId, bypass }, caller) =>
      manager.start({ definition, ...(parentFolderId === undefined ? {} : { parentFolderId }), ...(bypass === undefined ? {} : { bypass }) }, as(caller)),
    swarm_list: ({ states, limit }, caller) => ({ swarms: manager.list({ ...(states === undefined ? {} : { states }), limit }, as(caller)) }),
    swarm_status: ({ swarmId }, caller) => statusForCaller(manager.status(swarmId, as(caller)), caller),
    swarm_send: async ({ swarmId, agent, message, now }, caller) => {
      await manager.send(swarmId, { ...(agent === undefined ? {} : { agent }), ...(message === undefined ? {} : { message }), now }, as(caller));
      return done;
    },
    swarm_interrupt: async ({ swarmId, agent }, caller) => {
      await manager.interrupt(swarmId, agent === undefined ? {} : { agent }, as(caller));
      return done;
    },
    swarm_stop: async ({ swarmId, agent }, caller) => {
      await manager.stop(swarmId, agent === undefined ? {} : { agent }, as(caller));
      return done;
    },
    swarm_results: async ({ swarmId, agent, patch }, caller) => {
      const swarmCaller = as(caller);
      const results = await manager.results(swarmId, { ...(agent === undefined ? {} : { agent }), patch }, swarmCaller);
      const own = swarmCaller.kind === 'session' && manager.status(swarmId, swarmCaller).callerSessionId === swarmCaller.sessionId;
      return { swarmId, agents: resultsForCaller(results.agents, caller, own) };
    },
    swarm_approval_answer: ({ swarmId, agent, requestId, decision }, caller) => {
      assertUser(caller, 'agents never answer approvals');
      manager.answerApproval(swarmId, agent, requestId, decision);
      return done;
    },
  };
  cleanups.push(...registerSwarmCommands(ctx.commands, handlers));

  return {
    service: { manager },
    dispose: async () => {
      await manager.shutdown();
      for (const off of cleanups) off();
      await runtime.dispose();
    },
  };
}
