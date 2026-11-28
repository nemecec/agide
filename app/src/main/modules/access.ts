import { InMemoryAccessBroker, registerAccessCommands, resolveAccessSettings, type AccessBroker } from '../../core/access/index';
import type { NoticeDelivery } from '../../core/inbox/index';
import type { InboxService } from '../../core/inbox/index';
import type { ProfileService } from '../../core/profile/index';
import type { SessionService } from '../../core/session/index';
import type { ModuleContext, ModuleHandle } from '../context';

export interface AccessDeps {
  readonly inbox: InboxService;
  readonly sessions: SessionService;
  readonly profile: ProfileService;
  readonly delivery: NoticeDelivery;
}

/** The broker behind a factory: w-access replaces the in-memory broker with the SQLite one. */
export function createAccessBroker(deps: AccessDeps): AccessBroker & { sessionEnded(sessionId: string): void; dispose(): void } {
  const { inbox, sessions, profile, delivery } = deps;
  return new InMemoryAccessBroker({
    inbox,
    delivery,
    settings: () => resolveAccessSettings(profile.settings().access),
    sessionTitle: (sessionId) => sessions.get(sessionId)?.title,
    isLive: (sessionId) => {
      const status = sessions.get(sessionId)?.status;
      return status !== undefined && status !== 'exited';
    },
  });
}

/**
 * Access module (0043 section 4.10). Owner: w-access. It follows `inbox`, whose items announce the requests. The
 * owners of notes and mounts (0044) register their actions on the broker; the commands answer `not_built` until
 * w-access fills them.
 */
export function init(ctx: ModuleContext, deps: AccessDeps): ModuleHandle<AccessBroker> {
  const broker = createAccessBroker(deps);
  const unsubscribers = [
    broker.subscribe((record) =>
      ctx.events.emit({ type: 'access.request_changed', requestId: record.requestId, state: record.state, callState: record.callState, delivery: record.delivery }),
    ),
    broker.subscribeGrants((sessionId) => ctx.events.emit({ type: 'access.grants_changed', sessionId })),
    deps.sessions.subscribe((event) => {
      if (event.type === 'session.exited') broker.sessionEnded(event.session.id);
      else if (event.type === 'session.closed') broker.sessionEnded(event.sessionId);
    }),
    registerAccessCommands(ctx.commands),
  ];
  return {
    service: broker,
    dispose: () => {
      for (const off of unsubscribers) off();
      broker.dispose();
    },
  };
}
