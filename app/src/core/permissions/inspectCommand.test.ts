import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTION_CLASSES } from './classTable';
import { inspectCommand } from './inspectCommand';
import type { GateFile } from './types';

let dir: string;
let gatePath: string;
let inboxDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agide-inspect-'));
  inboxDir = join(dir, 'inbox');
  mkdirSync(inboxDir);
  gatePath = join(dir, 'gate.json');
  const gate: GateFile = { schema: 1, sessionId: 's1', table: ACTION_CLASSES, outward: {}, allowedHosts: [], inboxDir };
  writeFileSync(gatePath, JSON.stringify(gate));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const payload = (tool_name: string, tool_input: unknown, hook_event_name = 'PreToolUse') => JSON.stringify({ hook_event_name, session_id: 's1', permission_mode: 'auto', tool_name, tool_input });
const records = () => readdirSync(inboxDir).filter((name) => name.endsWith('.json'));

describe('inspectCommand', () => {
  it('prints a deny or ask decision as hook output and records the payload with the decision', () => {
    const out = inspectCommand(gatePath, () => payload('Bash', { command: 'git push origin main' }));
    expect(JSON.parse(out), 'hook output').toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } });
    expect(records(), 'one record').toHaveLength(1);
    const record = JSON.parse(readFileSync(join(inboxDir, records()[0]!), 'utf8'));
    expect(record, 'record carries the payload and the decision').toMatchObject({ tool_name: 'Bash', agide_gate: { decision: 'ask', classId: 'git.push' } });
  });

  it('records a call without a decision and prints nothing', () => {
    expect(inspectCommand(gatePath, () => payload('Read', { file_path: 'a.txt' })), 'no output').toBe('');
    expect(records(), 'record written for the app').toHaveLength(1);
    expect(JSON.parse(readFileSync(join(inboxDir, records()[0]!), 'utf8')).agide_gate, 'decision none').toMatchObject({ decision: 'none' });
  });

  it('writes the record readable by the owner only', () => {
    inspectCommand(gatePath, () => payload('Bash', { command: 'git push' }));
    expect(statSync(join(inboxDir, records()[0]!)).mode & 0o777, 'file mode').toBe(0o600);
  });

  it('leaves no temporary entry behind, so the sweep of stale files has nothing it cannot remove', () => {
    inspectCommand(gatePath, () => payload('Bash', { command: 'git push' }));
    expect(readdirSync(inboxDir).filter((name) => !name.endsWith('.json')), 'only the record remains').toEqual([]);
  });

  it('does nothing without a gate file path', () => {
    expect(inspectCommand(undefined, () => payload('Bash', { command: 'git push' })), 'no output').toBe('');
    expect(readdirSync(inboxDir), 'nothing recorded').toEqual([]);
  });

  it('ignores events other than PreToolUse', () => {
    expect(inspectCommand(gatePath, () => payload('Bash', { command: 'git push' }, 'PostToolUse')), 'no output').toBe('');
    expect(readdirSync(inboxDir), 'nothing recorded').toEqual([]);
  });

  it('throws on a payload that is not JSON, which the entry turns into exit 0 without a decision', () => {
    expect(() => inspectCommand(gatePath, () => 'not json')).toThrow();
    expect(readdirSync(inboxDir), 'nothing recorded').toEqual([]);
  });
});
