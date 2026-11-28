#!/usr/bin/env node
// A stand-in for the claude CLI that fires the hooks it is told to. It runs the hook commands from --settings
// like the CLI does, posts the `http` hook entries to their URL with their headers (the transport of 0043 section 4.1)
// and reads typed lines:
//   /hook <Event> <json>   runs that hook with the JSON merged into the payload; an http hook does not block the
//                          next line, and its reply is printed as `hook-reply <Event> <status> <body>`
//   /abort <Event>         closes the open http request of that event, as the CLI does at an Esc: `hook-aborted <Event>`
//   /mcp <tool> <json>     calls a tool of the app MCP server named in --mcp-config and waits for the result:
//                          `mcp-result <id> <text>` or `mcp-error <id> <message>`; the line before it is `mcp-call <id> <tool>`
//   /mcp-cancel <id>       posts notifications/cancelled for that call, as the CLI does at an interrupt: `mcp-cancelled <id>`
//   /exit                  runs SessionEnd and exits 0
// Any other line is ignored.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const resumed = args.includes('--resume');
const sessionId = resumed ? flag('--resume') : flag('--session-id');
// --settings is inline JSON or the path of a JSON file.
const jsonArg = (value) => JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8'));
const settings = args.includes('--settings') ? jsonArg(flag('--settings')) : { hooks: {} };

// The file named by --mcp-config, read at launch like the CLI does.
const mcpPath = args.includes('--mcp-config') ? flag('--mcp-config') : undefined;
const mcpConfigFile = mcpPath && existsSync(mcpPath) && { mode: statSync(mcpPath).mode & 0o777, content: readFileSync(mcpPath, 'utf8') };

if (process.env.FAKE_CLAUDE_RECORD) appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ args, mcpConfigFile, cwd: process.cwd() }) + '\n');

const out = (text) => process.stdout.write(`${text}\r\n`);
const open = new Map();

// An http hook entry: the payload as the JSON body, the entry's headers, its timeout in seconds.
async function postHook(hook, event, payload) {
  const controller = new AbortController();
  open.set(event, controller);
  const signal = hook.timeout ? AbortSignal.any([controller.signal, AbortSignal.timeout(hook.timeout * 1000)]) : controller.signal;
  try {
    const response = await fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', ...hook.headers }, body: payload, signal });
    out(`hook-reply ${event} ${response.status} ${await response.text()}`);
  } catch (error) {
    out(controller.signal.aborted ? `hook-aborted ${event}` : `hook-error ${event} ${error instanceof Error ? error.message : error}`);
  } finally {
    open.delete(event);
  }
}

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, hook_event_name: event, ...extra });
  for (const group of settings.hooks?.[event] ?? []) {
    for (const hook of group.hooks) {
      if (hook.type === 'http') void postHook(hook, event, payload);
      else spawnSync('/bin/sh', ['-c', hook.command], { input: payload });
    }
  }
}

// The app MCP server of --mcp-config: a stateless JSON-RPC call over HTTP, like the CLI's own.
const appServer = mcpConfigFile ? JSON.parse(mcpConfigFile.content).mcpServers?.app : undefined;
const calls = new Map();
let nextCall = 0;

function rpc(body, signal) {
  return fetch(appServer.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...appServer.headers },
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
    ...(signal ? { signal } : {}),
  });
}

async function callTool(tool, args) {
  const id = ++nextCall;
  const controller = new AbortController();
  calls.set(id, controller);
  out(`mcp-call ${id} ${tool}`);
  try {
    const response = await rpc({ id, method: 'tools/call', params: { name: tool, arguments: args } }, AbortSignal.any([controller.signal, AbortSignal.timeout(appServer.timeout ?? 60_000)]));
    const reply = await response.json();
    const text = reply.result?.content?.map((item) => item.text).join('') ?? JSON.stringify(reply.error);
    out(`${reply.result?.isError || reply.error ? 'mcp-error' : 'mcp-result'} ${id} ${text}`);
  } catch (error) {
    out(`mcp-error ${id} ${error instanceof Error ? error.message : error}`);
  } finally {
    calls.delete(id);
  }
}

process.stdout.write('fake-claude-hooks ready\r\n> ');
// Raw mode comes before SessionStart: a reader that types as soon as the session reports it has started
// finds Enter arriving as \r, not turned into \n by the line discipline.
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
runHooks('SessionStart', { source: resumed ? 'resume' : 'startup' });

let line = '';
process.stdin.on('data', (chunk) => {
  for (const ch of chunk.replace(/\x1b\[20[01]~/g, '')) {
    if (ch !== '\r') {
      line += ch;
      continue;
    }
    const text = line;
    line = '';
    if (text === '/exit') {
      runHooks('SessionEnd');
      process.exit(0);
    }
    const match = /^\/hook (\w+)(?: (.*))?$/.exec(text);
    if (match) {
      runHooks(match[1], match[2] ? JSON.parse(match[2]) : {});
      process.stdout.write(`ran ${match[1]}\r\n> `);
    }
    const abort = /^\/abort (\w+)$/.exec(text);
    if (abort) open.get(abort[1])?.abort();
    const mcp = /^\/mcp (\w+)(?: (.*))?$/.exec(text);
    if (mcp && appServer) void callTool(mcp[1], mcp[2] ? JSON.parse(mcp[2]) : {});
    const cancel = /^\/mcp-cancel (\d+)$/.exec(text);
    if (cancel && appServer) {
      void rpc({ method: 'notifications/cancelled', params: { requestId: Number(cancel[1]), reason: 'interrupted' } }).then(() => out(`mcp-cancelled ${cancel[1]}`));
    }
  }
});
