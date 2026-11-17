// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_PRESET } from '../../core/blocks/index';
import { installFakeApi } from '../testing/fakeApi';
import { flush, renderHook } from '../testing/render';
import { useLayoutState, type LayoutViewState } from './useLayoutState';

const view = (revision: number): LayoutViewState => ({
  layoutId: 'session',
  layout: { ...SESSION_PRESET, revision },
  revision,
  readOnly: false,
  fileIssues: [],
  resolutions: {},
  activeLayoutId: 'session',
  layouts: [{ id: 'session', title: 'Session', active: true }],
});
let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function mount() {
  const hook = await renderHook(useLayoutState);
  unmount = hook.unmount;
  return hook;
}

describe('useLayoutState', () => {
  it('has no view until layout_get answers, then holds the view and the context', async () => {
    installFakeApi({ layout_get: view(1), ui_get_context: { 'node.current': 'n1' } });
    const hook = await mount();
    expect(hook.current().view?.revision, 'view').toBe(1);
    expect(hook.current().context, 'context').toEqual({ 'node.current': 'n1' });
  });

  it('refreshes the view on layout and blocks events only', async () => {
    let revision = 1;
    const fake = installFakeApi({ layout_get: () => view(revision), ui_get_context: {} });
    const hook = await mount();
    revision = 2;
    fake.emit({ type: 'tree.changed' } as never);
    await flush();
    expect(hook.current().view?.revision, 'unrelated event').toBe(1);
    fake.emit({ type: 'layout.applied' } as never);
    await flush();
    expect(hook.current().view?.revision, 'layout event').toBe(2);
    revision = 3;
    fake.emit({ type: 'blocks.changed' } as never);
    await flush();
    expect(hook.current().view?.revision, 'blocks event').toBe(3);
  });

  it('refreshes the context on context events without reading the layout again', async () => {
    let current = 'n1';
    const fake = installFakeApi({ layout_get: view(1), ui_get_context: () => ({ 'node.current': current }) });
    const hook = await mount();
    fake.invoke.mockClear();
    current = 'n2';
    fake.emit({ type: 'context.changed' } as never);
    await flush();
    expect(hook.current().context, 'new context').toEqual({ 'node.current': 'n2' });
    expect(fake.invoke.mock.calls.map((c) => c[0]), 'only the context was read').toEqual(['ui_get_context']);
  });

  it('keeps the newest view when an older request finishes last', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const fake = installFakeApi({ layout_get: () => new Promise((resolve) => pending.push(resolve)), ui_get_context: {} });
    const hook = await mount();
    fake.emit({ type: 'layout.applied' } as never);
    await flush();
    pending[1]?.(view(5));
    await flush();
    pending[0]?.(view(4));
    await flush();
    expect(hook.current().view?.revision, 'stale view dropped').toBe(5);
  });

  it('keeps no view when layout_get fails', async () => {
    installFakeApi({ layout_get: { ok: false, error: { code: 'failed', message: 'x' } }, ui_get_context: {} });
    const hook = await mount();
    expect(hook.current().view, 'no view').toBeUndefined();
  });
});
