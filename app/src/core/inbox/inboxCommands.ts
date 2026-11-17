import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { requireInScope } from '../commands/scope';
import { CommandError, type Caller } from '../commands/types';
import type { ItemContext } from './ItemContext';
import { messageFrom } from './itemText';
import { httpUrl } from './urlSchema';
import type { ItemRow } from './viewTypes';
import type { ViewTracker } from './ViewTracker';
import { InboxError, ITEM_KINDS, ITEM_STATES, URGENCIES, type InboxItem, type InboxService, type Resolution } from './types';
import type { TreeService } from '../tree/types';

export interface InboxCommandDeps {
  readonly inbox: InboxService;
  readonly tree: TreeService;
  readonly context: ItemContext;
  readonly views: ViewTracker;
  readonly now?: () => Date;
}

/** `inbox_post` rate of 0021 section 8: this many posts per session in the window, then they coalesce. */
export const POST_LIMIT = 10;
export const POST_WINDOW_MS = 10 * 60_000;
const RESOLUTIONS = ['answered', 'approved', 'denied', 'dismissed', 'viewed', 'superseded', 'expired', 'acted'] as const;
/** What an agent can resolve an item with. */
const AGENT_RESOLUTIONS = ['superseded', 'dismissed'] as const;

const link = z
  .object({
    nodeId: z.string().max(64).optional().describe('A node in your own folder that the item points at'),
    url: httpUrl.optional().describe('Shown to the user as text with an explicit Open action'),
  })
  .strict();

const postInput = z
  .object({
    message: z.string().min(1).max(140).describe('One line the user reads in the list and the notification'),
    details: z.string().max(8000).optional().describe('The longer description; plain text, shown on demand'),
    kind: z.enum(['status', 'failure', 'review']).default('status'),
    urgency: z.enum(URGENCIES).default('normal').describe('high is lowered to normal'),
    link: link.optional(),
    dedupeKey: z.string().regex(/^[a-z0-9_.-]{1,64}$/).optional().describe('A repeat with the same key updates the open item'),
  })
  .strict();

const itemRef = z.object({ itemId: z.string().min(1) }).strict();

function fail(error: unknown): never {
  if (error instanceof InboxError) throw new CommandError(error.code === 'not_found' ? 'not_found' : error.code === 'invalid' ? 'invalid_input' : 'failed', error.message);
  throw error;
}

function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    return fail(error);
  }
}

/** Registers the `inbox_*` commands. `inbox_post`, `inbox_list` and `inbox_resolve` are agent tools. */
export function registerInboxCommands(registry: CommandRegistry, deps: InboxCommandDeps): () => void {
  const { inbox, tree, context, views } = deps;
  const now = deps.now ?? (() => new Date());
  const posted = new Map<string, number[]>();

  const row = (item: InboxItem): ItemRow => {
    const info = context.forItem(item);
    return { ...item, ...(info.project ? { projectName: info.project.name } : {}), ...(info.session ? { sessionName: info.session.name } : {}) };
  };
  const requireVisible = (caller: Caller, itemId: string): InboxItem => {
    const item = inbox.get(itemId);
    if (!item) throw new CommandError('not_found', `no inbox item ${itemId}`);
    if (caller.kind === 'mcp') requireInScope(tree, caller, item.folderId);
    return item;
  };
  const underLimit = (sessionId: string): boolean => {
    const cutoff = now().getTime() - POST_WINDOW_MS;
    const recent = (posted.get(sessionId) ?? []).filter((time) => time > cutoff);
    posted.set(sessionId, recent);
    if (recent.length >= POST_LIMIT) return false;
    recent.push(now().getTime());
    return true;
  };

  const off = [
    registry.register({
      id: 'inbox_post',
      title: 'Post to the inbox',
      description:
        'Posts a non-blocking update to the user\'s inbox: a one-line message and an optional longer description. Use it for progress the user would want to see when they come back, not for questions you need answered now. The item belongs to your folder and session. Returns the item id; coalesced is true when a repeat updated an open item.',
      input: postInput,
      ui: false,
      mcp: true,
      run: (input, { caller }) => {
        if (caller.kind !== 'mcp') throw new CommandError('invalid_input', 'inbox_post is for agent sessions; the user posts reminders with reminder_create');
        if (input.link?.nodeId !== undefined) requireInScope(tree, caller, input.link.nodeId);
        const base = {
          folderId: caller.folderId,
          source: 'agent' as const,
          origin: 'mcp:inbox_post',
          sessionId: caller.sessionId,
          textAuthor: 'agent' as const,
        };
        if (!underLimit(caller.sessionId)) {
          const result = guarded(() =>
            inbox.post({
              ...base,
              kind: 'status',
              urgency: 'low',
              message: 'More updates from this session',
              details: input.details === undefined ? input.message : `${input.message}\n\n${input.details}`.slice(0, 8000),
              dedupeKey: `more:${caller.sessionId}`,
            }),
          );
          return { itemId: result.item.id, coalesced: true };
        }
        const result = guarded(() =>
          inbox.post({
            ...base,
            kind: input.kind,
            urgency: input.urgency === 'high' ? 'normal' : input.urgency,
            message: input.message,
            ...(input.details === undefined ? {} : { details: input.details }),
            ...(input.link?.nodeId === undefined ? {} : { linkNodeId: input.link.nodeId }),
            ...(input.link?.url === undefined ? {} : { linkAnchor: { url: input.link.url } }),
            ...(input.dedupeKey === undefined ? {} : { dedupeKey: `agent:${caller.sessionId}:${input.dedupeKey}` }),
          }),
        );
        return { itemId: result.item.id, coalesced: result.coalesced };
      },
    }),
    registry.register({
      id: 'inbox_list',
      title: 'List inbox items',
      description:
        'Lists inbox items, newest first within urgency, with the project and session names. An agent sees the items of its own folder and below; the user sees all. Returns items and the unread count.',
      input: z
        .object({
          states: z.array(z.enum(ITEM_STATES)).optional().describe('Default: new, seen and snoozed'),
          kinds: z.array(z.enum(ITEM_KINDS)).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict(),
      ui: false,
      mcp: true,
      run: (input, { caller }) => ({
        items: inbox
          .list({
            ...(caller.kind === 'mcp' ? { folderId: caller.folderId } : {}),
            states: input.states ?? ['new', 'seen', 'snoozed'],
            ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
            limit: input.limit,
          })
          .map(row),
        unread: inbox.unreadCount(),
      }),
    }),
    registry.register({
      id: 'inbox_resolve',
      title: 'Resolve an inbox item',
      description:
        'Marks an inbox item done. An agent can resolve only the items it posted itself, for example when an update no longer applies; the resolution is superseded or dismissed.',
      input: z
        .object({ itemId: z.string().min(1), resolution: z.enum(RESOLUTIONS).default('dismissed') })
        .strict(),
      ui: false,
      mcp: true,
      run: ({ itemId, resolution }, { caller }) => {
        const item = requireVisible(caller, itemId);
        if (caller.kind === 'mcp') {
          if (item.origin !== 'mcp:inbox_post' || item.sessionId !== caller.sessionId) {
            throw new CommandError('out_of_scope', 'you can resolve only the items you posted in this session');
          }
          if (!(AGENT_RESOLUTIONS as readonly string[]).includes(resolution)) {
            throw new CommandError('invalid_input', `an agent resolves with ${AGENT_RESOLUTIONS.join(' or ')}`);
          }
        }
        return guarded(() => row(inbox.resolve(itemId, resolution as Resolution)));
      },
    }),
    registry.register({
      id: 'inbox_mark_seen',
      title: 'Mark inbox item seen',
      description: 'Marks an item as read.',
      input: itemRef,
      ui: false,
      mcp: false,
      run: ({ itemId }) => guarded(() => row(inbox.markSeen(itemId))),
    }),
    registry.register({
      id: 'inbox_mark_unread',
      title: 'Mark inbox item unread',
      description: 'Marks an item as unread.',
      input: itemRef,
      ui: false,
      mcp: false,
      run: ({ itemId }) => guarded(() => row(inbox.markUnread(itemId))),
    }),
    registry.register({
      id: 'inbox_snooze',
      title: 'Snooze inbox item',
      description: 'Hides an item until the time, then returns it as new.',
      input: z.object({ itemId: z.string().min(1), until: z.string().min(1) }).strict(),
      ui: false,
      mcp: false,
      run: ({ itemId, until }) => guarded(() => row(inbox.snooze(itemId, until))),
    }),
    registry.register({
      id: 'inbox_reopen',
      title: 'Reopen inbox item',
      description: 'Returns a done item to seen.',
      input: itemRef,
      ui: false,
      mcp: false,
      run: ({ itemId }) => guarded(() => row(inbox.reopen(itemId))),
    }),
    registry.register({
      id: 'inbox_context',
      title: 'Inbox item context',
      description: 'The project and session layers of an item: names, summaries and the summary generation time.',
      input: itemRef,
      ui: false,
      mcp: false,
      run: ({ itemId }) => {
        const item = inbox.get(itemId);
        if (!item) throw new CommandError('not_found', `no inbox item ${itemId}`);
        return context.forItem(item);
      },
    }),
    registry.register({
      id: 'inbox_set_viewing',
      title: 'Report the session in view',
      description: 'Tells the inbox which session the user looks at, or none. A session in view for two seconds resolves its status items.',
      input: z.object({ sessionId: z.string().min(1).optional() }).strict(),
      ui: false,
      mcp: false,
      run: ({ sessionId }) => {
        views.set(sessionId);
        return { viewing: sessionId ?? null };
      },
    }),
    registry.register({
      id: 'inbox_set_project_summary',
      title: 'Set project summary',
      description: 'Sets or clears the summary of a project folder. A folder with a summary counts as a project.',
      input: z.object({ folderId: z.string().min(1), summary: z.string().max(2000).nullable() }).strict(),
      ui: false,
      mcp: false,
      run: ({ folderId, summary }) => {
        try {
          context.setProjectSummary(folderId, summary === null ? null : messageFrom(summary, 2000));
        } catch (error) {
          throw new CommandError('invalid_input', error instanceof Error ? error.message : String(error));
        }
        return { updated: true };
      },
    }),
    registry.register({
      id: 'inbox_set_session_summary',
      title: 'Set session summary',
      description: 'Stores the summary of a session with its generation time. The generator of the small model calls this.',
      input: z.object({ sessionId: z.string().min(1), summary: z.string().min(1).max(400), model: z.string().max(80).optional() }).strict(),
      ui: false,
      mcp: false,
      run: ({ sessionId, summary, model }) => {
        context.setSessionSummary(sessionId, summary, model);
        return { updated: true };
      },
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
