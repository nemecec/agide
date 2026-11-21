import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LaunchPath, SessionEvent, SessionInfo } from '../session/types';
import { UsageEngine } from '../usage/UsageEngine';
import { AgentsController } from './AgentsController';
import { InMemoryAgentStore } from './InMemoryAgentStore';
import type { AgentOutcome } from './types';

const session = (id: string): SessionInfo => ({ id, folderId: 'f', title: 't', cwd: '/w', launchPath: 'pty', permissionMode: 'default', status: 'idle', createdAt: '2026-11-17T10:00:00.000Z' });

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function setup(outcomeOf?: (path: string) => AgentOutcome, maxAppStarted = 4) {
  root = mkdtempSync(join(tmpdir(), 'agents-controller-'));
  const transcript = join(root, 'projects', 'p', 's1.jsonl');
  const subagents = join(root, 'projects', 'p', 's1', 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(transcript, '');
  const clock = { now: Date.parse('2026-11-17T10:00:00.000Z') };
  const store = new InMemoryAgentStore(() => clock.now);
  const usage = new UsageEngine({ now: () => clock.now, windowMinutes: () => 5 });
  const archived: string[] = [];
  const exited: (string | undefined)[] = [];
  const launchPaths = new Map<string, LaunchPath>();
  const controller = new AgentsController({
    store,
    usage,
    now: () => clock.now,
    eventsDirOf: (id) => join(root as string, 'events', id),
    maxAppStarted: () => maxAppStarted,
    launchPathOf: (id) => launchPaths.get(id),
    ...(outcomeOf === undefined ? {} : { outcomeOf }),
    onAgentEnded: (record) => archived.push(record.ref.agentKey),
    onSessionExited: (_id, path) => exited.push(path),
  });
  const hook = (hookEvent: string, payload: object): void =>
    controller.handleSession({ type: 'session.hook', sessionId: 's1', hookEvent, payload: { session_id: 's1', transcript_path: transcript, ...payload } } as SessionEvent);
  return { controller, store, usage, hook, archived, exited, transcript, subagents, clock, launchPaths };
}

const line = (id: string, input: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-haiku-5-5', usage: { input_tokens: input, output_tokens: 1 } } });

describe('AgentsController over session hooks', () => {
  it('shows a subagent from SubagentStart to SubagentStop and hands the ended record to the archive', () => {
    const { hook, store, archived } = setup();
    hook('SubagentStart', { agent_id: 'a1', agent_type: 'general-purpose' });
    expect(store.get({ sessionId: 's1', agentKey: 'a1' })?.state, 'running').toBe('running');
    hook('SubagentStop', { agent_id: 'a1', last_assistant_message: 'ok', agent_transcript_path: '/nowhere/agent-a1.jsonl' });
    expect(store.get({ sessionId: 's1', agentKey: 'a1' }), 'done, derived').toMatchObject({ state: 'done', outcome: 'completed', outcomeBasis: 'derived', summary: 'ok' });
    expect(archived, 'archive called once').toEqual(['a1']);
  });

  it('turns an interrupted agent into stopped through the transcript check', () => {
    const { hook, store } = setup(() => 'stopped');
    hook('SubagentStart', { agent_id: 'a1' });
    hook('SubagentStop', { agent_id: 'a1', agent_transcript_path: '/x/agent-a1.jsonl' });
    expect(store.get({ sessionId: 's1', agentKey: 'a1' }), 'stopped outcome, derived').toMatchObject({ state: 'done', outcome: 'stopped', outcomeBasis: 'derived' });
  });

  it('counts the lines of the agent transcript when it stops, once per message id', () => {
    const { hook, store, usage, subagents } = setup();
    hook('SubagentStart', { agent_id: 'a1' });
    writeFileSync(join(subagents, 'agent-a1.jsonl'), `${line('m1', 100)}\n${line('m1', 100)}\n${line('m2', 50)}\n`);
    hook('SubagentStop', { agent_id: 'a1', agent_transcript_path: join(subagents, 'agent-a1.jsonl') });
    expect(store.get({ sessionId: 's1', agentKey: 'a1' })?.tokens.input, 'agent record').toBe(150);
    expect(usage.sessionTotals('s1')?.tokens.input, 'session total').toBe(150);
  });

  it('marks the session leaf for an approval without an agent and clears it when the tool runs', () => {
    const { hook, store } = setup();
    hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(store.waitingSessions(), 'waiting').toEqual(['s1']);
    hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
    expect(store.waitingSessions(), 'answered').toEqual([]);
  });

  it('ends agents still open when the process exits and reports the transcript for the last copy', () => {
    const { controller, hook, store, exited, transcript } = setup();
    hook('SubagentStart', { agent_id: 'a1' });
    controller.handleSession({ type: 'session.exited', session: session('s1'), exitCode: 0, signal: null });
    expect(store.get({ sessionId: 's1', agentKey: 'a1' }), 'lost').toMatchObject({ state: 'failed', outcome: 'lost' });
    expect(exited, 'main transcript passed on').toEqual([transcript]);
  });

  it('reads the status snapshot of a launched session into the session cost and plan', () => {
    const { controller, usage, clock } = setup();
    controller.handleSession({ type: 'session.created', session: session('s1') });
    const dir = join(root as string, 'events', 's1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'status.snapshot'), JSON.stringify({ cost: { total_cost_usd: 0.4 }, rate_limits: { five_hour: { used_percentage: 12, resets_at: Math.floor(clock.now / 1000) + 3600 } } }));
    controller.tick();
    expect(usage.sessionTotals('s1'), 'cost from the status line').toMatchObject({ costUsd: 0.4, basis: 'status-line' });
    expect(usage.plan()[0], 'plan window').toMatchObject({ window: 'five_hour', usedPercentage: 12 });
  });
});

describe('AgentsController over stream-json', () => {
  it('starts an app-started row, applies stream messages and refuses a start at the cap', () => {
    const { controller, store } = setup(undefined, 1);
    expect(controller.beginAppStarted('p1'), 'first start').toEqual({ ok: true });
    expect(store.get({ sessionId: 'p1', agentKey: 'session' })?.origin, 'app-started row').toBe('app-started');
    controller.streamMessage('p1', { type: 'system', subtype: 'task_started', task_id: 'sub1', description: 'inner', task_type: 'local_agent' });
    expect(store.get({ sessionId: 'p1', agentKey: 'sub1' })?.state, 'its subagent').toBe('running');
    expect(controller.beginAppStarted('p2'), 'cap reached').toEqual({ ok: false, reason: 'cap', running: 1, cap: 1 });
    controller.streamExited('p1');
    expect(store.get({ sessionId: 'p1', agentKey: 'session' })?.state, 'process ended').toBe('done');
    expect(controller.beginAppStarted('p2'), 'room again').toEqual({ ok: true });
  });

  it('applies the session cost of a result to the usage engine', () => {
    const { controller, usage } = setup();
    controller.beginAppStarted('p1');
    controller.streamMessage('p1', { type: 'result', total_cost_usd: 0.02 });
    expect(usage.sessionTotals('p1'), 'result cost').toMatchObject({ costUsd: 0.02, basis: 'result' });
  });

  it('adds the cost of a resumed process to what the earlier process reported', () => {
    const { controller, usage } = setup();
    controller.trackAppStarted('p1');
    controller.streamMessage('p1', { type: 'result', total_cost_usd: 0.8 });
    controller.streamExited('p1');
    controller.trackAppStarted('p1');
    controller.streamMessage('p1', { type: 'result', total_cost_usd: 0.05 });
    expect(usage.sessionTotals('p1')?.costUsd, 'the cost of both processes').toBeCloseTo(0.85, 9);
  });

  it('tracks an app-started agent whose starter already holds its slot, even at the cap', () => {
    const { controller, store } = setup(undefined, 1);
    controller.beginAppStarted('p1');
    controller.trackAppStarted('p2', { description: 'swarm agent' });
    expect(store.get({ sessionId: 'p2', agentKey: 'session' }), 'a running app-started row').toMatchObject({ origin: 'app-started', state: 'running' });
  });

  it('reads a stream-json session through the stream adapter only, keeping its transcript path for the copy at exit', () => {
    const { controller, store, usage, transcript, exited, launchPaths } = setup();
    launchPaths.set('p1', 'stream-json');
    const info = { ...session('p1'), launchPath: 'stream-json' } as const;
    controller.handleSession({ type: 'session.created', session: info });
    controller.trackAppStarted('p1');
    writeFileSync(transcript, `${line('m1', 100)}\n`);
    controller.handleSession({ type: 'session.hook', sessionId: 'p1', hookEvent: 'SessionStart', payload: { session_id: 'p1', transcript_path: transcript } });
    controller.handleSession({ type: 'session.hook', sessionId: 'p1', hookEvent: 'SubagentStart', payload: { session_id: 'p1', agent_id: 'a1' } });
    controller.streamMessage('p1', JSON.parse(line('m1', 100)));
    controller.tick();
    controller.handleSession({ type: 'session.exited', session: info, exitCode: 0, signal: null });
    expect(store.get({ sessionId: 'p1', agentKey: 'a1' }), 'no agent record from a hook').toBeUndefined();
    expect(usage.sessionTotals('p1')?.tokens.input, 'the message counted once, from the stream').toBe(100);
    expect(exited, 'the transcript from the hooks is handed on for the copy').toEqual([transcript]);
  });

  it('treats a stream-json session it never saw created, such as one resumed after an app restart, the same way', () => {
    const { controller, store, usage, transcript, launchPaths } = setup();
    launchPaths.set('p1', 'stream-json');
    controller.trackAppStarted('p1', { priorCostUsd: 0.8 });
    writeFileSync(transcript, `${line('m1', 100)}\n`);
    controller.handleSession({ type: 'session.status_changed', session: { ...session('p1'), launchPath: 'stream-json' }, previous: 'exited' });
    controller.handleSession({ type: 'session.hook', sessionId: 'p1', hookEvent: 'SessionStart', payload: { session_id: 'p1', transcript_path: transcript } });
    controller.streamMessage('p1', JSON.parse(line('m1', 100)));
    controller.streamMessage('p1', { type: 'result', total_cost_usd: 0.05 });
    controller.tick();
    expect(store.get({ sessionId: 'p1', agentKey: 'main' }), 'no session-started row').toBeUndefined();
    expect(usage.sessionTotals('p1')?.tokens.input, 'counted once').toBe(100);
    expect(usage.sessionTotals('p1')?.costUsd, 'the cost the starter knew plus the new process').toBeCloseTo(0.85, 9);
  });
});
