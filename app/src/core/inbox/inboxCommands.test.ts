import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry } from '../commands/CommandRegistry';
import { inputJsonSchema } from '../commands/jsonSchema';
import type { Caller, CommandResult } from '../commands/types';
import { openStore } from '../store/index';
import { SqliteTreeService } from '../tree/SqliteTreeService';
import { ItemContext } from './ItemContext';
import { POST_LIMIT, registerInboxCommands } from './inboxCommands';
import type { ItemRow } from './viewTypes';
import { SqliteInboxService } from './SqliteInboxService';
import { SqliteTaskStore } from './SqliteTaskStore';
import { AGENT_SCHEDULE_LIMIT, registerTaskCommands } from './taskCommands';
import { ViewTracker } from './ViewTracker';

const ui: Caller = { kind: 'ui' };
let time: number;
let registry: CommandRegistry;
let tree: SqliteTreeService;
let inbox: SqliteInboxService;
let folderA: string;
let folderB: string;
let agentA: Caller;
let agentA2: Caller;

const call = async <T = unknown>(id: string, input: unknown, caller: Caller): Promise<CommandResult<T>> => (await registry.invoke(id, input, caller)) as CommandResult<T>;
const ok = <T>(result: CommandResult<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const errorOf = (result: CommandResult): string => (result.ok ? 'ok' : result.error.code);

beforeEach(() => {
  time = Date.parse('2026-11-17T12:00:00Z');
  const db = openStore(':memory:');
  tree = new SqliteTreeService(db);
  inbox = new SqliteInboxService(db, tree, { now: () => new Date(time) });
  const sessions = { get: (id: string) => (id === 'sa' ? ({ id, title: 'Session A', status: 'idle' } as never) : undefined) };
  const context = new ItemContext(db, tree, sessions, () => new Date(time));
  registry = new CommandRegistry();
  registerInboxCommands(registry, { inbox, tree, context, views: new ViewTracker(inbox), now: () => new Date(time) });
  registerTaskCommands(registry, { tasks: new SqliteTaskStore(db, tree, { now: () => new Date(time), defaultZone: 'Europe/Tallinn' }), tree });
  folderA = tree.createFolder({ title: 'A' }).id;
  folderB = tree.createFolder({ title: 'B' }).id;
  agentA = { kind: 'mcp', sessionId: 'sa', folderId: folderA };
  agentA2 = { kind: 'mcp', sessionId: 'sa2', folderId: folderA };
});

describe('tool schemas', () => {
  const tools = (): Map<string, ReturnType<typeof inputJsonSchema>> => new Map(registry.list({ mcp: true }).map((command) => [command.id, inputJsonSchema(command)]));

  it('exposes inbox_post, inbox_list and inbox_resolve as tools and keeps the user-only commands off the tool list', () => {
    const names = [...tools().keys()];
    expect(names, 'agent tools').toEqual(expect.arrayContaining(['inbox_post', 'inbox_list', 'inbox_resolve']));
    for (const hidden of ['inbox_mark_seen', 'inbox_snooze', 'inbox_set_viewing', 'inbox_set_project_summary', 'inbox_set_session_summary']) {
      expect(names, `${hidden} is not a tool`).not.toContain(hidden);
    }
  });

  it('describes inbox_post with the message limit and the closed kind list', () => {
    const schema = tools().get('inbox_post') as { required?: string[]; properties: Record<string, { maxLength?: number; enum?: string[]; default?: unknown }>; additionalProperties?: boolean };
    expect(schema.required, 'only the message is required').toEqual(['message']);
    expect(schema.properties['message']?.maxLength, 'message limit').toBe(140);
    expect(schema.properties['kind']?.enum, 'kinds an agent may post').toEqual(['status', 'failure', 'review']);
    expect(schema.additionalProperties, 'unknown fields are refused').toBe(false);
  });
});

describe('inbox_post', () => {
  it('creates an item in the caller\'s folder and session, whatever the input says', async () => {
    const result = ok<{ itemId: string; coalesced: boolean }>(await call('inbox_post', { message: 'Build done', details: 'all green' }, agentA));
    const item = inbox.get(result.itemId);
    expect([item?.folderId, item?.sessionId, item?.source, item?.origin, item?.textAuthor], 'scope from the grant').toEqual([folderA, 'sa', 'agent', 'mcp:inbox_post', 'agent']);
    expect(await call('inbox_post', { message: 'x', folderId: folderB }, agentA).then(errorOf), 'a folder in the input is refused').toBe('invalid_input');
  });

  it('refuses a message over 140 characters, an empty message and an unknown kind', async () => {
    expect(errorOf(await call('inbox_post', { message: 'x'.repeat(141) }, agentA)), 'too long').toBe('invalid_input');
    expect(errorOf(await call('inbox_post', { message: '' }, agentA)), 'empty').toBe('invalid_input');
    expect(errorOf(await call('inbox_post', { message: 'm', kind: 'approval' }, agentA)), 'approval is not postable').toBe('invalid_input');
    expect(inbox.list(), 'nothing stored').toEqual([]);
  });

  it('lowers high urgency to normal', async () => {
    const { itemId } = ok<{ itemId: string }>(await call('inbox_post', { message: 'm', urgency: 'high' }, agentA));
    expect(inbox.get(itemId)?.urgency, 'normal').toBe('normal');
  });

  it('checks link.nodeId against the caller\'s folder and stores a URL as an anchor', async () => {
    const outside = tree.createLeaf({ title: 'x', parentId: folderB, surfaceType: 'browser-tab', surfaceId: 'b' }).id;
    const inside = tree.createLeaf({ title: 'y', parentId: folderA, surfaceType: 'browser-tab', surfaceId: 'c' }).id;
    expect(errorOf(await call('inbox_post', { message: 'm', link: { nodeId: outside } }, agentA)), 'outside node').toBe('out_of_scope');
    const { itemId } = ok<{ itemId: string }>(await call('inbox_post', { message: 'm', link: { nodeId: inside, url: 'https://example.org/pr/1' } }, agentA));
    expect([inbox.get(itemId)?.linkNodeId, inbox.get(itemId)?.linkAnchor], 'link stored').toEqual([inside, { url: 'https://example.org/pr/1' }]);
    expect(errorOf(await call('inbox_post', { message: 'm', link: { url: 'javascript:alert(1)' } }, agentA)), 'not a URL').toBe('invalid_input');
  });

  it('prefixes the dedupe key with the session so sessions cannot coalesce into each other', async () => {
    const first = ok<{ itemId: string }>(await call('inbox_post', { message: 'one', dedupeKey: 'build' }, agentA));
    const repeat = ok<{ itemId: string; coalesced: boolean }>(await call('inbox_post', { message: 'two', dedupeKey: 'build' }, agentA));
    const other = ok<{ itemId: string; coalesced: boolean }>(await call('inbox_post', { message: 'three', dedupeKey: 'build' }, agentA2));
    expect([repeat.itemId, repeat.coalesced], 'same session coalesces').toEqual([first.itemId, true]);
    expect(other.coalesced, 'another session does not').toBe(false);
    expect(await call('inbox_post', { message: 'm', dedupeKey: 'Bad Key!' }, agentA).then(errorOf), 'key format').toBe('invalid_input');
  });

  it('coalesces posts beyond the session limit into one low-urgency more-updates item', async () => {
    for (let i = 0; i < POST_LIMIT; i++) ok(await call('inbox_post', { message: `update ${i}` }, agentA));
    const over = ok<{ itemId: string; coalesced: boolean }>(await call('inbox_post', { message: 'eleventh' }, agentA));
    const again = ok<{ itemId: string; coalesced: boolean }>(await call('inbox_post', { message: 'twelfth' }, agentA));
    expect(over.coalesced, 'coalesced').toBe(true);
    expect(again.itemId, 'one more-updates item').toBe(over.itemId);
    expect(inbox.get(over.itemId)?.urgency, 'low urgency').toBe('low');
    expect(inbox.list({ sessionId: 'sa' }), 'limit plus one item').toHaveLength(POST_LIMIT + 1);
    time += 11 * 60_000;
    expect(ok<{ coalesced: boolean }>(await call('inbox_post', { message: 'later' }, agentA)).coalesced, 'the window passes').toBe(false);
  });

  it('is refused for the user, who has no session', async () => {
    expect(errorOf(await call('inbox_post', { message: 'm' }, ui)), 'ui caller').toBe('invalid_input');
  });
});

describe('inbox_list and inbox_resolve', () => {
  it('lists an agent only the items of its folder subtree, and the user everything, with names and unread count', async () => {
    tree.createFolder({ title: 'Sub', parentId: folderA });
    ok(await call('inbox_post', { message: 'mine' }, agentA));
    inbox.post({ folderId: folderB, kind: 'status', source: 'app', origin: 'x', message: 'other', textAuthor: 'app' });
    const mine = ok<{ items: ItemRow[]; unread: number }>(await call('inbox_list', {}, agentA));
    expect(mine.items.map((i) => i.message), 'agent scope').toEqual(['mine']);
    expect(mine.items[0]?.projectName, 'project name of the folder').toBe('A');
    expect(mine.items[0]?.sessionName, 'session name').toBe('Session A');
    expect(mine.unread, 'unread count').toBe(2);
    expect(ok<{ items: unknown[] }>(await call('inbox_list', {}, ui)).items, 'user sees both').toHaveLength(2);
  });

  it('hides done items by default and shows them with a state filter', async () => {
    const { itemId } = ok<{ itemId: string }>(await call('inbox_post', { message: 'm' }, agentA));
    ok(await call('inbox_resolve', { itemId, resolution: 'superseded' }, agentA));
    expect(ok<{ items: unknown[] }>(await call('inbox_list', {}, ui)).items, 'default hides done').toEqual([]);
    expect(ok<{ items: unknown[] }>(await call('inbox_list', { states: ['done'] }, ui)).items, 'done filter').toHaveLength(1);
  });

  it('lets an agent resolve only its own posted items, with superseded or dismissed', async () => {
    const mine = ok<{ itemId: string }>(await call('inbox_post', { message: 'm' }, agentA));
    const foreign = inbox.post({ folderId: folderA, kind: 'approval', source: 'hook', origin: 'hook:PermissionRequest', sessionId: 'sa', message: 'a', textAuthor: 'agent' }).item;
    const sibling = ok<{ itemId: string }>(await call('inbox_post', { message: 'm' }, agentA2));
    expect(errorOf(await call('inbox_resolve', { itemId: foreign.id }, agentA)), 'a hook approval is not the agent\'s to resolve').toBe('out_of_scope');
    expect(errorOf(await call('inbox_resolve', { itemId: sibling.itemId }, agentA)), 'another session\'s item').toBe('out_of_scope');
    expect(errorOf(await call('inbox_resolve', { itemId: mine.itemId, resolution: 'approved' }, agentA)), 'agents cannot approve').toBe('invalid_input');
    expect(errorOf(await call('inbox_resolve', { itemId: mine.itemId, resolution: 'superseded' }, agentA)), 'own item').toBe('ok');
    expect(errorOf(await call('inbox_resolve', { itemId: mine.itemId }, agentA)), 'twice').toBe('failed');
  });

  it('does not let an agent see or resolve an item outside its folder', async () => {
    const outside = inbox.post({ folderId: folderB, kind: 'status', source: 'app', origin: 'x', message: 'o', textAuthor: 'app' }).item;
    expect(errorOf(await call('inbox_resolve', { itemId: outside.id }, agentA)), 'out of scope').toBe('out_of_scope');
    expect(errorOf(await call('inbox_resolve', { itemId: 'missing' }, agentA)), 'unknown').toBe('not_found');
  });

  it('lets the user resolve any item with any resolution', async () => {
    const item = inbox.post({ folderId: folderB, kind: 'approval', source: 'hook', origin: 'x', message: 'o', textAuthor: 'app' }).item;
    expect(errorOf(await call('inbox_resolve', { itemId: item.id, resolution: 'approved' }, ui)), 'user').toBe('ok');
  });
});

describe('user-only commands', () => {
  it('are not callable by an agent', async () => {
    const item = inbox.post({ folderId: folderA, kind: 'status', source: 'app', origin: 'x', message: 'o', textAuthor: 'app' }).item;
    expect(errorOf(await call('inbox_mark_seen', { itemId: item.id }, agentA)), 'agent caller').toBe('not_found');
    expect(errorOf(await call('inbox_mark_seen', { itemId: item.id }, ui)), 'user caller').toBe('ok');
  });

  it('snoozes, reopens and returns the context with project and session summaries', async () => {
    const item = inbox.post({ folderId: folderA, kind: 'status', source: 'hook', origin: 'x', sessionId: 'sa', message: 'o', textAuthor: 'app' }).item;
    ok(await call('inbox_set_project_summary', { folderId: folderA, summary: 'Billing rewrite' }, ui));
    ok(await call('inbox_set_session_summary', { sessionId: 'sa', summary: 'Fixing the invoice job', model: 'haiku' }, ui));
    const info = ok<{ project: { name: string; summary: string }; session: { name: string; summary: string; summaryGeneratedAt: string } }>(await call('inbox_context', { itemId: item.id }, ui));
    expect([info.project.name, info.project.summary, info.session.name, info.session.summary], 'context layers').toEqual(['A', 'Billing rewrite', 'Session A', 'Fixing the invoice job']);
    expect(info.session.summaryGeneratedAt, 'generation time').toBe('2026-11-17T12:00:00.000Z');
    expect(ok<ItemRow>(await call('inbox_snooze', { itemId: item.id, until: new Date(time + 60_000).toISOString() }, ui)).state, 'snoozed').toBe('snoozed');
    expect(errorOf(await call('inbox_snooze', { itemId: item.id, until: 'soon' }, ui)), 'bad time').toBe('invalid_input');
  });

  it('uses the nearest marked project, else the top-level folder, as the project of a nested item', async () => {
    const mid = tree.createFolder({ title: 'Mid', parentId: folderA }).id;
    const leaf = tree.createFolder({ title: 'Leaf', parentId: mid }).id;
    const item = inbox.post({ folderId: leaf, kind: 'status', source: 'app', origin: 'x', message: 'o', textAuthor: 'app' }).item;
    expect(ok<{ project: { name: string } }>(await call('inbox_context', { itemId: item.id }, ui)).project.name, 'top-level folder by default').toBe('A');
    ok(await call('inbox_set_project_summary', { folderId: mid, summary: 'Marked' }, ui));
    expect(ok<{ project: { name: string } }>(await call('inbox_context', { itemId: item.id }, ui)).project.name, 'nearest marked ancestor').toBe('Mid');
  });
});

describe('task and reminder tools', () => {
  it('scope an agent to its folder and own the tasks it creates', async () => {
    const task = ok<{ id: string; owner: { kind: string; sessionId?: string } }>(await call('task_create', { title: 'Follow up' }, agentA));
    expect(task.owner, 'agent owner').toEqual({ kind: 'agent', sessionId: 'sa' });
    expect(errorOf(await call('task_create', { title: 't', folderId: folderB }, agentA)), 'other folder').toBe('out_of_scope');
    expect(errorOf(await call('task_update', { taskId: task.id, state: 'done' }, agentA2)), 'same folder, allowed').toBe('ok');
    const other = ok<{ id: string }>(await call('task_create', { title: 'b', folderId: folderB }, ui));
    expect(errorOf(await call('task_update', { taskId: other.id, state: 'done' }, agentA)), 'update outside scope').toBe('out_of_scope');
    expect(ok<{ tasks: unknown[] }>(await call('task_list', {}, agentA)).tasks, 'done task not listed by default').toEqual([]);
  });

  it('create a reminder with a rule, list it and delete it, and refuse a bad rule', async () => {
    const reminder = ok<{ id: string; nextDueAt: string }>(await call('reminder_create', { title: 'Standup', dtstart: '2026-11-18T09:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }, agentA));
    expect(reminder.nextDueAt, 'next Wednesday 09:00 local').toBe('2026-11-18T07:00:00.000Z');
    expect(ok<{ reminders: unknown[] }>(await call('reminder_list', {}, agentA)).reminders, 'listed').toHaveLength(1);
    expect(errorOf(await call('reminder_create', { title: 'x', dtstart: '2026-11-18T09:00', rrule: 'FREQ=HOURLY' }, agentA)), 'unsupported rule').toBe('invalid_input');
    ok(await call('reminder_delete', { reminderId: reminder.id }, agentA));
    expect(ok<{ reminders: unknown[] }>(await call('reminder_list', {}, ui)).reminders, 'deleted').toEqual([]);
  });

  it('cap the reminders an agent keeps in a folder', async () => {
    for (let i = 0; i < AGENT_SCHEDULE_LIMIT; i++) ok(await call('reminder_create', { title: `r${i}`, dtstart: '2026-12-01T09:00' }, agentA));
    expect(errorOf(await call('reminder_create', { title: 'one more', dtstart: '2026-12-01T09:00' }, agentA)), 'cap').toBe('failed');
    expect(errorOf(await call('reminder_create', { title: 'user', dtstart: '2026-12-01T09:00', folderId: folderA }, ui)), 'the user is not capped').toBe('ok');
  });
});
