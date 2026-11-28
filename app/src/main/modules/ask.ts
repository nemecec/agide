import {
  InMemoryAskService,
  InMemoryNoticeDelivery,
  registerAskCommands,
  type AskService,
  type InboxService,
  type NoticeDelivery,
} from '../../core/inbox/index';
import type { HookEndpoint, HookReplyContributor } from '../../core/hooks/index';
import type { AppMcpServer } from '../../core/mcp/index';
import type { SessionService } from '../../core/session/index';
import type { ModuleContext, ModuleHandle } from '../context';

/** The planner that announces answers and decisions to sessions, behind a factory: w-ask replaces the in-memory planner. Asks and access requests share it. */
export function createNoticeDelivery(sessions: SessionService): NoticeDelivery {
  return new InMemoryNoticeDelivery({
    state: (sessionId) => {
      const info = sessions.get(sessionId);
      return info === undefined ? undefined : { status: info.status, launchPath: info.launchPath };
    },
    typeLine: (sessionId, line) => sessions.sendText(sessionId, line),
    writeUserMessage: (sessionId, line) => sessions.sendText(sessionId, line),
  });
}

/** The ask service behind a factory: w-ask replaces the in-memory service with the SQLite one. */
export function createAskService(deps: { inbox: InboxService; delivery: NoticeDelivery }): AskService & { dispose(): void } {
  return new InMemoryAskService({ inbox: deps.inbox, delivery: deps.delivery });
}

/** The `UserPromptSubmit` contributor of the planner: the context lines of the notices queued for the session of the prompt. */
export function createNoticeContributor(delivery: NoticeDelivery): HookReplyContributor {
  return {
    id: 'inbox-notices',
    events: ['UserPromptSubmit'],
    reply: (request) => {
      const taken = delivery.takeContext(request.sessionId);
      if (taken.length === 0) return undefined;
      return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: taken.map((notice) => notice.contextLine).join('\n') } };
    },
  };
}

/**
 * Ask module (0043 section 4.4). Owner: w-ask, which owns this whole file. It follows `inbox` and `hooks`. It registers the notice contributor on the hook endpoint
 * from its deps, so no other module file changes, and registers `inbox_ask`, `inbox_ask_result` and `inbox_answer`, which
 * answer `not_built` until w-ask fills them. A tool call of a session that exited is aborted
 * on the MCP server, so an ask that waits for an answer closes.
 */
export function init(ctx: ModuleContext, deps: { inbox: InboxService; sessions: SessionService; mcp: AppMcpServer; hooks: HookEndpoint; delivery: NoticeDelivery }): ModuleHandle<AskService> {
  const ask = createAskService(deps);
  const unsubscribers = [
    deps.sessions.subscribe((event) => {
      if (event.type === 'session.exited' || event.type === 'session.closed') {
        const sessionId = event.type === 'session.exited' ? event.session.id : event.sessionId;
        ask.sessionEnded(sessionId);
        deps.mcp.abortCalls(sessionId);
      } else if (event.type === 'session.status_changed' && event.session.status === 'idle') {
        ask.deliverPending(event.session.id);
      }
    }),
    deps.hooks.addContributor(createNoticeContributor(deps.delivery)),
    ask.subscribe((event) => ctx.events.emit(event)),
    registerAskCommands(ctx.commands),
  ];
  return {
    service: ask,
    dispose: () => {
      for (const off of unsubscribers) off();
      ask.dispose();
    },
  };
}
