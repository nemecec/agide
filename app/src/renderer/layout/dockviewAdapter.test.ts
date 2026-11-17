import { describe, expect, it } from 'vitest';
import { PAIR_PRESET, SESSION_PRESET, type ArrangementNode } from '../../core/blocks/index';
import { arrangementsClose, fromDockview, normalizeArrangement, toDockview } from './dockviewAdapter';

const title = (id: string) => id;

describe('dockview adapter', () => {
  it('round trips the presets through the engine serialization', () => {
    for (const preset of [SESSION_PRESET, PAIR_PRESET]) {
      const back = fromDockview(toDockview(preset, title));
      expect(arrangementsClose(back, normalizeArrangement(preset.arrangement)), `${preset.id} arrangement survives the round trip`).toBe(true);
    }
  });

  it('wraps a single tab group in a split the engine can hold', () => {
    const layout = { ...SESSION_PRESET, instances: { tree: SESSION_PRESET.instances['tree']! }, arrangement: { tabs: { panes: ['tree'] } } };
    const serialized = toDockview(layout, title);
    expect(Object.keys(serialized.panels), 'one panel per instance').toEqual(['tree']);
    expect(fromDockview(serialized), 'one group comes back as a tab group').toMatchObject({ tabs: { panes: ['tree'] } });
  });

  it('flattens a split nested in a split of the same direction and keeps relative sizes', () => {
    const nested: ArrangementNode = {
      split: 'row',
      children: [
        { size: 1, tabs: { panes: ['a'] } },
        { size: 2, split: 'row', children: [{ size: 1, tabs: { panes: ['b'] } }, { size: 1, tabs: { panes: ['c'] } }] },
      ],
    };
    const flat = normalizeArrangement(nested);
    expect(flat, 'three children in one row').toMatchObject({ split: 'row', children: [{ tabs: { panes: ['a'] } }, { tabs: { panes: ['b'] } }, { tabs: { panes: ['c'] } }] });
    const sizes = 'children' in flat ? flat.children.map((c) => c.size ?? 0) : [];
    expect(sizes[0], 'a keeps a third').toBeCloseTo(1 / 3);
    expect(sizes[1], 'b and c share the remaining two thirds').toBeCloseTo(1 / 3);
  });

  it('keeps a column inside a row as a nested split', () => {
    const layout = {
      ...PAIR_PRESET,
      arrangement: {
        split: 'row',
        children: [
          { size: 1, tabs: { panes: ['tree'] } },
          { size: 3, split: 'column', children: [{ tabs: { panes: ['main'] } }, { tabs: { panes: ['side'] } }] },
        ],
      } satisfies ArrangementNode,
    };
    const back = fromDockview(toDockview(layout, title));
    expect(back, 'row with a nested column').toMatchObject({ split: 'row', children: [{ tabs: { panes: ['tree'] } }, { split: 'column' }] });
  });

  it('tells a moved pane from a resize within tolerance', () => {
    const base: ArrangementNode = { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'] } }, { size: 3, tabs: { panes: ['main'] } }, { size: 3, tabs: { panes: ['side'] } }] };
    const a = normalizeArrangement(base);
    const resized: ArrangementNode = { split: 'row', children: [{ size: 1.05, tabs: { panes: ['tree'] } }, { size: 3, tabs: { panes: ['main'] } }, { size: 3, tabs: { panes: ['side'] } }] };
    const swapped: ArrangementNode = { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'] } }, { size: 3, tabs: { panes: ['side'] } }, { size: 3, tabs: { panes: ['main'] } }] };
    expect(arrangementsClose(a, normalizeArrangement(resized)), 'small size drift is not a change').toBe(true);
    expect(arrangementsClose(a, normalizeArrangement(swapped)), 'swapped panes are a change').toBe(false);
  });
});
