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

  it('accepts a UI-bound command with a stated exemption and shows the reason', async () => {
    h.registry.register({ ...uiOnly, id: 'ui_exempt_thing', mcpExempt: 'agents must not do this' });
    const report = checkParity(h.registry.list(), await servedToolNames());
    expect(report.missing, 'an exempt command is not missing').toEqual([]);
    expect(renderParityMarkdown(report), 'the table shows the reason').toContain('| `ui_exempt_thing` | menu app | no | exempt: agents must not do this |');
  });
});
