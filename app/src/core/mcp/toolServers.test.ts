import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CommandRegistry } from '../commands/CommandRegistry';
import type { Caller } from '../commands/types';
import { callTool, toolsFrom } from './tools';

const agent: Caller = { kind: 'mcp', sessionId: 's1', folderId: 'f1' };

function registry(): CommandRegistry {
  const commands = new CommandRegistry();
  const base = { input: z.object({}), ui: false as const, mcp: true, run: () => ({ ran: true }) };
  commands.register({ ...base, id: 'ui_list_tree', title: 'List', description: 'App tool.' });
  commands.register({ ...base, id: 'browser_navigate', title: 'Navigate', description: 'Browser tool.', mcpServer: 'agide-browser', run: () => ({ ran: 'navigate' }) });
  return commands;
}

describe('tools per MCP server', () => {
  it('list app commands on app and browser commands without their prefix on agide-browser', () => {
    expect(toolsFrom(registry()).map((tool) => tool.name), 'app server').toEqual(['ui_list_tree']);
    expect(toolsFrom(registry(), 'agide-browser').map((tool) => tool.name), 'browser server').toEqual(['navigate']);
  });

  it('run a browser tool by its short name on agide-browser and refuse it on app under either name', async () => {
    const commands = registry();
    expect((await callTool(commands, 'navigate', {}, agent, 'agide-browser')).isError, 'browser server runs navigate').toBeUndefined();
    expect((await callTool(commands, 'navigate', {}, agent)).isError, 'short name on app').toBe(true);
    expect((await callTool(commands, 'browser_navigate', {}, agent)).isError, 'command id on app').toBe(true);
    expect((await callTool(commands, 'ui_list_tree', {}, agent, 'agide-browser')).isError, 'app tool on the browser server').toBe(true);
  });
});
