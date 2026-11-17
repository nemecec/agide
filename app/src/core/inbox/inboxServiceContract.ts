import { describe, expect, it, vi } from 'vitest';
import type { TreeService } from '../tree/types';
import { InboxError, type InboxService, type NewItem } from './types';

export interface InboxHarness {
  readonly inbox: InboxService;
  /** The tree the inbox scopes by; a SQLite inbox gets the SQLite tree on the same database. */
  readonly tree: TreeService;
}

const codeOf = (work: () => unknown): string | undefined => {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof InboxError ? error.code : `not an InboxError: ${String(error)}`;
  }
};

/**
 * Behaviour every `InboxService` must show. `create(now)` returns an empty inbox and its tree; the inbox
 * reads the time from `now`, which the tests move forward.
 */
export function describeInboxServiceContract(name: string, create: (now: () => Date) => InboxHarness): void {
  describe(`${name} (InboxService contract)`, () => {
    let time = Date.parse('2026-11-17T12:00:00.000Z');
    const now = (): Date => new Date(time);
    const later = (ms: number): void => {
      time += ms;
    };
    const setup = (): InboxHarness => {
      time = Date.parse('2026-11-17T12:00:00.000Z');
      return create(now);
    };
    const item = (folderId: string | null, extra: Partial<NewItem> = {}): NewItem => ({
      folderId,
      kind: 'status',
      source: 'agent',
      origin: 'mcp:inbox_post',
      message: 'Turn finished',
      textAuthor: 'agent',
      ...extra,
    });

    it('creates a new item and counts it as unread unless its urgency is low', () => {
      const { inbox, tree } = setup();
      const folder = tree.createFolder({ title: 'P' });
      const { item: created, coalesced } = inbox.post(item(folder.id));
      inbox.post(item(folder.id, { urgency: 'low' }));
      expect(coalesced, 'a first post does not coalesce').toBe(false);
      expect(created.state, 'new item').toBe('new');
      expect(created.occurrences, 'one occurrence').toBe(1);
      expect(inbox.get(created.id)?.message, 'stored message').toBe('Turn finished');
      expect(inbox.unreadCount(), 'normal counts, low does not').toBe(1);
    });

    it('cleans control characters, escape sequences and bidi overrides from the text', () => {
      const { inbox } = setup();
      const { item: created } = inbox.post(
        item(null, { message: 'Build \u001b[31mfailed\u001b[0m\nnow ‮evil', details: 'line one\nline\u0007 two⁦' }),
      );
      expect(created.message, 'one clean line').toBe('Build failed now evil');
      expect(created.details, 'line breaks kept, controls removed').toBe('line one\nline two');
    });

    it('refuses a message that is empty or too long after cleaning, and stores nothing', () => {
      const { inbox } = setup();
      expect(codeOf(() => inbox.post(item(null, { message: '\u001b[0m' }))), 'only an escape sequence').toBe('invalid');
      expect(codeOf(() => inbox.post(item(null, { message: 'x'.repeat(141) }))), '141 characters').toBe('invalid');
      expect(codeOf(() => inbox.post(item('no-such-folder'))), 'unknown folder').toBe('invalid');
      expect(inbox.list(), 'nothing stored').toEqual([]);
    });

    it('coalesces a repeat into the open item with the same key and returns it to new', () => {
      const { inbox } = setup();
      const first = inbox.post(item(null, { dedupeKey: 'stop:s1', message: 'First' })).item;
      inbox.markSeen(first.id);
      later(1000);
      const repeat = inbox.post(item(null, { dedupeKey: 'stop:s1', message: 'Second' }));
      expect(repeat.coalesced, 'repeat coalesces').toBe(true);
      expect(repeat.item.id, 'same item').toBe(first.id);
      expect(repeat.item.state, 'back to new').toBe('new');
      expect(repeat.item.occurrences, 'occurrences raised').toBe(2);
      expect(repeat.item.message, 'text updated').toBe('Second');
      expect(repeat.item.updatedAt > first.updatedAt, 'updatedAt moved').toBe(true);
    });

    it('frees a dedupe key once its item is done', () => {
      const { inbox } = setup();
      const first = inbox.post(item(null, { dedupeKey: 'k' })).item;
      inbox.resolve(first.id, 'dismissed');
      const second = inbox.post(item(null, { dedupeKey: 'k' }));
      expect(second.coalesced, 'a done item does not take repeats').toBe(false);
      expect(second.item.id, 'a new item').not.toBe(first.id);
    });

    it('clears the key of a reopened item, so it never clashes with the open item that holds it', () => {
      const { inbox } = setup();
      const first = inbox.post(item(null, { dedupeKey: 'k' })).item;
      inbox.resolve(first.id, 'dismissed');
      const second = inbox.post(item(null, { dedupeKey: 'k' })).item;
      const reopened = inbox.reopen(first.id);
      expect(reopened.state, 'reopened to seen').toBe('seen');
      expect(reopened.dedupeKey, 'key cleared').toBeUndefined();
      expect(inbox.post(item(null, { dedupeKey: 'k' })).item.id, 'repeats still go to the open holder').toBe(second.id);
    });

    it('moves through seen, unread, snoozed and done, and wakes a snoozed item when its time passes', () => {
      const { inbox } = setup();
      const { id } = inbox.post(item(null)).item;
      expect(inbox.markSeen(id).state, 'seen').toBe('seen');
      expect(inbox.unreadCount(), 'seen is not unread').toBe(0);
      expect(inbox.markUnread(id).state, 'unread again').toBe('new');
      const snoozed = inbox.snooze(id, new Date(time + 60_000).toISOString());
      expect(snoozed.state, 'snoozed').toBe('snoozed');
      expect(inbox.wakeDue(), 'nothing due yet').toEqual([]);
      later(60_000);
      expect(inbox.wakeDue().map((woken) => woken.id), 'woken at its time').toEqual([id]);
      expect(inbox.get(id)?.snoozedUntil, 'snooze time cleared').toBeUndefined();
      const done = inbox.resolve(id, 'dismissed');
      expect([done.state, done.resolution], 'done with resolution').toEqual(['done', 'dismissed']);
      expect(done.doneAt, 'done time set').toBeDefined();
    });

    it('refuses transitions the state machine does not have and leaves the item unchanged', () => {
      const { inbox } = setup();
      const { id } = inbox.post(item(null)).item;
      expect(codeOf(() => inbox.reopen(id)), 'reopen an open item').toBe('invalid_transition');
      inbox.resolve(id, 'viewed');
      const before = inbox.get(id);
      expect(codeOf(() => inbox.resolve(id, 'dismissed')), 'resolve twice').toBe('invalid_transition');
      expect(codeOf(() => inbox.snooze(id, new Date(time + 1000).toISOString())), 'snooze a done item').toBe('invalid_transition');
      expect(codeOf(() => inbox.markSeen(id)), 'mark a done item seen').toBe('invalid_transition');
      expect(codeOf(() => inbox.markSeen('missing')), 'unknown id').toBe('not_found');
      expect(inbox.get(id), 'item unchanged').toEqual(before);
    });

    it('scopes a folder query to the folder and its descendants, top-level items to the unscoped view', () => {
      const { inbox, tree } = setup();
      const project = tree.createFolder({ title: 'Project' });
      const sub = tree.createFolder({ title: 'Sub', parentId: project.id });
      const other = tree.createFolder({ title: 'Other' });
      const inSub = inbox.post(item(sub.id)).item;
      const inOther = inbox.post(item(other.id)).item;
      const top = inbox.post(item(null)).item;
      expect(inbox.list({ folderId: project.id }).map((i) => i.id), 'project subtree').toEqual([inSub.id]);
      expect(inbox.list({ folderId: null }).map((i) => i.id), 'top level only').toEqual([top.id]);
      expect(new Set(inbox.list().map((i) => i.id)), 'unscoped view has all').toEqual(new Set([inSub.id, inOther.id, top.id]));
    });

    it('orders by urgency, then newest first, and filters by state, kind and urgency', () => {
      const { inbox } = setup();
      const old = inbox.post(item(null, { kind: 'approval' })).item;
      later(1000);
      const newer = inbox.post(item(null)).item;
      later(1000);
      const low = inbox.post(item(null, { urgency: 'low' })).item;
      const high = inbox.post(item(null, { urgency: 'high', kind: 'failure', source: 'app', textAuthor: 'app' })).item;
      expect(inbox.list().map((i) => i.id), 'urgency then time').toEqual([high.id, newer.id, old.id, low.id]);
      expect(inbox.list({ kinds: ['approval'] }).map((i) => i.id), 'kind filter').toEqual([old.id]);
      expect(inbox.list({ minUrgency: 'normal' }).map((i) => i.id), 'urgency filter').toEqual([high.id, newer.id, old.id]);
      inbox.resolve(newer.id, 'viewed');
      expect(inbox.list({ states: ['done'] }).map((i) => i.id), 'state filter').toEqual([newer.id]);
      expect(inbox.list({ limit: 1 }).map((i) => i.id), 'limit').toEqual([high.id]);
    });

    it('moves the items of a removed folder to the top level and marks them', () => {
      const { inbox, tree } = setup();
      const project = tree.createFolder({ title: 'Project' });
      const sub = tree.createFolder({ title: 'Sub', parentId: project.id });
      const approval = inbox.post(item(sub.id, { kind: 'approval' })).item;
      tree.remove(project.id);
      const moved = inbox.get(approval.id);
      expect(moved?.folderId, 'moved to the top level').toBeNull();
      expect(moved?.folderRemoved, 'marked as from a removed folder').toBe(true);
      expect(moved?.state, 'still open').toBe('new');
    });

    it('moves the open items of a session with it and leaves done items in place', () => {
      const { inbox, tree } = setup();
      const from = tree.createFolder({ title: 'From' });
      const to = tree.createFolder({ title: 'To' });
      const open = inbox.post(item(from.id, { sessionId: 's1' })).item;
      const done = inbox.post(item(from.id, { sessionId: 's1' })).item;
      const otherSession = inbox.post(item(from.id, { sessionId: 's2' })).item;
      inbox.resolve(done.id, 'viewed');
      expect(inbox.moveSessionItems('s1', to.id).map((i) => i.id), 'moved items').toEqual([open.id]);
      expect(inbox.get(open.id)?.folderId, 'open item moved').toBe(to.id);
      expect(inbox.get(done.id)?.folderId, 'done item stays').toBe(from.id);
      expect(inbox.get(otherSession.id)?.folderId, 'other session stays').toBe(from.id);
    });

    it('resolves a session\'s open items of the given kinds and origins only', () => {
      const { inbox } = setup();
      const status = inbox.post(item(null, { sessionId: 's1', source: 'hook', origin: 'hook:Stop', textAuthor: 'agent' })).item;
      const ask = inbox.post(item(null, { sessionId: 's1', kind: 'input', origin: 'mcp:inbox_ask' })).item;
      const idle = inbox.post(item(null, { sessionId: 's1', kind: 'input', source: 'hook', origin: 'hook:Notification:idle_prompt', textAuthor: 'app' })).item;
      const other = inbox.post(item(null, { sessionId: 's2' })).item;
      const resolved = inbox.resolveSessionItems('s1', ['status', 'input'], 'viewed', ['hook:Stop', 'hook:Notification:idle_prompt']);
      expect(new Set(resolved.map((i) => i.id)), 'hook-made status and input items').toEqual(new Set([status.id, idle.id]));
      expect(inbox.get(ask.id)?.state, 'an inbox_ask item needs an answer').toBe('new');
      expect(inbox.get(other.id)?.state, 'another session is untouched').toBe('new');
    });

    it('resolves the open item that holds a dedupe key', () => {
      const { inbox } = setup();
      const approval = inbox.post(item(null, { kind: 'approval', dedupeKey: 'perm:s1:abc' })).item;
      expect(inbox.resolveByDedupeKey('perm:s1:abc', 'superseded')?.id, 'resolved item').toBe(approval.id);
      expect(inbox.resolveByDedupeKey('perm:s1:abc', 'superseded'), 'no open holder left').toBeUndefined();
    });

    it('emits item changes and the unread count when it changes', () => {
      const { inbox } = setup();
      const listener = vi.fn();
      inbox.subscribe(listener);
      const { id } = inbox.post(item(null)).item;
      inbox.markSeen(id);
      const events = listener.mock.calls.map(([event]) => event as { type: string; change?: string; count?: number });
      expect(events.map((e) => e.type === 'inbox.unread_changed' ? `unread ${e.count}` : e.change), 'event sequence').toEqual([
        'created',
        'unread 1',
        'updated',
        'unread 0',
      ]);
    });
  });
}
