import { describe, expect, it } from 'vitest';
import { StreamNormaliser } from './streamAdapter';

const S = 'proc-1';
const T = '2026-11-17T10:00:00.000Z';
// Shapes follow the P5 stream-json logs with ids replaced.
const started = { type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'toolu_1', description: 'Write file', subagent_type: 'general-purpose', is_backgrounded: false, task_type: 'local_agent' };
const canUseTool = (requestId: string, agentId?: string) => ({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: 'Write', input: {}, ...(agentId === undefined ? {} : { agent_id: agentId }) } });
const notification = (status: string) => ({ type: 'system', subtype: 'task_notification', task_id: 'a1', status, summary: 'summary', usage: { total_tokens: 22953, tool_uses: 1, duration_ms: 3149 } });

describe('StreamNormaliser', () => {
  it('starts an agent from task_started and reports progress', () => {
    const n = new StreamNormaliser(S);
    expect(n.message(started, T), 'started').toEqual([
      { kind: 'started', ref: { sessionId: S, agentKey: 'a1' }, at: T, agentId: 'a1', agentType: 'general-purpose', description: 'Write file', toolUseId: 'toolu_1' },
    ]);
    expect(n.message({ type: 'system', subtype: 'task_progress', task_id: 'a1', last_tool_name: 'Write', description: 'Writing' }, T), 'progress').toEqual([
      { kind: 'progress', ref: { sessionId: S, agentKey: 'a1' }, at: T, lastTool: 'Write', text: 'Writing' },
    ]);
  });

  it('ends with the reported status and the token total from task_notification', () => {
    const n = new StreamNormaliser(S);
    n.message(started, T);
    expect(n.message(notification('failed'), T), 'failed end').toEqual([
      { kind: 'ended', ref: { sessionId: S, agentKey: 'a1' }, at: T, outcome: 'failed', basis: 'reported', summary: 'summary', totalTokens: 22953 },
    ]);
  });

  it('waits on the agent named by agent_id and on the process row without one', () => {
    const n = new StreamNormaliser(S);
    n.message(started, T);
    expect(n.message(canUseTool('r1', 'a1'), T)[0], 'exact').toMatchObject({ kind: 'waiting', ref: { agentKey: 'a1' }, attribution: 'exact', requestKey: 'r1' });
    expect(n.message(canUseTool('r2'), T)[0], 'session').toMatchObject({ kind: 'waiting', ref: { agentKey: 'session' }, attribution: 'session' });
  });

  it('answers a request from the app response and turns a denied agent end into denied with basis derived', () => {
    const n = new StreamNormaliser(S);
    n.message(started, T);
    n.message(canUseTool('r1', 'a1'), T);
    expect(n.controlResponse('r1', 'deny', T), 'answered').toEqual([{ kind: 'answered', ref: { sessionId: S, agentKey: 'a1' }, at: T, requestKey: 'r1' }]);
    expect(n.message(notification('completed'), T)[0], 'a host denial ends as completed in the stream (P5)').toMatchObject({ kind: 'ended', outcome: 'denied', basis: 'derived' });
  });

  it('keeps a completed outcome when the app allowed the request', () => {
    const n = new StreamNormaliser(S);
    n.message(started, T);
    n.message(canUseTool('r1', 'a1'), T);
    n.controlResponse('r1', 'allow', T);
    expect(n.message(notification('completed'), T)[0], 'completed').toMatchObject({ outcome: 'completed', basis: 'reported' });
  });

  it('takes the session cost from each result, replacing the earlier one', () => {
    const n = new StreamNormaliser(S);
    expect(n.message({ type: 'result', total_cost_usd: 0.005 }, T), 'first').toEqual([{ kind: 'session-cost', sessionId: S, at: T, costUsd: 0.005, basis: 'result' }]);
    expect(n.message({ type: 'result', total_cost_usd: 0.011 }, T)[0], 'second carries the cumulative value').toMatchObject({ costUsd: 0.011 });
  });

  it('reads plan windows from a rate_limit_event as percentages with ISO reset times', () => {
    const facts = new StreamNormaliser(S).message(
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.15, resetsAt: 1794913800 }, seven_day: { utilization: 0.19, resetsAt: 1795208400 } } } },
      T,
    );
    expect(facts, 'two windows').toEqual([
      { kind: 'plan', at: T, window: 'five_hour', usedPercentage: 15, resetsAt: new Date(1794913800 * 1000).toISOString(), source: 'rate-limit-event' },
      { kind: 'plan', at: T, window: 'seven_day', usedPercentage: 19, resetsAt: new Date(1795208400 * 1000).toISOString(), source: 'rate-limit-event' },
    ]);
  });

  it('diffs the cumulative workflow_progress array into started, queued, linked and ended agents', () => {
    const n = new StreamNormaliser(S);
    n.message({ type: 'system', subtype: 'task_started', task_id: 'w1', task_type: 'local_workflow', workflow_name: 'probe' }, T);
    const entry = (index: number, extra: object) => ({ type: 'workflow_agent', index, label: `agent-${index}`, phaseTitle: 'p', ...extra });
    const first = n.message({ type: 'system', subtype: 'task_progress', task_id: 'w1', workflow_progress: [{ type: 'workflow_phase', index: 1, title: 'p' }, entry(1, { agentId: 'x1', state: 'start', startedAt: 1, queuedAt: 0 }), entry(2, { state: 'start', queuedAt: 0 })] }, T);
    expect(first.flatMap((f) => (f.kind === 'started' ? [`${f.kind}:${f.ref.agentKey}${f.queued === true ? ':queued' : ''}`] : [])), 'first sight').toEqual(['started:wf:w1:1', 'started:wf:w1:2:queued']);
    const second = n.message({ type: 'system', subtype: 'task_progress', task_id: 'w1', workflow_progress: [entry(1, { agentId: 'x1', state: 'done', startedAt: 1, queuedAt: 0, tokens: 18211, resultPreview: 'ok' }), entry(2, { agentId: 'x2', state: 'start', startedAt: 2, queuedAt: 0 })] }, T);
    expect(second.flatMap((f) => (f.kind === 'started' || f.kind === 'ended' ? [`${f.kind}:${f.ref.agentKey}`] : [])), 'done, then the queued one starts').toEqual(['ended:wf:w1:1', 'started:wf:w1:2']);
    expect(second[0], 'done entry').toMatchObject({ outcome: 'completed', basis: 'reported', totalTokens: 18211, summary: 'ok' });
    expect(n.message({ type: 'system', subtype: 'task_progress', task_id: 'w1', workflow_progress: [entry(1, { agentId: 'x1', state: 'done', startedAt: 1 })] }, T), 'a repeated copy adds nothing').toEqual([]);
  });

  it('ends open agents as lost and the process row as stopped or completed when the process exits', () => {
    const n = new StreamNormaliser(S);
    n.processStarted(T);
    n.message(started, T);
    const facts = n.exited(T, { stopped: true });
    expect(facts.map((f) => (f.kind === 'ended' ? `${f.ref.agentKey}:${f.outcome}` : '')), 'ends').toEqual(['a1:lost', 'session:stopped']);
  });

  it('counts the token usage of each assistant message on the process row with its message id and model', () => {
    const assistant = { type: 'assistant', message: { id: 'msg_1', model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } };
    expect(new StreamNormaliser(S).message(assistant, T), 'a usage fact for the session row').toEqual([
      {
        kind: 'usage',
        ref: { sessionId: S, agentKey: 'session' },
        at: T,
        messageId: 'msg_1',
        model: 'claude-haiku-4-5',
        usage: { input: 10, output: 5, cacheWrite5m: 20, cacheWrite1h: 0, cacheRead: 100 },
      },
    ]);
  });

  it('ignores messages it does not know', () => {
    expect(new StreamNormaliser(S).message({ type: 'assistant' }, T), 'no facts').toEqual([]);
    expect(new StreamNormaliser(S).message('text', T), 'not an object').toEqual([]);
  });
});
