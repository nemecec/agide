#!/usr/bin/env node
// A stand-in for the claude CLI in the milestone 3 integration tests. It records its launch (arguments, the
// parsed --settings, the --mcp-config file, the working directory) to $FAKE_CLAUDE_RECORD, runs the hook and
// status line commands of --settings like the CLI does, and appends every submitted prompt to $FAKE_CLAUDE_INPUT.
// A bracketed paste counts as one prompt, newlines included. Typed lines:
//   /agent <id> <description>  Agent tool call and SubagentStart
//   /agentstop <id>            SubagentStop
//   /lines <n> <input>         n assistant lines with <input> input tokens each in the main transcript
//   /status <cost> <percent>   the status line command with a cost and a five-hour plan percentage
//   /tool <json>               PreToolUse hooks for {tool_name, tool_input}; outputs go to $FAKE_CLAUDE_HOOK_OUT
// FAKE_CLAUDE_ROOT is the configuration directory; transcripts live below its projects directory.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
// `claude auth status`, which the profile module runs to check the login.
if (args[0] === 'auth') {
  process.stdout.write('{"loggedIn":true}\n');
  process.exit(0);
}
const flag = (name) => args[args.indexOf(name) + 1];
const resumed = args.includes('--resume');
const sessionId = resumed ? flag('--resume') : flag('--session-id');
const settings = args.includes('--settings') ? JSON.parse(flag('--settings')) : { hooks: {} };
const mcpPath = args.includes('--mcp-config') ? flag('--mcp-config') : undefined;
const mcpConfig = mcpPath && existsSync(mcpPath) ? JSON.parse(readFileSync(mcpPath, 'utf8')) : undefined;
appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ args, settings, mcpConfig, cwd: process.cwd() }) + '\n');

const root = process.env.FAKE_CLAUDE_ROOT ?? process.cwd();
const transcript = join(root, 'projects', 'proj', `${sessionId}.jsonl`);
const subagentDir = join(root, 'projects', 'proj', sessionId, 'subagents');
mkdirSync(subagentDir, { recursive: true });

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, transcript_path: transcript, hook_event_name: event, permission_mode: flag('--permission-mode'), ...extra });
  for (const group of settings.hooks?.[event] ?? []) {
    for (const hook of group.hooks) {
      const run = spawnSync('/bin/sh', ['-c', hook.command], { input: payload, encoding: 'utf8' });
      if (event === 'PreToolUse' && process.env.FAKE_CLAUDE_HOOK_OUT) {
        appendFileSync(process.env.FAKE_CLAUDE_HOOK_OUT, JSON.stringify({ status: run.status, stdout: run.stdout }) + '\n');
      }
    }
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
function appendLines(file, count, input) {
  mkdirSync(dirname(file), { recursive: true });
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const line = { type: 'assistant', message: { id: `msg_${sessionId}_${counter}`, model: 'claude-haiku-5-5', usage: { input_tokens: input, output_tokens: 1 }, content: [{ type: 'text', text: `reply ${counter}` }] } };
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  }
}

function submit(text) {
  if (process.env.FAKE_CLAUDE_INPUT) appendFileSync(process.env.FAKE_CLAUDE_INPUT, JSON.stringify({ sessionId, text }) + '\n');
  const [command, ...rest] = text.trim().split(' ');
  if (command === '/agent') {
    const [id, ...description] = rest;
    const input = { description: description.join(' '), prompt: 'p', subagent_type: 'general-purpose' };
    runHooks('PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: `toolu_${id}` });
    runHooks('SubagentStart', { agent_id: id, agent_type: 'general-purpose' });
    runHooks('PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: `toolu_${id}`, tool_response: { isAsync: true, status: 'async_launched', agentId: id, description: input.description } });
    appendFileSync(join(subagentDir, `agent-${id}.jsonl`), '');
  } else if (command === '/agentstop') {
    runHooks('SubagentStop', { agent_id: rest[0], agent_type: 'general-purpose', agent_transcript_path: join(subagentDir, `agent-${rest[0]}.jsonl`), last_assistant_message: 'done' });
  } else if (command === '/lines') {
    appendLines(transcript, Number(rest[0]), Number(rest[1]));
  } else if (command === '/status') {
    runStatusLine(Number(rest[0]), Number(rest[1]));
  } else if (command === '/tool') {
    runHooks('PreToolUse', JSON.parse(rest.join(' ')));
  } else {
    runHooks('UserPromptSubmit', { prompt: text });
    runHooks('Stop');
  }
  process.stdout.write(`ran ${command}\r\n> `);
}

process.stdout.write('fake-claude-m3 ready\r\n> ');
runHooks('SessionStart', { source: resumed ? 'resume' : 'startup' });
runStatusLine(0, 1);

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
let buffer = '';
let pasting = false;
let line = '';
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
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
