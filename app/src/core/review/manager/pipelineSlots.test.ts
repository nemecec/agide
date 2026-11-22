import { describe, expect, it } from 'vitest';
import { reviewPolicySchema } from '../policy/schema';
import { catalogueReason } from '../fakes/fakes';
import { changesetIdOf } from '../fakes/fixtures';
import type { AssessInput, CheckExecutor, CheckOutcomeSet, CheckRequest, ReviewerEvent, ReviewerRuntime, ReviewRunRequest, RiskRules } from '../types';
import { SwitchableChecks, SwitchableReviewer, SwitchableRules } from './pipelineSlots';

const request = (): CheckRequest => ({
  changesetId: changesetIdOf('slots'),
  swarmId: 'sw1',
  commonDir: '/repo/.git',
  checkpointCommit: 'c'.repeat(40),
  baseCommit: 'b'.repeat(40),
  policyHash: 'p'.repeat(64),
  policy: reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }),
});

describe('the unconnected rules slot', () => {
  it('fails closed with check.not_run, which is a reason for a person', () => {
    const slot = new SwitchableRules();
    const reasons = slot.assess({} as AssessInput);
    expect(slot.connected, 'not connected').toBe(false);
    expect(reasons.map((reason) => reason.id), 'one reason').toEqual(['check.not_run']);
    expect(reasons[0]?.minRung, 'above rung A, so nothing is accepted on its own').not.toBe('A');
  });

  it('hands over to the rules once they are connected', () => {
    const slot = new SwitchableRules();
    const connected: RiskRules = { assess: () => [catalogueReason('size.medium')] };
    slot.connect(connected);
    expect([slot.connected, slot.assess({} as AssessInput).map((reason) => reason.id)], 'the connected rules answer').toEqual([true, ['size.medium']]);
  });
});

describe('the unconnected check slot', () => {
  it('answers not_run with the command of the policy and no exit code', async () => {
    const slot = new SwitchableChecks();
    const outcome = await slot.run(request());
    expect(slot.connected, 'not connected').toBe(false);
    expect(outcome.checkpoint, 'a not_run record that names why').toMatchObject({ outcome: 'not_run', command: ['pnpm', 'test'], exitCode: null, notRunReason: 'the review pipeline is not connected' });
    expect(outcome.base, 'no base run').toBeUndefined();
    await expect(slot.cancel(request().changesetId), 'cancelling needs nothing').resolves.toBeUndefined();
  });

  it('answers with an empty command when the policy has no check', async () => {
    const outcome = await new SwitchableChecks().run({ ...request(), policy: reviewPolicySchema.parse({ version: 1 }) });
    expect(outcome.checkpoint.command, 'no command').toEqual([]);
  });

  it('forwards runs and cancellations once connected', async () => {
    const slot = new SwitchableChecks();
    const seen: string[] = [];
    const target: CheckExecutor = {
      run: async (given): Promise<CheckOutcomeSet> => {
        seen.push(`run ${given.changesetId}`);
        return (await new SwitchableChecks().run(given));
      },
      cancel: async (id) => void seen.push(`cancel ${id}`),
    };
    slot.connect(target);
    await slot.run(request());
    await slot.cancel(request().changesetId);
    expect(seen, 'both reached the target').toEqual([`run ${request().changesetId}`, `cancel ${request().changesetId}`]);
  });
});

describe('the unconnected reviewer slot', () => {
  const run = (): ReviewRunRequest => ({ runId: 'run_1', sessionId: 'session-1' }) as ReviewRunRequest;

  it('ends a run at once with a spawn failure and no cost', async () => {
    const slot = new SwitchableReviewer();
    const events: ReviewerEvent[] = [];
    slot.subscribe((event) => events.push(event));
    await slot.start(run());
    await Promise.resolve();
    expect(slot.connected, 'not connected').toBe(false);
    expect(events, 'the run ended without a report').toEqual([{ type: 'ended', runId: 'run_1', sessionId: 'session-1', costUsd: 0, failure: 'spawn', deniedRequests: 0 }]);
    await expect(slot.cancel('run_1', 'user'), 'cancelling needs nothing').resolves.toBeUndefined();
    await expect(slot.dispose(), 'disposing needs nothing').resolves.toBeUndefined();
  });

  it('passes the events of the connected runner on and replaces an earlier runner', async () => {
    const slot = new SwitchableReviewer();
    const events: ReviewerEvent[] = [];
    slot.subscribe((event) => events.push(event));
    const listeners: ((event: ReviewerEvent) => void)[] = [];
    const calls: string[] = [];
    const runner = (name: string): ReviewerRuntime => ({
      start: async () => void calls.push(`${name} start`),
      cancel: async (id, why) => void calls.push(`${name} cancel ${id} ${why}`),
      subscribe: (listener) => {
        listeners.push(listener);
        return () => void listeners.splice(listeners.indexOf(listener), 1);
      },
      dispose: async () => void calls.push(`${name} dispose`),
    });
    slot.connect(runner('first'));
    slot.connect(runner('second'));
    expect(listeners.length, 'the first runner is no longer listened to').toBe(1);
    await slot.start(run());
    await slot.cancel('run_1', 'timeout');
    listeners[0]!({ type: 'started', runId: 'run_1', sessionId: 'session-1', model: 'm' } as ReviewerEvent);
    await slot.dispose();
    expect(calls, 'the second runner got every call').toEqual(['second start', 'second cancel run_1 timeout', 'second dispose']);
    expect(events.map((event) => event.type), 'its event reached the listener of the slot').toEqual(['started']);
    expect(listeners.length, 'disposing stops listening').toBe(0);
  });
});

