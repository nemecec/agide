import { describe, expect, it } from 'vitest';
import { PAIR_PRESET, SESSION_PRESET, type LayoutDocument } from '../../core/blocks/index';
import { toDockview } from './dockviewAdapter';
import { arrangementToSave, engineShows, fixedWidth, hidesHeader, resolveInputs, titleOf } from './hostModel';

const titles = (layout: LayoutDocument) => Object.keys(layout.instances).map((id) => ({ id, title: titleOf(layout, id) }));
const serialize = (layout: LayoutDocument) => toDockview(layout, (id) => titleOf(layout, id));

describe('titleOf', () => {
  it('prefers the title in the instance config', () => {
    const layout = { ...SESSION_PRESET, instances: { a: { ...SESSION_PRESET.instances['tree']!, config: { title: 'Tasks' } } } };
    expect(titleOf(layout, 'a'), 'configured title').toBe('Tasks');
  });

  it('falls back to the last segment of the type id, then to the id', () => {
    const layout = { ...SESSION_PRESET, instances: { a: { ...SESSION_PRESET.instances['tree']!, type: 'agide/task-tree', config: {} } } };
    expect(titleOf(layout, 'a'), 'type segment in words').toBe('Task tree');
    expect(titleOf(layout, 'unknown'), 'unknown instance').toBe('unknown');
  });

  it('numbers panes that would otherwise show the same title', () => {
    const surface = { ...SESSION_PRESET.instances['tree']!, type: 'agide/surface-host', config: {} };
    const layout = { ...SESSION_PRESET, instances: { a: surface, b: surface, c: { ...surface, type: 'agide/usage-ranking' } } };
    expect([titleOf(layout, 'a'), titleOf(layout, 'b')], 'two surface panes').toEqual(['Surface host 1', 'Surface host 2']);
    expect(titleOf(layout, 'c'), 'a pane with its own title stays plain').toBe('Usage ranking');
  });

  it('ignores a title that is not a string', () => {
    const layout = { ...SESSION_PRESET, instances: { a: { ...SESSION_PRESET.instances['tree']!, type: 'agide/tree', config: { title: 5 } } } };
    expect(titleOf(layout, 'a'), 'non-string title').toBe('Tree');
  });
});

describe('resolveInputs', () => {
  it('reads a context binding from the shared context and a value binding as given', () => {
    const inputs = resolveInputs({ node: { context: 'node.current' }, label: { value: 'x' } }, { 'node.current': 'n1' } as never);
    expect(inputs, 'resolved inputs').toEqual({ node: 'n1', label: 'x' });
  });

  it('leaves a context input undefined while the context has no value, and skips data sources', () => {
    const inputs = resolveInputs({ node: { context: 'node.current' }, feed: { source: 'inbox.items' } }, {});
    expect(inputs, 'resolved inputs').toEqual({ node: undefined });
    expect('feed' in inputs, 'data source binding has no input yet').toBe(false);
  });

  it('returns no inputs without bindings', () => {
    expect(resolveInputs(undefined, {}), 'no bindings').toEqual({});
  });
});

describe('hidesHeader', () => {
  it('hides the header of a group that holds only the profile rail', () => {
    expect(hidesHeader(['agide/profile-rail']), 'rail alone').toBe(true);
  });

  it('keeps the header when another pane shares the group, and for an empty group', () => {
    expect(hidesHeader(['agide/profile-rail', 'agide/inbox']), 'mixed group').toBe(false);
    expect(hidesHeader(['agide/inbox']), 'other pane').toBe(false);
    expect(hidesHeader([]), 'empty group').toBe(false);
  });
});

describe('engineShows', () => {
  it('is true for the serialization of the same layout', () => {
    expect(engineShows(serialize(SESSION_PRESET), SESSION_PRESET, titles(SESSION_PRESET)), 'same layout').toBe(true);
  });

  it('is false when the layout has other panels', () => {
    expect(engineShows(serialize(SESSION_PRESET), PAIR_PRESET, titles(SESSION_PRESET)), 'panel set differs').toBe(false);
  });

  it('is false when the arrangement differs', () => {
    const moved: LayoutDocument = { ...SESSION_PRESET, arrangement: { tabs: { panes: ['rail', 'tree', 'main', 'inbox'] } } };
    expect(engineShows(serialize(SESSION_PRESET), moved, titles(SESSION_PRESET)), 'groups differ').toBe(false);
  });

  it('is false when a tab title changed', () => {
    const renamed: LayoutDocument = { ...SESSION_PRESET, instances: { ...SESSION_PRESET.instances, tree: { ...SESSION_PRESET.instances['tree']!, config: { title: 'Renamed' } } } };
    expect(engineShows(serialize(SESSION_PRESET), renamed, titles(SESSION_PRESET)), 'title differs').toBe(false);
  });
});

describe('arrangementToSave', () => {
  it('returns nothing when the engine shows what the layout holds', () => {
    expect(arrangementToSave(serialize(SESSION_PRESET), SESSION_PRESET), 'unchanged').toBeUndefined();
  });

  it('returns nothing while the engine shows other panels than the layout', () => {
    expect(arrangementToSave(serialize(SESSION_PRESET), PAIR_PRESET), 'mid reload').toBeUndefined();
  });

  it('returns the arrangement the user produced', () => {
    const regrouped: LayoutDocument = {
      ...SESSION_PRESET,
      arrangement: {
        split: 'row',
        children: [
          { size: 1, tabs: { panes: ['rail'] } },
          { size: 1, tabs: { panes: ['tree', 'inbox'], active: 'tree' } },
          { size: 3, tabs: { panes: ['main'], active: 'main' } },
        ],
      },
    };
    const saved = arrangementToSave(serialize(regrouped), SESSION_PRESET);
    expect(saved, 'rearranged groups').toMatchObject({ split: 'row' });
    expect(JSON.stringify(saved), 'inbox moved beside the tree').toContain('"panes":["tree","inbox"]');
  });
});

describe('fixedWidth', () => {
  it('gives a group holding only the profile rail the 52 px of the rail', () => {
    expect(fixedWidth(['agide/profile-rail']), 'rail alone').toBe(52);
  });

  it('leaves a group free when another pane shares it, and an empty group', () => {
    expect(fixedWidth(['agide/profile-rail', 'agide/tree']), 'rail with the tree').toBeUndefined();
    expect(fixedWidth(['agide/tree']), 'tree alone').toBeUndefined();
    expect(fixedWidth([]), 'empty group').toBeUndefined();
  });
});
