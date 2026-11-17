import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkParity, renderParityMarkdown, type Caller } from '../../core/commands/index';
import { openStore } from '../../core/store/index';
import { SqliteTreeService } from '../../core/tree/index';
import { startAppModules, type AppModules } from '../appForTests';

const FAKE_CLAUDE = join(import.meta.dirname, '..', '..', 'core', 'session', 'fixtures', 'fake-claude.mjs');
const PARITY_DOC = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'parity.md');

let dir: string;
let work: string;
let app: AppModules | undefined;
const clients: Client[] = [];
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'app-modules-'));
  process.env['AGIDE_CLAUDE_BIN'] = FAKE_CLAUDE;
  work = mkdtempSync(join(tmpdir(), 'session-work-'));
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

async function start(options: { dbPath?: string } = {}): Promise<AppModules> {
  app = await startAppModules({ dataDir: dir, ...options });
  return app;
}

async function value<T>(running: AppModules, id: string, input: unknown, caller: Caller = ui): Promise<T> {
  const result = await running.commands.invoke(id, input, caller);
  if (!result.ok) throw new Error(`${id} failed: ${result.error.code}: ${result.error.message}`);
  return result.value as T;
}

const errorCode = async (running: AppModules, id: string, input: unknown, caller: Caller): Promise<string> => {
  const result = await running.commands.invoke(id, input, caller);
  return result.ok ? 'ok' : result.error.code;
};

const folder = (running: AppModules, title: string, parentId?: string) =>
  value<{ id: string }>(running, 'ui_create_folder', { title, ...(parentId ? { parentId } : {}) });

async function session(running: AppModules, folderId: string) {
  return value<{ sessionId: string; leafId: string }>(running, 'session_create', { folderId });
}

const agent = (sessionId: string, folderId: string): Caller => ({ kind: 'mcp', sessionId, folderId });

async function mcpClient(running: AppModules, sessionId: string): Promise<Client> {
  const { url, headers } = running.services.mcp.configFor(sessionId).mcpServers.app;
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  clients.push(client);
  return client;
}

const statusWith = (running: AppModules, sessionId: string): Promise<number> => {
  const { url, headers } = running.services.mcp.configFor(sessionId).mcpServers.app;
  return fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status);
};

const textOf = (result: unknown): string =>
  ((result as { content?: { text?: string }[] }).content ?? []).map((item) => item.text ?? '').join('');

describe('session launch', () => {
  it('revokes the grant of a session whose launch failed', async () => {
    const running = await start();
    const revoked = vi.spyOn(running.services.mcp, 'revoke');
    const fa = await folder(running, 'A');
    const failed = await errorCode(running, 'session_create', { folderId: fa.id, cwd: join(work, 'missing') }, ui);
    expect(failed, 'launch in a missing directory fails').toBe('failed');
    expect(revoked, 'the grant issued for that launch is revoked').toHaveBeenCalledTimes(1);
  });

  it('refuses a working directory inside the app data and starts without one in a directory of the folder, not the home directory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'session-home-'));
    process.env['HOME'] = home;
    delete process.env['AGIDE_SESSION_CWD'];
    try {
      const running = await start();
      const fa = await folder(running, 'A');
      expect(await errorCode(running, 'session_create', { folderId: fa.id, cwd: dir }, ui), 'cwd is the data directory').toBe('invalid_input');
      const created = await session(running, fa.id);
      const cwd = running.services.sessions.get(created.sessionId)?.cwd ?? '';
      expect(cwd, 'a directory of its own below the home directory').toBe(join(home, 'Agide', fa.id));
      expect(cwd === home || join(dir, 'sessions').startsWith(cwd + '/'), 'the working directory does not contain the session files').toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('profile setup', () => {
  it('gives the login terminal an empty directory that holds no session file', async () => {
    const running = await start();
    const status = await value<{ loginDirectory: string }>(running, 'profile_setup_status', {});
    expect(status.loginDirectory, 'directory for the login terminal').toBe(join(dir, 'login'));
    expect(readdirSync(status.loginDirectory), 'it is empty').toEqual([]);
    expect(statSync(status.loginDirectory).mode & 0o777, 'owner only').toBe(0o700);
  });
});

describe('session module scope', () => {
  it('lets an agent act on sessions in its own folder only', async () => {
    const running = await start();
    const [fa, fb] = [await folder(running, 'A'), await folder(running, 'B')];
    const [sa, sb] = [await session(running, fa.id), await session(running, fb.id)];
    const caller = agent(sa.sessionId, fa.id);

    expect(await errorCode(running, 'session_send_text', { sessionId: sb.sessionId, text: 'x' }, caller), 'send text to a session elsewhere').toBe('out_of_scope');
    expect(await errorCode(running, 'session_get', { sessionId: sb.sessionId }, caller), 'read a session elsewhere').toBe('out_of_scope');
    expect(await errorCode(running, 'session_send_text', { sessionId: sa.sessionId, text: 'x' }, caller), 'send text to the own session').toBe('ok');
    const listed = await value<{ id: string }[]>(running, 'session_list', {}, caller);
    expect(listed.map((s) => s.id), 'sessions an agent lists').toEqual([sa.sessionId]);
    const all = await value<{ id: string }[]>(running, 'session_list', {});
    expect(all.map((s) => s.id).sort(), 'sessions the user lists').toEqual([sa.sessionId, sb.sessionId].sort());
    expect(await errorCode(running, 'session_close', { sessionId: sb.sessionId }, caller), 'session_close is no tool for agents').toBe('not_found');
  });

  it('does not let an agent create a claude-session leaf', async () => {
    const running = await start();
    const fa = await folder(running, 'A');
    const sa = await session(running, fa.id);
    const client = await mcpClient(running, sa.sessionId);
    const result = await client.callTool({ name: 'ui_create_leaf', arguments: { title: 'x', surfaceType: 'claude-session', surfaceId: 'anything' } });
    expect(result.isError, 'the forged leaf is refused').toBe(true);
    expect(textOf(result), 'the refusal says what is allowed').toContain('invalid_input');
  });

  it('ignores a second leaf that names a session: it cannot move, rescope or close that session', async () => {
    const running = await start();
    const [fa, fb] = [await folder(running, 'A'), await folder(running, 'B')];
    const sub = await folder(running, 'sub', fa.id);
    const [sa, sb] = [await session(running, fa.id), await session(running, fb.id)];
    const forged = await value<{ id: string }>(running, 'ui_create_leaf', { title: 'forged', surfaceType: 'claude-session', surfaceId: sb.sessionId, parentId: fa.id });

    await value(running, 'ui_move_node', { nodeId: forged.id, parentId: sub.id });
    expect(running.services.sessions.get(sb.sessionId)?.folderId, 'folder of the session after its forged leaf moved').toBe(fb.id);
    expect(await errorCode(running, 'session_send_text', { sessionId: sb.sessionId, text: 'x' }, agent(sa.sessionId, fa.id)), 'agent A still cannot reach session B').toBe('out_of_scope');

    await value(running, 'ui_remove_node', { nodeId: forged.id });
    expect(running.services.sessions.get(sb.sessionId)?.status, 'session B after its forged leaf was removed').not.toBe('exited');
    expect(running.services.sessions.get(sb.sessionId), 'session B still exists').toBeDefined();
  });

  it('follows the real leaf: moving it rescopes the grant, removing it closes the session', async () => {
    const running = await start();
    const [fa, fc] = [await folder(running, 'A'), await folder(running, 'C')];
    const sa = await session(running, fa.id);
    await value(running, 'ui_move_node', { nodeId: sa.leafId, parentId: fc.id });
    expect(running.services.sessions.get(sa.sessionId)?.folderId, 'session folder after the move').toBe(fc.id);
    const client = await mcpClient(running, sa.sessionId);
    const nodes = (JSON.parse(textOf(await client.callTool({ name: 'ui_list_tree', arguments: {} }))) as { nodes: { id: string }[] }).nodes;
    expect(nodes.map((n) => n.id), 'the grant now shows the new folder').toEqual([fc.id, sa.leafId]);

    await value(running, 'ui_remove_node', { nodeId: sa.leafId });
    await expect.poll(() => running.services.sessions.get(sa.sessionId), { message: 'session after its leaf was removed', timeout: 10_000 }).toBeUndefined();
  });

  it('revokes the grant when the leaf moves to the top level', async () => {
    const running = await start();
    const fa = await folder(running, 'A');
    const sa = await session(running, fa.id);
    expect(await statusWith(running, sa.sessionId), 'grant before the move').not.toBe(401);
    await value(running, 'ui_move_node', { nodeId: sa.leafId, parentId: null });
    expect(() => running.services.mcp.configFor(sa.sessionId), 'no grant after the move to the top level').toThrow();
  });

  it('revokes the grant when the session closes and when its process exits', async () => {
    const running = await start();
    const fa = await folder(running, 'A');
    const sa = await session(running, fa.id);
    const config = running.services.mcp.configFor(sa.sessionId).mcpServers.app;
    await value(running, 'session_close', { sessionId: sa.sessionId });
    const status = await fetch(config.url, { method: 'POST', headers: { ...config.headers, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status);
    expect(status, 'old token after close').toBe(401);

    const sb = await session(running, fa.id);
    running.services.sessions.sendText(sb.sessionId, '/exit');
    await expect.poll(() => running.services.sessions.get(sb.sessionId)?.status, { message: 'status after /exit', timeout: 10_000 }).toBe('exited');
    expect(() => running.services.mcp.configFor(sb.sessionId), 'grant after the process exited').toThrow();
  });

  it('closes a persisted session whose leaf is gone at startup', async () => {
    const dbPath = join(dir, 'app.db');
    const first = await start({ dbPath });
    const fa = await folder(first, 'A');
    const sa = await session(first, fa.id);
    await first.close();
    app = undefined;
    const db = openStore(dbPath);
    new SqliteTreeService(db).remove(sa.leafId);
    db.close();

    const second = await start({ dbPath });
    expect(second.services.sessions.list(), 'sessions after a restart without the leaf').toEqual([]);
  });

  it('refuses bypassPermissions without an explicit confirmation', async () => {
    const running = await start();
    const fa = await folder(running, 'A');
    expect(await errorCode(running, 'session_create', { folderId: fa.id, permissionMode: 'bypassPermissions' }, ui), 'bypass without confirmation').toBe('invalid_input');
    expect(await errorCode(running, 'session_create', { folderId: fa.id, permissionMode: 'bypassPermissions', confirmBypassPermissions: true }, ui), 'bypass with confirmation').toBe('ok');
  });
});

describe('UI and MCP parity of the app registry', () => {
  it('has no UI-bound command without a tool, and docs/parity.md is current', async () => {
    const running = await start();
    const parent = await folder(running, 'parity');
    const grant = running.services.mcp.grant('parity', parent.id);
    const client = new Client({ name: 'parity', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
    clients.push(client);
    const report = checkParity(running.commands.list(), (await client.listTools()).tools.map((tool) => tool.name));

    expect(report.missing, 'UI-bound commands that agents cannot call').toEqual([]);
    expect(report.rows.map((row) => row.id), 'the registry includes the session and surface type commands').toEqual(
      expect.arrayContaining(['session_create', 'session_send_text', 'ui_list_surface_types', 'ui_create_folder']),
    );
    expect(report.rows.find((row) => row.id === 'session_create')?.exempt, 'session_create states why it is no tool').toBeTruthy();
    if (existsSync(PARITY_DOC)) {
      expect(readFileSync(PARITY_DOC, 'utf8'), 'docs/parity.md is out of date; run pnpm parity').toBe(renderParityMarkdown(report));
    }
  });
});
