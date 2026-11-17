import { describe, expect, it, vi } from 'vitest';
import { TreeError, type TreeEvent, type TreeService } from './types';

/** Behaviour every `TreeService` implementation must show. Call it from the implementation's test file. */
export function describeTreeServiceContract(name: string, create: () => TreeService): void {
  describe(`${name} (TreeService contract)`, () => {
    it('lists parents before children and siblings in order', () => {
      const tree = create();
      const a = tree.createFolder({ title: 'A' });
      const b = tree.createFolder({ title: 'B' });
      const leaf = tree.createLeaf({ title: 'S', parentId: a.id, surfaceType: 'claude-session', surfaceId: 's1' });
      expect(tree.list().map((n) => n.id), 'depth-first order with siblings by order').toEqual([a.id, leaf.id, b.id]);
    });

    it('inserts at the requested index and keeps sibling orders dense', () => {
      const tree = create();
      const first = tree.createFolder({ title: 'first' });
      const second = tree.createFolder({ title: 'second', index: 0 });
      expect(tree.children(null).map((n) => [n.id, n.order]), 'new node at index 0 pushes the other down').toEqual([
        [second.id, 0],
        [first.id, 1],
      ]);
    });

    it('rejects a move of a folder into its own descendant', () => {
      const tree = create();
      const outer = tree.createFolder({ title: 'outer' });
      const inner = tree.createFolder({ title: 'inner', parentId: outer.id });
      const attempt = () => tree.move(outer.id, { parentId: inner.id });
      expect(attempt, 'move into a descendant throws').toThrow(TreeError);
      expect(tree.get(outer.id)?.parentId, 'tree unchanged after the rejected move').toBeNull();
    });

    it('rejects a move of a folder into a grandchild and leaves the tree unchanged', () => {
      const tree = create();
      const outer = tree.createFolder({ title: 'outer' });
      const mid = tree.createFolder({ title: 'mid', parentId: outer.id });
      const inner = tree.createFolder({ title: 'inner', parentId: mid.id });
      const before = tree.list();
      expect(() => tree.move(outer.id, { parentId: inner.id }), 'move into a grandchild throws cycle').toThrow(
        expect.objectContaining({ code: 'cycle' }),
      );
      expect(tree.list(), 'tree after the rejected move').toEqual(before);
    });

    it('rejects a leaf as a parent', () => {
      const tree = create();
      const leaf = tree.createLeaf({ title: 'S', parentId: null, surfaceType: 'browser-tab', surfaceId: 't1' });
      expect(() => tree.createFolder({ title: 'x', parentId: leaf.id }), 'leaf cannot hold children').toThrow(
        expect.objectContaining({ code: 'parent_not_folder' }),
      );
    });

    it('moves a node and renumbers both sibling lists', () => {
      const tree = create();
      const a = tree.createFolder({ title: 'A' });
      const b = tree.createFolder({ title: 'B' });
      const c = tree.createFolder({ title: 'C' });
      tree.move(a.id, { parentId: c.id });
      expect(tree.children(null).map((n) => n.order), 'old siblings closed the gap').toEqual([0, 1]);
      expect(tree.get(a.id), 'moved node sits under its new parent').toMatchObject({ parentId: c.id, order: 0 });
      expect(tree.get(b.id)?.order, 'B moved up to the first position').toBe(0);
    });

    it('removes a whole subtree and reports every removed node', () => {
      const tree = create();
      const outer = tree.createFolder({ title: 'outer' });
      const inner = tree.createFolder({ title: 'inner', parentId: outer.id });
      const leaf = tree.createLeaf({ title: 'S', parentId: inner.id, surfaceType: 'claude-session', surfaceId: 's1' });
      const events: TreeEvent[] = [];
      tree.subscribe((e) => events.push(e));
      const removed = tree.remove(outer.id);
      expect(removed.map((n) => n.id).sort(), 'removed list holds the root and its descendants').toEqual(
        [outer.id, inner.id, leaf.id].sort(),
      );
      expect(tree.list(), 'tree is empty afterwards').toEqual([]);
      expect(events.map((e) => e.type), 'one subtree event').toEqual(['tree.subtree_removed']);
    });

    it('renames with a trimmed title and rejects an empty one', () => {
      const tree = create();
      const folder = tree.createFolder({ title: 'old' });
      expect(tree.rename(folder.id, '  new  ').title, 'title is trimmed').toBe('new');
      expect(() => tree.rename(folder.id, '   '), 'blank title is rejected').toThrow(
        expect.objectContaining({ code: 'invalid_title' }),
      );
    });

    it('reorders a node inside its parent', () => {
      const tree = create();
      const a = tree.createFolder({ title: 'A' });
      const b = tree.createFolder({ title: 'B' });
      const c = tree.createFolder({ title: 'C' });
      tree.move(a.id, { parentId: null, index: 1 });
      expect(tree.children(null).map((n) => [n.id, n.order]), 'A sits between B and C').toEqual([
        [b.id, 0],
        [a.id, 1],
        [c.id, 2],
      ]);
    });

    it('appends a moved node when the index is absent or past the end', () => {
      const tree = create();
      const a = tree.createFolder({ title: 'A' });
      const b = tree.createFolder({ title: 'B' });
      const target = tree.createFolder({ title: 'target' });
      tree.createFolder({ title: 'existing', parentId: target.id });
      tree.move(a.id, { parentId: target.id });
      tree.move(b.id, { parentId: target.id, index: 99 });
      expect(tree.children(target.id).map((n) => n.id).slice(1), 'moved nodes follow the existing child').toEqual([a.id, b.id]);
    });

    it('moves a leaf to the top level and keeps its surface', () => {
      const tree = create();
      const folder = tree.createFolder({ title: 'F' });
      const leaf = tree.createLeaf({ title: 'S', parentId: folder.id, surfaceType: 'browser-tab', surfaceId: 't1' });
      const moved = tree.move(leaf.id, { parentId: null });
      expect(moved, 'leaf keeps type and surface id').toMatchObject({ parentId: null, surfaceType: 'browser-tab', surfaceId: 't1' });
    });

    it('rejects a move onto itself and a move under a leaf, leaving the tree unchanged', () => {
      const tree = create();
      const folder = tree.createFolder({ title: 'F' });
      const leaf = tree.createLeaf({ title: 'S', parentId: null, surfaceType: 'browser-tab', surfaceId: 't1' });
      expect(() => tree.move(folder.id, { parentId: folder.id }), 'folder into itself').toThrow(
        expect.objectContaining({ code: 'cycle' }),
      );
      expect(() => tree.move(folder.id, { parentId: leaf.id }), 'folder under a leaf').toThrow(
        expect.objectContaining({ code: 'parent_not_folder' }),
      );
      expect(tree.children(null).map((n) => n.id), 'top level is as before').toEqual([folder.id, leaf.id]);
    });

    it('throws not_found for an unknown node', () => {
      const tree = create();
      expect(() => tree.rename('missing', 'x'), 'rename of an unknown id').toThrow(expect.objectContaining({ code: 'not_found' }));
      expect(() => tree.remove('missing'), 'remove of an unknown id').toThrow(expect.objectContaining({ code: 'not_found' }));
    });

    it('closes the order gap after removing a middle sibling', () => {
      const tree = create();
      tree.createFolder({ title: 'A' });
      const b = tree.createFolder({ title: 'B' });
      const c = tree.createFolder({ title: 'C' });
      tree.remove(b.id);
      expect(tree.get(c.id)?.order, 'C moved up to position 1').toBe(1);
    });

    it('emits created, renamed and moved events with the changed node', () => {
      const tree = create();
      const events: TreeEvent[] = [];
      tree.subscribe((e) => events.push(e));
      const a = tree.createFolder({ title: 'A' });
      const b = tree.createFolder({ title: 'B' });
      tree.rename(a.id, 'A2');
      tree.move(a.id, { parentId: b.id });
      expect(
        events.map((e) => e.type),
        'one event per operation, in order',
      ).toEqual(['tree.node_created', 'tree.node_created', 'tree.node_renamed', 'tree.node_moved']);
      expect(events[2], 'rename event carries the old title').toMatchObject({ previousTitle: 'A' });
      expect(events[3], 'move event names the old parent').toMatchObject({ fromParentId: null, node: { parentId: b.id } });
    });

    it('emits nothing for a rejected operation and stops after unsubscribe', () => {
      const tree = create();
      const events: TreeEvent[] = [];
      const off = tree.subscribe((e) => events.push(e));
      const a = tree.createFolder({ title: 'A' });
      expect(() => tree.move(a.id, { parentId: a.id }), 'cycle is rejected').toThrow(TreeError);
      off();
      tree.createFolder({ title: 'B' });
      expect(events.map((e) => e.type), 'only the first creation was observed').toEqual(['tree.node_created']);
    });

    it('keeps the change and informs later listeners when a listener throws', () => {
      const tree = create();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const later: string[] = [];
        tree.subscribe(() => {
          throw new Error('listener failed');
        });
        tree.subscribe((e) => later.push(e.type));
        const folder = tree.createFolder({ title: 'A' });
        expect(tree.get(folder.id), 'the folder exists although a listener threw').toBeDefined();
        expect(later, 'a listener after the failing one still ran').toEqual(['tree.node_created']);
        expect(errors, 'the listener error was reported').toHaveBeenCalledOnce();
      } finally {
        errors.mockRestore();
      }
    });

    it('answers isWithin for the node itself, descendants and strangers', () => {
      const tree = create();
      const outer = tree.createFolder({ title: 'outer' });
      const inner = tree.createFolder({ title: 'inner', parentId: outer.id });
      const other = tree.createFolder({ title: 'other' });
      expect(tree.isWithin(outer.id, outer.id), 'a node is within itself').toBe(true);
      expect(tree.isWithin(inner.id, outer.id), 'a child is within its parent').toBe(true);
      expect(tree.isWithin(other.id, outer.id), 'a sibling folder is not within').toBe(false);
      const mid = tree.createFolder({ title: 'mid', parentId: inner.id });
      const deep = tree.createFolder({ title: 'deep', parentId: mid.id });
      expect(tree.isWithin(deep.id, outer.id), 'a node two levels below the ancestor is within').toBe(true);
      expect(tree.isWithin(outer.id, deep.id), 'an ancestor is not within its descendant').toBe(false);
    });
  });
}
