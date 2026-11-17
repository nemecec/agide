import { statSync } from 'node:fs';
import {
  HookItemMapper,
  InboxNotifier,
  ItemContext,
  registerInboxCommands,
  registerTaskCommands,
  Scheduler,
  SqliteInboxService,
  SqliteTaskStore,
  ViewTracker,
  type InboxService,
} from '../../core/inbox/index';
import type { ProfileService } from '../../core/profile/index';
import type { SessionService } from '../../core/session/index';
import type { TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';

const SESSION_SURFACE = 'claude-session';

function transcriptSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

/**
 * Inbox module. Owner: w-inbox.
 * The SQLite item store and the task store, the hook mapping from `session.hook` events, the `inbox_*`, `task_*`
 * and `reminder_*` commands, the notifier and the scheduler. The unread count reaches the profile registry and the
 * dock badge through `inbox.unread_changed` on the bus; the profile module owns both.
 */
export async function init(
  ctx: ModuleContext,
  deps: { tree: TreeService; sessions: SessionService; profile: ProfileService },
): Promise<ModuleHandle<InboxService>> {
  const { tree, sessions, profile } = deps;
  const inbox = new SqliteInboxService(ctx.db, tree);
  const tasks = new SqliteTaskStore(ctx.db, tree);
  const context = new ItemContext(ctx.db, tree, sessions);
  const views = new ViewTracker(inbox);
  const now = () => new Date();

  const notifier = new InboxNotifier({
    sink: { notify: (notification) => ctx.desktop?.notify(notification) },
    now,
    titleFor: (item) => `${profile.definition().name} - ${context.projectName(item) ?? 'Agide'}`,
  });
  const mapper = new HookItemMapper({
    inbox,
    tree,
    sessions,
    now,
    isInView: (sessionId) => views.isInView(sessionId),
    notifyNow: (item) => notifier.notifyNow(item),
    transcriptSize,
  });
  const scheduler = new Scheduler({
    db: ctx.db,
    store: tasks,
    inbox,
    tree,
    now,
    timers: {
      setTimeout: (work, ms) => {
        const handle = setTimeout(work, ms);
        handle.unref();
        return handle;
      },
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
    onWake: (items) => items.forEach((item) => notifier.notifyNow(item)),
    onError: (error) => console.error('scheduler:', error),
  });

  const unsubscribers = [
    inbox.subscribe((event) => {
      ctx.events.emit(event);
      if (event.type === 'inbox.unread_changed') return;
      notifier.onEvent(event);
      if (event.item.sessionId !== undefined && views.isInView(event.item.sessionId)) views.refresh();
    }),
    sessions.subscribe((event) => {
      if (event.type === 'session.hook') mapper.handle(event.sessionId, event.hookEvent, event.payload);
      else if (event.type === 'session.closed') mapper.forget(event.sessionId);
    }),
    tree.subscribe((event) => {
      if (event.type !== 'tree.node_moved') return;
      const node = event.node;
      if (node.kind === 'leaf' && node.surfaceType === SESSION_SURFACE) inbox.moveSessionItems(node.surfaceId, node.parentId);
    }),
  ];

  const unregister = [
    registerInboxCommands(ctx.commands, { inbox, tree, context, views }),
    registerTaskCommands(ctx.commands, { tasks, tree, onScheduleChanged: () => scheduler.tick() }),
  ];

  ctx.events.emit({ type: 'inbox.unread_changed', count: inbox.unreadCount() });
  scheduler.start();

  return {
    service: inbox,
    dispose: () => {
      scheduler.stop();
      views.dispose();
      for (const off of [...unregister, ...unsubscribers]) off();
      inbox.dispose();
    },
  };
}

