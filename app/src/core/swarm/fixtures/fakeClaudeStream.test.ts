import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FAKE = join(import.meta.dirname, 'fake-claude-stream.mjs');

interface Fake {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly lines: Record<string, unknown>[];
  readonly exited: Promise<number | null>;
  send(message: object): void;
  user(text: string): void;
  waitFor(predicate: (line: Record<string, unknown>) => boolean, count?: number): Promise<Record<string, unknown>[]>;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fake-stream-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function start(args: string[], env: Record<string, string> = {}): Fake {
  const proc = spawn(process.execPath, [FAKE, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      FAKE_CLAUDE_STATE: join(dir, 'state'),
      FAKE_CLAUDE_RECORD: join(dir, 'record.jsonl'),
      ...env,
    },
  });
  const lines: Record<string, unknown>[] = [];
  createInterface({ input: proc.stdout }).on('line', (line) => lines.push(JSON.parse(line) as Record<string, unknown>));
  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  const send = (message: object) => proc.stdin.write(JSON.stringify(message) + '\n');
  return {
    proc,
    lines,
    exited,
    send,
    user: (text) =>
      send({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
      }),
    waitFor: async (predicate, count = 1) => {
      const deadline = Date.now() + 5_000;
      while (lines.filter(predicate).length < count) {
        if (Date.now() > deadline) throw new Error(`timed out; lines: ${lines.map((line) => line['type']).join(', ')}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return lines.filter(predicate);
    },
  };
}

const isResult = (line: Record<string, unknown>) => line['type'] === 'result';
const launchArgs = (sessionId: string, extra: string[] = []) => [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--session-id',
  sessionId,
  '--permission-mode',
  'manual',
  '--model',
  'haiku',
  ...extra,
];

describe('fake stream-json claude', () => {
  it('writes nothing before the first message, then init, assistant usage, a rate limit event and a result with cost', async () => {
    const fake = start(launchArgs(randomUUID()));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fake.lines, 'silent before the first message').toEqual([]);
    fake.user('/text hi');
    const [result] = await fake.waitFor(isResult);
    expect(
      fake.lines.map((line) => line['type']),
      'message order',
    ).toEqual(['system', 'assistant', 'rate_limit_event', 'result']);
    expect(fake.lines[0], 'init').toMatchObject({
      subtype: 'init',
      permissionMode: 'default',
      model: 'claude-haiku-5-5',
    });
    expect((fake.lines[1]?.['message'] as { usage: unknown }).usage, 'assistant usage').toMatchObject({ input_tokens: 10, output_tokens: 5 });
    expect(result, 'result').toMatchObject({
      subtype: 'success',
      is_error: false,
      result: 'hi',
      terminal_reason: 'completed',
    });
    expect(result?.['total_cost_usd'], 'cost').toBeGreaterThan(0);
    fake.proc.stdin.end();
    expect(await fake.exited, 'closing stdin ends the process with code 0').toBe(0);
  });

  it('sends can_use_tool and continues after the control response', async () => {
    const fake = start(launchArgs(randomUUID()));
    fake.user('/tool Write {"file_path":"a.txt","content":"one"}\n/text done');
    const [request] = await fake.waitFor((line) => line['type'] === 'control_request');
    expect(request?.['request'], 'request fields of P30').toMatchObject({
      subtype: 'can_use_tool',
      tool_name: 'Write',
      display_name: 'Write',
      input: { file_path: 'a.txt' },
      tool_use_id: expect.any(String),
    });
    fake.send({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: request?.['request_id'],
        response: { behavior: 'deny', message: 'no' },
      },
    });
    const [result] = await fake.waitFor(isResult);
    expect(result?.['permission_denials'], 'the deny is recorded').toHaveLength(1);
    fake.proc.kill('SIGTERM');
  });

  it('answers interrupt, cancels the open request and keeps running', async () => {
    const fake = start(launchArgs(randomUUID()));
    fake.user('/tool Bash {"command":"ls"}');
    const [request] = await fake.waitFor((line) => line['type'] === 'control_request');
    fake.send({
      type: 'control_request',
      request_id: 'app-1',
      request: { subtype: 'interrupt' },
    });
    const [result] = await fake.waitFor(isResult);
    expect(
      fake.lines.some((line) => line['type'] === 'control_cancel_request' && line['request_id'] === request?.['request_id']),
      'cancel for the open request',
    ).toBe(true);
    expect(
      fake.lines.some((line) => line['type'] === 'control_response' && (line['response'] as { request_id: string }).request_id === 'app-1'),
      'the interrupt is answered',
    ).toBe(true);
    expect(result, 'interrupted result').toMatchObject({
      subtype: 'error_during_execution',
      terminal_reason: 'aborted_tools',
    });
    fake.user('/text again');
    const results = await fake.waitFor(isResult, 2);
    expect(results[1]?.['result'], 'next turn runs').toBe('again');
    fake.proc.kill('SIGTERM');
  });

  it('refuses a used --session-id, resumes it with --resume and records its arguments', async () => {
    const sessionId = randomUUID();
    const first = start(launchArgs(sessionId, ['--max-budget-usd', '0.25']));
    first.user('/text one');
    await first.waitFor(isResult);
    first.proc.stdin.end();
    await first.exited;
    const again = start(launchArgs(sessionId));
    expect(await again.exited, 'a used session id fails at start').toBe(1);
    const resumed = start(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--resume', sessionId]);
    resumed.user('/text two');
    const [result] = await resumed.waitFor(isResult);
    expect(result?.['result'], 'the resumed turn').toBe('two');
    resumed.proc.stdin.end();
    await resumed.exited;
    const record = readFileSync(join(dir, 'record.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[] });
    expect(record[0]?.args, 'arguments are recorded').toEqual(expect.arrayContaining(['--max-budget-usd', '0.25']));
  });

  it('answers every message after the budget with error_max_budget_usd', async () => {
    const fake = start(launchArgs(randomUUID(), ['--max-budget-usd', '0.01']));
    fake.user('/cost 0.02\n/text spend');
    fake.user('/text more');
    const results = await fake.waitFor(isResult, 2);
    expect(
      results.map((line) => line['subtype']),
      'both turns',
    ).toEqual(['error_max_budget_usd', 'error_max_budget_usd']);
    fake.proc.kill('SIGTERM');
  });

  it('writes a file for /write and exits with the code of /exit', async () => {
    const fake = start(launchArgs(randomUUID()));
    fake.user('/write out.txt hello\n/exit 3');
    expect(await fake.exited, 'exit code').toBe(3);
    expect(readFileSync(join(dir, 'out.txt'), 'utf8'), 'written file').toBe('hello');
  });
});
