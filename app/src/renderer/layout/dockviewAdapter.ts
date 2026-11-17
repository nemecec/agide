import type { SerializedDockview } from 'dockview-react';
import type { ArrangementNode, LayoutDocument } from '../../core/blocks/layout';

/**
 * The only code that knows the layout engine (0020 section 5). Agide's arrangement tree is authoritative;
 * these functions translate it to dockview's serialization and back.
 */

const GRID_SIZE = 1000;
const SIZE_TOLERANCE = 0.03;

type Tabs = Extract<ArrangementNode, { tabs: unknown }>;
type Split = Extract<ArrangementNode, { split: unknown }>;

const isSplit = (node: ArrangementNode): node is Split => 'split' in node;

/**
 * A split inside a split of the same direction, and a split of one child, have no counterpart in the engine's
 * alternating grid. This is the shape both directions compare and rebuild from. Sizes become shares of the siblings.
 */
export function normalizeArrangement(node: ArrangementNode): ArrangementNode {
  if (!isSplit(node)) return { tabs: { panes: [...node.tabs.panes], ...(node.tabs.active === undefined ? {} : { active: node.tabs.active }) }, ...(node.size === undefined ? {} : { size: node.size }) };
  const children: ArrangementNode[] = [];
  const total = node.children.reduce((sum, child) => sum + (child.size ?? 1), 0);
  for (const raw of node.children) {
    const child = normalizeArrangement(raw);
    const share = (raw.size ?? 1) / total;
    if (isSplit(child) && child.split === node.split) {
      const inner = child.children.reduce((sum, c) => sum + (c.size ?? 1), 0);
      for (const grand of child.children) children.push({ ...grand, size: (share * (grand.size ?? 1)) / inner });
    } else {
      children.push({ ...child, size: share });
    }
  }
  if (children.length === 1 && children[0]) {
    const { size: _size, ...only } = children[0];
    return { ...only, ...(node.size === undefined ? {} : { size: node.size }) } as ArrangementNode;
  }
  return { split: node.split, children, ...(node.size === undefined ? {} : { size: node.size }) };
}

/** Same panes in the same groups and splits, sizes within a few percent of their siblings. */
export function arrangementsClose(a: ArrangementNode, b: ArrangementNode): boolean {
  if (isSplit(a) !== isSplit(b)) return false;
  if (isSplit(a) && isSplit(b)) {
    if (a.split !== b.split || a.children.length !== b.children.length) return false;
    const sum = (node: Split) => node.children.reduce((total, c) => total + (c.size ?? 1), 0);
    const [sa, sb] = [sum(a), sum(b)];
    return a.children.every((child, index) => {
      const other = b.children[index];
      if (!other) return false;
      const close = Math.abs((child.size ?? 1) / sa - (other.size ?? 1) / sb) <= SIZE_TOLERANCE;
      return close && arrangementsClose(child, other);
    });
  }
  const [ta, tb] = [a as Tabs, b as Tabs];
  const active = (t: Tabs) => t.tabs.active ?? t.tabs.panes[0];
  return JSON.stringify(ta.tabs.panes) === JSON.stringify(tb.tabs.panes) && active(ta) === active(tb);
}

interface GridNode {
  type: 'leaf' | 'branch';
  data: unknown;
  size?: number;
}

export function toDockview(layout: LayoutDocument, titleOf: (instanceId: string) => string): SerializedDockview {
  let groups = 0;
  const root = normalizeArrangement(layout.arrangement);
  const build = (node: ArrangementNode, size: number): GridNode => {
    if (isSplit(node)) {
      const total = node.children.reduce((sum, child) => sum + (child.size ?? 1), 0);
      return { type: 'branch', size, data: node.children.map((child) => build(child, ((child.size ?? 1) / total) * GRID_SIZE)) };
    }
    groups += 1;
    return {
      type: 'leaf',
      size,
      data: { id: `group-${groups}`, views: node.tabs.panes, activeView: node.tabs.active ?? node.tabs.panes[0] },
    };
  };
  const top = isSplit(root) ? root : ({ split: 'row', children: [root] } as Split);
  const grid = build(top, GRID_SIZE);
  const panels = Object.fromEntries(
    Object.keys(layout.instances).map((id) => [id, { id, contentComponent: 'pane', title: titleOf(id), params: { instanceId: id } }]),
  );
  return {
    grid: { root: grid, width: GRID_SIZE, height: GRID_SIZE, orientation: top.split === 'row' ? 'HORIZONTAL' : 'VERTICAL' },
    panels,
  } as unknown as SerializedDockview;
}

interface SerializedNode {
  type: 'leaf' | 'branch';
  data: unknown;
  size?: number;
}

/** The arrangement the engine currently shows, in normalized form. */
export function fromDockview(serialized: SerializedDockview): ArrangementNode {
  const convert = (node: SerializedNode, horizontal: boolean): ArrangementNode => {
    if (node.type === 'leaf') {
      const group = node.data as { views: string[]; activeView?: string };
      return { tabs: { panes: group.views, ...(group.activeView === undefined ? {} : { active: group.activeView }) }, size: node.size ?? 1 };
    }
    const children = (node.data as SerializedNode[]).map((child) => convert(child, !horizontal));
    return { split: horizontal ? 'row' : 'column', children, size: node.size ?? 1 };
  };
  const { root, orientation } = serialized.grid as unknown as { root: SerializedNode; orientation: string };
  return normalizeArrangement(convert(root, orientation === 'HORIZONTAL'));
}

/** Instance ids in the groups the engine shows. */
export function panelIds(serialized: SerializedDockview): string[] {
  return Object.keys(serialized.panels).sort();
}
