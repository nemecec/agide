import { SqliteTreeService, registerSurfaceTypeCommands, type TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';

/**
 * Tree module: the SQLite tree in the app database and its events on the bus. The `ui_*` node commands
 * come from `registerBuiltinCommands` in the mcp module; this module adds the surface type listing.
 */
export function init(ctx: ModuleContext): ModuleHandle<TreeService> {
  const tree = new SqliteTreeService(ctx.db);
  const unsubscribe = tree.subscribe((event) => ctx.events.emit(event));
  const unregister = registerSurfaceTypeCommands(ctx.commands);
  return {
    service: tree,
    dispose: () => {
      unregister();
      unsubscribe();
    },
  };
}
