import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callTool } from '../../core/mcp/tools';
import { startAppModules, type AppModules } from '../appForTests';

const capturer = vi.hoisted(() => ({
  override: undefined as undefined | ((request: import('../../core/layout/index').CaptureRequest) => Promise<import('../../core/layout/index').WindowCapture>),
}));
vi.mock('../windowCapture', async (importOriginal) => {
  const original = await importOriginal<typeof import('../windowCapture')>();
  return { ...original, captureAppWindow: (...args: Parameters<typeof original.captureAppWindow>) => (capturer.override ?? original.captureAppWindow)(...args) };
});

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
  afterEach(async () => {
    capturer.override = undefined;
    await app.close();
  });

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

  it('gives the capture the folder scope of an agent and none for the user', async () => {
    const scopes: ((nodeId: string) => boolean)[] = [];
    capturer.override = async ({ inScope }) => {
      if (inScope) scopes.push(inScope);
      return { data: 'AAAA', width: 1, height: 1, masked: [] };
    };
    await call('ui_capture_window', {}, ui);
    expect(scopes, 'the user is not scoped').toHaveLength(0);
    await call('ui_capture_window', {}, mcp());
    expect(scopes, 'an agent is scoped').toHaveLength(1);
    expect([scopes[0]?.(folderId), scopes[0]?.(otherId)], 'its own folder is in scope, another folder is not').toEqual([true, false]);
  });

  it('lets the capturer read the mask again and names the mask it applied, not the one at the start', async () => {
    await call('ui_focus_node', { nodeId: folderId }, ui);
    capturer.override = async ({ masked }) => {
      const atStart = [...masked()];
      await call('ui_focus_node', { nodeId: otherId }, ui);
      const later = [...masked()];
      expect([atStart.includes('main'), later.includes('main')], 'the pane of the surface host is masked once the window shows the other folder').toEqual([false, true]);
      return { data: 'AAAA', width: 1, height: 1, masked: later };
    };
    const shot = await call('ui_capture_window', {}, mcp());
    expect(shot.value?.masked, 'the result carries the applied mask').toContain('main');
  });

  it('gives the user a capture with nothing masked', async () => {
    await call('ui_focus_node', { nodeId: otherId }, ui);
    let seen: readonly string[] | undefined;
    capturer.override = async ({ masked }) => {
      seen = masked();
      return { data: 'AAAA', width: 1, height: 1, masked: seen };
    };
    await call('ui_capture_window', {}, ui);
    expect(seen, 'no pane is hidden from the user').toEqual([]);
  });

  it('refuses an agent a value binding to a node outside its folder, whether the node exists or not, and allows one inside', async () => {
    await call('ui_focus_node', { nodeId: folderId }, ui);
    const bind = (value: string) => [{ op: 'add', path: '/instances/main/bindings/node', value: { value } }];
    const foreign = await call('layout_apply', { expectedRevision: 1, patch: bind(otherId) }, mcp());
    const unknown = await call('layout_apply', { expectedRevision: 1, patch: bind('no-such-node') }, mcp());
    expect(foreign.error?.code, 'a node of another folder is out of scope').toBe('out_of_scope');
    expect(unknown.error?.code, 'an unknown node answers the same way').toBe('out_of_scope');
    expect(unknown.error?.message.replace('no-such-node', ''), 'the message does not tell the two apart').toBe(foreign.error?.message.replace(otherId, ''));
    expect((await call('layout_get', {}, mcp())).value, 'nothing applied').toMatchObject({ revision: 1 });
    const inside = await call('layout_apply', { expectedRevision: 1, patch: bind(folderId) }, mcp());
    expect(inside.ok, 'a node of its own folder is accepted').toBe(true);
    expect((await call('layout_apply', { expectedRevision: 2, patch: bind(otherId) }, ui)).ok, 'the user may bind any node').toBe(true);
    await call('layout_apply', { expectedRevision: 3, patch: [{ op: 'replace', path: '/instances/main/bindings/node', value: { context: 'node.current' } }] }, ui);
    const undone = await call('layout_undo', { toRevision: 3 }, mcp());
    expect(undone.error?.code, 'an agent cannot undo to a revision that binds a node of another folder').toBe('out_of_scope');
  });

  it('checks only the node bindings a change adds or changes, so a binding the user wrote does not block an agent', async () => {
    await call('ui_focus_node', { nodeId: folderId }, ui);
    const bindMain = (value: string) => [{ op: 'add', path: '/instances/main/bindings/node', value: { value } }];
    expect((await call('layout_apply', { expectedRevision: 1, patch: bindMain(otherId) }, ui)).ok, 'the user binds the surface host to a node of another folder').toBe(true);

    const unrelated = await call('layout_apply', { expectedRevision: 2, patch: [{ op: 'replace', path: '/title', value: 'Agent' }] }, mcp());
    expect(unrelated.ok, 'a patch that leaves the binding alone is accepted').toBe(true);
    const undone = await call('layout_undo', { toRevision: 1 }, mcp());
    expect(undone.ok, 'an undo to a revision that does not add a foreign binding is accepted').toBe(true);
    expect((await call('layout_apply', { expectedRevision: 4, patch: bindMain(otherId) }, ui)).ok, 'the user binds the foreign node again').toBe(true);

    const text = await call('layout_apply', { expectedRevision: 5, patch: [{ op: 'add', path: '/instances/main/bindings/label', value: { value: 'a text' } }] }, mcp());
    expect(text.ok, 'a text value on input "label", which the surface host does not declare and no pane type declares with a node key, is accepted').toBe(true);

    const changed = await call('layout_apply', { expectedRevision: 6, patch: [{ op: 'replace', path: '/instances/main/bindings/node', value: { value: 'no-such-node' } }] }, mcp());
    expect(changed.error?.code, 'a changed binding to an unknown node is refused').toBe('out_of_scope');
    const own = await call('layout_apply', { expectedRevision: 6, patch: [{ op: 'replace', path: '/instances/main/bindings/node', value: { value: folderId } }] }, mcp());
    expect(own.ok, 'a changed binding to a node of the folder is accepted').toBe(true);
    const foreign = await call('layout_apply', { expectedRevision: 7, patch: [{ op: 'replace', path: '/instances/main/bindings/node', value: { value: otherId } }] }, mcp());
    expect(foreign.error?.code, 'a changed binding from a node of the folder to a node of another folder is refused').toBe('out_of_scope');
  });

  describe('a type change that keeps a binding', () => {
    const addInstance = (type: string) => [
      { op: 'add', path: '/instances/probe', value: { type, version: '^1', configVersion: 1, config: {}, bindings: { node: { value: otherId } } } },
      { op: 'add', path: '/arrangement/children/-', value: { tabs: { panes: ['probe'] } } },
    ];
    const retype = [{ op: 'replace', path: '/instances/probe/type', value: 'agide/surface-host' }];

    it.each([['acme/ghost', 'a type the registry does not know'], ['agide/placeholder', 'the placeholder']])('refuses a value binding to a node of another folder on %s, so a second step cannot turn it into a surface host (%s)', async (type) => {
      await call('ui_focus_node', { nodeId: folderId }, ui);
      const first = await call('layout_apply', { expectedRevision: 1, patch: addInstance(type) }, mcp());
      expect(first.error?.code, `adding ${type} bound to a node of another folder is refused`).toBe('out_of_scope');
    });

    it.each(['acme/ghost', 'agide/placeholder'])('refuses an agent the change of %s, written by the user with a foreign binding, to a surface host', async (type) => {
      await call('ui_focus_node', { nodeId: folderId }, ui);
      expect((await call('layout_apply', { expectedRevision: 1, patch: addInstance(type) }, ui)).ok, `the user adds ${type} with a foreign binding`).toBe(true);
      const changed = await call('layout_apply', { expectedRevision: 2, patch: retype }, mcp());
      expect(changed.error?.code, 'the type change binds the surface host to a node of another folder').toBe('out_of_scope');
      expect((await call('layout_get', {}, mcp())).value, 'nothing applied').toMatchObject({ revision: 2 });
      const unrelated = await call('layout_apply', { expectedRevision: 2, patch: [{ op: 'replace', path: '/title', value: 'Agent' }] }, mcp());
      expect(unrelated.ok, 'a patch that leaves the type and the binding alone is accepted').toBe(true);
    });
  });
});
