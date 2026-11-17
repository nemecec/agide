import type { ArrangementNode, LayoutDocument, PaneInstance } from '../blocks/layout';

export interface InstanceChange {
  readonly instanceId: string;
  readonly field: 'type' | 'version' | 'configVersion' | 'config' | 'bindings' | 'scope';
  readonly from: unknown;
  readonly to: unknown;
}

export interface LayoutDiff {
  readonly titleChanged?: { readonly from: string; readonly to: string };
  readonly added: readonly { readonly instanceId: string; readonly type: string }[];
  readonly removed: readonly { readonly instanceId: string; readonly type: string }[];
  /** Instances that sit in another tab group, at another tab position or beside other panes. */
  readonly moved: readonly string[];
  readonly changed: readonly InstanceChange[];
  /** True when split directions, split sizes or the nesting of the arrangement changed. */
  readonly arrangementChanged: boolean;
  readonly activeTabsChanged: boolean;
}

export const isEmptyDiff = (diff: LayoutDiff): boolean =>
  diff.titleChanged === undefined &&
  diff.added.length === 0 &&
  diff.removed.length === 0 &&
  diff.moved.length === 0 &&
  diff.changed.length === 0 &&
  !diff.arrangementChanged &&
  !diff.activeTabsChanged;

interface Placement {
  readonly group: string;
  readonly position: number;
  readonly neighbours: string;
}

/** Where each instance sits: the path of its tab group, its tab position and the panes beside it. */
function placements(node: ArrangementNode, path: string, into: Map<string, Placement>): void {
  if ('split' in node) {
    node.children.forEach((child, index) => placements(child, `${path}/${index}`, into));
    return;
  }
  const neighbours = [...node.tabs.panes].sort().join(',');
  node.tabs.panes.forEach((id, position) => into.set(id, { group: path, position, neighbours }));
}

/** The arrangement with only its shape and sizes, for comparing structure while ignoring which pane is where. */
function shape(node: ArrangementNode): unknown {
  if ('split' in node) return { split: node.split, size: node.size ?? null, children: node.children.map(shape) };
  return { size: node.size ?? null, count: node.tabs.panes.length };
}

function activeTabs(node: ArrangementNode, into: unknown[]): unknown[] {
  if ('split' in node) node.children.forEach((child) => activeTabs(child, into));
  else into.push(node.tabs.active ?? node.tabs.panes[0]);
  return into;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function changesOf(id: string, before: PaneInstance, after: PaneInstance): InstanceChange[] {
  const fields = ['type', 'version', 'configVersion', 'config', 'bindings', 'scope'] as const;
  return fields.flatMap((field) =>
    same(before[field], after[field]) ? [] : [{ instanceId: id, field, from: before[field] ?? null, to: after[field] ?? null }],
  );
}

/** What changed between two revisions of a layout, in terms of instances, not of JSON text. */
export function diffLayouts(before: LayoutDocument, after: LayoutDocument): LayoutDiff {
  const oldPlace = new Map<string, Placement>();
  const newPlace = new Map<string, Placement>();
  placements(before.arrangement, '', oldPlace);
  placements(after.arrangement, '', newPlace);

  const ids = (layout: LayoutDocument) => Object.keys(layout.instances);
  const added = ids(after).filter((id) => !(id in before.instances)).map((id) => ({ instanceId: id, type: after.instances[id]?.type ?? '' }));
  const removed = ids(before).filter((id) => !(id in after.instances)).map((id) => ({ instanceId: id, type: before.instances[id]?.type ?? '' }));
  const kept = ids(after).filter((id) => id in before.instances);

  const moved = kept.filter((id) => {
    const from = oldPlace.get(id);
    const to = newPlace.get(id);
    return from !== undefined && to !== undefined && (from.group !== to.group || from.position !== to.position || from.neighbours !== to.neighbours);
  });
  const changed = kept.flatMap((id) => {
    const previous = before.instances[id];
    const next = after.instances[id];
    return previous && next ? changesOf(id, previous, next) : [];
  });

  return {
    ...(before.title === after.title ? {} : { titleChanged: { from: before.title, to: after.title } }),
    added,
    removed,
    moved,
    changed,
    arrangementChanged: !same(shape(before.arrangement), shape(after.arrangement)),
    activeTabsChanged: !same(activeTabs(before.arrangement, []), activeTabs(after.arrangement, [])),
  };
}

const show = (value: unknown): string => {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** The diff as lines for a person or an agent. */
export function describeDiff(diff: LayoutDiff): string[] {
  if (isEmptyDiff(diff)) return ['no change'];
  const lines: string[] = [];
  if (diff.titleChanged) lines.push(`title: ${show(diff.titleChanged.from)} -> ${show(diff.titleChanged.to)}`);
  for (const { instanceId, type } of diff.added) lines.push(`added ${instanceId} (${type})`);
  for (const { instanceId, type } of diff.removed) lines.push(`removed ${instanceId} (${type})`);
  for (const id of diff.moved) lines.push(`moved ${id}`);
  for (const change of diff.changed) lines.push(`${change.instanceId}.${change.field}: ${show(change.from)} -> ${show(change.to)}`);
  if (diff.arrangementChanged) lines.push('arrangement: split directions or sizes changed');
  if (diff.activeTabsChanged) lines.push('arrangement: the active tab of a group changed');
  return lines;
}
