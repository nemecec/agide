import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentFact } from '../agents/types';
import { AlertEvaluator, type AlertThresholds } from './alerts';
import { forecast, slopePerMinute } from './forecast';
import { heatLevel } from './heat';
import { costOf, priceFor, weightedTokens } from './prices';
import { RateBuffer } from './RateBuffer';
import { rollupFolders } from './rollup';
import { SessionWatcher } from './SessionWatcher';
import { parseStatusSnapshot, snapshotFacts, statusLineCommand } from './statusLine';
import { subjectKey, type PlanWindowView, type RankedSubject } from './types';

const MIN = 60_000;

describe('price table', () => {
  it('prices by model family and weights tokens by their price relative to input', () => {
    expect(priceFor('claude-haiku-5-5')?.family, 'haiku').toBe('haiku');
    expect(priceFor('claude-opus-9')?.family, 'opus').toBe('opus');
    expect(priceFor('mystery'), 'unknown').toBeUndefined();
    const usage = { input: 0, output: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
    expect(costOf('claude-haiku-5-5', usage), 'output cost').toBe(priceFor('claude-haiku-5-5')?.output);
    expect(weightedTokens('claude-haiku-5-5', usage), 'an output token weighs the output to input ratio').toBe(5_000_000);
    expect(weightedTokens('mystery', { ...usage, output: 10 }), 'fallback ratios without a price').toBe(50);
  });
});

describe('forecast', () => {
  const samples = (percents: number[], stepMin: number) => percents.map((percent, i) => ({ at: i * stepMin * MIN, percent }));

  it('fits a least-squares slope per minute', () => {
    expect(slopePerMinute(samples([0, 5, 10, 15], 2)), 'five points per two minutes').toBeCloseTo(2.5);
    expect(slopePerMinute(samples([0, 5], 10)), 'two samples').toBeUndefined();
    expect(slopePerMinute(samples([0, 5, 10], 1)), 'spread under five minutes').toBeUndefined();
  });

  it('compares the time to full with the reset time', () => {
    const s = samples([10, 20, 30], 3);
    const now = 6 * MIN;
    expect(forecast(s, 30, now, now + 60 * MIN), 'runs out first').toMatchObject({ beforeReset: true });
    expect(forecast(s, 30, now, now + 5 * MIN), 'resets first').toMatchObject({ beforeReset: false });
    expect(forecast(samples([30, 20, 10], 3), 10, now, now + 60 * MIN), 'falling series').toBeUndefined();
  });
});

describe('heatLevel', () => {
  const t = { heatFloorUsdPerMinute: 0.01, alertUsdPerMinute: 0.5 };
  it('is none below the floor, rises with the share and tops out above the alert threshold', () => {
    expect(heatLevel(0.9, 0.005, t), 'below the floor').toBe(0);
    expect(heatLevel(0.05, 0.2, t), 'under ten percent').toBe(0);
    expect(heatLevel(0.1, 0.2, t), 'ten percent').toBe(1);
    expect(heatLevel(0.3, 0.2, t), 'thirty percent').toBe(2);
    expect(heatLevel(0.6, 0.2, t), 'sixty percent').toBe(3);
    expect(heatLevel(0.05, 0.5, t), 'at the alert threshold').toBe(3);
    expect(heatLevel(0.4, undefined, t), 'no price: the share decides').toBe(2);
  });
});

describe('RateBuffer', () => {
  it('drops buckets older than the window and keeps the cost unknown for unpriced input only', () => {
    const buffer = new RateBuffer();
    buffer.add(0, { cost: 1, tokens: 100 });
    expect(buffer.rate(60_000, 5).costPerMinute, 'one dollar over a minute').toBeCloseTo(1);
    expect(buffer.rate(6 * MIN, 5), 'out of the window: nothing counted, no cost known').toEqual({ tokensPerMinute: 0 });
    const unpriced = new RateBuffer();
    unpriced.add(0, { tokens: 60 });
    expect(unpriced.rate(60_000, 5), 'tokens only').toEqual({ tokensPerMinute: 60 });
  });
});

describe('alerts', () => {
  const thresholds: AlertThresholds = { alertUsdPerMinute: 0.5, planThresholds: [80, 95], windowMinutes: 5 };
  const ranked = (rate: number): RankedSubject => ({ subject: { kind: 'session', sessionId: 's1' }, costUsdPerMinute: rate, weightedTokensPerMinute: 1, share: 1, lastActivityAt: 0 });
  const plan = (used: number, extra: Partial<PlanWindowView> = {}): PlanWindowView => ({ window: 'five_hour', usedPercentage: used, resetsAt: '2026-11-17T15:00:00.000Z', observedAt: '2026-11-17T10:00:00.000Z', source: 'status-line', ...extra });

  it('raises a rate alert only after the rate stayed above the threshold for a whole window, once', () => {
    const evaluator = new AlertEvaluator(() => thresholds);
    expect(evaluator.evaluate({ now: 0, ranked: [ranked(0.9)], plan: [] }).raise, 'just crossed').toEqual([]);
    expect(evaluator.evaluate({ now: 4 * MIN, ranked: [ranked(0.9)], plan: [] }).raise, 'under a window').toEqual([]);
    const result = evaluator.evaluate({ now: 5 * MIN, ranked: [ranked(0.9)], plan: [] });
    expect(result.raise, 'a whole window').toHaveLength(1);
    expect(result.raise[0], 'alert content').toMatchObject({ urgency: 'normal', actions: ['open', 'pause', 'stop'], dedupeKey: `usage:rate:${subjectKey({ kind: 'session', sessionId: 's1' })}:1970-01-01T00:00:00.000Z` });
    expect(evaluator.evaluate({ now: 6 * MIN, ranked: [ranked(0.9)], plan: [] }).raise, 'not raised twice').toEqual([]);
  });

  it('restarts the window when the rate dips below the threshold', () => {
    const evaluator = new AlertEvaluator(() => thresholds);
    evaluator.evaluate({ now: 0, ranked: [ranked(0.9)], plan: [] });
    evaluator.evaluate({ now: 3 * MIN, ranked: [ranked(0.1)], plan: [] });
    expect(evaluator.evaluate({ now: 6 * MIN, ranked: [ranked(0.9)], plan: [] }).raise, 'counting starts again').toEqual([]);
  });

  it('clears the alert after the condition has been false for a whole window', () => {
    const evaluator = new AlertEvaluator(() => thresholds);
    evaluator.evaluate({ now: 0, ranked: [ranked(0.9)], plan: [] });
    const [raised] = evaluator.evaluate({ now: 5 * MIN, ranked: [ranked(0.9)], plan: [] }).raise;
    expect(evaluator.evaluate({ now: 6 * MIN, ranked: [], plan: [] }).clear, 'just below').toEqual([]);
    expect(evaluator.evaluate({ now: 11 * MIN, ranked: [], plan: [] }).clear, 'a whole window below').toEqual([raised?.dedupeKey]);
  });

  it('raises a plan alert per threshold with urgency by level and once per reset time', () => {
    const evaluator = new AlertEvaluator(() => thresholds);
    expect(evaluator.evaluate({ now: 0, ranked: [], plan: [plan(79)] }).raise, 'below the first').toEqual([]);
    const first = evaluator.evaluate({ now: 0, ranked: [], plan: [plan(82)] }).raise;
    expect(first.map((a) => [a.dedupeKey, a.urgency]), 'first threshold').toEqual([['usage:plan:five_hour:80:2026-11-17T15:00:00.000Z', 'normal']]);
    const both = evaluator.evaluate({ now: 0, ranked: [], plan: [plan(96)] }).raise;
    expect(both.map((a) => [a.dedupeKey.split(':')[3], a.urgency]), 'second threshold only, high').toEqual([['95', 'high']]);
    expect(evaluator.evaluate({ now: 0, ranked: [], plan: [plan(97)] }).raise, 'no repeat').toEqual([]);
    expect(evaluator.evaluate({ now: 0, ranked: [], plan: [plan(85, { resetsAt: '2026-11-18T00:00:00.000Z' })] }).raise, 'a new window alerts again').toHaveLength(1);
  });

  it('raises a forecast alert only when the window runs out within 30 minutes and before its reset', () => {
    const evaluator = new AlertEvaluator(() => thresholds);
    expect(evaluator.evaluate({ now: 0, ranked: [], plan: [plan(50, { runsOutInMinutes: 90, runsOutBeforeReset: true })] }).raise, 'too far').toEqual([]);
    expect(evaluator.evaluate({ now: 0, ranked: [], plan: [plan(50, { runsOutInMinutes: 20, runsOutBeforeReset: false })] }).raise, 'resets first').toEqual([]);
    const result = evaluator.evaluate({ now: 0, ranked: [], plan: [plan(50, { runsOutInMinutes: 20, runsOutBeforeReset: true })] }).raise;
    expect(result.map((a) => a.dedupeKey), 'forecast alert').toEqual(['usage:forecast:five_hour:2026-11-17T15:00:00.000Z']);
  });
});

describe('rollupFolders', () => {
  it('sums session rates into the folder and its ancestors and keeps the hottest level', () => {
    const entry = (sessionId: string, cost: number, share: number): RankedSubject => ({ subject: { kind: 'session', sessionId }, costUsdPerMinute: cost, weightedTokensPerMinute: 10, share, lastActivityAt: 0 });
    const folders = rollupFolders(
      [entry('s1', 0.2, 0.2), entry('s2', 0.3, 0.7), { subject: { kind: 'agent', ref: { sessionId: 's1', agentKey: 'a' } }, costUsdPerMinute: 9, weightedTokensPerMinute: 1, share: 1, lastActivityAt: 0 }],
      { folderOf: (id) => (id === 's1' ? 'child' : 'other'), parentOf: (id) => (id === 'child' ? 'root' : undefined) },
      { heatFloorUsdPerMinute: 0.01, alertUsdPerMinute: 0.5 },
    );
    expect(folders['child'], 'child folder').toMatchObject({ costUsdPerMinute: 0.2, sessions: 1, level: 1 });
    expect(folders['root'], 'ancestor sums its descendants and ignores agents').toMatchObject({ costUsdPerMinute: 0.2, sessions: 1 });
    expect(folders['other'], 'other folder').toMatchObject({ level: 3, sessions: 1 });
  });
});

describe('status line', () => {
  const payload = {
    session_id: 's',
    cwd: '/home/user/project',
    model: { id: 'claude-haiku-5-5', display_name: 'Haiku' },
    workspace: { current_dir: '/home/user/project' },
    cost: { total_cost_usd: 0.0136, total_duration_ms: 12616 },
    context_window: { used_percentage: 5, context_window_size: 1000000 },
    rate_limits: { five_hour: { used_percentage: 9, resets_at: 1794931800 }, seven_day: { used_percentage: 30, resets_at: 1795208400 } },
  };

  it('keeps only cost, model, context and plan windows and drops the paths', () => {
    const snapshot = parseStatusSnapshot(JSON.stringify(payload));
    expect(snapshot, 'parsed').toEqual({
      model: 'claude-haiku-5-5',
      costUsd: 0.0136,
      contextUsedPercentage: 5,
      plan: [
        { window: 'five_hour', usedPercentage: 9, resetsAt: new Date(1794931800 * 1000).toISOString() },
        { window: 'seven_day', usedPercentage: 30, resetsAt: new Date(1795208400 * 1000).toISOString() },
      ],
    });
    expect(JSON.stringify(snapshot), 'no path in the result').not.toContain('/home/user');
  });

  it('accepts the first call without cost context or plan and refuses broken input', () => {
    expect(parseStatusSnapshot('{"cost":{"total_cost_usd":0},"context_window":{"used_percentage":null},"session_id":"s"}'), 'first call').toEqual({ costUsd: 0, plan: [] });
    expect(parseStatusSnapshot('nope'), 'not json').toBeUndefined();
    expect(parseStatusSnapshot('{"cost":{"total_cost_usd":-1}}'), 'negative cost').toBeUndefined();
  });

  it('turns a snapshot into a cost fact and plan facts', () => {
    const facts: AgentFact[] = snapshotFacts('s', parseStatusSnapshot(JSON.stringify(payload))!, 'now');
    expect(facts.map((f) => f.kind), 'kinds').toEqual(['session-cost', 'plan', 'plan']);
  });

  it('builds a command that stores stdin through a temporary name and prints nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-sl-'));
    try {
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
      const run = spawnSync('/bin/sh', ['-c', statusLineCommand(dir)], { input: '{"a":1}' });
      expect(run.stdout.toString(), 'prints nothing').toBe('');
      expect(statSync(join(dir, 'status.snapshot')).isFile(), 'snapshot written').toBe(true);
      expect(existsSync(join(dir, 'status.snapshot.json')), 'never a .json file the hook inbox could take').toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SessionWatcher', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  const assistant = (id: string, input: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-haiku-5-5', usage: { input_tokens: input, output_tokens: 1 } } });

  function setup() {
    root = mkdtempSync(join(tmpdir(), 'agents-watch-'));
    const eventsDir = join(root, 'events');
    mkdirSync(eventsDir);
    const transcript = join(root, 'projects', 'p', 's1.jsonl');
    mkdirSync(join(root, 'projects', 'p', 's1', 'subagents'), { recursive: true });
    const facts: AgentFact[] = [];
    const watcher = new SessionWatcher({ sessionId: 's1', eventsDir, now: () => Date.now(), onFacts: (batch) => facts.push(...batch) });
    watcher.setTranscript(transcript);
    return { eventsDir, transcript, facts, watcher, subagents: join(root, 'projects', 'p', 's1', 'subagents') };
  }

  it('reads only appended complete lines of the main and subagent transcripts, by message id', () => {
    const { transcript, subagents, facts, watcher } = setup();
    writeFileSync(transcript, `${assistant('m1', 5)}\n${assistant('m2', 6).slice(0, 20)}`);
    watcher.poll();
    expect(facts.map((f) => (f.kind === 'usage' ? f.messageId : '')), 'the partial line waits').toEqual(['m1']);
    appendFileSync(transcript, `${assistant('m2', 6).slice(20)}\n`);
    writeFileSync(join(subagents, 'agent-a1.jsonl'), `${assistant('x1', 9)}\n`);
    watcher.poll();
    const usage = facts.filter((f): f is Extract<AgentFact, { kind: 'usage' }> => f.kind === 'usage');
    expect(usage.map((f) => `${f.ref.agentKey}:${f.messageId}`), 'main line completed, agent file found').toEqual(['main:m1', 'main:m2', 'a1:x1']);
    watcher.poll();
    expect(facts.length, 'a poll without new bytes adds nothing').toBe(3);
  });

  it('reads the status snapshot when its modification time changes', () => {
    const { eventsDir, facts, watcher } = setup();
    const file = join(eventsDir, 'status.snapshot');
    writeFileSync(file, '{"cost":{"total_cost_usd":0.5},"session_id":"s1"}');
    watcher.poll();
    watcher.poll();
    expect(facts.filter((f) => f.kind === 'session-cost'), 'one cost fact for one file version').toHaveLength(1);
    writeFileSync(file, '{"cost":{"total_cost_usd":0.7},"session_id":"s1"}');
    utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    watcher.poll();
    expect(facts.filter((f) => f.kind === 'session-cost').map((f) => (f.kind === 'session-cost' ? f.costUsd : 0)), 'second version').toEqual([0.5, 0.7]);
  });

  it('skips a line over the size limit and reads the next one', () => {
    const { transcript, facts, watcher } = setup();
    writeFileSync(transcript, `${'x'.repeat(1024 * 1024 + 10)}\n${assistant('after', 1)}\n`);
    watcher.poll();
    expect(facts.map((f) => (f.kind === 'usage' ? f.messageId : '')), 'the long line is dropped').toEqual(['after']);
  });

  it('finishes with the cost-state of the exit and reports whether an agent finished', () => {
    const { transcript, subagents, facts, watcher } = setup();
    writeFileSync(transcript, `${assistant('m1', 1)}\n{"type":"cost-state","totalCostUSD":0.0142}\n`);
    writeFileSync(join(subagents, 'agent-a1.meta.json'), '{"finished":true}');
    watcher.finish();
    expect(facts.at(-1), 'exit cost').toMatchObject({ kind: 'session-cost', costUsd: 0.0142, basis: 'cost-state' });
    expect(watcher.agentFinished('a1'), 'finished agent').toBe(true);
    expect(watcher.agentFinished('a2'), 'no metadata').toBe(false);
  });

  it('removes stale temporary files that the status command left and keeps fresh ones', () => {
    const { eventsDir, watcher } = setup();
    const stale = join(eventsDir, 'tmp-old');
    const fresh = join(eventsDir, 'tmp-new');
    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'x');
    utimesSync(stale, new Date(Date.now() - 5 * MIN), new Date(Date.now() - 5 * MIN));
    const late = new SessionWatcher({ sessionId: 's1', eventsDir, now: () => Date.now() + 30_000, onFacts: () => {} });
    late.poll();
    watcher.poll();
    expect(existsSync(stale), 'stale file removed').toBe(false);
    expect(existsSync(fresh), 'fresh file kept').toBe(true);
  });

  it('removes a stale temporary directory and keeps sweeping the entries after it', () => {
    const { eventsDir, watcher } = setup();
    const staleDir = join(eventsDir, 'tmp-aaaaaa');
    const staleFile = join(eventsDir, 'tmp-zzzzzz');
    mkdirSync(staleDir);
    writeFileSync(join(staleDir, 'p'), 'x');
    writeFileSync(staleFile, 'x');
    for (const path of [staleDir, staleFile]) utimesSync(path, new Date(Date.now() - 5 * MIN), new Date(Date.now() - 5 * MIN));
    watcher.poll();
    expect(existsSync(staleDir), 'stale directory removed').toBe(false);
    expect(existsSync(staleFile), 'the file after it is removed too').toBe(false);
  });
});
