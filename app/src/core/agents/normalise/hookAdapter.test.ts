import { describe, expect, it } from 'vitest';
import type { AgentFact } from '../types';
import { HookNormaliser } from './hookAdapter';

const S = 'sess-1';
const T = '2026-11-17T10:00:00.000Z';
const TRANSCRIPT = '/cfg/projects/proj/sess-1.jsonl';
const base = { session_id: S, transcript_path: TRANSCRIPT };

// Payload shapes follow the P13 and P11 hook logs with ids and paths replaced.
const agentToolPre = (toolUseId: string, description: string) => ({ ...base, tool_name: 'Agent', tool_input: { description, prompt: 'p', subagent_type: 'general-purpose' }, tool_use_id: toolUseId });
const subagentStart = (agentId: string) => ({ ...base, agent_id: agentId, agent_type: 'general-purpose' });
const subagentStop = (agentId: string, message = 'ok') => ({ ...base, agent_id: agentId, agent_type: 'general-purpose', agent_transcript_path: `/cfg/projects/proj/sess-1/subagents/agent-${agentId}.jsonl`, last_assistant_message: message });

function run(normaliser: HookNormaliser, events: [string, unknown][]): AgentFact[] {
  return events.flatMap(([name, payload]) => normaliser.handle(S, name, payload, T));
}

describe('HookNormaliser: subagent lifecycle', () => {
  it('starts an agent with the description queued by the Agent tool call and the transcript path of its file', () => {
    const facts = run(new HookNormaliser(), [
      ['PreToolUse', agentToolPre('toolu_1', 'Reply with ok')],
      ['SubagentStart', subagentStart('a1')],
    ]);
    expect(facts, 'one started fact').toEqual([
      {
        kind: 'started',
        ref: { sessionId: S, agentKey: 'a1' },
        at: T,
        agentId: 'a1',
        agentType: 'general-purpose',
        description: 'Reply with ok',
        toolUseId: 'toolu_1',
        transcriptPath: '/cfg/projects/proj/sess-1/subagents/agent-a1.jsonl',
      },
    ]);
  });

  it('links a background launch from the PostToolUse response', () => {
    const facts = run(new HookNormaliser(), [
      ['PostToolUse', { ...agentToolPre('toolu_1', 'Reply with ok'), tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1', description: 'Reply with ok' } }],
    ]);
    expect(facts, 'linked fact').toEqual([{ kind: 'linked', ref: { sessionId: S, agentKey: 'a1' }, agentId: 'a1', toolUseId: 'toolu_1', description: 'Reply with ok' }]);
  });

  it('ends a started agent as completed with basis derived and the closing message as summary', () => {
    const facts = run(new HookNormaliser(), [
      ['SubagentStart', subagentStart('a1')],
      ['SubagentStop', subagentStop('a1', 'all done')],
    ]);
    expect(facts.at(-1), 'ended fact').toMatchObject({ kind: 'ended', outcome: 'completed', basis: 'derived', summary: 'all done', transcriptPath: expect.stringContaining('agent-a1.jsonl') });
  });

  it('drops a stop for an agent id that never started (internal agents)', () => {
    expect(run(new HookNormaliser(), [['SubagentStop', subagentStop('internal')]]), 'no facts').toEqual([]);
  });

  it('uses the SubagentHandback message as the summary', () => {
    const facts = run(new HookNormaliser(), [
      ['SubagentStart', subagentStart('a1')],
      ['PreToolUse', { ...base, agent_id: 'a1', tool_name: 'SubagentHandback', tool_input: { message: 'the report' } }],
      ['SubagentStop', subagentStop('a1', 'closing words')],
    ]);
    expect(facts.at(-1), 'summary from the handback').toMatchObject({ kind: 'ended', summary: 'the report' });
  });

  it('matches parallel starts to queued tool calls in order', () => {
    const facts = run(new HookNormaliser(), [
      ['PreToolUse', agentToolPre('toolu_1', 'first')],
      ['PreToolUse', agentToolPre('toolu_2', 'second')],
      ['SubagentStart', subagentStart('a1')],
      ['SubagentStart', subagentStart('a2')],
    ]);
    expect(facts.map((fact) => (fact.kind === 'started' ? fact.description : '')), 'descriptions in start order').toEqual(['first', 'second']);
  });

  it('refines the outcome from a task-notification prompt with the reported status and token total', () => {
    const prompt = '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>failed</status>\n<summary>Agent "x" failed</summary>\n<usage><subagent_tokens>31365</subagent_tokens></usage>\n</task-notification>';
    const facts = run(new HookNormaliser(), [
      ['SubagentStart', subagentStart('a1')],
      ['SubagentStop', subagentStop('a1')],
      ['UserPromptSubmit', { ...base, prompt }],
    ]);
    expect(facts.at(-1), 'reported end').toMatchObject({ kind: 'ended', outcome: 'failed', basis: 'reported', totalTokens: 31365 });
  });

  it('ends agents still open when the session exits as lost, or completed when their metadata says finished', () => {
    const normaliser = new HookNormaliser();
    run(normaliser, [
      ['SubagentStart', subagentStart('a1')],
      ['SubagentStart', subagentStart('a2')],
    ]);
    const facts = normaliser.exited(S, T, (id) => id === 'a2');
    expect(facts.map((f) => (f.kind === 'ended' ? `${f.ref.agentKey}:${f.outcome}:${f.basis}` : f.kind)), 'outcomes').toEqual(['a1:lost:derived', 'a2:completed:derived']);
  });
});

describe('HookNormaliser: approvals', () => {
  const perm = (extra: object = {}) => ({ ...base, tool_name: 'Bash', tool_input: { command: 'ls' }, ...extra });

  it('marks the session, not a guessed agent, for a request without an agent id', () => {
    const facts = run(new HookNormaliser(), [
      ['SubagentStart', subagentStart('a1')],
      ['PermissionRequest', perm()],
    ]);
    expect(facts.at(-1), 'waiting on main').toMatchObject({ kind: 'waiting', ref: { agentKey: 'main' }, attribution: 'session', toolName: 'Bash' });
  });

  it('attributes a request to the running agent named by agent_id', () => {
    const facts = run(new HookNormaliser(), [
      ['SubagentStart', subagentStart('a1')],
      ['PermissionRequest', perm({ agent_id: 'a1' })],
    ]);
    expect(facts.at(-1), 'waiting on the agent').toMatchObject({ kind: 'waiting', ref: { agentKey: 'a1' }, attribution: 'exact' });
  });

  it('does not attribute to an agent that is not running', () => {
    const facts = run(new HookNormaliser(), [['PermissionRequest', perm({ agent_id: 'ghost' })]]);
    expect(facts[0], 'falls back to the session').toMatchObject({ ref: { agentKey: 'main' }, attribution: 'session' });
  });

  it('answers the request when the same tool call runs', () => {
    const normaliser = new HookNormaliser();
    const [waiting] = run(normaliser, [['PermissionRequest', perm()]]);
    const answered = run(normaliser, [['PostToolUse', perm({ tool_response: {} })]]);
    expect(answered, 'answered with the request key').toEqual([{ kind: 'answered', ref: { sessionId: S, agentKey: 'main' }, at: T, requestKey: (waiting as { requestKey: string }).requestKey }]);
  });

  it('keeps a request open when another tool call runs', () => {
    const normaliser = new HookNormaliser();
    run(normaliser, [['PermissionRequest', perm()]]);
    expect(run(normaliser, [['PostToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'pwd' } }]]), 'a different input answers nothing').toEqual([]);
  });

  it('answers every open request on Stop and on the end of a subagent for its own requests', () => {
    const normaliser = new HookNormaliser();
    run(normaliser, [
      ['SubagentStart', subagentStart('a1')],
      ['PermissionRequest', perm({ agent_id: 'a1' })],
      ['PermissionRequest', perm({ tool_input: { command: 'other' } })],
    ]);
    const stop = run(normaliser, [['SubagentStop', subagentStop('a1')]]);
    expect(stop.filter((f) => f.kind === 'answered').map((f) => f.ref.agentKey), 'agent request answered at its stop').toEqual(['a1']);
    expect(run(normaliser, [['Stop', base]]).flatMap((f) => (f.kind === 'answered' ? [f.ref.agentKey] : [])), 'session request answered at Stop').toEqual(['main']);
  });
});
