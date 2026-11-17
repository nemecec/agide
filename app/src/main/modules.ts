import type { ModuleContext, ModuleHandle, Services } from './context';
import * as mcpModule from './modules/mcp';
import * as sessionModule from './modules/session';
import * as treeModule from './modules/tree';

export interface InitializedModules {
  readonly services: Services;
  dispose(): Promise<void>;
}

/** Initializes the modules in dependency order. Each module file is owned by one builder. */
export async function initModules(ctx: ModuleContext): Promise<InitializedModules> {
  const handles: ModuleHandle<unknown>[] = [];
  const keep = <S>(handle: ModuleHandle<S>): S => {
    handles.push(handle);
    return handle.service;
  };

  const tree = keep(treeModule.init(ctx));
  const mcp = keep(await mcpModule.init(ctx, { tree }));
  const sessions = keep(await sessionModule.init(ctx, { tree, mcp }));
  await mcp.start();

  return {
    services: { tree, mcp, sessions },
    dispose: async () => {
      for (const handle of handles.reverse()) await handle.dispose?.();
    },
  };
}
