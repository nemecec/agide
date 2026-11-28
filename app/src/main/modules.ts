import { LaunchContributors, StreamSpawners } from '../core/session/index';
import type { ModuleContext, ModuleHandle, Services } from './context';
import * as accessModule from './modules/access';
import * as agentsModule from './modules/agents';
import * as askModule from './modules/ask';
import * as browserModule from './modules/browser';
import * as hooksModule from './modules/hooks';
import * as inboxModule from './modules/inbox';
import * as layoutModule from './modules/layout';
import * as mcpModule from './modules/mcp';
import * as permissionsModule from './modules/permissions';
import * as profileModule from './modules/profile';
import * as reviewModule from './modules/review';
import * as sessionModule from './modules/session';
import * as swarmModule from './modules/swarm';
import * as themeModule from './modules/theme';
import * as tasksModule from './modules/tasks';
import * as treeModule from './modules/tree';

export interface InitializedModules {
  readonly services: Services;
  dispose(): Promise<void>;
}

/**
 * Initializes the modules in dependency order (0029). Each module file is owned by one builder.
 *
 * - hooks comes after mcp and before session (0043): it is the hook endpoint the app's listener carries. This file passes
 *   the endpoint in the deps of the session, inbox and ask modules, so that each builder edits only its own module file:
 *   w-hooks uses it in the session module, w-approvals in the inbox module, w-ask registers its `UserPromptSubmit`
 *   contributor on it in the ask module. Until w-hooks lands no session posts to it.
 * - permissions comes before session: the session module asks it for the mode, the network policy and the
 *   launch rules of every launch.
 * - The session module starts the MCP listener during its own init, because it needs the port to grant sessions.
 * - inbox comes after session because it maps session hooks to items, and its tables refer to the tree's.
 * - ask and access come right after inbox (0043): their items are inbox items, and their delivery planner is shared. The
 *   planner is created before them from the session service. The owners of notes and mounts (0044) register their
 *   access actions on the broker later.
 * - browser, agents and tasks come after inbox: they post inbox items and read sessions. They add to session
 *   launches through `launch`, which the session service reads before every spawn, so registering after the
 *   session module is in time for every launch. tasks comes after browser because it opens browser tabs.
 * - swarm comes last (0038): it posts inbox items, counts app-started agents through agents, and sets the
 *   stream-json runtime into `streams`, the spawner slot the session service reads at each stream-json launch.
 *   No stream-json session launches during init.
 * - review comes after swarm (0041): it reads the swarm manager for callers, captures and the merge gate, runs
 *   reviewers on the swarm's runtime and posts inbox items. Its tables refer to `swarms`, so the swarm tables
 *   exist first. Dispose runs in reverse, so reviewer runs and checks end before the swarm runtime.
 */
export async function initModules(ctx: ModuleContext): Promise<InitializedModules> {
  const handles: ModuleHandle<unknown>[] = [];
  const keep = <S>(handle: ModuleHandle<S>): S => {
    handles.push(handle);
    return handle.service;
  };
  const launch = new LaunchContributors();
  const streams = new StreamSpawners();

  const profile = keep(await profileModule.init(ctx));
  const tree = keep(treeModule.init(ctx));
  const mcp = keep(await mcpModule.init(ctx, { tree }));
  const hooks = keep(hooksModule.init(ctx, { mcp, profile }));
  const permissions = keep(permissionsModule.init(ctx, { profile, launch }));
  const sessions = keep(await sessionModule.init(ctx, { tree, mcp, hooks, profile, permissions, launch, streams }));
  const layout = keep(await layoutModule.init(ctx, { tree }));
  const theme = keep(themeModule.init(ctx));
  const inbox = keep(await inboxModule.init(ctx, { tree, sessions, hooks, profile }));
  const delivery = askModule.createNoticeDelivery(sessions);
  const ask = keep(askModule.init(ctx, { inbox, sessions, mcp, hooks, delivery }));
  const access = keep(accessModule.init(ctx, { inbox, sessions, profile, delivery }));
  const browser = keep(browserModule.init(ctx, { tree, mcp, sessions, profile, permissions, inbox, launch }));
  const agents = keep(agentsModule.init(ctx, { tree, sessions, inbox, profile, launch }));
  const tasks = keep(tasksModule.init(ctx, { tree, sessions, profile, permissions, inbox, browser, launch, agents }));
  const swarm = keep(swarmModule.init(ctx, { tree, sessions, profile, permissions, inbox, agents, tasks, launch, streams, mcp }));
  const review = keep(reviewModule.init(ctx, { tree, sessions, profile, inbox, mcp, swarm }));
  await mcp.start();

  return {
    services: { profile, tree, mcp, hooks, permissions, sessions, layout, theme, inbox, delivery, ask, access, browser, agents, tasks, swarm, review },
    dispose: async () => {
      for (const handle of handles.reverse()) await handle.dispose?.();
    },
  };
}
