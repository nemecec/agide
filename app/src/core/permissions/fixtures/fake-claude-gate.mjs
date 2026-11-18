#!/usr/bin/env node
// A stand-in for the claude CLI in the permission end-to-end tests. It records its arguments, runs the
// SessionStart hook and then the PreToolUse hooks of --settings for each tool call in $FAKE_TOOL_CALLS (a JSON
// array of {tool_name, tool_input}), the way the CLI does, and writes each hook's output to $FAKE_CLAUDE_HOOK_OUT.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const sessionId = args.includes('--resume') ? flag('--resume') : flag('--session-id');
const settings = JSON.parse(flag('--settings'));
appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ args, settings }) + '\n');

function runHooks(event, extra = {}) {
  const payload = JSON.stringify({ session_id: sessionId, hook_event_name: event, permission_mode: flag('--permission-mode'), ...extra });
  for (const group of settings.hooks[event] ?? []) {
    for (const hook of group.hooks) {
      const run = spawnSync('/bin/sh', ['-c', hook.command], { input: payload, encoding: 'utf8' });
      if (event === 'PreToolUse') appendFileSync(process.env.FAKE_CLAUDE_HOOK_OUT, JSON.stringify({ status: run.status, stdout: run.stdout, stderr: run.stderr }) + '\n');
    }
  }
}

process.stdout.write('fake-claude ready\r\n> ');
runHooks('SessionStart', { source: 'startup' });
for (const call of JSON.parse(process.env.FAKE_TOOL_CALLS ?? '[]')) runHooks('PreToolUse', call);
process.stdin.resume();
