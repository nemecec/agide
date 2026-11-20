#!/usr/bin/env node
// A stand-in for the claude CLI in unit tests. It records its launch (arguments, working directory,
// environment, and the file named by --mcp-config) as JSON to $FAKE_CLAUDE_RECORD, runs the hook commands from --settings like the CLI does,
// and reads typed lines:
//   /exit            runs SessionEnd and exits 0
//   /perm            runs PermissionRequest and waits for "y"
//   /subagent        runs SubagentStart and SubagentStop
//   any other text   runs UserPromptSubmit, prints "echo: <text>", runs Stop
// A resize prints "size=<cols>x<rows>". FAKE_CLAUDE_IGNORE_TERM=1 ignores SIGTERM.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const resumed = args.includes('--resume');
const sessionId = resumed ? flag('--resume') : flag('--session-id');
const settings = args.includes('--settings') ? JSON.parse(flag('--settings')) : { hooks: {} };

// The file named by --mcp-config, read at launch like the CLI does.
const mcpPath = args.includes('--mcp-config') ? flag('--mcp-config') : undefined;
const mcpConfigFile = mcpPath && existsSync(mcpPath) && { mode: statSync(mcpPath).mode & 0o777, content: readFileSync(mcpPath, 'utf8') };

appendFileSync(
  process.env.FAKE_CLAUDE_RECORD,
  JSON.stringify({
    args,
    mcpConfigFile,
    cwd: process.cwd(),
    env: { CLAUDECODE: process.env.CLAUDECODE, CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, TERM: process.env.TERM },
  }) + '\n',
);

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, hook_event_name: event, ...extra });
  for (const group of settings.hooks[event] ?? []) {
    for (const hook of group.hooks) spawnSync('/bin/sh', ['-c', hook.command], { input: payload });
  }
}

if (process.env.FAKE_CLAUDE_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
const size = () => `size=${process.stdout.columns}x${process.stdout.rows}\r\n`;
process.stdout.on('resize', () => process.stdout.write(size()));

process.stdout.write(`fake-claude ready ${size()}> `);
// Raw mode comes before SessionStart: a reader that types as soon as the session reports it has started
// finds Enter arriving as \r, not turned into \n by the line discipline.
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
runHooks('SessionStart', { source: resumed ? 'resume' : 'startup' });

let line = '';
let awaitingPermission = false;
process.stdin.on('data', (chunk) => {
  for (const ch of chunk.replace(/\x1b\[20[01]~/g, '')) {
    if (ch !== '\r') {
      line += ch;
      continue;
    }
    const text = line;
    line = '';
    if (awaitingPermission) {
      awaitingPermission = false;
      process.stdout.write('allowed\r\n> ');
    } else if (text === '/exit') {
      runHooks('SessionEnd');
      process.exit(0);
    } else if (text === '/perm') {
      runHooks('UserPromptSubmit', { prompt: text });
      runHooks('PermissionRequest', { tool_name: 'Write' });
      awaitingPermission = true;
      process.stdout.write('Allow? ');
    } else if (text === '/subagent') {
      runHooks('SubagentStart', { agent_id: 'a1' });
      runHooks('SubagentStop', { agent_id: 'a1' });
      process.stdout.write('> ');
    } else {
      runHooks('UserPromptSubmit', { prompt: text });
      process.stdout.write(`echo: ${text}\r\n`);
      runHooks('Stop', { last_assistant_message: `echo: ${text}` });
      process.stdout.write('> ');
    }
  }
});
