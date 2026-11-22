import { describe, expect, it } from 'vitest';
import { ACTION_CLASSES } from './classTable';
import { DefaultPolicyBuilder } from './policyBuilder';
import { ToolCallInspector } from './inspector';
import type { ActionClassId, GateFile, OutwardMode } from './types';

const gate = (outward: Partial<Record<ActionClassId, OutwardMode>> = {}): GateFile => ({ schema: 1, sessionId: 's1', table: ACTION_CLASSES, outward, allowedHosts: [], inboxDir: '/inbox' });
const call = { hook_event_name: 'PreToolUse', session_id: 's1', permission_mode: 'auto', tool_name: 'mcp__app__swarm_merge', tool_input: { swarmId: 'sw1' } } as const;

describe('app.merge class', () => {
  it('asks the user for every swarm_merge call from a session', () => {
    expect(new ToolCallInspector().inspect(call, gate()), 'swarm_merge is held for approval by default').toMatchObject({ decision: 'ask', classId: 'app.merge' });
  });

  it('is an approve class with a hard floor, so a profile cannot loosen it', () => {
    const row = ACTION_CLASSES.find((candidate) => candidate.id === 'app.merge');
    expect(row, 'the class table lists app.merge').toMatchObject({ defaultMode: 'approve', hardFloor: 'approve', askRules: ['mcp__app__swarm_merge'] });
  });

  it('writes the ask rule into the launch policy', () => {
    const settings = { network: { bashSandbox: false, allow: [], deny: [] } } as never;
    const policy = new DefaultPolicyBuilder().build({ settings, table: ACTION_CLASSES, capabilities: { network: 'none' } } as never);
    expect(policy.ask, 'the ask rule of the merge tool is in the launch policy').toContain('mcp__app__swarm_merge');
  });
});
