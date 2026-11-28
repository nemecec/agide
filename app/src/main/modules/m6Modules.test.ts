import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessActionHandler, AccessTarget } from '../../core/access/index';
import type { Caller } from '../../core/commands/index';
import type { AppEvent } from '../../core/events/index';
import { InMemoryHookEndpoint } from '../../core/hooks/index';
import { startAppModules, type AppModules } from '../appForTests';

const FAKE_CLAUDE = join(import.meta.dirname, '..', '..', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let dir: string;
let work: string;
let app: AppModules | undefined;
const clients: Client[] = [];
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm6-modules-'));
  work = mkdtempSync(join(tmpdir(), 'm6-work-'));
  process.env['AGIDE_CLAUDE_BIN'] = FAKE_CLAUDE;
  process.env['AGIDE_SESSION_CWD'] = work;
  process.env['FAKE_CLAUDE_RECORD'] = join(dir, 'launches.jsonl');
});
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await app?.close();
  app = undefined;
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const ui: Caller = { kind: 'ui' };

async function start(): Promise<AppModules> {
  app = await startAppModules({ dataDir: dir });
  return app;
}

async function created<T>(running: AppModules, id: string, input: unknown): Promise<T> {
  const result = await running.commands.invoke(id, input, ui);
  if (!result.ok) throw new Error(`${id} failed: ${result.error.code}: ${result.error.message}`);
  return result.value as T;
}

const codeOf = async (running: AppModules, id: string, input: unknown, caller: Caller): Promise<string> => {
  const result = await running.commands.invoke(id, input, caller);
  return result.ok ? 'ok' : result.error.code;
};

async function agentTools(running: AppModules, sessionId: string, folderId: string): Promise<string[]> {
  const grant = running.services.mcp.grant(sessionId, folderId);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
  clients.push(client);
  return (await client.listTools()).tools.map((tool) => tool.name);
}

describe('commands of milestone 6 before their builders', () => {
  it('lists the agent tools of asks, access results and tasks, and none of the user-only commands', async () => {
    const running = await start();
    const folder = await created<{ id: string }>(running, 'ui_create_folder', { title: 'A' });
    const tools = await agentTools(running, 's1', folder.id);
    for (const tool of ['inbox_ask', 'inbox_ask_result', 'access_request_result', 'task_delete', 'task_move', 'reminder_update', 'reminder_set_enabled']) {
      expect(tools, `${tool} is an agent tool`).toContain(tool);
    }
    for (const hidden of [
      'inbox_answer',
      'hook_approval_answer',
      'session_set_mode',
      'access_decide',
      'access_grants_list',
      'access_grant_revoke',
      'access_request_get',
      'session_summarize',
      'session_summary_get',
      'inbox_views_list',
      'inbox_view_save',
      'inbox_view_delete',
      'inbox_open_item',
    ]) {
      expect(tools, `${hidden} is not an agent tool`).not.toContain(hidden);
    }
  });

  it('answers not_built from every command whose builder has not filled the handler', async () => {
    const running = await start();
    const folder = await created<{ id: string }>(running, 'ui_create_folder', { title: 'A' });
    const agent: Caller = { kind: 'mcp', sessionId: 's1', folderId: folder.id };
    const calls: [string, unknown, Caller][] = [
      ['inbox_ask', { question: 'Ship it?' }, agent],
      ['inbox_ask_result', { askId: 'a1' }, agent],
      ['inbox_answer', { itemId: 'i1', text: 'yes' }, ui],
      ['hook_approval_answer', { itemId: 'i1', behavior: 'allow' }, ui],
      ['session_set_mode', { sessionId: 's1', mode: 'plan' }, ui],
      ['inbox_views_list', {}, ui],
      ['inbox_view_save', { id: 'v1', name: 'Mine', folderId: null, filter: {}, sort: 'time', position: 0 }, ui],
      ['inbox_view_delete', { id: 'v1' }, ui],
      ['inbox_open_item', { itemId: 'i1' }, ui],
      ['session_summarize', { sessionId: 's1' }, ui],
      ['session_summary_get', { sessionId: 's1' }, ui],
      ['access_request_result', { requestId: 'r1' }, agent],
      ['access_request_get', { requestId: 'r1' }, ui],
      ['access_decide', { requestId: 'r1', decision: 'once' }, ui],
      ['access_grants_list', {}, ui],
      ['access_grant_revoke', { sessionId: 's1', action: 'note.read', targetId: 't1' }, ui],
      ['task_delete', { taskId: 't1' }, ui],
      ['task_move', { taskId: 't1' }, ui],
      ['reminder_update', { reminderId: 'r1', title: 'x' }, ui],
      ['reminder_set_enabled', { reminderId: 'r1', enabled: false }, ui],
    ];
    for (const [id, input, caller] of calls) expect(await codeOf(running, id, input, caller), `${id} is not built yet`).toBe('not_built');
  });

  it('keeps the user-only commands away from an agent caller', async () => {
    const running = await start();
    const folder = await created<{ id: string }>(running, 'ui_create_folder', { title: 'A' });
    const agent: Caller = { kind: 'mcp', sessionId: 's1', folderId: folder.id };
    for (const id of ['inbox_answer', 'hook_approval_answer', 'session_set_mode', 'access_decide', 'access_grant_revoke', 'session_summarize']) {
      expect(await codeOf(running, id, {}, agent), `${id} is not found for an agent`).toBe('not_found');
    }
  });

  it('validates the inputs of the new commands before the handler runs', async () => {
    const running = await start();
    expect(await codeOf(running, 'inbox_answer', { itemId: 'i1' }, ui), 'an answer needs a choice or text').toBe('invalid_input');
    expect(await codeOf(running, 'hook_approval_answer', { itemId: 'i1', behavior: 'allow', message: 'x' }, ui), 'only a deny carries a message').toBe('invalid_input');
    expect(await codeOf(running, 'access_decide', { requestId: 'r', decision: 'once', message: 'x' }, ui), 'only a deny carries a message').toBe('invalid_input');
  });
});

describe('the hooks, ask and access modules', () => {
  it('gives the access broker the sessions of the real service and tells the bus about requests and grants', async () => {
    const running = await start();
    const events: AppEvent[] = [];
    running.events.onAny((event) => events.push(event));
    const folder = await created<{ id: string }>(running, 'ui_create_folder', { title: 'A' });
    const { sessionId, leafId } = await created<{ sessionId: string; leafId: string }>(running, 'session_create', { folderId: folder.id });
    const target: AccessTarget = { kind: 'note', id: 'n1', nodeId: leafId };
    const handler: AccessActionHandler = {
      action: 'note.read',
      offered: () => ['once', 'session'],
      detail: () => Promise.resolve({ targetTitle: 'Plan' }),
      perform: () => Promise.resolve('content'),
    };
    running.services.access.register(handler);
    const call = running.services.access.request({ kind: 'mcp', sessionId, folderId: folder.id }, 'note.read', target, {}, new AbortController().signal);
    await vi.waitFor(() => expect(running.services.inbox.list({ kinds: ['approval'] }).length, 'the request is an inbox item').toBe(1));
    const item = running.services.inbox.list({ kinds: ['approval'] })[0];
    expect(item?.message, 'the message holds the session title').toContain(running.services.sessions.get(sessionId)?.title ?? '?');
    await running.services.access.decide(item?.id ?? '', { allow: 'session' });
    expect(await call, 'the call returns the handler result').toBe('content');
    expect(events.map((event) => event.type), 'the request and the grant reached the bus').toEqual(expect.arrayContaining(['access.request_changed', 'access.grants_changed']));
    expect(running.services.access.check(sessionId, 'note.read', target), 'a live session takes a session grant').toBe('allow');
    await running.services.sessions.stop(sessionId);
    expect(running.services.access.check(sessionId, 'note.read', target), 'the grant ends when the process exits').toBe('ask');
  });

  it('aborts the tool calls of a session that exits and announces to an idle session through the shared planner', async () => {
    const running = await start();
    const abort = vi.spyOn(running.services.mcp, 'abortCalls');
    const folder = await created<{ id: string }>(running, 'ui_create_folder', { title: 'A' });
    const { sessionId } = await created<{ sessionId: string }>(running, 'session_create', { folderId: folder.id });
    await vi.waitFor(() => expect(running.services.sessions.get(sessionId)?.status, 'the fake CLI reports ready').toBe('idle'));
    const delivered: string[] = [];
    running.services.delivery.enqueue({ recordId: 'r1', sessionId, noticeLine: 'Access request r1 was decided. Read it with access_request_result.', contextLine: 'c', onDelivered: (how) => delivered.push(how) });
    expect(delivered, 'an idle PTY session gets the notice typed').toEqual(['notice']);
    await running.services.sessions.stop(sessionId);
    expect(abort, 'the MCP server is told that the session ended').toHaveBeenCalledWith(sessionId);
  });

  it('delivers a queued answer when the session becomes idle', async () => {
    const running = await start();
    const folder = await created<{ id: string }>(running, 'ui_create_folder', { title: 'A' });
    const { sessionId } = await created<{ sessionId: string }>(running, 'session_create', { folderId: folder.id });
    const deliverPending = vi.spyOn(running.services.ask, 'deliverPending');
    await running.services.sessions.stop(sessionId);
    await running.services.sessions.resume(sessionId);
    await vi.waitFor(() => expect(deliverPending, 'the resumed session reached idle').toHaveBeenCalledWith(sessionId));
  });

  it('gives the hooks module an endpoint that grants a token and refuses a wrong one', async () => {
    const running = await start();
    const endpoint = running.services.hooks;
    expect(endpoint, 'until w-hooks lands, the module holds the in-memory endpoint; w-hooks posts over HTTP here').toBeInstanceOf(InMemoryHookEndpoint);
    const grant = endpoint.grant('s1');
    expect(grant.token, 'a hook token of 32 bytes').toMatch(/^[0-9a-f]{64}$/);
    expect(grant.url, 'the hook route of the session').toContain('/hooks/s1');
    const body = JSON.stringify({ session_id: 's1', hook_event_name: 'Stop' });
    const requests: string[] = [];
    endpoint.subscribe((request) => requests.push(request.event));
    const post = (token: string) => (endpoint as InMemoryHookEndpoint).receive({ sessionId: 's1', token, body });
    expect((await post(grant.token.replace(/^./, (first) => (first === '0' ? '1' : '0')))).status, 'a wrong token is refused').toBe(401);
    expect(requests, 'a refused request reaches no listener').toEqual([]);
    expect((await post(grant.token)).status, 'the granted token is accepted').toBe(200);
    expect(requests, 'an accepted request reaches the listener').toEqual(['Stop']);
  });
});
