import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import type { ReviewRunRequest, ReviewerRuntime } from '../types';
import type { ReviewerCheckouts } from './checkout';
import { InMemoryReviewerRuntime } from './InMemoryReviewerRuntime';
import { StreamReviewerRuntime } from './StreamReviewerRuntime';
import { describeReviewerRuntimeContract, type ReviewerHarness } from './reviewerRuntimeContract';

async function inMemory(): Promise<ReviewerHarness> {
  const agents = new InMemoryAgentRuntime();
  let script: (request: ReviewRunRequest) => string = () => '/text nothing';
  const reportCalls: ReviewerHarness['reportCalls'] = [];
  const reviewer = new InMemoryReviewerRuntime({
    runtime: agents,
    script: (request) => script(request),
    onReportCall: async (sessionId, input) => void reportCalls.push({ sessionId, input }),
  });
  return {
    reviewer,
    agents,
    reportCalls,
    setScript: (next) => {
      script = next;
    },
    close: async () => {
      await reviewer.dispose();
      await agents.dispose();
    },
  };
}

describeReviewerRuntimeContract('in-memory reviewer runtime', inMemory);

/** An in-memory agent runtime that reads the step script of the test instead of the prompt the runner sends. */
class ScriptedAgents extends InMemoryAgentRuntime {
  script: (request: ReviewRunRequest) => string = () => '/text nothing';
  readonly requests = new Map<string, ReviewRunRequest>();
  override async launch(spec: Parameters<InMemoryAgentRuntime['launch']>[0]): Promise<void> {
    const request = this.requests.get(spec.sessionId);
    return super.launch({ ...spec, firstMessage: request === undefined ? spec.firstMessage : this.script(request) });
  }
}

/** The stream reviewer runner with its checkout, prompt and launch spec, over the in-memory agent runtime. */
async function streamRunner(): Promise<ReviewerHarness> {
  const agents = new ScriptedAgents();
  const root = mkdtempSync(join(tmpdir(), 'stream-reviewer-'));
  const checkouts: ReviewerCheckouts = {
    prepare: async (request) => {
      const cwd = join(root, request.runId, 'tree');
      const inputsDir = join(root, request.runId, 'inputs');
      mkdirSync(cwd, { recursive: true });
      mkdirSync(inputsDir, { recursive: true });
      return { cwd, inputsDir, dispose: async () => rmSync(join(root, request.runId), { recursive: true, force: true }) };
    },
  };
  const reportCalls: ReviewerHarness['reportCalls'] = [];
  const runner = new StreamReviewerRuntime({ runtime: agents, checkouts, onReportCall: async (sessionId, input) => void reportCalls.push({ sessionId, input }) });
  const reviewer: ReviewerRuntime = {
    start: (request) => {
      agents.requests.set(request.sessionId, request);
      return runner.start(request);
    },
    cancel: (runId, why) => runner.cancel(runId, why),
    subscribe: (listener) => runner.subscribe(listener),
    dispose: () => runner.dispose(),
  };
  return {
    reviewer,
    agents,
    reportCalls,
    setScript: (next) => {
      agents.script = next;
    },
    close: async () => {
      await reviewer.dispose();
      await agents.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describeReviewerRuntimeContract('stream reviewer runner', streamRunner);
