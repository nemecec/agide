import type { AccessBroker } from '../core/access/index';
import type { AgentsService } from '../core/agents/index';
import type { LayoutService } from '../core/blocks/index';
import type { BrowserService } from '../core/browser/index';
import type { CommandRegistry } from '../core/commands/index';
import type { AppEventBus } from '../core/events/index';
import type { HookEndpoint } from '../core/hooks/index';
import type { AskService, InboxService, NoticeDelivery } from '../core/inbox/index';
import type { AppMcpServer } from '../core/mcp/index';
import type { PermissionService } from '../core/permissions/index';
import type { ProfileService, ResolvedProfile } from '../core/profile/index';
import type { SessionService } from '../core/session/index';
import type { Database } from '../core/store/index';
import type { SwarmService } from '../core/swarm/index';
import type { TasksService } from '../core/tasks/index';
import type { ThemeService } from '../core/theme/service';
import type { TreeService } from '../core/tree/index';
import type { BrowserViews } from './browser/views';
import type { ReviewModuleService } from './modules/review';

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
  /** The app's logs and crash dump directories, which sandboxed programs of the app may not read. Absent in tests. */
  readonly protectedReadDirs?: readonly string[];
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
  /** Called when the Mac wakes from sleep (Electron `powerMonitor` `resume`); the inbox ticks its scheduler on it (0043 section 4.6). Absent until w-inbox-ui builds it. */
  onResume?(listener: () => void): () => void;
}

/**
 * Services the modules provide, in init order (0029, 0038, 0041, 0043): profile, tree, mcp, hooks, permissions, session,
 * layout, theme, inbox, ask, access, browser, agents, tasks, swarm, review. `delivery` is shared by `ask` and `access`.
 */
export interface Services {
  readonly profile: ProfileService;
  readonly tree: TreeService;
  readonly mcp: AppMcpServer;
  readonly hooks: HookEndpoint;
  readonly permissions: PermissionService;
  readonly sessions: SessionService;
  readonly layout: LayoutService;
  readonly theme: ThemeService;
  readonly inbox: InboxService;
  readonly delivery: NoticeDelivery;
  readonly ask: AskService;
  readonly access: AccessBroker;
  readonly browser: BrowserService;
  readonly agents: AgentsService;
  readonly tasks: TasksService;
  readonly swarm: SwarmService;
  readonly review: ReviewModuleService;
}

export interface ModuleHandle<S> {
  readonly service: S;
  /** Called on app quit, in reverse init order. */
  dispose?(): void | Promise<void>;
}
