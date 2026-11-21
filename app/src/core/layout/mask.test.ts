import { describe, expect, it } from 'vitest';
import { PAIR_PRESET, type LayoutDocument } from '../blocks/index';
import { maskedInstances } from './mask';

const inScope = (id: string) => id === 'mine';

/** The pair preset with the bindings of the main pane replaced. */
function withMainBindings(bindings: NonNullable<LayoutDocument['instances'][string]['bindings']>): LayoutDocument {
  const layout = structuredClone(PAIR_PRESET);
  layout.instances['main'] = { ...layout.instances['main']!, bindings };
  return layout;
}

function withInstance(id: string, type: string): LayoutDocument {
  const layout = structuredClone(PAIR_PRESET);
  layout.instances[id] = { type, version: '^1', configVersion: 1, config: {} };
  layout.arrangement = { split: 'row', children: [layout.arrangement, { tabs: { panes: [id] } }] };
  return layout;
}

const context = { 'node.current': 'mine' };

describe('maskedInstances bindings', () => {
  it('masks a surface host bound by value to a node outside the folder', () => {
    expect(maskedInstances(withMainBindings({ node: { value: 'theirs' } }), context, inScope), 'the foreign value binding is masked').toContain('main');
  });

  it('masks a surface host bound by value to a node the tree does not know', () => {
    expect(maskedInstances(withMainBindings({ node: { value: 'unknown-id' } }), context, inScope), 'an unknown node is outside the folder').toContain('main');
  });

  it('keeps a surface host bound by value to a node of the folder', () => {
    expect(maskedInstances(withMainBindings({ node: { value: 'mine' } }), context, inScope), 'an own node is shown').not.toContain('main');
  });

  it('keeps a surface host with a value that is not a string, which names no node', () => {
    expect(maskedInstances(withMainBindings({ node: { value: 42 } }), context, inScope), 'a number selects no node').not.toContain('main');
  });

  it('masks a surface host bound to a data source, which has no value to check', () => {
    expect(maskedInstances(withMainBindings({ node: { source: 'tree.node' } }), context, inScope), 'a source binding counts as outside').toContain('main');
  });

  it('masks the pane when any one of several bindings points outside the folder', () => {
    expect(maskedInstances(withMainBindings({ node: { context: 'node.current' }, other: { value: 'theirs' } }), context, inScope), 'one foreign binding is enough').toContain('main');
  });

  it('keeps a context binding that resolves to an own node and one that resolves to nothing', () => {
    expect(maskedInstances(PAIR_PRESET, context, inScope), 'own node and an empty side pane').not.toContain('main');
    expect(maskedInstances(PAIR_PRESET, {}, inScope), 'no node at all').toEqual(['rail', 'tree', 'inbox']);
  });

  it('masks a pane bound to a context key that holds an object, without asking the scope about it', () => {
    const nodesOnly = (id: string): boolean => {
      if (typeof id !== 'string') throw new Error('the scope was asked about a value that is not a node id');
      return id === 'mine';
    };
    const selected = { 'node.current': 'mine', 'selection.object': { kind: 'file', id: 'f1' } };
    expect(maskedInstances(withMainBindings({ node: { context: 'selection.object' } }), selected, nodesOnly), 'an object is not a node of the folder').toContain('main');
  });
});

describe('maskedInstances pane types', () => {
  it.each(['agide/usage-ranking', 'agide/agent-history', 'agide/transcript-viewer', 'agide/observation-log', 'agide/swarm', 'acme/code-pane'])(
    'masks a %s pane, which shows content of folders other than the caller',
    (type) => {
      expect(maskedInstances(withInstance('extra', type), context, inScope), `${type} is hidden from a scoped caller`).toContain('extra');
    },
  );

  it('does not mask a placeholder pane', () => {
    expect(maskedInstances(withInstance('extra', 'agide/placeholder'), context, inScope), 'a placeholder shows only its own message').not.toContain('extra');
  });
});
