import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import type { ReviewerEvent } from '../types';
import type { ReviewerCheckouts } from './checkout';
import { REVIEW_PROMPT_VERSION } from './prompt';
import { StreamReviewerRuntime } from './StreamReviewerRuntime';
import { runRequest } from './reviewerRuntimeContract';

/** In-memory runtime that reads the steps a test sets instead of the prompt the runner sends. Its `init` lists no MCP tool. */
class StepAgents extends InMemoryAgentRuntime {
  steps = '/text ok';
  override async launch(spec: Parameters<InMemoryAgentRuntime['launch']>[0]): Promise<void> {
    return super.launch({ ...spec, firstMessage: this.steps });
  }
}

let root: string;
let disposed: string[];
let checkouts: ReviewerCheckouts;
let events: ReviewerEvent[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stream-reviewer-unit-'));
  disposed = [];
  events = [];
  checkouts = {
    prepare: async (request) => {
      const cwd = join(root, request.runId, 'tree');
      const inputsDir = join(root, request.runId, 'inputs');
      mkdirSync(cwd, { recursive: true });
      mkdirSync(inputsDir, { recursive: true });
      return { cwd, inputsDir, dispose: async () => void disposed.push(request.runId) };
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const endedOf = async (runId: string) => {
  await vi.waitFor(() => expect(events.some((event) => event.type === 'ended' && event.runId === runId), `run ${runId} ended`).toBe(true));
  return events.find((event): event is Extract<ReviewerEvent, { type: 'ended' }> => event.type === 'ended' && event.runId === runId)!;
};

describe('stream reviewer runtime', () => {
  it('launches in the checkout with the prompt as first message, the inputs directory and the tier table model', async () => {
    const agents = new StepAgents();
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts, tiers: { strong: { model: 'haiku', effort: 'low' }, mid: { model: 'haiku', effort: 'low' }, small: { model: 'haiku', effort: 'low' } } });
    runner.subscribe((event) => events.push(event));
    const request = runRequest({ task: 'TASKTEXT' });
    await runner.start(request);
    await endedOf(request.runId);
    const spec = agents.launches[0]!;
    expect(spec.cwd, 'the working directory is the read-only checkout').toBe(join(root, request.runId, 'tree'));
    expect(spec.addDirs, 'the inputs directory is added').toEqual([join(root, request.runId, 'inputs')]);
    expect(spec.model, 'the model comes from the tier table').toBe('haiku');
    expect(spec.denyRules, 'write and web tools are denied').toEqual(expect.arrayContaining(['Edit(**)', 'Write(**)', 'NotebookEdit(**)', 'WebFetch']));
    expect(spec.connectors, 'no connectors').toBe(false);
    expect(startedPromptVersion(events), 'the started event carries the prompt version').toBe(REVIEW_PROMPT_VERSION);
    await runner.dispose();
  });

  it('disposes the checkout when the run ends', async () => {
    const agents = new StepAgents();
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts });
    runner.subscribe((event) => events.push(event));
    const request = runRequest();
    await runner.start(request);
    await endedOf(request.runId);
    expect(disposed, 'the checkout of the run was removed').toEqual([request.runId]);
    await runner.dispose();
  });

  it('launches nothing for a run cancelled while its checkout was being prepared', async () => {
    const agents = new StepAgents();
    const launch = vi.spyOn(agents, 'launch');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: ReviewerCheckouts = { prepare: async (request) => (await gate, checkouts.prepare(request)) };
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts: slow });
    runner.subscribe((event) => events.push(event));
    const request = runRequest();
    const started = runner.start(request);
    await runner.cancel(request.runId, 'superseded');
    release();
    await started;
    expect({ launches: launch.mock.calls.length, failure: (await endedOf(request.runId)).failure }, 'no process, ended with the cancel').toEqual({ launches: 0, failure: 'superseded' });
    expect(disposed, 'the checkout was removed').toEqual([request.runId]);
    await runner.dispose();
  });

  it('ends a run as spawn and throws when the checkout cannot be made', async () => {
    const runner = new StreamReviewerRuntime({ runtime: new StepAgents(), checkouts: { prepare: async () => Promise.reject(new Error('no worktree')) } });
    runner.subscribe((event) => events.push(event));
    const request = runRequest();
    await expect(runner.start(request), 'the start fails').rejects.toThrow('no worktree');
    expect((await endedOf(request.runId)).failure, 'the run ended as a spawn failure').toBe('spawn');
  });

  it('stops a run at once as spawn when init does not list the report tool and the runner requires it', async () => {
    const agents = new StepAgents();
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts, requireReportToolListed: true });
    runner.subscribe((event) => events.push(event));
    agents.steps = '/sleep 5000';
    const request = runRequest();
    await runner.start(request);
    expect((await endedOf(request.runId)).failure, 'the app server did not connect, so the run is a spawn failure').toBe('spawn');
    await runner.dispose();
  });

  it('interrupts and stops a run that passes its timeout and reports it as a timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const agents = new StepAgents();
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts });
    runner.subscribe((event) => events.push(event));
    agents.steps = '/sleep 600000';
    const request = runRequest({ timeoutMinutes: 2 });
    await runner.start(request);
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1);
    vi.useRealTimers();
    const ended = await endedOf(request.runId);
    expect(ended.failure, 'the timeout is the failure').toBe('timeout');
    expect(agents.isLive(request.sessionId), 'the process is gone').toBe(false);
  });

  it('stops a live run and removes its checkout when the runner is disposed, without reporting an end', async () => {
    const agents = new StepAgents();
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts });
    runner.subscribe((event) => events.push(event));
    agents.steps = '/sleep 600000';
    const request = runRequest();
    await runner.start(request);
    await runner.dispose();
    expect(events.filter((event) => event.type === 'ended'), 'the manager records the end of a quit itself').toEqual([]);
    expect(disposed, 'the checkout of the live run was removed').toEqual([request.runId]);
    expect(agents.isLive(request.sessionId), 'the process is gone').toBe(false);
  });

  it('keeps the first failure when a cancel follows a failed result', async () => {
    const agents = new StepAgents();
    const runner = new StreamReviewerRuntime({ runtime: agents, checkouts });
    runner.subscribe((event) => events.push(event));
    agents.steps = '/fail budget_exhausted';
    const request = runRequest();
    await runner.start(request);
    expect((await endedOf(request.runId)).failure, 'a budget result is a budget failure').toBe('budget');
    await runner.cancel(request.runId, 'user');
    await runner.dispose();
  });
});

function startedPromptVersion(list: readonly ReviewerEvent[]): string | undefined {
  const started = list.find((event): event is Extract<ReviewerEvent, { type: 'started' }> => event.type === 'started');
  return started?.promptVersion;
}
