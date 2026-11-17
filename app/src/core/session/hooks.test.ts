import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hookCommand, hookSettings } from './hooks';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('hook settings', () => {
  it('registers one command hook for each event the status machine and agent records use', () => {
    const { hooks } = hookSettings('/tmp/inbox');
    expect(Object.keys(hooks).sort(), 'registered hook events').toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'UserPromptSubmit',
    ]);
    for (const [event, groups] of Object.entries(hooks)) expect(groups, `hook for ${event}`).toHaveLength(1);
  });

  it('stores each payload as a complete file in a directory with spaces and quotes, and prints nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), "hook it's "));
    dirs.push(dir);
    mkdirSync(join(dir, 'inbox'));
    const command = hookCommand(join(dir, 'inbox'));
    const first = spawnSync('/bin/sh', ['-c', command], { input: '{"hook_event_name":"Stop"}' });
    spawnSync('/bin/sh', ['-c', command], { input: '{"hook_event_name":"SessionStart"}\n' });
    expect(first.status, 'hook exit status').toBe(0);
    expect(first.stdout.toString(), 'hook stdout, which would be read as a permission decision').toBe('');
    const files = readdirSync(join(dir, 'inbox'));
    expect(files.every((name) => name.endsWith('.json')), 'only finished payload files remain').toBe(true);
    expect(
      files.map((name) => readFileSync(join(dir, 'inbox', name), 'utf8').trim()).sort(),
      'stored payloads',
    ).toEqual(['{"hook_event_name":"SessionStart"}', '{"hook_event_name":"Stop"}']);
  });
});
