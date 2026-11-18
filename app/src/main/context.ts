import type { AgentsService } from '../core/agents/index';
import type { LayoutService } from '../core/blocks/index';
import type { BrowserService } from '../core/browser/index';
import type { CommandRegistry } from '../core/commands/index';
import type { AppEventBus } from '../core/events/index';
import type { InboxService } from '../core/inbox/index';
import type { AppMcpServer } from '../core/mcp/index';
import type { PermissionService } from '../core/permissions/index';
import type { ProfileService, ResolvedProfile } from '../core/profile/index';
import type { SessionService } from '../core/session/index';
import type { Database } from '../core/store/index';
import type { TasksService } from '../core/tasks/index';
import type { TreeService } from '../core/tree/index';
import type { BrowserViews } from './browser/views';

/** What every main-process module receives. */
export interface ModuleContext {
  readonly events: AppEventBus;
  readonly commands: CommandRegistry;
  readonly db: Database;
  /** Directory for the module's own files (Electron `userData`, the profile's data directory). */
  readonly dataDir: string;
  /**
   * The profile resolved before `ready`. Absent in tests and until profile resolution exists: the profile
   * module then runs one in-memory `default` profile on `dataDir`.
   */
  readonly profile?: ResolvedProfile;
  /** Notifications and the dock badge. Absent in tests that run without Electron. */
  readonly desktop?: Desktop;
  /** Browser views of `browser-tab` leaves (0026). Absent in tests that run without Electron. */
  readonly browserViews?: BrowserViews;
}

export interface DesktopNotification {
  /** Profile name and project name (0021 section 10). */
  readonly title: string;
  /** One line of plain text. */
  readonly body: string;
  /** Runs after the window was focused. */
  readonly onClick?: () => void;
}

/** The Electron parts modules use, behind an interface so modules stay testable in plain Node. */
export interface Desktop {
  notify(notification: DesktopNotification): void;
  setBadgeCount(count: number): void;
}

/** Services the modules provide, in init order (0029): profile, tree, mcp, permissions, session, layout, inbox, browser, agents, tasks. */
export interface Services {
  readonly profile: ProfileService;
  readonly tree: TreeService;
  readonly mcp: AppMcpServer;
  readonly permissions: PermissionService;
  readonly sessions: SessionService;
  readonly layout: LayoutService;
  readonly inbox: InboxService;
  readonly browser: BrowserService;
  readonly agents: AgentsService;
  readonly tasks: TasksService;
}

export interface ModuleHandle<S> {
  readonly service: S;
  /** Called on app quit, in reverse init order. */
  dispose?(): void | Promise<void>;
}
