import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_CLAUDE_SCRIPT, streamHarness, type StreamHarness, type StreamHarnessOptions } from '../fixtures/streamHarness';
import type { NdjsonItem } from './ndjson';
import { contractSpec } from './agentRuntimeContract';
import { IsolationError } from '../../isolation/types';
import { StreamAgentRuntime } from './StreamAgentRuntime';
import type { AgentLaunchSpec, RuntimeEvent } from './types';

let harness: StreamHarness | undefined;
let events: RuntimeEvent[] = [];
const scratch: string[] = [];

afterEach(async () => {
  await harness?.runtime.dispose();
  await harness?.close();
  harness = undefined;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function start(options: StreamHarnessOptions = {}): Promise<StreamHarness> {
  harness = await streamHarness(options);
  events = [];
  harness.runtime.subscribe((event) => events.push(event));
  return harness;
}

const of = <T extends RuntimeEvent['type']>(sessionId: string, type: T): Extract<RuntimeEvent, { type: T }>[] =>
  events.filter((event): event is Extract<RuntimeEvent, { type: T }> => event.type === type && event.sessionId === sessionId);

async function waitFor<T extends RuntimeEvent['type']>(sessionId: string, type: T, count = 1): Promise<Extract<RuntimeEvent, { type: T }>[]> {
  const deadline = Date.now() + 10_000;
  while (of(sessionId, type).length < count) {
    if (Date.now() > deadline) throw new Error(`no ${count} ${type} event(s); saw ${events.map((event) => event.type).join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return of(sessionId, type);
}

const records = (h: StreamHarness) =>
  readFileSync(h.recordFile, 'utf8')
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          args: string[];
          cwd: string;
          env: Record<string, string | undefined>;
        },
    );

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('launch arguments and environment', () => {
  it('starts the CLI with the stream-json flags, the agent arguments, the session id and the mode, and the contributed deny rules in --settings', async () => {
    const h = await start({
      env: {
        CLAUDE_CONFIG_DIR: '/profile/claude',
        CLAUDE_CODE_ENTRYPOINT: 'inherited',
        CLAUDECODE: '1',
      },
    });
    const spec = contractSpec(h, '/text hi', {
      model: 'sonnet',
      effort: 'medium',
      permissionMode: 'acceptEdits',
      maxBudgetUsd: 0.5,
      maxTurnsPerMessage: 7,
      tools: ['Read', 'Grep'],
      denyRules: ['Edit(/src/**)'],
      addDirs: [h.dir],
      connectors: false,
    });
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    const [record] = records(h);
    const { args } = record!;
    expect(args, 'stream-json flags').toEqual(
      expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio']),
    );
    expect(args, 'session, mode and agent arguments').toEqual(
      expect.arrayContaining([
        '--session-id',
        spec.sessionId,
        '--permission-mode',
        'acceptEdits',
        '--model',
        'sonnet',
        '--effort',
        'medium',
        '--max-budget-usd',
        '0.5',
        '--max-turns',
        '7',
        '--strict-mcp-config',
        '--tools',
        'Read,Grep',
        '--add-dir',
        h.dir,
        '--setting-sources',
        'user',
      ]),
    );
    expect(args, 'no bare mode').not.toContain('--bare');
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny, 'the agent deny rules reach --settings').toContain('Edit(/src/**)');
    expect(record?.cwd, 'working directory of the spec').toBe(realpathSync(h.cwd));
    expect(record?.env, 'the profile login directory stays and the subagent model follows the agent').toMatchObject({
      CLAUDE_CONFIG_DIR: '/profile/claude',
      CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
    });
    expect(record?.env, 'variables a parent Claude session injected are scrubbed').not.toHaveProperty('CLAUDECODE');
    expect(record?.env, 'including the CLAUDE_CODE family').not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT');
  });

  it('passes the manual mode to the CLI for a default-mode agent and adds no stream-json flags to a session of another path', async () => {
    const h = await start();
    const spec = contractSpec(h, '/text hi', { permissionMode: 'default' });
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    expect(records(h)[0]?.args, 'default is manual for the CLI').toEqual(expect.arrayContaining(['--permission-mode', 'manual']));
    const ptyLike = await h.runtime.contributor.contribute({
      session: { id: 'pty-1', launchPath: 'pty' },
    } as never);
    expect(ptyLike, 'a PTY session gets nothing').toEqual({});
  });

  it('resumes with --resume and the mode of the new spec', async () => {
    const h = await start();
    const spec = contractSpec(h, '/text one', { permissionMode: 'default' });
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    await h.runtime.end(spec.sessionId);
    await h.runtime.resume({
      ...spec,
      permissionMode: 'acceptEdits',
      firstMessage: '/text two',
    });
    await waitFor(spec.sessionId, 'result', 2);
    expect(records(h)[1]?.args, 'resume arguments').toEqual(expect.arrayContaining(['--resume', spec.sessionId, '--permission-mode', 'acceptEdits']));
    expect(records(h)[1]?.args, 'a resume has no --session-id').not.toContain('--session-id');
    expect(
      of(spec.sessionId, 'init').map((event) => event.permissionMode),
      'the CLI reports the new mode',
    ).toEqual(['default', 'acceptEdits']);
  });
});

describe('the control channel', () => {
  it('sends a deny to the agent with the message text and records the call as denied', async () => {
    const h = await start();
    const spec = contractSpec(h, '/tool Bash {"command":"rm -rf build"}\n/text gave up');
    await h.runtime.launch(spec);
    const [request] = await waitFor(spec.sessionId, 'permission_request');
    h.runtime.answer(spec.sessionId, request!.requestId, {
      behavior: 'deny',
      message: 'The user denied this call in Agide.',
    });
    const [result] = await waitFor(spec.sessionId, 'result');
    const toolResults = of(spec.sessionId, 'message')
      .map((event) => JSON.stringify(event.raw))
      .filter((line) => line.includes('tool_result'));
    expect(toolResults.join(''), 'the agent gets the deny text as an error result').toContain('The user denied this call in Agide.');
    expect(toolResults.join(''), 'and no success').not.toContain('"content":"ok');
    expect(result?.result.permissionDenials, 'the result lists the denied call').toMatchObject([{ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }]);
    expect(result?.result.text, 'the turn continues after the deny').toBe('gave up');
  });

  it('runs an allowed call with the input the app sends back, also when the app changed it', async () => {
    const h = await start();
    const spec = contractSpec(h, '/tool Write {"file_path":"a.txt","content":"agent text"}\n/text done');
    await h.runtime.launch(spec);
    const [request] = await waitFor(spec.sessionId, 'permission_request');
    h.runtime.answer(spec.sessionId, request!.requestId, {
      behavior: 'allow',
      updatedInput: {
        ...request!.request.input,
        content: 'edited by the user',
      },
    });
    const [result] = await waitFor(spec.sessionId, 'result');
    const toolResult = of(spec.sessionId, 'message')
      .map((event) => JSON.stringify(event.raw))
      .find((line) => line.includes('tool_result'));
    expect(toolResult, 'the call ran with the changed input').toContain('edited by the user');
    expect(toolResult, 'and not with the original').not.toContain('agent text');
    expect(result?.result.permissionDenials, 'no denial').toEqual([]);
  });

  it('keeps the raw request with every key the CLI sent', async () => {
    const h = await start();
    const spec = contractSpec(h, '/tool Write {"file_path":"a.txt","content":"x"}');
    await h.runtime.launch(spec);
    const [request] = await waitFor(spec.sessionId, 'permission_request');
    expect(request?.request, 'the raw request').toMatchObject({
      subtype: 'can_use_tool',
      tool_name: 'Write',
      display_name: 'Write',
      description: 'Write',
      tool_use_id: expect.any(String),
      permission_suggestions: [{ type: 'addRules', destination: 'session' }],
    });
  });

  it('ignores an answer to a request that is not open, and a second answer to one that is', async () => {
    const h = await start();
    const spec = contractSpec(h, '/tool Bash {"command":"ls"}\n/text after');
    await h.runtime.launch(spec);
    const [request] = await waitFor(spec.sessionId, 'permission_request');
    h.runtime.answer(spec.sessionId, 'unknown-request', {
      behavior: 'deny',
      message: 'x',
    });
    h.runtime.answer(spec.sessionId, request!.requestId, {
      behavior: 'allow',
      updatedInput: request!.request.input,
    });
    h.runtime.answer(spec.sessionId, request!.requestId, {
      behavior: 'deny',
      message: 'too late',
    });
    h.runtime.answer('no-such-session', 'r', {
      behavior: 'deny',
      message: 'x',
    });
    const [result] = await waitFor(spec.sessionId, 'result');
    expect(result?.result, 'the first answer counts').toMatchObject({
      subtype: 'success',
      permissionDenials: [],
    });
  });

  it('marks the result of an interrupted turn and not the result of the next turn', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'init');
    await h.runtime.interrupt(spec.sessionId);
    h.runtime.send(spec.sessionId, '/text next');
    const results = await waitFor(spec.sessionId, 'result', 2);
    expect(
      results.map((event) => [event.result.interrupted, event.result.terminalReason]),
      'interrupted flag per turn',
    ).toEqual([
      [true, 'aborted_streaming'],
      [false, 'completed'],
    ]);
    expect(h.runtime.isBusy(spec.sessionId), 'idle after the second result').toBe(false);
  });

  it('puts a steering message first, ahead of the messages already queued', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'init');
    h.runtime.send(spec.sessionId, '/text queued');
    h.runtime.send(spec.sessionId, '/text steered', { now: true });
    const results = await waitFor(spec.sessionId, 'result', 3);
    expect(
      results.map((event) => event.result.text),
      'steering runs before the queued message',
    ).toEqual([undefined, 'steered', 'queued']);
  });

  it('changes the mode of the process with a set_permission_mode request, which the next init reports', async () => {
    const h = await start();
    const spec = contractSpec(h, '/text one');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    await expect(
      h.runtime.control(spec.sessionId, {
        subtype: 'set_permission_mode',
        mode: 'acceptEdits',
      }),
      'the CLI confirms the mode',
    ).resolves.toEqual({ mode: 'acceptEdits' });
    h.runtime.send(spec.sessionId, '/text two');
    await waitFor(spec.sessionId, 'result', 2);
    expect(
      of(spec.sessionId, 'init').map((event) => event.permissionMode),
      'the mode of each turn',
    ).toEqual(['default', 'acceptEdits']);
  });

  it('refuses control requests and messages for a session without a live process', async () => {
    const h = await start();
    await expect(h.runtime.control('nobody', { subtype: 'initialize' }), 'control').rejects.toMatchObject({ code: 'not_running' });
    await expect(h.runtime.interrupt('nobody'), 'interrupt').rejects.toMatchObject({ code: 'not_running' });
    await expect(h.runtime.end('nobody'), 'end').rejects.toMatchObject({
      code: 'not_running',
    });
    await expect(h.runtime.stop('nobody'), 'stop of an unknown session is a no-op').resolves.toBeUndefined();
    expect(h.runtime.isBusy('nobody'), 'not busy').toBe(false);
  });

  it('refuses a message once the process was asked to end', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 200\n/text last');
    await h.runtime.launch(spec);
    const ended = h.runtime.end(spec.sessionId);
    h.runtime.send(spec.sessionId, '/text queued before the end closes stdin');
    await ended;
    expect(h.runtime.isLive(spec.sessionId), 'no process').toBe(false);
    expect(() => h.runtime.send(spec.sessionId, 'again'), 'refused').toThrow(expect.objectContaining({ code: 'not_running' }));
  });
});

describe('usage, cost and limits', () => {
  it('reports token usage per assistant message, the cumulative cost per result and the rate limit info', async () => {
    const h = await start();
    const spec = contractSpec(h, '/text one');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    h.runtime.send(spec.sessionId, '/text two');
    const results = await waitFor(spec.sessionId, 'result', 2);
    expect(of(spec.sessionId, 'assistant')[0], 'usage of the first message').toMatchObject({
      model: 'claude-haiku-5-5',
      usage: {
        input: 10,
        output: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 100,
        cacheRead: 200,
      },
    });
    expect(results[1]!.result.totalCostUsd, 'cost is cumulative over the process').toBeGreaterThan(results[0]!.result.totalCostUsd);
    expect(of(spec.sessionId, 'rate_limit')[0]?.info, 'rate limit windows').toMatchObject({
      status: 'allowed',
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.03 } },
    });
    expect(of(spec.sessionId, 'init')[0], 'init carries the key source and tools').toMatchObject({
      apiKeySource: 'none',
      tools: expect.arrayContaining(['Bash']),
    });
  });
});

describe('a stream the reader must tolerate', () => {
  it('delivers the events around lines of unknown type and lines that are not JSON', async () => {
    const h = await start({ env: { FAKE_CLAUDE_NOISE: '1' } });
    const spec = contractSpec(h, '/text one\n/tool Bash {"command":"ls"}\n/text two');
    await h.runtime.launch(spec);
    const [request] = await waitFor(spec.sessionId, 'permission_request');
    h.runtime.answer(spec.sessionId, request!.requestId, {
      behavior: 'allow',
      updatedInput: request!.request.input,
    });
    const [result] = await waitFor(spec.sessionId, 'result');
    expect(
      of(spec.sessionId, 'assistant').map((event) => event.text),
      'assistant texts',
    ).toEqual(['one', undefined, 'two']);
    expect(
      of(spec.sessionId, 'message').some((event) => (event.raw as { type?: string }).type === 'future_event'),
      'the unknown event is passed on raw',
    ).toBe(true);
    expect(result?.result.text, 'the turn ends normally').toBe('two');
  });

  describe('scripted output', () => {
    const INIT = {
      type: 'system',
      subtype: 'init',
      permissionMode: 'default',
      model: 'claude-haiku-5-5',
      tools: ['Bash'],
      apiKeySource: 'none',
    };
    const RESULT = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      result: 'fine',
      total_cost_usd: 0.002,
      terminal_reason: 'completed',
      permission_denials: [],
    };
    const line = (value: object) => `${JSON.stringify(value)}\n`;

    async function scripted(steps: object[], options: StreamHarnessOptions = {}) {
      const dir = mkdtempSync(join(tmpdir(), 'script-runtime-'));
      scratch.push(dir);
      const stepsFile = join(dir, 'steps.json');
      const stdinFile = join(dir, 'stdin.log');
      writeFileSync(stepsFile, JSON.stringify(steps));
      const h = await start({
        ...options,
        binary: FAKE_CLAUDE_SCRIPT,
        env: {
          FAKE_SCRIPT_FILE: stepsFile,
          FAKE_SCRIPT_STDIN: stdinFile,
          ...options.env,
        },
      });
      const stdin = () =>
        existsSync(stdinFile)
          ? readFileSync(stdinFile, 'utf8')
              .trim()
              .split('\n')
              .map((entry) => JSON.parse(entry) as Record<string, unknown>)
          : [];
      return { h, stdin, cleanup: () => undefined };
    }

    it('fails an interrupt with timeout when the CLI accepts it but the turn does not end', async () => {
      const { h, cleanup } = await scripted([{ write: line(INIT) }], { runtime: { controlTimeoutMs: 300 }, env: { FAKE_SCRIPT_ACK_CONTROL: '1' } });
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        await waitFor(spec.sessionId, 'init');
        await expect(h.runtime.interrupt(spec.sessionId), 'the interrupt gives up when the turn stays open').rejects.toMatchObject({ code: 'timeout' });
        expect(h.runtime.isLive(spec.sessionId), 'the process is left to the caller').toBe(true);
      } finally {
        cleanup();
      }
    });

    it('reports the exit of a process that wrote nothing before the start timeout, and frees its session', async () => {
      const { h, cleanup } = await scripted([{ delayMs: 400 }, { exit: 1 }], { runtime: { startTimeoutMs: 100 } });
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        expect(h.runtime.isLive(spec.sessionId), 'the silent process is alive when launch returns').toBe(true);
        const [exited] = await waitFor(spec.sessionId, 'exited');
        expect(exited?.code, 'the exit code of the silent process').toBe(1);
        expect(h.runtime.isLive(spec.sessionId), 'the dead process is gone').toBe(false);
        expect(of(spec.sessionId, 'started'), 'no start was ever reported').toHaveLength(0);
      } finally {
        cleanup();
      }
    });

    it('joins a line that arrives in pieces, skips an oversize line and still reads the result after it', async () => {
      const text = line({ ...INIT });
      const unreadable: NdjsonItem[] = [];
      const { h, cleanup } = await scripted(
        [{ write: text.slice(0, 20) }, { delayMs: 40 }, { write: text.slice(20) }, { fill: 4 * 1024 * 1024 + 10 }, { write: 'garbage\n' }, { write: line(RESULT) }],
        { runtime: { onUnreadable: (_id, item) => unreadable.push(item) } },
      );
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        const [result] = await waitFor(spec.sessionId, 'result');
        expect(of(spec.sessionId, 'init'), 'the init line cut in two arrives whole').toHaveLength(1);
        expect(result?.result.text, 'the result after the oversize line').toBe('fine');
        expect(
          unreadable.map((item) => item.kind),
          'the oversize line and the garbage line are reported',
        ).toEqual(['dropped', 'invalid']);
        expect(of(spec.sessionId, 'message'), 'the unreadable lines are not events').toHaveLength(2);
      } finally {
        cleanup();
      }
    });

    it('answers a control request of a kind it does not support with an error, so the CLI is not left waiting', async () => {
      const { h, stdin, cleanup } = await scripted([
        { write: line(INIT) },
        {
          write: line({
            type: 'control_request',
            request_id: 'hook-1',
            request: { subtype: 'hook_callback' },
          }),
        },
        { write: line(RESULT) },
      ]);
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        await waitFor(spec.sessionId, 'result');
        await eventually(() => stdin().some((entry) => entry['type'] === 'control_response'), 'the error response reaches stdin');
        expect(
          stdin().find((entry) => entry['type'] === 'control_response'),
          'error response',
        ).toEqual({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: 'hook-1',
            error: 'Unsupported control request subtype: hook_callback',
          },
        });
        expect(of(spec.sessionId, 'permission_request'), 'not an approval').toHaveLength(0);
      } finally {
        cleanup();
      }
    });

    it('writes nothing for an answer to a request that is not open, and reports a cancel for such a request as nothing', async () => {
      const { h, stdin, cleanup } = await scripted([{ write: line(INIT) }, { write: line({ type: 'control_cancel_request', request_id: 'never-asked' }) }, { write: line(RESULT) }]);
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        await waitFor(spec.sessionId, 'result');
        h.runtime.answer(spec.sessionId, 'never-asked', { behavior: 'deny', message: 'x' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(stdin().filter((entry) => entry['type'] === 'control_response'), 'no control response was written').toEqual([]);
        expect(of(spec.sessionId, 'permission_cancelled'), 'a cancel of an unknown request is no event').toEqual([]);
      } finally {
        cleanup();
      }
    });

    it('fails a control request with timeout when the CLI never answers, and an interrupt with it', async () => {
      const { h, cleanup } = await scripted([{ write: line(INIT) }], {
        runtime: { controlTimeoutMs: 80 },
      });
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        await expect(h.runtime.control(spec.sessionId, { subtype: 'initialize' }), 'control request').rejects.toMatchObject({ code: 'timeout' });
        await expect(h.runtime.interrupt(spec.sessionId), 'interrupt of the open turn').rejects.toMatchObject({ code: 'timeout' });
      } finally {
        cleanup();
      }
    });

    it('reads the lines that come with the exit of the process before it reports the exit', async () => {
      const { h, cleanup } = await scripted([{ write: line(INIT) }, { write: line(RESULT).trimEnd() }, { exit: 4 }]);
      try {
        const spec = contractSpec(h, 'go');
        await h.runtime.launch(spec);
        await waitFor(spec.sessionId, 'exited');
        const order = events.filter((event) => event.sessionId === spec.sessionId).map((event) => event.type);
        expect(order.indexOf('result'), 'the last line without a newline is still read').toBeGreaterThan(-1);
        expect(order.indexOf('result'), 'and before the exit').toBeLessThan(order.indexOf('exited'));
        expect(of(spec.sessionId, 'exited')[0], 'exit code').toMatchObject({
          code: 4,
          byApp: false,
        });
      } finally {
        cleanup();
      }
    });
  });
});

describe('a process that ends', () => {
  it('reports a killed process with its signal, no longer counts it as live or busy, and refuses messages for it', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    const [started] = await waitFor(spec.sessionId, 'started');
    process.kill(started!.pid, 'SIGKILL');
    const [exited] = await waitFor(spec.sessionId, 'exited');
    expect(exited, 'killed by a signal, not by the app').toMatchObject({
      code: null,
      signal: 'SIGKILL',
      byApp: false,
    });
    expect(h.runtime.isLive(spec.sessionId), 'not live').toBe(false);
    expect(h.runtime.isBusy(spec.sessionId), 'not busy').toBe(false);
    expect(() => h.runtime.send(spec.sessionId, 'x'), 'send').toThrow(expect.objectContaining({ code: 'not_running' }));
    expect(of(spec.sessionId, 'result'), 'no result for the turn that died').toHaveLength(0);
    expect(h.sessions.get(spec.sessionId)?.status, 'the session row is exited').toBe('exited');
  });

  it('fails a pending control request at once when the process dies', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    const [started] = await waitFor(spec.sessionId, 'started');
    const interrupted = h.runtime.interrupt(spec.sessionId);
    process.kill(started!.pid, 'SIGKILL');
    await expect(interrupted, 'the interrupt does not wait for the timeout').rejects.toMatchObject({ code: 'not_running' });
  });

  it('resumes a session whose process was killed, with the earlier session id', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    const [started] = await waitFor(spec.sessionId, 'started');
    process.kill(started!.pid, 'SIGKILL');
    await waitFor(spec.sessionId, 'exited');
    await h.runtime.resume({ ...spec, firstMessage: '/text back' });
    const [result] = await waitFor(spec.sessionId, 'result');
    expect(result?.result.text, 'the resumed process answers').toBe('back');
    expect(
      of(spec.sessionId, 'started').map((event) => event.resumed),
      'launch, then resume',
    ).toEqual([false, true]);
  });

  it('fails a launch whose process exits before it wrote anything, names the CLI message and leaves no events or session behind', async () => {
    const h = await start();
    const spec = contractSpec(h, '/text hi');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    await h.runtime.end(spec.sessionId);
    rmSync(join(h.dir, 'state'), { recursive: true, force: true });
    events.length = 0;
    await expect(h.runtime.resume(spec), 'the CLI cannot find the conversation').rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('No conversation found'),
    });
    expect(events, 'a failed start emits no events').toEqual([]);
    expect(h.runtime.isLive(spec.sessionId), 'not live').toBe(false);
  });

  it('closes the session of a launch that failed at the CLI, so the id is free for the manager to report', async () => {
    const h = await start();
    const id = randomUUID();
    // The CLI refuses a session id that exists in its state, and the app has no session row for it yet.
    mkdirSync(join(h.dir, 'state'), { recursive: true });
    writeFileSync(join(h.dir, 'state', `${id}.session`), '');
    await expect(h.runtime.launch(contractSpec(h, '/text hi', { sessionId: id })), 'CLI says the id is in use').rejects.toMatchObject({
      code: 'spawn',
      message: expect.stringContaining('already in use'),
    });
    expect(h.sessions.get(id), 'no session row is left').toBeUndefined();
    expect(
      events.filter((event) => event.sessionId === id),
      'no events',
    ).toEqual([]);
  });

  it('fails the launch with the provider reason when the provider cannot run a process without a terminal', async () => {
    const runtime = new StreamAgentRuntime({
      sessions: {
        create: async (input) => {
          await runtime.spawn({
            session: { id: input.id!, cwd: '/work' } as never,
            resume: false,
            args: [],
            env: {},
            environment: {
              provider: 'bare',
              processCommand: () => Promise.reject(new IsolationError('unsupported', 'the bare provider cannot run a process without a terminal')),
            } as never,
          });
          throw new Error('unreachable');
        },
        resume: async () => {
          throw new Error('unused');
        },
        get: () => undefined,
        close: async () => undefined,
        setPermissionMode: () => undefined,
      },
    });
    const spec: AgentLaunchSpec = {
      sessionId: 's',
      folderId: 'f',
      title: 't',
      cwd: '/work',
      model: 'haiku',
      effort: 'low',
      permissionMode: 'default',
      maxBudgetUsd: 0.1,
      maxTurnsPerMessage: 1,
      connectors: false,
      denyRules: [],
      addDirs: [],
      firstMessage: 'x',
    };
    await expect(runtime.launch(spec), 'a spawn failure that names the reason').rejects.toMatchObject({ code: 'spawn', message: expect.stringContaining('cannot run a process without a terminal') });
  });

  it('writes the names of the variables that do not reach the program to the log of the app, without their values, as a PTY session does', async () => {
    const runtime = new StreamAgentRuntime({
      sessions: {
        create: async (input) => {
          await runtime.spawn({
            session: { id: input.id!, cwd: '/work' } as never,
            resume: false,
            args: [],
            env: { NOT_CARRIED: 'value-that-stays-out' },
            environment: {
              provider: 'srt',
              // A relative file stops the launch before anything starts; the log line comes first.
              processCommand: () => Promise.resolve({ file: 'not-started', args: [], cwd: '/work', env: {}, dropped: ['NOT_CARRIED', 'BASH_FUNC_x%%'] }),
            } as never,
          });
          throw new Error('unreachable');
        },
        resume: async () => {
          throw new Error('unused');
        },
        get: () => undefined,
        close: async () => undefined,
        setPermissionMode: () => undefined,
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await runtime.launch({ sessionId: 'agent-1', folderId: 'f', title: 't', cwd: '/work', model: 'haiku', effort: 'low', permissionMode: 'default', maxBudgetUsd: 0.1, maxTurnsPerMessage: 1, connectors: false, denyRules: [], addDirs: [], firstMessage: 'x' }).catch(() => undefined);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines, 'one line with the session and the names').toContain('session agent-1: variables of the launch that do not reach the program: NOT_CARRIED, BASH_FUNC_x%%');
      expect(lines.some((line) => line.includes('value-that-stays-out')), 'no value').toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('stop and end', () => {
  it('ends an idle process gracefully: stdin closes, the process exits with code 0 and no signal', async () => {
    const h = await start();
    const spec = contractSpec(h, '/text hi');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    await h.runtime.stop(spec.sessionId);
    expect(of(spec.sessionId, 'exited')[0], 'clean exit by the app').toMatchObject({ code: 0, signal: null, byApp: true });
  });

  it('interrupts the running turn before it ends the process, so the turn gets its result', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'init');
    await h.runtime.stop(spec.sessionId);
    expect(of(spec.sessionId, 'result')[0]?.result, 'the interrupted result arrived').toMatchObject({ interrupted: true });
    expect(of(spec.sessionId, 'exited')[0], 'then a clean exit').toMatchObject({
      code: 0,
      signal: null,
      byApp: true,
    });
  });

  it('drops the queued messages instead of running them', async () => {
    const h = await start();
    const spec = contractSpec(h, '/sleep 5000');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'init');
    h.runtime.send(spec.sessionId, '/text queued');
    await h.runtime.stop(spec.sessionId);
    expect(of(spec.sessionId, 'assistant'), 'the queued message never ran').toHaveLength(0);
  });

  it('escalates from SIGTERM to SIGKILL for a process that ignores both stdin closing and SIGTERM', async () => {
    const h = await start({
      env: { FAKE_CLAUDE_STUBBORN: '1' },
      runtime: { stopGraceMs: 100, killTimeoutMs: 200 },
    });
    const spec = contractSpec(h, '/text hi');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    const [started] = of(spec.sessionId, 'started');
    await h.runtime.stop(spec.sessionId);
    expect(of(spec.sessionId, 'exited')[0], 'ended by SIGKILL').toMatchObject({
      code: null,
      signal: 'SIGKILL',
      byApp: true,
    });
    expect(alive(started!.pid), 'the process is gone').toBe(false);
  });

  it('sends SIGTERM before SIGKILL to a process that stays up after stdin closed', async () => {
    const h = await start({ env: { FAKE_CLAUDE_IGNORE_STDIN_CLOSE: '1' }, runtime: { stopGraceMs: 100, killTimeoutMs: 2000 } });
    const spec = contractSpec(h, '/text hi');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    await h.runtime.stop(spec.sessionId);
    expect(of(spec.sessionId, 'exited')[0], 'ended by SIGTERM, the gentler signal').toMatchObject({ signal: 'SIGTERM', byApp: true });
  });

  it('ends the processes the agent started, which share its process group', async () => {
    const h = await start({
      children: true,
      env: { FAKE_CLAUDE_STUBBORN: '1' },
      runtime: { stopGraceMs: 100, killTimeoutMs: 200 },
    });
    const spec = contractSpec(h, '/text hi');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    const childPid = Number(readFileSync(h.childPidFile, 'utf8'));
    expect(alive(childPid), 'the child runs before the stop').toBe(true);
    await h.runtime.stop(spec.sessionId);
    await eventually(() => !alive(childPid), 'the child of the agent ends with it');
  });

  it('ends the children of an agent that exits on its own request to end', async () => {
    const h = await start({ children: true });
    const spec = contractSpec(h, '/text hi');
    await h.runtime.launch(spec);
    await waitFor(spec.sessionId, 'result');
    const childPid = Number(readFileSync(h.childPidFile, 'utf8'));
    await h.runtime.end(spec.sessionId);
    await eventually(() => !alive(childPid), 'the child ends after the app ended the agent');
  });

  it('stops every live agent on dispose', async () => {
    const h = await start();
    const specs = [contractSpec(h, '/sleep 5000'), contractSpec(h, '/sleep 5000')];
    for (const spec of specs) await h.runtime.launch(spec);
    await h.runtime.dispose();
    expect(
      specs.map((spec) => h.runtime.isLive(spec.sessionId)),
      'no live process',
    ).toEqual([false, false]);
    expect(
      events.filter((event) => event.type === 'exited').map((event) => event.type === 'exited' && event.byApp),
      'both ended by the app',
    ).toEqual([true, true]);
  });
});
