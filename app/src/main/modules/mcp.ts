import { registerBuiltinCommands } from '../../core/commands/index';
import { HttpAppMcpServer, type AppMcpServer } from '../../core/mcp/index';
import type { TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';

/**
 * App MCP server module. Registers the commands that need only the tree, then listens on a random port of
 * 127.0.0.1 before the session module starts, so sessions can be granted access during their own init.
 */
export async function init(ctx: ModuleContext, deps: { tree: TreeService }): Promise<ModuleHandle<AppMcpServer>> {
  registerBuiltinCommands(ctx.commands, { tree: deps.tree, events: ctx.events });
  const server = new HttpAppMcpServer(ctx.commands);
  await server.start();
  return { service: server, dispose: () => server.stop() };
}
