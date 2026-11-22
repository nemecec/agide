import { describe, expect, it } from 'vitest';
import { CommandRegistry, inputJsonSchema } from '../commands/index';
import { SWARM_COMMANDS, registerSwarmCommands } from './commands';
import { SwarmError } from './types';

const ui = { kind: 'ui' } as const;
const mcp = { kind: 'mcp', sessionId: 's1', folderId: 'f1' } as const;

describe('swarm commands', () => {
  it('answers a command without a handler as not built yet', async () => {
    const registry = new CommandRegistry();
    registerSwarmCommands(registry, {});
    const result = await registry.invoke('swarm_list', {}, ui);
    expect(result, 'pending stub').toMatchObject({ ok: false, error: { code: 'failed', message: 'swarm_list is not built yet' } });
  });

  it('keeps the approval answer away from agents and exposes the rest as tools', async () => {
    const registry = new CommandRegistry();
    registerSwarmCommands(registry, { swarm_approval_answer: () => 'answered' });
    expect(
      registry
        .list({ mcp: true })
        .map((command) => command.id)
        .sort(),
      'tools',
    ).toEqual(['swarm_interrupt', 'swarm_list', 'swarm_merge', 'swarm_results', 'swarm_send', 'swarm_start', 'swarm_status', 'swarm_stop']);
    expect(SWARM_COMMANDS.swarm_approval_answer.mcpExempt, 'stated exemption').toBe('agents never answer approvals');
    const fromAgent = await registry.invoke('swarm_approval_answer', { swarmId: 'w', agent: 'impl', requestId: 'r', decision: 'allow' }, mcp);
    expect(fromAgent, 'an agent cannot call it').toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await registry.invoke('swarm_approval_answer', { swarmId: 'w', agent: 'impl', requestId: 'r', decision: 'allow' }, ui), 'the user can').toEqual({
      ok: true,
      value: 'answered',
    });
  });

  it('maps manager errors to command error codes', async () => {
    const registry = new CommandRegistry();
    registerSwarmCommands(registry, {
      swarm_stop: () => {
        throw new SwarmError('limit_reached', 'too deep');
      },
    });
    expect(await registry.invoke('swarm_stop', { swarmId: 'w' }, ui), 'limit').toMatchObject({ ok: false, error: { code: 'limit_reached', message: 'too deep' } });
  });

  it('validates the definition of swarm_start with the swarm schema and gives agents a JSON schema', async () => {
    const registry = new CommandRegistry();
    let seen: unknown;
    registerSwarmCommands(registry, { swarm_start: (input) => (seen = input) });
    const bad = await registry.invoke('swarm_start', { definition: { version: 1, goal: 'g', budget: { usdTotal: 1 }, agents: [], permissionMode: 'auto' } }, ui);
    expect(bad, 'no agents').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    await registry.invoke('swarm_start', { definition: { version: 1, goal: 'g', budget: { usdTotal: 1 }, agents: [{ name: 'a', prompt: 'p', workspace: 'scratch' }] } }, ui);
    expect(seen, 'parsed with defaults').toMatchObject({ definition: { permissionMode: 'auto', agents: [{ role: 'worker' }] } });
    const schema = inputJsonSchema(registry.get('swarm_start')!) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties), 'tool schema').toEqual(expect.arrayContaining(['definition', 'parentFolderId']));
  });
});
