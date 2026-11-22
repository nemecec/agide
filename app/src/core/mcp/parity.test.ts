import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkParity, renderParityMarkdown } from '../commands/index';
import { startHarness, type Harness } from './testHarness';

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

async function servedToolNames(): Promise<string[]> {
  const client = await h.connect(h.server.grant('parity', h.mine.id));
  return (await client.listTools()).tools.map((tool) => tool.name);
}

const uiOnly = { title: 'Only', description: 'd', input: z.strictObject({}), ui: { menu: 'app' }, mcp: false, run: () => null } as const;

describe('UI and MCP parity check', () => {
  it('has no gap among the built-in commands', async () => {
    const report = checkParity(h.registry.list(), await servedToolNames());
    expect(report.missing, 'UI-bound commands that agents cannot call').toEqual([]);
  });

  it('reports a UI-bound command that has no MCP tool', async () => {
    h.registry.register({ ...uiOnly, id: 'ui_only_thing' });
    const report = checkParity(h.registry.list(), await servedToolNames());
    expect(report.missing, 'the command is named as missing').toEqual(['ui_only_thing']);
    expect(renderParityMarkdown(report), 'the table marks it').toContain('| `ui_only_thing` | menu app | no | MISSING |');
  });

  it('names the grant tool set of a tool the default list leaves out, without counting it as exposed', () => {
    h.registry.register({ ...uiOnly, id: 'set_only_thing', ui: false, mcp: true });
    const report = checkParity(h.registry.list(), [], { reviewer: ['set_only_thing'] });
    expect(report.rows.find((row) => row.id === 'set_only_thing'), 'the row knows the set').toMatchObject({ exposed: false, sets: ['reviewer'] });
    expect(renderParityMarkdown(report), 'the table names the set').toContain('| `set_only_thing` | none | reviewer set only | ok |');
  });

  it('accepts a UI-bound command with a stated exemption and shows the reason', async () => {
    h.registry.register({ ...uiOnly, id: 'ui_exempt_thing', mcpExempt: 'agents must not do this' });
    const report = checkParity(h.registry.list(), await servedToolNames());
    expect(report.missing, 'an exempt command is not missing').toEqual([]);
    expect(renderParityMarkdown(report), 'the table shows the reason').toContain('| `ui_exempt_thing` | menu app | no | exempt: agents must not do this |');
  });
});
