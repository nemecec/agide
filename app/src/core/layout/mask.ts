import { PANE_TYPES } from '../blocks/firstParty';
import type { LayoutDocument } from '../blocks/layout';

/** Panes that show content of every folder, or of other profiles. */
const UNSCOPED_PANES: ReadonlySet<string> = new Set([PANE_TYPES.tree, PANE_TYPES.inbox, PANE_TYPES.profileRail]);

/**
 * Instances a window capture hides from a caller scoped to a folder (0020 section 9): the task tree and the inbox
 * list every folder, the profile rail lists other profiles, and a pane bound to a node outside the folder shows
 * that node's content.
 */
export function maskedInstances(
  layout: LayoutDocument,
  context: Readonly<Record<string, string | undefined>>,
  inScope: (nodeId: string) => boolean,
): string[] {
  return Object.entries(layout.instances).flatMap(([id, instance]) => {
    if (UNSCOPED_PANES.has(instance.type)) return [id];
    const bound = Object.values(instance.bindings ?? {}).flatMap((binding) => {
      if (!('context' in binding)) return [];
      const value = context[binding.context];
      return value === undefined ? [] : [value];
    });
    return bound.some((nodeId) => !inScope(nodeId)) ? [id] : [];
  });
}
