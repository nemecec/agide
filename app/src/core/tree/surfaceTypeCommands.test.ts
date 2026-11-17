import { expect, it } from 'vitest';
import { CommandRegistry } from '../commands/CommandRegistry';
import { registerSurfaceTypeCommands } from './surfaceTypeCommands';

it('lists the surface types for UI and MCP callers', async () => {
  const registry = new CommandRegistry();
  registerSurfaceTypeCommands(registry, [{ id: 'browser-tab', label: 'Browser tab' }]);
  const expected = { ok: true, value: { surfaceTypes: [{ id: 'browser-tab', label: 'Browser tab' }] } };
  expect(await registry.invoke('ui_list_surface_types', {}, { kind: 'ui' }), 'UI caller').toEqual(expected);
  expect(
    await registry.invoke('ui_list_surface_types', {}, { kind: 'mcp', sessionId: 's', folderId: 'f' }),
    'MCP caller',
  ).toEqual(expected);
});
