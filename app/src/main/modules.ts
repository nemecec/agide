import type { ModuleContext, ModuleHandle, Services } from './context';
import * as inboxModule from './modules/inbox';
import * as layoutModule from './modules/layout';
import * as mcpModule from './modules/mcp';
import * as profileModule from './modules/profile';
import * as sessionModule from './modules/session';
import * as treeModule from './modules/tree';

export interface InitializedModules {
  readonly services: Services;
  dispose(): Promise<void>;
}

/**
 * Initializes the modules in dependency order. Each module file is owned by one builder.
 * The inbox comes after the session module because it maps session hooks to items, and its tables refer to
 * the tree's. The session module starts the MCP listener during its own init, because it needs the port to grant sessions.
 */
export async function initModules(ctx: ModuleContext): Promise<InitializedModules> {
  const handles: ModuleHandle<unknown>[] = [];
  const keep = <S>(handle: ModuleHandle<S>): S => {
    handles.push(handle);
    return handle.service;
  };

  const profile = keep(await profileModule.init(ctx));
  const tree = keep(treeModule.init(ctx));
  const mcp = keep(await mcpModule.init(ctx, { tree }));
  const sessions = keep(await sessionModule.init(ctx, { tree, mcp, profile }));
  const layout = keep(await layoutModule.init(ctx, { tree }));
  const inbox = keep(await inboxModule.init(ctx, { tree, sessions, profile }));
  await mcp.start();

  return {
    services: { profile, tree, mcp, sessions, layout, inbox },
    dispose: async () => {
      for (const handle of handles.reverse()) await handle.dispose?.();
    },
  };
}
