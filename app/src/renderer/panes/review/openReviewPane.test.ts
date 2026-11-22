// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../../testing/fakeApi';
import { openReviewPane, planOpenReviewPane } from './openReviewPane';

const pane = (type: string, config: Record<string, unknown> = {}) => ({ type, version: '^1', configVersion: 1, config });
const layout = (extra: Record<string, unknown> = {}, tabs = ['main', 'inbox'], active = 'main') => ({
  layout: {
    schemaVersion: 1,
    revision: 3,
    id: 'default',
    title: 'default',
    instances: { tree: pane('agide/tree'), main: pane('agide/surface-host'), inbox: pane('agide/inbox'), ...extra },
    arrangement: { split: 'row', children: [{ tabs: { panes: ['tree'] } }, { tabs: { panes: tabs, active } }] },
  },
});

afterEach(() => {
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
});

describe('planOpenReviewPane', () => {
  it('adds a review pane with the swarm and changeset next to the main surface', () => {
    const patch = planOpenReviewPane(layout() as never, 'sw-1', 'cs_1')!;
    expect(patch[0], 'new instance with both ids').toEqual({ op: 'add', path: '/instances/review-sw-1', value: pane('agide/review', { swarmId: 'sw-1', changesetId: 'cs_1' }) });
    expect(patch[1], 'its tab is active').toEqual({ op: 'replace', path: '/arrangement/children/1/tabs', value: { panes: ['main', 'inbox', 'review-sw-1'], active: 'review-sw-1' } });
  });

  it('writes the changeset into an existing review pane of the swarm and brings it to the front', () => {
    const view = layout({ 'review-sw-1': pane('agide/review', { swarmId: 'sw-1' }) }, ['main', 'review-sw-1']);
    expect(planOpenReviewPane(view as never, 'sw-1', 'cs_2'), 'config then activation').toEqual([
      { op: 'replace', path: '/instances/review-sw-1/config', value: { swarmId: 'sw-1', changesetId: 'cs_2' } },
      { op: 'replace', path: '/arrangement/children/1/tabs/active', value: 'review-sw-1' },
    ]);
  });

  it('opens the list when no changeset is named and leaves the review pane of another swarm alone', () => {
    const view = layout({ 'review-other': pane('agide/review', { swarmId: 'other' }) });
    const patch = planOpenReviewPane(view as never, 'sw-1')!;
    expect(patch[0], 'a new pane without a changeset').toEqual({ op: 'add', path: '/instances/review-sw-1', value: pane('agide/review', { swarmId: 'sw-1' }) });
  });
});

describe('openReviewPane', () => {
  it('applies the plan against the revision it read and returns a failure message', async () => {
    const fake = installFakeApi({ layout_get: { ...layout(), layoutId: 'default', revision: 3 }, layout_apply: {} });
    expect(await openReviewPane('sw-1', 'cs_1'), 'success').toBeUndefined();
    expect(fake.invoke, 'patch with the read revision').toHaveBeenCalledWith('layout_apply', expect.objectContaining({ layoutId: 'default', expectedRevision: 3 }));
    installFakeApi({ layout_get: { ok: false, error: { code: 'failed', message: 'no layout' } } });
    expect(await openReviewPane('sw-1'), 'failure').toBe('no layout');
  });
});
