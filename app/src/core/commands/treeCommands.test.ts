import { describe, expect, it } from 'vitest';
import { createAppEventBus, type AppEvent } from '../events/index';
import { InMemoryTreeService } from '../tree/index';
import { CommandRegistry } from './CommandRegistry';
import { registerBuiltinCommands } from './builtinCommands';
import type { Caller } from './types';

function setup() {
  const tree = new InMemoryTreeService();
  const events = createAppEventBus();
  const seen: AppEvent[] = [];
  events.onAny((e) => seen.push(e));
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry, { tree, events });
  return { tree, registry, seen };
}
const ui: Caller = { kind: 'ui' };

describe('tree commands for the UI caller', () => {
  it('creates, renames, moves and removes nodes anywhere in the tree', async () => {
    const { tree, registry } = setup();
    const a = await registry.invoke('ui_create_folder', { title: 'A' }, ui);
    const b = await registry.invoke('ui_create_folder', { title: 'B' }, ui);
    if (!a.ok || !b.ok) throw new Error('folders were not created');
    const aId = (a.value as { id: string }).id;
    const bId = (b.value as { id: string }).id;
    await registry.invoke('ui_rename_node', { nodeId: aId, title: 'A2' }, ui);
    await registry.invoke('ui_move_node', { nodeId: bId, parentId: aId }, ui);
    expect(tree.get(bId)?.parentId, 'B moved under A').toBe(aId);
    expect(tree.get(aId)?.title, 'A renamed').toBe('A2');
    const removed = await registry.invoke('ui_remove_node', { nodeId: aId }, ui);
    expect(removed, 'removal lists the subtree').toEqual({ ok: true, value: { removedIds: [aId, bId] } });
    expect(tree.list(), 'tree is empty').toEqual([]);
  });

  it('maps tree errors to command error codes', async () => {
    const { registry } = setup();
    expect(await registry.invoke('ui_rename_node', { nodeId: 'zzz', title: 'x' }, ui), 'unknown node').toMatchObject({ error: { code: 'not_found' } });
    const f = await registry.invoke('ui_create_folder', { title: 'F' }, ui);
    const id = f.ok ? (f.value as { id: string }).id : '';
    expect(await registry.invoke('ui_move_node', { nodeId: id, parentId: id }, ui), 'cycle').toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('gives every UI-bound command an MCP tool', () => {
    const { registry } = setup();
    const missing = registry.list().filter((c) => c.ui !== false && !c.mcp).map((c) => c.id);
    expect(missing, 'UI-bound commands without mcp').toEqual([]);
  });
});
