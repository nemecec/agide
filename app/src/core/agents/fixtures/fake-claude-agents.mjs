#!/usr/bin/env node
// A stand-in for the claude CLI that plays what the agents module reads: hook payloads for subagents and
// approvals, status line snapshots and transcript lines. It runs the hook commands and the status line command
// from --settings like the CLI does. Typed lines:
//   /agent <id> <description>    Agent tool call and SubagentStart (a background launch)
//   /agentstop <id>              SubagentStop for that agent
//   /agentlines <id> <n> <input> n assistant lines with distinct message ids and <input> input tokens each, in the agent's file
//   /lines <n> <input>           the same for the main transcript
//   /status <cost> <percent>     the status line command with a cost and a five-hour plan percentage
//   /perm <tool>                 PermissionRequest without an agent id
//   /exit                        SessionEnd, then exit 0
// FAKE_CLAUDE_ROOT is the configuration directory; transcripts live below its projects directory.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const resumed = args.includes('--resume');
const sessionId = resumed ? flag('--resume') : flag('--session-id');
const settings = args.includes('--settings') ? JSON.parse(flag('--settings')) : { hooks: {} };
const root = process.env.FAKE_CLAUDE_ROOT;
const transcript = join(root, 'projects', 'proj', `${sessionId}.jsonl`);
const subagentDir = join(root, 'projects', 'proj', sessionId, 'subagents');
mkdirSync(subagentDir, { recursive: true });

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, transcript_path: transcript, hook_event_name: event, ...extra });
  for (const group of settings.hooks[event] ?? []) {
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
function appendLines(file, count, input) {
  mkdirSync(dirname(file), { recursive: true });
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const line = { type: 'assistant', message: { id: `msg_${sessionId}_${counter}`, model: 'claude-haiku-5-5', usage: { input_tokens: input, output_tokens: 1 }, content: [{ type: 'text', text: `reply ${counter}` }] } };
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  }
}

const agentFile = (id) => join(subagentDir, `agent-${id}.jsonl`);
process.stdout.write('fake-claude-agents ready\r\n> ');
// Raw mode comes before SessionStart: a reader that types as soon as the session reports it has started
// finds Enter arriving as \r, not turned into \n by the line discipline.
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
runHooks('SessionStart', { source: resumed ? 'resume' : 'startup' });
runStatusLine(0, 1);

let line = '';
process.stdin.on('data', (chunk) => {
  for (const ch of chunk.replace(/\x1b\[20[01]~/g, '')) {
    if (ch !== '\r') {
      line += ch;
      continue;
    }
    const [command, ...rest] = line.split(' ');
    line = '';
    if (command === '/exit') {
      runHooks('SessionEnd');
      process.exit(0);
    } else if (command === '/agent') {
      const [id, ...description] = rest;
      const toolUseId = `toolu_${id}`;
      const input = { description: description.join(' '), prompt: 'p', subagent_type: 'general-purpose' };
      runHooks('PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: toolUseId });
      runHooks('SubagentStart', { agent_id: id, agent_type: 'general-purpose' });
      runHooks('PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: toolUseId, tool_response: { isAsync: true, status: 'async_launched', agentId: id, description: input.description } });
      appendFileSync(agentFile(id), '');
    } else if (command === '/agentstop') {
      const [id] = rest;
      runHooks('SubagentStop', { agent_id: id, agent_type: 'general-purpose', agent_transcript_path: agentFile(id), last_assistant_message: 'done' });
    } else if (command === '/agentlines') {
      const [id, count, input] = rest;
      appendLines(agentFile(id), Number(count), Number(input));
    } else if (command === '/lines') {
      appendLines(transcript, Number(rest[0]), Number(rest[1]));
    } else if (command === '/status') {
      runStatusLine(Number(rest[0]), Number(rest[1]));
    } else if (command === '/perm') {
      runHooks('PermissionRequest', { tool_name: rest[0] ?? 'Bash', tool_input: { command: 'ls' } });
    }
    process.stdout.write(`ran ${command}\r\n> `);
  }
});
