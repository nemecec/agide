#!/usr/bin/env node
// A stand-in for the claude CLI that fires the hooks it is told to. It runs the hook commands from --settings
// like the CLI does and reads typed lines:
//   /hook <Event> <json>   runs that hook with the JSON merged into the payload
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

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, hook_event_name: event, ...extra });
  for (const group of settings.hooks[event] ?? []) {
    for (const hook of group.hooks) spawnSync('/bin/sh', ['-c', hook.command], { input: payload });
  }
}

process.stdout.write('fake-claude-hooks ready\r\n> ');
runHooks('SessionStart', { source: resumed ? 'resume' : 'startup' });

let line = '';
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
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
  }
});
