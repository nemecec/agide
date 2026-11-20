#!/usr/bin/env node
// A stand-in for the claude CLI for the visual check. It prints a short fake banner, records its launch to
// $FAKE_CLAUDE_RECORD, runs the hook and status line commands of --settings like the CLI does and reads typed lines:
//   /hook <Event> <json>      one hook with the JSON merged into the payload
//   /agent <id> <description> Agent tool call and SubagentStart
//   /agentstop <id>           SubagentStop
//   /agentfail <id>           an API error line in the agent transcript, then SubagentStop
//   /lines <n> <input>        n assistant lines with <input> input tokens each in the main transcript
//   /status <cost> <percent>  the status line command with a cost and a five-hour plan percentage
// `claude auth status` answers logged out when the file `logged-out` exists in $CLAUDE_CONFIG_DIR.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'auth') {
  const loggedOut = existsSync(join(process.env.CLAUDE_CONFIG_DIR ?? '/nonexistent', 'logged-out'));
  process.stdout.write(`{"loggedIn":${!loggedOut}}\n`);
  process.exit(0);
}
const flag = (name) => args[args.indexOf(name) + 1];
const resumed = args.includes('--resume');
const sessionId = resumed ? flag('--resume') : flag('--session-id');
const jsonArg = (value) => JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8'));
const settings = args.includes('--settings') ? jsonArg(flag('--settings')) : { hooks: {} };
const mcpPath = args.includes('--mcp-config') ? flag('--mcp-config') : undefined;
const mcpConfig = mcpPath && existsSync(mcpPath) ? JSON.parse(readFileSync(mcpPath, 'utf8')) : undefined;
if (process.env.FAKE_CLAUDE_RECORD) appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ args, mcpConfig, cwd: process.cwd() }) + '\n');

const root = process.env.FAKE_CLAUDE_ROOT ?? process.cwd();
const transcript = join(root, 'projects', 'proj', `${sessionId}.jsonl`);
const subagentDir = join(root, 'projects', 'proj', sessionId, 'subagents');
mkdirSync(subagentDir, { recursive: true });
const agentFile = (id) => join(subagentDir, `agent-${id}.jsonl`);

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, transcript_path: transcript, hook_event_name: event, permission_mode: flag('--permission-mode'), ...extra });
  for (const group of settings.hooks?.[event] ?? []) {
    for (const hook of group.hooks) spawnSync('/bin/sh', ['-c', hook.command], { input: payload });
  }
}

function runStatusLine(cost, percent) {
  const command = settings.statusLine?.command;
  if (!command) return;
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd: process.cwd(),
    model: { id: 'claude-haiku-5-5' },
    cost: { total_cost_usd: cost, total_duration_ms: 1000 },
    context_window: { used_percentage: 5, context_window_size: 1000000 },
    rate_limits: { five_hour: { used_percentage: percent, resets_at: Math.floor(Date.now() / 1000) + 3600 } },
  });
  spawnSync('/bin/sh', ['-c', command], { input: payload });
}

let counter = 0;
function appendLines(file, count, input, extra = {}) {
  mkdirSync(dirname(file), { recursive: true });
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const line = { type: 'assistant', message: { id: `msg_${sessionId}_${counter}`, model: 'claude-haiku-5-5', usage: { input_tokens: input, output_tokens: 1 }, content: [{ type: 'text', text: `reply ${counter}` }] }, ...extra };
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  }
}

function submit(text) {
  const [command, ...rest] = text.trim().split(' ');
  if (command === '/hook') {
    runHooks(rest[0], JSON.parse(rest.slice(1).join(' ') || '{}'));
  } else if (command === '/agent') {
    const [id, ...description] = rest;
    const input = { description: description.join(' '), prompt: 'p', subagent_type: 'general-purpose' };
    runHooks('PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: `toolu_${id}` });
    runHooks('SubagentStart', { agent_id: id, agent_type: 'general-purpose' });
    runHooks('PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: `toolu_${id}`, tool_response: { isAsync: true, status: 'async_launched', agentId: id, description: input.description } });
    appendFileSync(agentFile(id), '');
  } else if (command === '/agentstop' || command === '/agentfail') {
    const id = rest[0];
    if (command === '/agentfail') appendLines(agentFile(id), 1, 10, { isApiErrorMessage: true });
    runHooks('SubagentStop', { agent_id: id, agent_type: 'general-purpose', agent_transcript_path: agentFile(id), last_assistant_message: 'done' });
  } else if (command === '/lines') {
    appendLines(transcript, Number(rest[0]), Number(rest[1]));
  } else if (command === '/status') {
    runStatusLine(Number(rest[0]), Number(rest[1]));
  } else {
    runHooks('UserPromptSubmit', { prompt: text });
    runHooks('Stop');
  }
  process.stdout.write(command.startsWith('/') ? '> ' : `echo: ${text}\r\n> `);
}

process.stdout.write('Welcome to the fake assistant (sample data)\r\nWorking in a generic project folder\r\n> ');
// Raw mode comes before SessionStart: a reader that types as soon as the session reports it has started
// finds Enter arriving as \r, not turned into \n by the line discipline.
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
runHooks('SessionStart', { source: resumed ? 'resume' : 'startup' });
runStatusLine(0, 1);

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
let buffer = '';
let pasting = false;
let line = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    if (pasting) {
      const end = buffer.indexOf(PASTE_END);
      if (end < 0) return;
      line += buffer.slice(0, end);
      buffer = buffer.slice(end + PASTE_END.length);
      pasting = false;
      continue;
    }
    const start = buffer.indexOf(PASTE_START);
    const enter = buffer.indexOf('\r');
    if (start >= 0 && (enter < 0 || start < enter)) {
      line += buffer.slice(0, start);
      buffer = buffer.slice(start + PASTE_START.length);
      pasting = true;
      continue;
    }
    if (enter < 0) {
      line += buffer;
      buffer = '';
      return;
    }
    line += buffer.slice(0, enter);
    buffer = buffer.slice(enter + 1);
    const text = line;
    line = '';
    submit(text);
  }
});
