import { PANE_TYPES } from '../blocks/firstParty';
import type { Binding, LayoutDocument } from '../blocks/layout';

/** Panes whose content is the one node they are bound to; every other pane type lists or opens content of any folder. */
const NODE_PANES: ReadonlySet<string> = new Set([PANE_TYPES.surfaceHost, PANE_TYPES.placeholder]);

/**
 * Whether a binding makes its pane show something outside the folder. A context binding resolves through the
 * shared context; a resolved value that is not a node id (such as the selected object) counts as outside.
 * A value binding is fixed: a string must name a node of the folder. A data source has no
 * resolved value to check, so it counts as outside.
 */
function bindsOutside(binding: Binding, context: Readonly<Record<string, unknown>>, inScope: (nodeId: string) => boolean): boolean {
  if ('context' in binding) {
    const value = context[binding.context];
    return value !== undefined && (typeof value !== 'string' || !inScope(value));
  }
  if ('value' in binding) return typeof binding.value === 'string' && !inScope(binding.value);
  return true;
}

/**
 * Instances a window capture hides from a caller scoped to a folder (0020 section 9): the task tree, the inbox,
 * the profile rail, the usage, history, transcript, observation and swarm panes and any pane of a code block
 * show content of every folder, and a surface host bound to a node outside the folder shows that node.
 */
export function maskedInstances(
  layout: LayoutDocument,
  context: Readonly<Record<string, unknown>>,
  inScope: (nodeId: string) => boolean,
): string[] {
  return Object.entries(layout.instances).flatMap(([id, instance]) => {
    if (!NODE_PANES.has(instance.type)) return [id];
    return Object.values(instance.bindings ?? {}).some((binding) => bindsOutside(binding, context, inScope)) ? [id] : [];
  });
}
