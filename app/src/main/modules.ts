import { LaunchContributors } from '../core/session/index';
import type { ModuleContext, ModuleHandle, Services } from './context';
import * as agentsModule from './modules/agents';
import * as browserModule from './modules/browser';
import * as inboxModule from './modules/inbox';
import * as layoutModule from './modules/layout';
import * as mcpModule from './modules/mcp';
import * as permissionsModule from './modules/permissions';
import * as profileModule from './modules/profile';
import * as sessionModule from './modules/session';
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
 * - permissions comes before session: the session module asks it for the mode, the network policy and the
 *   launch rules of every launch.
 * - The session module starts the MCP listener during its own init, because it needs the port to grant sessions.
 * - inbox comes after session because it maps session hooks to items, and its tables refer to the tree's.
 * - browser, agents and tasks come after inbox: they post inbox items and read sessions. They add to session
 *   launches through `launch`, which the session service reads before every spawn, so registering after the
 *   session module is in time for every launch. tasks comes last because it opens browser tabs.
 */
export async function initModules(ctx: ModuleContext): Promise<InitializedModules> {
  const handles: ModuleHandle<unknown>[] = [];
  const keep = <S>(handle: ModuleHandle<S>): S => {
    handles.push(handle);
    return handle.service;
  };
  const launch = new LaunchContributors();

  const profile = keep(await profileModule.init(ctx));
  const tree = keep(treeModule.init(ctx));
  const mcp = keep(await mcpModule.init(ctx, { tree }));
  const permissions = keep(permissionsModule.init(ctx, { profile, launch }));
  const sessions = keep(await sessionModule.init(ctx, { tree, mcp, profile, permissions, launch }));
  const layout = keep(await layoutModule.init(ctx, { tree }));
  const theme = keep(themeModule.init(ctx));
  const inbox = keep(await inboxModule.init(ctx, { tree, sessions, profile }));
  const browser = keep(browserModule.init(ctx, { tree, mcp, sessions, profile, permissions, inbox, launch }));
  const agents = keep(agentsModule.init(ctx, { tree, sessions, inbox, profile, launch }));
  const tasks = keep(tasksModule.init(ctx, { tree, sessions, profile, permissions, inbox, browser, launch }));
  await mcp.start();

  return {
    services: { profile, tree, mcp, permissions, sessions, layout, theme, inbox, browser, agents, tasks },
    dispose: async () => {
      for (const handle of handles.reverse()) await handle.dispose?.();
    },
  };
}
