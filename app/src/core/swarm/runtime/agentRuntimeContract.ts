import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentLaunchSpec, AgentRuntime, RuntimeEvent } from './types';

/** What the contract suite gets per test: a runtime and a working directory for its agents. */
export interface RuntimeHarness {
  readonly runtime: AgentRuntime;
  readonly cwd: string;
  /** The folder the agents' sessions belong to. */
  readonly folderId: string;
  close(): Promise<void>;
}

export interface RuntimeContractOptions {
  /** Skips the suite with `[pending <owner>]` in its title, for a runtime not built yet. */
  readonly pending?: string;
  /** Skips the suite with `[unavailable: <reason>]` in its title, for a host without what the runtime needs. */
  readonly unavailable?: string;
  /** Upper bound for one wait on an event. */
  readonly timeoutMs?: number;
}

/** A launch spec for the suite; tests change single fields. */
export function contractSpec(harness: RuntimeHarness, firstMessage: string, overrides: Partial<AgentLaunchSpec> = {}): AgentLaunchSpec {
  return {
    sessionId: randomUUID(),
    folderId: harness.folderId,
    title: 'contract agent',
    cwd: harness.cwd,
    model: 'haiku',
    effort: 'low',
    permissionMode: 'default',
    maxBudgetUsd: 0.25,
    maxTurnsPerMessage: 10,
    connectors: false,
    denyRules: [],
    addDirs: [],
    firstMessage,
    ...overrides,
  };
}

/**
 * Behaviour every `AgentRuntime` shows (0037 section 2), driven through the step language of `fakeScript.ts`.
 * The in-memory runtime runs it directly; the stream-json runtime runs it against `fixtures/fake-claude-stream.mjs`.
 */
export function describeAgentRuntimeContract(name: string, setup: () => Promise<RuntimeHarness>, options: RuntimeContractOptions = {}): void {
  const title =
    options.pending !== undefined
      ? `${name} (AgentRuntime contract) [pending ${options.pending}]`
      : options.unavailable !== undefined
        ? `${name} (AgentRuntime contract) [unavailable: ${options.unavailable}]`
        : `${name} (AgentRuntime contract)`;
  const suite = options.pending !== undefined || options.unavailable !== undefined ? describe.skip : describe;
  const timeoutMs = options.timeoutMs ?? 5_000;

  suite(title, () => {
    let harness: RuntimeHarness;
    let events: RuntimeEvent[];
    let unsubscribe: () => void;

    beforeEach(async () => {
      harness = await setup();
      events = [];
      unsubscribe = harness.runtime.subscribe((event) => events.push(event));
    });
    afterEach(async () => {
      unsubscribe();
      await harness.runtime.dispose();
      await harness.close();
    });

    const of = <T extends RuntimeEvent['type']>(sessionId: string, type: T): Extract<RuntimeEvent, { type: T }>[] =>
      events.filter((event): event is Extract<RuntimeEvent, { type: T }> => event.type === type && event.sessionId === sessionId);

    const waitFor = async <T extends RuntimeEvent['type']>(sessionId: string, type: T, count = 1): Promise<Extract<RuntimeEvent, { type: T }>[]> => {
      const deadline = Date.now() + timeoutMs;
      while (of(sessionId, type).length < count) {
        if (Date.now() > deadline) throw new Error(`no ${count} ${type} event(s) for ${sessionId} within ${timeoutMs} ms; saw ${events.map((event) => event.type).join(', ')}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return of(sessionId, type);
    };

    it('writes the first message at launch and reports init, the assistant text and a successful result', async () => {
      const spec = contractSpec(harness, '/text hello from the agent');
      await harness.runtime.launch(spec);
      const [result] = await waitFor(spec.sessionId, 'result');
      expect(of(spec.sessionId, 'started')[0]?.resumed, 'a launch is not a resume').toBe(false);
      expect(of(spec.sessionId, 'init')[0], 'init names the CLI mode and the model').toMatchObject({ permissionMode: 'default', model: expect.stringContaining('haiku') });
      expect(
        of(spec.sessionId, 'assistant').map((event) => event.text),
        'assistant text',
      ).toContain('hello from the agent');
      expect(result?.result, 'the result').toMatchObject({ subtype: 'success', isError: false, text: 'hello from the agent', interrupted: false });
      expect(harness.runtime.isLive(spec.sessionId), 'the process stays alive after a turn').toBe(true);
      expect(harness.runtime.isBusy(spec.sessionId), 'no turn runs after the result').toBe(false);
      expect(of(spec.sessionId, 'message').length, 'raw messages are passed on').toBeGreaterThan(0);
    });

    it('holds a message sent during a turn until the turn ends, so each message has its own result', async () => {
      const spec = contractSpec(harness, '/sleep 150\n/text first');
      await harness.runtime.launch(spec);
      harness.runtime.send(spec.sessionId, '/text second');
      const results = await waitFor(spec.sessionId, 'result', 2);
      expect(
        results.map((event) => event.result.text),
        'results in order',
      ).toEqual(['first', 'second']);
    });

    it('reports no remaining work at a result with nothing queued, and remaining work when a message waits', async () => {
      const busyAtResult: boolean[] = [];
      const spec = contractSpec(harness, '/sleep 100\n/text one');
      harness.runtime.subscribe((event) => {
        if (event.type === 'result' && event.sessionId === spec.sessionId) busyAtResult.push(harness.runtime.isBusy(spec.sessionId));
      });
      await harness.runtime.launch(spec);
      harness.runtime.send(spec.sessionId, '/text two');
      await waitFor(spec.sessionId, 'result', 2);
      expect(busyAtResult, 'busy at the first result, idle at the last').toEqual([true, false]);
    });

    it('turns a tool call into a permission request and runs it after an allow', async () => {
      const spec = contractSpec(harness, '/tool Write {"file_path":"a.txt","content":"one"}\n/text written');
      await harness.runtime.launch(spec);
      const [request] = await waitFor(spec.sessionId, 'permission_request');
      expect(request?.request, 'the raw request').toMatchObject({ subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a.txt', content: 'one' } });
      expect(harness.runtime.isBusy(spec.sessionId), 'the turn waits for the answer').toBe(true);
      harness.runtime.answer(spec.sessionId, request!.requestId, { behavior: 'allow', updatedInput: request!.request.input });
      const [result] = await waitFor(spec.sessionId, 'result');
      expect(result?.result, 'an allowed call leaves no denial').toMatchObject({ subtype: 'success', permissionDenials: [] });
    });

    it('records a denied call in the result', async () => {
      const spec = contractSpec(harness, '/tool Bash {"command":"rm -rf build"}\n/text gave up');
      await harness.runtime.launch(spec);
      const [request] = await waitFor(spec.sessionId, 'permission_request');
      harness.runtime.answer(spec.sessionId, request!.requestId, { behavior: 'deny', message: 'The user denied this call in Agide.' });
      const [result] = await waitFor(spec.sessionId, 'result');
      expect(result?.result.permissionDenials, 'one denial').toHaveLength(1);
    });

    it('interrupts a turn with an open request: the request is cancelled, the result is marked interrupted, the process stays', async () => {
      const spec = contractSpec(harness, '/tool Write {"file_path":"b.txt","content":"two"}');
      await harness.runtime.launch(spec);
      const [request] = await waitFor(spec.sessionId, 'permission_request');
      await harness.runtime.interrupt(spec.sessionId);
      expect(
        of(spec.sessionId, 'permission_cancelled').map((event) => event.requestId),
        'the open request is cancelled',
      ).toEqual([request!.requestId]);
      expect(of(spec.sessionId, 'result')[0]?.result, 'interrupted result').toMatchObject({ isError: true, interrupted: true, terminalReason: 'aborted_tools' });
      expect(harness.runtime.isLive(spec.sessionId), 'alive after an interrupt').toBe(true);
      harness.runtime.send(spec.sessionId, '/text still here');
      const results = await waitFor(spec.sessionId, 'result', 2);
      expect(results[1]?.result.text, 'the next message runs').toBe('still here');
    });

    it('resolves an interrupt at once when no turn runs', async () => {
      const spec = contractSpec(harness, '/text idle soon');
      await harness.runtime.launch(spec);
      await waitFor(spec.sessionId, 'result');
      await harness.runtime.interrupt(spec.sessionId);
      expect(of(spec.sessionId, 'result'), 'no extra result').toHaveLength(1);
    });

    it('interrupts the running turn for a message sent with now and runs the message next', async () => {
      const spec = contractSpec(harness, '/sleep 5000\n/text never');
      await harness.runtime.launch(spec);
      await waitFor(spec.sessionId, 'init');
      harness.runtime.send(spec.sessionId, '/text steered', { now: true });
      const results = await waitFor(spec.sessionId, 'result', 2);
      expect(
        results.map((event) => [event.result.interrupted, event.result.text]),
        'interrupted turn, then the message',
      ).toEqual([
        [true, undefined],
        [false, 'steered'],
      ]);
    });

    it('ends the process after the running turn when asked to end', async () => {
      const spec = contractSpec(harness, '/sleep 100\n/text last');
      await harness.runtime.launch(spec);
      await harness.runtime.end(spec.sessionId);
      expect(of(spec.sessionId, 'result')[0]?.result.text, 'the turn finished first').toBe('last');
      expect(of(spec.sessionId, 'exited')[0], 'exit by the app').toMatchObject({ code: 0, byApp: true });
      expect(harness.runtime.isLive(spec.sessionId), 'no live process').toBe(false);
    });

    it('stops a process in the middle of a turn', async () => {
      const spec = contractSpec(harness, '/sleep 5000');
      await harness.runtime.launch(spec);
      await waitFor(spec.sessionId, 'init');
      await harness.runtime.stop(spec.sessionId);
      expect(of(spec.sessionId, 'exited')[0]?.byApp, 'stopped by the app').toBe(true);
      expect(harness.runtime.isLive(spec.sessionId), 'no live process').toBe(false);
      expect(() => harness.runtime.send(spec.sessionId, 'more'), 'a message to an ended process is refused').toThrow(expect.objectContaining({ code: 'not_running' }));
    });

    it('resumes an ended session, counts cost from zero in the new process, and refuses a second live process or a reused id', async () => {
      const spec = contractSpec(harness, '/cost 0.02\n/text first life');
      await harness.runtime.launch(spec);
      const [first] = await waitFor(spec.sessionId, 'result');
      await harness.runtime.end(spec.sessionId);
      await expect(harness.runtime.launch(spec), 'a launch with a used id fails').rejects.toMatchObject({ code: 'spawn' });
      await harness.runtime.resume({ ...spec, firstMessage: '/text second life' });
      await expect(harness.runtime.resume(spec), 'one live process per session').rejects.toMatchObject({ code: 'already_running' });
      const results = await waitFor(spec.sessionId, 'result', 2);
      expect(
        of(spec.sessionId, 'started').map((event) => event.resumed),
        'launch then resume',
      ).toEqual([false, true]);
      expect(results[1]?.result.text, 'the resumed turn').toBe('second life');
      expect(results[1]!.result.totalCostUsd, 'the resumed process counts from zero').toBeLessThan(first!.result.totalCostUsd);
    });

    it('refuses to resume a session id that was never launched', async () => {
      const spec = contractSpec(harness, '/text never');
      await expect(harness.runtime.resume(spec), 'an unknown id').rejects.toMatchObject({ code: 'not_found' });
      expect(harness.runtime.isLive(spec.sessionId), 'no process for the unknown id').toBe(false);
    });

    it('ends the turn that crosses --max-budget-usd with error_max_budget_usd and answers later messages the same way without a model call', async () => {
      const spec = contractSpec(harness, '/text spend\n/cost 0.5', { maxBudgetUsd: 0.25 });
      await harness.runtime.launch(spec);
      const [crossing] = await waitFor(spec.sessionId, 'result');
      expect(crossing?.result, 'the crossing turn').toMatchObject({ subtype: 'error_max_budget_usd', isError: true, terminalReason: 'budget_exhausted' });
      const assistantsBefore = of(spec.sessionId, 'assistant').length;
      harness.runtime.send(spec.sessionId, '/text more');
      const results = await waitFor(spec.sessionId, 'result', 2);
      expect(results[1]?.result.subtype, 'later message').toBe('error_max_budget_usd');
      expect(of(spec.sessionId, 'assistant').length, 'no model call after the budget').toBe(assistantsBefore);
    });

    it('reports an error result with its terminal reason', async () => {
      const spec = contractSpec(harness, '/fail api_error');
      await harness.runtime.launch(spec);
      const [result] = await waitFor(spec.sessionId, 'result');
      expect(result?.result, 'error result').toMatchObject({ isError: true, terminalReason: 'api_error', interrupted: false });
    });

    it('reports a process that exits on its own with its code and no result', async () => {
      const spec = contractSpec(harness, '/exit 3');
      await harness.runtime.launch(spec);
      const [exited] = await waitFor(spec.sessionId, 'exited');
      expect(exited, 'exit').toMatchObject({ code: 3, byApp: false });
      expect(of(spec.sessionId, 'result'), 'no result').toHaveLength(0);
    });

    it('answers initialize with the models list', async () => {
      const spec = contractSpec(harness, '/text ready');
      await harness.runtime.launch(spec);
      await waitFor(spec.sessionId, 'result');
      const answer = await harness.runtime.control(spec.sessionId, { subtype: 'initialize' });
      const models = (answer['models'] as { value: string }[]).map((model) => model.value);
      expect(models, 'the tier aliases').toEqual(expect.arrayContaining(['fable', 'sonnet', 'haiku']));
    });
  });
}
