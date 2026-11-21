// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../../testing/fakeApi';
import { openSwarmPane, planOpenSwarmPane } from './openSwarmPane';

const pane = (type: string, config: Record<string, unknown> = {}) => ({ type, version: '^1', configVersion: 1, config });
const layout = (extra: Record<string, unknown> = {}, tabs = ['main', 'inbox'], active = 'main') => ({
  layout: {
    schemaVersion: 1,
    revision: 3,
    id: 'default',
    title: 'default',
    instances: { rail: pane('agide/profile-rail'), tree: pane('agide/tree'), main: pane('agide/surface-host'), inbox: pane('agide/inbox'), ...extra },
    arrangement: { split: 'row', children: [{ tabs: { panes: ['rail'] } }, { tabs: { panes: ['tree'] } }, { tabs: { panes: tabs, active } }] },
  },
});

afterEach(() => {
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
});

describe('planOpenSwarmPane', () => {
  it('adds a pane for the swarm to the tab group of the main surface and makes it the active tab', () => {
    const patch = planOpenSwarmPane(layout() as never, 's1-uuid')!;
    expect(patch[0], 'new instance').toEqual({ op: 'add', path: '/instances/swarm-s1-uuid', value: pane('agide/swarm', { swarmId: 's1-uuid' }) });
    expect(patch[1], 'tab group of the main surface').toEqual({ op: 'replace', path: '/arrangement/children/2/tabs', value: { panes: ['main', 'inbox', 'swarm-s1-uuid'], active: 'swarm-s1-uuid' } });
  });

  it('brings an existing pane of the swarm to the front instead of adding another', () => {
    const view = layout({ 'swarm-s1': pane('agide/swarm', { swarmId: 's1' }) }, ['main', 'swarm-s1']);
    expect(planOpenSwarmPane(view as never, 's1'), 'activate only').toEqual([{ op: 'replace', path: '/arrangement/children/2/tabs/active', value: 'swarm-s1' }]);
  });

  it('keeps instance ids unique and valid when the swarm id has odd characters', () => {
    const view = layout({ 'swarm-ab': pane('agide/swarm', { swarmId: 'other' }) });
    const patch = planOpenSwarmPane(view as never, 'a.b/c!')!;
    expect(patch[0]?.path, 'sanitised id').toBe('/instances/swarm-abc');
    const taken = planOpenSwarmPane(layout({ 'swarm-ab': pane('agide/swarm', { swarmId: 'other' }) }) as never, 'ab')!;
    expect(taken[0]?.path, 'a taken id gets a suffix').toBe('/instances/swarm-ab-x');
  });

  it('falls back to the last tab group when no group holds the main surface, and gives no plan for a missing group', () => {
    const view = layout();
    (view.layout.instances as Record<string, unknown>)['main'] = pane('agide/inbox');
    expect(planOpenSwarmPane(view as never, 's1')![1]?.path, 'last group').toBe('/arrangement/children/2/tabs');
    const single = { layout: { ...layout().layout, arrangement: { tabs: { panes: ['main'] } } } };
    expect(planOpenSwarmPane(single as never, 's1')![1]?.path, 'root tab group').toBe('/arrangement/tabs');
    const orphan = layout({ 'swarm-s1': pane('agide/swarm', { swarmId: 's1' }) });
    expect(planOpenSwarmPane(orphan as never, 's1'), 'a pane that no group lists').toBeUndefined();
  });
});

describe('openSwarmPane', () => {
  it('applies the plan against the revision it read', async () => {
    const fake = installFakeApi({ layout_get: { ...layout(), layoutId: 'default', revision: 3 }, layout_apply: {} });
    expect(await openSwarmPane('s1'), 'success').toBeUndefined();
    expect(fake.invoke, 'patch with the read revision').toHaveBeenCalledWith('layout_apply', expect.objectContaining({ layoutId: 'default', expectedRevision: 3 }));
  });

  it('returns the message of a failure', async () => {
    installFakeApi({ layout_get: { ok: false, error: { code: 'failed', message: 'no layout' } } });
    expect(await openSwarmPane('s1'), 'read failure').toBe('no layout');
    installFakeApi({ layout_get: { ...layout(), layoutId: 'default', revision: 3 }, layout_apply: { ok: false, error: { code: 'failed', message: 'stale revision' } } });
    expect(await openSwarmPane('s1'), 'apply failure').toBe('stale revision');
    installFakeApi({ layout_get: { layout: { ...layout().layout, instances: {}, arrangement: { split: 'row', children: [] } }, layoutId: 'default', revision: 1 } });
    expect(await openSwarmPane('s1'), 'no place').toBe('The layout has no place for the swarm pane.');
  });
});
