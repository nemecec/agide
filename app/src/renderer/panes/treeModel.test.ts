import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../core/tree/types';
import { indexTree, isWithin, ROOT_ID } from './treeModel';

const folder = (id: string, parentId: string | null, order: number): TreeNode => ({ kind: 'folder', id, parentId, title: id, order });

const NODES: TreeNode[] = [folder('b', null, 1), folder('a', null, 0), folder('a2', 'a', 1), folder('a1', 'a', 0), folder('a1x', 'a1', 0)];

describe('indexTree', () => {
  it('groups children under their parent in sibling order and puts top-level nodes under the root', () => {
    const { childIds } = indexTree(NODES);
    expect(childIds.get(ROOT_ID), 'top level').toEqual(['a', 'b']);
    expect(childIds.get('a'), 'children of a').toEqual(['a1', 'a2']);
    expect(childIds.get('a1'), 'children of a1').toEqual(['a1x']);
  });

  it('finds every node by id and leaves leaves without a child entry', () => {
    const { byId, childIds } = indexTree(NODES);
    expect(byId.get('a1x')?.title, 'node lookup').toBe('a1x');
    expect(byId.size, 'all nodes indexed').toBe(NODES.length);
    expect(childIds.has('a1x'), 'no entry for a node without children').toBe(false);
  });

  it('does not reorder the input list', () => {
    const input = [...NODES];
    indexTree(input);
    expect(input, 'input unchanged').toEqual(NODES);
  });

  it('indexes an empty list', () => {
    const { byId, childIds } = indexTree([]);
    expect([byId.size, childIds.size], 'empty index').toEqual([0, 0]);
  });
});

describe('isWithin', () => {
  const index = indexTree(NODES);

  it('is true for the node itself and for any descendant', () => {
    expect(isWithin(index, 'a', 'a'), 'itself').toBe(true);
    expect(isWithin(index, 'a1x', 'a'), 'grandchild').toBe(true);
    expect(isWithin(index, 'a2', 'a'), 'child').toBe(true);
  });

  it('is false for an ancestor, a sibling branch and an unknown id', () => {
    expect(isWithin(index, 'a', 'a1x'), 'ancestor is not within its descendant').toBe(false);
    expect(isWithin(index, 'b', 'a'), 'other branch').toBe(false);
    expect(isWithin(index, 'missing', 'a'), 'unknown node').toBe(false);
  });

  it('terminates when the parent chain leaves the index', () => {
    const orphan = indexTree([folder('x', 'gone', 0)]);
    expect(isWithin(orphan, 'x', 'gone'), 'dangling parent is not found').toBe(false);
  });
});
