import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callTool } from '../../core/mcp/tools';
import { startAppModules, type AppModules } from '../appForTests';

const ui = { kind: 'ui' } as const;

interface Loose {
  ok: boolean;
  value?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: { code: string; message: string; details?: unknown };
}

describe('layout commands in the module graph', () => {
  let app: AppModules;
  const call = (id: string, input: unknown, caller: Parameters<AppModules['commands']['invoke']>[2]) => app.commands.invoke(id, input, caller) as Promise<Loose>;
  let folderId: string;
  let otherId: string;
  const mcp = () => ({ kind: 'mcp', sessionId: 's1', folderId }) as const;

  beforeEach(async () => {
    app = await startAppModules();
    folderId = ((await call('ui_create_folder', { title: 'mine2' }, ui)).value as { id: string }).id;
    otherId = ((await call('ui_create_folder', { title: 'other' }, ui)).value as { id: string }).id;
  });
  afterEach(() => app.close());

  it('lists the first-party pane types and the layouts', async () => {
    const result = await call('blocks_list', { includeSchemas: true }, mcp());
    expect(result.ok, 'blocks_list works for an agent').toBe(true);
    const value = result.value as { blocks: { id: string; panes: { type: string }[] }[]; layouts: { id: string }[]; layoutSchema: unknown };
    expect(value?.blocks[0]?.panes.map((p) => p.type), 'tree and surface host are listed').toEqual(expect.arrayContaining(['agide/tree', 'agide/surface-host']));
    expect(value?.layouts.map((l) => l.id), 'both presets').toEqual(['session', 'pair']);
    expect(value?.layoutSchema, 'JSON Schema of the layout').toBeTruthy();
  });

  it('refuses an agent while the window shows no node of its folder, and allows it once the window does', async () => {
    const patch = [{ op: 'replace', path: '/title', value: 'Agent' }];
    const denied = await call('layout_apply', { expectedRevision: 1, patch }, mcp());
    expect(denied.error?.code, 'no node.current yet').toBe('out_of_scope');

    await call('ui_focus_node', { nodeId: otherId }, ui);
    const stillDenied = await call('layout_apply', { expectedRevision: 1, patch }, mcp());
    expect(stillDenied.error?.code, 'window shows another folder').toBe('out_of_scope');

    await call('ui_focus_node', { nodeId: folderId }, ui);
    const applied = await call('layout_apply', { expectedRevision: 1, patch }, mcp());
    expect(applied, 'applies with a diff and undo arguments').toMatchObject({ ok: true, value: { revision: 2, summary: ['title: "Session" -> "Agent"'], undo: { toRevision: 1 } } });

    const undone = await call('layout_undo', {}, mcp());
    expect(undone, 'undo is a new revision').toMatchObject({ ok: true, value: { revision: 3 } });
    expect((await call('layout_get', {}, mcp())).value, 'title restored').toMatchObject({ layout: { title: 'Session' } });
  });

  it('refuses a scope of all and a stale revision with actionable errors', async () => {
    await call('ui_focus_node', { nodeId: folderId }, ui);
    const wide = [{ op: 'add', path: '/instances/main/scope', value: 'all' }];
    const refused = await call('layout_apply', { expectedRevision: 1, patch: wide }, mcp());
    expect(refused.error?.message, 'says what to use instead').toContain(`use your folder id ${folderId}`);

    await call('layout_apply', { expectedRevision: 1, patch: [{ op: 'replace', path: '/title', value: 'A' }] }, ui);
    const stale = await call('layout_apply', { expectedRevision: 1, patch: [{ op: 'replace', path: '/title', value: 'B' }] }, mcp());
    expect(stale.error, 'stale revision carries the current one').toMatchObject({ code: 'invalid_input', details: { currentRevision: 2 } });
  });

  it('refuses an agent undo to a revision whose scope is wider than its folder', async () => {
    await call('ui_focus_node', { nodeId: folderId }, ui);
    await call('layout_apply', { expectedRevision: 1, patch: [{ op: 'add', path: '/instances/main/scope', value: 'all' }] }, ui);
    await call('layout_apply', { expectedRevision: 2, patch: [{ op: 'remove', path: '/instances/main/scope' }] }, ui);
    const undone = await call('layout_undo', { toRevision: 2 }, mcp());
    expect(undone.error?.code, 'restoring a scope of all is out of scope for an agent').toBe('out_of_scope');
    expect((await call('layout_get', {}, mcp())).value, 'nothing restored').toMatchObject({ revision: 3 });
    expect((await call('layout_undo', { toRevision: 2 }, ui)).ok, 'the user may restore it').toBe(true);
  });

  it('validates without applying and reports placeholders', async () => {
    const patch = [{ op: 'add', path: '/instances/ghost', value: { type: 'acme/ghost', version: '^1', configVersion: 1, config: {} } }, { op: 'add', path: '/arrangement/children/-', value: { tabs: { panes: ['ghost'] } } }];
    const result = await call('layout_validate', { patch }, mcp());
    expect(result, 'valid with a placeholder').toMatchObject({ ok: true, value: { ok: true, placeholders: [{ instanceId: 'ghost', reason: 'missing' }] } });
    expect((await call('layout_get', {}, mcp())).value, 'nothing applied').toMatchObject({ revision: 1 });
  });

  it('opens a node to the side and reports it in the shared context', async () => {
    await call('ui_open_to_side', { nodeId: otherId }, ui);
    expect((await call('ui_get_context', {}, ui)).value, 'node.secondary set').toMatchObject({ 'node.secondary': otherId });
    const outside = await call('ui_open_to_side', { nodeId: otherId }, mcp());
    expect(outside.error?.code, 'an agent cannot open a node outside its folder').toBe('out_of_scope');
  });

  it('maps the capture result to an image content block for MCP', async () => {
    const result = await callTool(app.commands, 'ui_capture_window', {}, mcp());
    // Plain Node has no window, so the command fails with a message instead of an image.
    expect(result.isError, 'no window in plain Node').toBe(true);
    const fake = { type: 'image', mimeType: 'image/png', data: 'AAAA', width: 1, height: 1 };
    app.commands.register({ id: 'test_image', title: 't', description: 't', input: (await import('zod')).z.strictObject({}), ui: false, mcp: true, run: () => fake });
    const image = await callTool(app.commands, 'test_image', {}, mcp());
    expect(image.content[0], 'image block first').toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });
});
