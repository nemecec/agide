import { describe, expect, it } from 'vitest';
import type { AgentFact, AgentRecord, AgentRef, AgentStore, TokenUsage } from './types';

const ref = (agentKey: string, sessionId = 's1'): AgentRef => ({ sessionId, agentKey });
const usage = (input: number, output = 0): TokenUsage => ({ input, output, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
const started = (agentKey: string, at = '2026-11-17T10:00:00.000Z'): AgentFact => ({ kind: 'started', ref: ref(agentKey), at, agentType: 'general-purpose', description: 'Read files' });

/**
 * Behaviour every `AgentStore` shows (0027 section 2). `create(now)` gets a controlled clock in milliseconds,
 * which drives the pending list of facts that arrive before their `started`.
 */
export function describeAgentStoreContract(name: string, create: (now: () => number) => AgentStore): void {
  describe(`${name} (AgentStore contract)`, () => {
    let clock = 0;
    const now = () => clock;

    it('runs an agent from start to done and keeps the outcome with its basis', () => {
      const store = create(now);
      store.apply(started('a1'));
      expect(store.get(ref('a1'))?.state, 'after start').toBe('running');
      store.apply({ kind: 'ended', ref: ref('a1'), at: '2026-11-17T10:01:00.000Z', outcome: 'completed', basis: 'derived', summary: 'done' });
      expect(store.get(ref('a1')), 'after end').toMatchObject({ state: 'done', outcome: 'completed', outcomeBasis: 'derived', endedAt: '2026-11-17T10:01:00.000Z' });
    });

    it('puts failed, denied and lost outcomes in the failed state and stopped in done', () => {
      const store = create(now);
      for (const outcome of ['failed', 'denied', 'lost', 'stopped'] as const) {
        store.apply(started(outcome));
        store.apply({ kind: 'ended', ref: ref(outcome), at: '2026-11-17T10:01:00.000Z', outcome, basis: 'reported' });
      }
      expect(store.list().map((record) => [record.ref.agentKey, record.state]), 'states').toEqual([
        ['failed', 'failed'],
        ['denied', 'failed'],
        ['lost', 'failed'],
        ['stopped', 'done'],
      ]);
    });

    it('waits on an exact request and returns to running when every request is answered', () => {
      const store = create(now);
      store.apply(started('a1'));
      store.apply({ kind: 'waiting', ref: ref('a1'), at: 't', requestKey: 'r1', attribution: 'exact' });
      store.apply({ kind: 'waiting', ref: ref('a1'), at: 't', requestKey: 'r2', attribution: 'exact' });
      expect(store.get(ref('a1'))?.state, 'waiting').toBe('waiting');
      store.apply({ kind: 'answered', ref: ref('a1'), at: 't', requestKey: 'r1' });
      expect(store.get(ref('a1'))?.state, 'one request still open').toBe('waiting');
      store.apply({ kind: 'answered', ref: ref('a1'), at: 't', requestKey: 'r2' });
      expect(store.get(ref('a1'))?.state, 'all answered').toBe('running');
    });

    it('marks the session, not a guessed agent, for a request on main', () => {
      const store = create(now);
      store.apply(started('a1'));
      store.apply({ kind: 'waiting', ref: ref('main'), at: 't', requestKey: 'r1', attribution: 'session' });
      expect(store.waitingSessions(), 'session marker').toEqual(['s1']);
      expect(store.get(ref('a1'))?.state, 'agent unchanged').toBe('running');
      expect(store.get(ref('main')), 'no record for main').toBeUndefined();
      store.apply({ kind: 'answered', ref: ref('main'), at: 't' });
      expect(store.waitingSessions(), 'marker cleared by an answer for every request').toEqual([]);
    });

    it('revives an ended agent that starts again', () => {
      const store = create(now);
      store.apply(started('a1'));
      store.apply({ kind: 'ended', ref: ref('a1'), at: 't', outcome: 'completed', basis: 'derived' });
      store.apply(started('a1', '2026-11-17T10:05:00.000Z'));
      const record = store.get(ref('a1'));
      expect(record?.state, 'running again').toBe('running');
      expect(record?.endedAt, 'end cleared').toBeUndefined();
      expect(record?.outcome, 'outcome cleared').toBeUndefined();
    });

    it('counts each message id once and replaces its usage when the line repeats', () => {
      const store = create(now);
      store.apply(started('a1'));
      store.apply({ kind: 'usage', ref: ref('a1'), at: 't', messageId: 'm1', usage: usage(10, 5) });
      store.apply({ kind: 'usage', ref: ref('a1'), at: 't', messageId: 'm1', usage: usage(10, 5) });
      store.apply({ kind: 'usage', ref: ref('a1'), at: 't', messageId: 'm2', usage: usage(3) });
      store.apply({ kind: 'usage', ref: ref('a1'), at: 't', messageId: 'm2', usage: usage(4) });
      expect(store.get(ref('a1'))?.tokens, 'totals').toMatchObject({ input: 14, output: 5 });
    });

    it('keeps facts that arrive before their start for a few seconds and drops them later', () => {
      const store = create(now);
      clock = 0;
      store.apply({ kind: 'ended', ref: ref('early'), at: 't', outcome: 'completed', basis: 'reported' });
      store.apply(started('early'));
      expect(store.get(ref('early'))?.state, 'reordered end applied after the start').toBe('done');
      store.apply({ kind: 'progress', ref: ref('late'), at: 't', lastTool: 'Read' });
      clock = 10_000;
      store.apply(started('other'));
      store.apply(started('late'));
      expect(store.get(ref('late'))?.lastTool, 'expired fact dropped').toBeUndefined();
      clock = 0;
    });

    it('tells app-started rows from session-started ones and reports every change', () => {
      const store = create(now);
      const changes: (readonly AgentRecord[])[] = [];
      store.subscribe((changed) => changes.push(changed));
      store.apply({ kind: 'started', ref: ref('session', 's2'), at: 't' });
      store.apply(started('a1'));
      expect(store.get(ref('session', 's2'))?.origin, 'app-started').toBe('app-started');
      expect(store.get(ref('a1'))?.origin, 'session-started').toBe('session-started');
      store.remove(ref('a1'));
      expect(store.get(ref('a1')), 'removed').toBeUndefined();
      expect(changes.length, 'two starts and a removal').toBe(3);
      expect(store.list({ sessionId: 's2' }).length, 'filter by session').toBe(1);
    });
  });
}
