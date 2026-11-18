import type { SerializedDockview } from 'dockview-react';
import type { ContextValues } from '../../core/blocks/context';
import type { ArrangementNode, LayoutDocument } from '../../core/blocks/layout';
import { arrangementsClose, fromDockview, normalizeArrangement, panelIds } from './dockviewAdapter';

/** Pane types whose group shows no tab header: window edges such as the profile rail. */
const HEADERLESS_TYPES: ReadonlySet<string> = new Set(['agide/profile-rail']);

const humanise = (segment: string): string => {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words === '' ? segment : words.charAt(0).toUpperCase() + words.slice(1);
};

const plainTitleOf = (layout: LayoutDocument, id: string): string => {
  const instance = layout.instances[id];
  const config = instance?.config['title'];
  if (typeof config === 'string') return config;
  return instance === undefined ? id : humanise(instance.type.split('/').at(-1) ?? id);
};

/**
 * The tab title: the instance's `title` config, else the last segment of its type id in words ("Usage ranking"),
 * else its id. Panes that would show the same title get a number so their tabs differ.
 */
export function titleOf(layout: LayoutDocument, id: string): string {
  const title = plainTitleOf(layout, id);
  const same = Object.keys(layout.instances).filter((other) => plainTitleOf(layout, other) === title).sort();
  return same.length > 1 ? `${title} ${same.indexOf(id) + 1}` : title;
}

/** Values of a pane's inputs: a context binding reads the shared context, a value binding is fixed. Data sources have no value yet. */
export function resolveInputs(bindings: LayoutDocument['instances'][string]['bindings'], context: Partial<ContextValues>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [name, binding] of Object.entries(bindings ?? {})) {
    if ('context' in binding) inputs[name] = context[binding.context];
    else if ('value' in binding) inputs[name] = binding.value;
  }
  return inputs;
}

/** True for a group that holds only headerless panes. */
export function hidesHeader(panelTypes: readonly string[]): boolean {
  return panelTypes.length > 0 && panelTypes.every((type) => HEADERLESS_TYPES.has(type));
}

/** True when the engine already shows the layout: the same panels, close arrangement and the same titles. */
export function engineShows(shown: SerializedDockview, layout: LayoutDocument, titles: readonly { id: string; title?: string | undefined }[]): boolean {
  const wanted = Object.keys(layout.instances).sort();
  return (
    JSON.stringify(panelIds(shown)) === JSON.stringify(wanted) &&
    arrangementsClose(fromDockview(shown), normalizeArrangement(layout.arrangement)) &&
    titles.every((panel) => panel.title === titleOf(layout, panel.id))
  );
}

/**
 * The arrangement to save after the user rearranged the engine, or undefined when nothing needs saving:
 * the engine shows other panels than the layout holds (it is mid-reload), or the arrangement did not change.
 */
export function arrangementToSave(shown: SerializedDockview, layout: LayoutDocument): ArrangementNode | undefined {
  const wanted = Object.keys(layout.instances).sort();
  if (JSON.stringify(panelIds(shown)) !== JSON.stringify(wanted)) return undefined;
  const arrangement = fromDockview(shown);
  return arrangementsClose(arrangement, normalizeArrangement(layout.arrangement)) ? undefined : arrangement;
}
