import type { CommandRegistry } from './CommandRegistry';
import { registerSurfaceCommands } from './surfaceCommands';
import { registerTreeCommands, type TreeCommandDeps } from './treeCommands';

/** The commands that need only the tree and the event bus. Other modules register their own. */
export function registerBuiltinCommands(registry: CommandRegistry, deps: TreeCommandDeps): void {
  registerTreeCommands(registry, deps);
  registerSurfaceCommands(registry, deps.tree);
}
