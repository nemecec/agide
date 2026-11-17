import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CommandRegistry } from '../core/commands/index';
import { invokeFromRenderer, isTrustedSource, listFromRenderer } from './ipcPolicy';

const isApp = (url: string) => url === 'app://page';
const good = { inAppWindow: true, isMainFrame: true, frameUrl: 'app://page' };

describe('isTrustedSource', () => {
  it('trusts the main frame of an app window showing an app page', () => {
    expect(isTrustedSource(good, isApp), 'app main frame').toBe(true);
  });

  it('refuses a sender outside an app window, such as a browser surface', () => {
    expect(isTrustedSource({ ...good, inAppWindow: false }, isApp), 'surface web contents').toBe(false);
  });

  it('refuses a subframe, also one that shows an app page', () => {
    expect(isTrustedSource({ ...good, isMainFrame: false }, isApp), 'iframe').toBe(false);
  });

  it('refuses a main frame that navigated to a foreign page', () => {
    expect(isTrustedSource({ ...good, frameUrl: 'https://example.com/' }, isApp), 'foreign page').toBe(false);
  });
});

function registry() {
  const commands = new CommandRegistry();
  const callers: string[] = [];
  commands.register({
    id: 'test_echo',
    title: 'Echo',
    description: 'Returns its input.',
    input: z.object({ text: z.string().optional() }),
    ui: true,
    mcp: false,
    run: (input: { text?: string | undefined }, context: { caller: { kind: string } }) => {
      callers.push(context.caller.kind);
      return input.text ?? '';
    },
  } as never);
  return { commands, callers };
}

describe('invokeFromRenderer', () => {
  it('runs the command as the UI caller', async () => {
    const { commands, callers } = registry();
    expect(await invokeFromRenderer(commands, true, 'test_echo', { text: 'hi' }), 'result').toEqual({ ok: true, value: 'hi' });
    expect(callers, 'caller kind').toEqual(['ui']);
  });

  it('answers a foreign source like an unknown command and runs nothing', async () => {
    const { commands, callers } = registry();
    expect(await invokeFromRenderer(commands, false, 'test_echo', {}), 'rejected').toEqual({ ok: false, error: { code: 'not_found', message: 'rejected' } });
    expect(callers, 'command did not run').toEqual([]);
  });

  it('rejects a command id that is not a string from a trusted source', async () => {
    const { commands, callers } = registry();
    for (const id of [undefined, 42, { toString: () => 'test_echo' }, ['test_echo']]) {
      expect(await invokeFromRenderer(commands, true, id, {}), `id ${JSON.stringify(id)} is rejected`).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    expect(callers, 'command did not run').toEqual([]);
  });

  it('reports an unknown command and invalid input as failed results', async () => {
    const { commands } = registry();
    expect(await invokeFromRenderer(commands, true, 'nothing_here', {}), 'unknown command').toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await invokeFromRenderer(commands, true, 'test_echo', { text: 5 }), 'wrong input type').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('listFromRenderer', () => {
  it('lists the commands for a trusted source and nothing for a foreign one', () => {
    const { commands } = registry();
    expect(listFromRenderer(commands, true).map((c) => c.id), 'trusted').toEqual(['test_echo']);
    expect(listFromRenderer(commands, false), 'foreign').toEqual([]);
  });
});
