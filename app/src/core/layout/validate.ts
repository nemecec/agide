import { CONTEXT_KEYS } from '../blocks/context';
import { validateLayout, type LayoutDocument, type LayoutIssue } from '../blocks/layout';
import type { BlockRegistry, PlaceholderReason } from '../blocks/types';
import { PANE_TYPES } from '../blocks/firstParty';

export interface PlaceholderNote {
  readonly instanceId: string;
  readonly type: string;
  readonly reason: PlaceholderReason;
  readonly message: string;
}

export interface LayoutReport {
  /** False when `errors` is not empty. */
  readonly ok: boolean;
  readonly layout?: LayoutDocument;
  readonly errors: readonly LayoutIssue[];
  /** Problems that do not stop the layout: a binding the pane does not read, an instance that renders as a placeholder. */
  readonly warnings: readonly LayoutIssue[];
  /** The instances that render as `agide/placeholder` and why. */
  readonly placeholders: readonly PlaceholderNote[];
}

const GENERIC = 'Invalid input';

/** Turns the schema's generic messages into ones that say what to write. */
function explain(issue: LayoutIssue): LayoutIssue {
  const { path, message } = issue;
  if (message === GENERIC || message.startsWith('Invalid input:')) {
    if (/\/bindings\/[^/]+$/.test(path)) {
      return { path, message: 'a binding is exactly one of {"context": <key>}, {"value": <json>} or {"source": <data source id>, "params"?: {...}}' };
    }
    if (path === '/arrangement' || /\/children\/\d+$/.test(path)) {
      return { path, message: 'an arrangement node is a split {"split": "row"|"column", "children": [...]} or a tab group {"tabs": {"panes": [<instance id>], "active"?: <instance id>}}; "size" is optional on both' };
    }
  }
  if (/Invalid option: expected one of/.test(message) && /\/bindings\/[^/]+\/context$/.test(path)) {
    return { path, message: `unknown context key; use one of ${CONTEXT_KEYS.join(', ')}` };
  }
  if (path === '/schemaVersion') return { path, message: `${message}; this build reads schemaVersion 1` };
  return issue;
}

/**
 * Validates a layout document and resolves its instances against the block registry.
 * Schema problems are errors. An instance whose pane type is missing, disabled or out of range is a warning:
 * the layout is valid and the instance renders as a placeholder that keeps its config.
 */
export function validateLayoutDocument(value: unknown, registry: BlockRegistry): LayoutReport {
  const checked = validateLayout(value);
  if (!checked.ok) return { ok: false, errors: checked.issues.map(explain), warnings: [], placeholders: [] };

  const warnings: LayoutIssue[] = [];
  const placeholders: PlaceholderNote[] = [];
  for (const [id, instance] of Object.entries(checked.layout.instances)) {
    const resolution = registry.resolve(instance);
    if (resolution.status === 'placeholder') {
      placeholders.push({ instanceId: id, type: instance.type, reason: resolution.reason, message: resolution.message });
      const known = registry.paneTypes().map((entry) => entry.pane.type);
      const hint = resolution.reason === 'missing' ? `; pane types: ${known.join(', ')}` : '';
      warnings.push({ path: `/instances/${id}/type`, message: `${resolution.message}; the instance shows as ${PANE_TYPES.placeholder} and keeps its config${hint}` });
      continue;
    }
    const inputs = Object.keys(resolution.paneType.pane.inputs);
    for (const key of Object.keys(instance.bindings ?? {})) {
      if (!inputs.includes(key)) {
        warnings.push({
          path: `/instances/${id}/bindings/${key}`,
          message: `${instance.type} has no input ${key}; its inputs: ${inputs.length === 0 ? 'none' : inputs.join(', ')}`,
        });
      }
    }
  }
  return { ok: true, layout: checked.layout, errors: [], warnings, placeholders };
}
