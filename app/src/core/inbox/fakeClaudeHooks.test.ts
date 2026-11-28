import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'fixtures', 'fake-claude-hooks.mjs');
const token = createHash('sha256').update('fake-claude-hooks test').digest('hex');

interface Received {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

let dir: string;
let server: Server;
let child: ChildProcessWithoutNullStreams | undefined;
let output = '';
let received: Received[] = [];
let held: ServerResponse[] = [];
let closedByClient: string[] = [];
let respond: (request: Received, res: ServerResponse) => void;

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fake-claude-hooks-'));
  received = [];
  held = [];
  closedByClient = [];
  output = '';
  respond = (_request, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  server = createServer((req, res) => {
    void readBody(req).then((text) => {
      const request: Received = { url: req.url ?? '', authorization: req.headers.authorization, body: JSON.parse(text) as Record<string, unknown> };
      received.push(request);
      res.on('close', () => {
        if (!res.writableFinished) closedByClient.push(request.url);
      });
      respond(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  child?.kill('SIGKILL');
  child = undefined;
  for (const res of held) res.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

const base = (): string => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

function launch(settings: object, mcp?: object): void {
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings));
  const args = [SCRIPT, '--session-id', 's1', '--settings', settingsPath];
  if (mcp) {
    const mcpPath = join(dir, 'mcp.json');
    writeFileSync(mcpPath, JSON.stringify(mcp), { mode: 0o600 });
    args.push('--mcp-config', mcpPath);
  }
  child = spawn(process.execPath, args, { cwd: dir });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (output += chunk));
}

const type = (line: string): void => void child?.stdin.write(`${line}\r`);
const httpEntry = (event: string) => ({ [event]: [{ hooks: [{ type: 'http', url: `${base()}/hooks/s1`, headers: { Authorization: `Bearer ${token}` }, timeout: 30 }] }] });

describe('fake claude hooks over http', () => {
  it('posts the payload of an http hook entry with its headers and prints the reply', async () => {
    respond = (_request, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'queued answer' } }));
    launch({ hooks: httpEntry('UserPromptSubmit') });
    await vi.waitFor(() => expect(output, 'the fake CLI started').toContain('fake-claude-hooks ready'));
    type('/hook UserPromptSubmit {"prompt":"hi"}');
    await vi.waitFor(() => expect(output, 'the reply is printed').toContain('hook-reply UserPromptSubmit 200 {"hookSpecificOutput"'));
    expect(received[0]?.authorization, 'the entry header is sent').toBe(`Bearer ${token}`);
    expect(received[0]?.body, 'the payload names the session and the event').toMatchObject({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  });

  it('does not let a held request delay the next hook, and closes it on /abort', async () => {
    respond = (request, res) => {
      if (request.body['hook_event_name'] === 'PermissionRequest') held.push(res);
      else res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    };
    launch({ hooks: { ...httpEntry('PermissionRequest'), ...httpEntry('PostToolUse') } });
    await vi.waitFor(() => expect(output).toContain('ready'));
    type('/hook PermissionRequest {"tool_name":"Bash"}');
    await vi.waitFor(() => expect(held.length, 'the receiver holds the request').toBe(1));
    type('/hook PostToolUse {}');
    await vi.waitFor(() => expect(output, 'a later hook is answered while the first is held').toContain('hook-reply PostToolUse 200 {}'));
    expect(output, 'the held request has no reply').not.toContain('hook-reply PermissionRequest');
    type('/abort PermissionRequest');
    await vi.waitFor(() => expect(output, 'the abort is reported').toContain('hook-aborted PermissionRequest'));
    await vi.waitFor(() => expect(closedByClient, 'the receiver saw the request close').toEqual(['/hooks/s1']));
  });

  it('reports a failed receiver as an error line and keeps going', async () => {
    respond = (_request, res) => res.destroy();
    launch({ hooks: httpEntry('Stop') });
    await vi.waitFor(() => expect(output).toContain('ready'));
    type('/hook Stop {}');
    await vi.waitFor(() => expect(output, 'a dropped connection is a hook error').toContain('hook-error Stop'));
  });

  it('still runs command hooks next to http ones', async () => {
    const marker = join(dir, 'ran');
    launch({ hooks: { ...httpEntry('Stop'), SessionEnd: [{ hooks: [{ type: 'command', command: `cat > ${marker}` }] }] } });
    await vi.waitFor(() => expect(output).toContain('ready'));
    type('/exit');
    const written = (): string => {
      try {
        return readFileSync(marker, 'utf8');
      } catch {
        return '';
      }
    };
    await vi.waitFor(() => expect(written(), 'the SessionEnd command hook wrote its payload').toContain('SessionEnd'));
    expect(JSON.parse(written()), 'the payload of the command hook').toMatchObject({ hook_event_name: 'SessionEnd' });
  });
});

describe('fake claude MCP calls', () => {
  const mcp = (): object => ({ mcpServers: { app: { type: 'http', url: `${base()}/mcp/s1`, headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 } } });

  it('calls a tool of the app server and prints its result', async () => {
    respond = (request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.body['id'], result: { content: [{ type: 'text', text: '{"status":"answered"}' }] } }));
    };
    launch({ hooks: {} }, mcp());
    await vi.waitFor(() => expect(output).toContain('ready'));
    type('/mcp inbox_ask {"question":"Ship it?"}');
    await vi.waitFor(() => expect(output, 'the result is printed with the call id').toContain('mcp-result 1 {"status":"answered"}'));
    expect(received[0]?.body, 'a tools/call request with the arguments').toMatchObject({ method: 'tools/call', params: { name: 'inbox_ask', arguments: { question: 'Ship it?' } } });
    expect(received[0]?.authorization, 'the entry header is sent').toBe(`Bearer ${token}`);
  });

  it('waits for a held call and posts notifications/cancelled for it on /mcp-cancel', async () => {
    respond = (request, res) => {
      if (request.body['method'] === 'tools/call') held.push(res);
      else res.writeHead(202).end();
    };
    launch({ hooks: {} }, mcp());
    await vi.waitFor(() => expect(output).toContain('ready'));
    type('/mcp inbox_ask {}');
    await vi.waitFor(() => expect(held.length, 'the server holds the call').toBe(1));
    expect(output, 'no result while it is held').not.toContain('mcp-result');
    type('/mcp-cancel 1');
    await vi.waitFor(() => expect(output, 'the cancel was posted').toContain('mcp-cancelled 1'));
    expect(received.at(-1)?.body, 'a cancel notification with the id of the pending call').toMatchObject({ method: 'notifications/cancelled', params: { requestId: 1 } });
  });

  it('prints an error line for a tool error', async () => {
    respond = (request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.body['id'], result: { isError: true, content: [{ type: 'text', text: 'not_built: inbox_ask is not built yet' }] } }));
    };
    launch({ hooks: {} }, mcp());
    await vi.waitFor(() => expect(output).toContain('ready'));
    type('/mcp inbox_ask {}');
    await vi.waitFor(() => expect(output, 'a tool error is an error line').toContain('mcp-error 1 not_built'));
  });
});
