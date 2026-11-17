// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { TreeNode } from '../../core/tree/types';
import { flush, renderHook } from '../testing/render';
import { installFakeApi } from '../testing/fakeApi';
import { useTreeNodes } from './useTreeNodes';

const node = (id: string, title = id): TreeNode => ({ kind: 'folder', id, parentId: null, title, order: 0 });
let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function mount() {
  const hook = await renderHook(useTreeNodes);
  unmount = hook.unmount;
  return hook;
}

describe('useTreeNodes', () => {
  it('starts empty and unloaded, then holds the listed nodes', async () => {
    let release: (value: unknown) => void = () => {};
    installFakeApi({ ui_list_tree: () => new Promise((resolve) => (release = resolve)) });
    const hook = await mount();
    expect(hook.current(), 'before the answer').toEqual({ nodes: [], loaded: false });
    release({ nodes: [node('a')] });
    await flush();
    expect(hook.current(), 'after the answer').toEqual({ nodes: [node('a')], loaded: true });
  });

  it('lists again on a tree event and ignores other events', async () => {
    let tree = [node('a')];
    const fake = installFakeApi({ ui_list_tree: () => ({ nodes: tree }) });
    const hook = await mount();
    tree = [node('a'), node('b')];
    fake.emit({ type: 'session.closed', sessionId: 's' } as never);
    await flush();
    expect(hook.current().nodes.map((n) => n.id), 'other event leaves the list').toEqual(['a']);
    fake.emit({ type: 'tree.node_created' } as never);
    await flush();
    expect(hook.current().nodes.map((n) => n.id), 'tree event refreshes').toEqual(['a', 'b']);
  });

  it('keeps the same array when the tree did not change', async () => {
    const fake = installFakeApi({ ui_list_tree: () => ({ nodes: [node('a')] }) });
    const hook = await mount();
    const before = hook.current().nodes;
    fake.emit({ type: 'tree.node_renamed' } as never);
    await flush();
    expect(hook.current().nodes, 'identical array while the user renames an item').toBe(before);
  });

  it('keeps the newest answer when an older request finishes last', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const fake = installFakeApi({ ui_list_tree: () => new Promise((resolve) => pending.push(resolve)) });
    const hook = await mount();
    fake.emit({ type: 'tree.changed' } as never);
    await flush();
    pending[1]?.({ nodes: [node('new')] });
    await flush();
    pending[0]?.({ nodes: [node('old')] });
    await flush();
    expect(hook.current().nodes.map((n) => n.id), 'stale answer dropped').toEqual(['new']);
  });

  it('stays unloaded when the command fails', async () => {
    installFakeApi({ ui_list_tree: { ok: false, error: { code: 'failed', message: 'x' } } });
    const hook = await mount();
    expect(hook.current(), 'failed listing').toEqual({ nodes: [], loaded: false });
  });

  it('unsubscribes on unmount', async () => {
    const fake = installFakeApi({ ui_list_tree: () => ({ nodes: [] }) });
    const hook = await mount();
    expect(fake.subscriberCount(), 'subscribed').toBe(1);
    await hook.unmount();
    unmount = undefined;
    expect(fake.subscriberCount(), 'unsubscribed').toBe(0);
  });
});
