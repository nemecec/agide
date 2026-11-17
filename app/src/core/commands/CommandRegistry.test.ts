import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CommandRegistry } from './CommandRegistry';
import { CommandError, type Caller } from './types';

const ui: Caller = { kind: 'ui' };
const agent: Caller = { kind: 'mcp', sessionId: 's1', folderId: 'f1' };

function registryWithEcho(mcp: boolean): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register({
    id: 'test_echo',
    title: 'Echo',
    description: 'Returns the text and the caller kind.',
    input: z.object({ text: z.string().min(1) }),
    ui: false,
    mcp,
    run: ({ text }, { caller }) => ({ text, caller: caller.kind }),
  });
  return registry;
}

describe('CommandRegistry', () => {
  it('runs a command with parsed input and the caller', async () => {
    const result = await registryWithEcho(true).invoke('test_echo', { text: 'hi' }, agent);
    expect(result, 'value carries input and caller kind').toEqual({ ok: true, value: { text: 'hi', caller: 'mcp' } });
  });

  it('returns invalid_input without running the command when the schema rejects the input', async () => {
    const result = await registryWithEcho(true).invoke('test_echo', { text: '' }, ui);
    expect(result, 'empty text fails validation').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('hides commands without mcp exposure from MCP callers only', async () => {
    const registry = registryWithEcho(false);
    expect(await registry.invoke('test_echo', { text: 'x' }, agent), 'MCP caller sees not_found').toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await registry.invoke('test_echo', { text: 'x' }, ui), 'UI caller can run it').toMatchObject({ ok: true });
  });

  it('passes a CommandError code through and wraps other errors as failed', async () => {
    const registry = new CommandRegistry();
    const base = { title: 't', description: 'd', input: z.object({}), ui: false as const, mcp: true };
    registry.register({ ...base, id: 'test_scope', run: () => { throw new CommandError('out_of_scope', 'no'); } });
    registry.register({ ...base, id: 'test_crash', run: () => { throw new Error('boom'); } });
    expect(await registry.invoke('test_scope', {}, agent), 'own code kept').toMatchObject({ error: { code: 'out_of_scope' } });
    expect(await registry.invoke('test_crash', {}, agent), 'plain error becomes failed').toMatchObject({
      error: { code: 'failed', message: 'boom' },
    });
  });

  it('rejects ids that do not follow <area>_<verb> and duplicate ids', () => {
    const registry = registryWithEcho(true);
    const command = { title: 't', description: 'd', input: z.object({}), ui: false as const, mcp: false, run: () => null };
    expect(() => registry.register({ ...command, id: 'CreateFolder' }), 'camel case id is rejected').toThrow();
    expect(() => registry.register({ ...command, id: 'test_echo' }), 'duplicate id is rejected').toThrow();
  });
});
