import type { CommandRegistry } from '../core/commands/index';
import type { AppEventBus } from '../core/events/index';
import type { AppMcpServer } from '../core/mcp/index';
import type { SessionService } from '../core/session/index';
import type { Database } from '../core/store/index';
import type { TreeService } from '../core/tree/index';

/** What every main-process module receives. */
export interface ModuleContext {
  readonly events: AppEventBus;
  readonly commands: CommandRegistry;
  readonly db: Database;
  /** Directory for the module's own files (Electron `userData`). */
  readonly dataDir: string;
}

/** Services the modules provide, in init order: tree, then mcp, then session. */
export interface Services {
  readonly tree: TreeService;
  readonly mcp: AppMcpServer;
  readonly sessions: SessionService;
}

export interface ModuleHandle<S> {
  readonly service: S;
  /** Called on app quit, in reverse init order. */
  dispose?(): void | Promise<void>;
}
