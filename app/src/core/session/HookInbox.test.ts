import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hookCommand } from './hooks';
import { HookInbox } from './HookInbox';

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inbox it's "));
  dir = join(root, 'inbox');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function runHook(payload: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', hookCommand(dir)], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', resolve);
    child.stdin.end(payload);
  });
}

describe('HookInbox', () => {
  it('delivers every payload of concurrent hooks with large payloads, intact', async () => {
    const seen: { hook_event_name: string; n: number; pad: string }[] = [];
    const inbox = new HookInbox(dir, (record) => seen.push(record as (typeof seen)[number]));
    const pad = 'x'.repeat(300_000);
    const codes = await Promise.all(
      Array.from({ length: 20 }, (_, n) => runHook(JSON.stringify({ hook_event_name: 'PostToolUse', n, pad }))),
    );
    inbox.stop();
    expect(codes, 'exit status of every hook').toEqual(Array(20).fill(0));
    expect(seen.map((r) => r.n).sort((a, b) => a - b), 'payload numbers that arrived').toEqual(Array.from({ length: 20 }, (_, n) => n));
    expect(seen.every((r) => r.pad === pad), 'payloads arrive complete').toBe(true);
  });

  it('delivers sequential hooks in the order they ran and deletes the files', async () => {
    const seen: unknown[] = [];
    const inbox = new HookInbox(dir, (record) => seen.push(record));
    for (const name of ['SessionStart', 'UserPromptSubmit', 'Stop']) await runHook(JSON.stringify({ hook_event_name: name }));
    inbox.stop();
    expect(seen, 'records in order').toEqual([
      { hook_event_name: 'SessionStart' },
      { hook_event_name: 'UserPromptSubmit' },
      { hook_event_name: 'Stop' },
    ]);
    expect(readdirSync(dir), 'files left after reading').toEqual([]);
  });

  it('keeps non-ASCII text intact and skips payloads that are not JSON', () => {
    const seen: unknown[] = [];
    const inbox = new HookInbox(dir, (record) => seen.push(record));
    writeFileSync(join(dir, 'a.json'), '{"m":"ä€😀"}');
    writeFileSync(join(dir, 'b.json'), 'not json');
    inbox.stop();
    expect(seen, 'decoded record').toEqual([{ m: 'ä€😀' }]);
  });

  it('ignores a file that is still being written and starts empty', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old.json'), '{"old":1}');
    const seen: unknown[] = [];
    const inbox = new HookInbox(dir, (record) => seen.push(record));
    writeFileSync(join(dir, 'tmp-abc123'), '{"partial":');
    inbox.stop();
    expect(seen, 'records from the old file and the unfinished file').toEqual([]);
  });

  it('delivers on its own interval', async () => {
    const seen: unknown[] = [];
    const inbox = new HookInbox(dir, (record) => seen.push(record), 10);
    writeFileSync(join(dir, 'x.json'), '{"x":1}');
    await new Promise((resolve) => setTimeout(resolve, 150));
    inbox.stop();
    expect(seen, 'record delivered by the timer').toEqual([{ x: 1 }]);
  });
});
