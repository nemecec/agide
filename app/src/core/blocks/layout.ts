import { z } from 'zod';
import { CONTEXT_KEYS } from './context';
import { paneTypeIdSchema } from './manifest';

/**
 * The layout file, `layouts/<id>.json` in the profile data directory (0020 section 4). Agide's own
 * arrangement tree is authoritative; `engineState` is only a cache of the layout engine.
 */

export const LAYOUT_SCHEMA_VERSION = 1;

const instanceId = z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,63}$/);

export const bindingSchema = z.union([
  z.object({ context: z.enum(CONTEXT_KEYS) }).strict(),
  z.object({ value: z.json() }).strict(),
  z.object({ source: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/), params: z.record(z.string(), z.json()).optional() }).strict(),
]);

export const paneInstanceSchema = z
  .object({
    type: paneTypeIdSchema,
    /** Version range of the block, such as `^1`. */
    version: z.string().min(1).max(40),
    configVersion: z.number().int().min(1),
    config: z.record(z.string(), z.json()),
    bindings: z.record(z.string(), bindingSchema).optional(),
    /** Folder id the instance's bridge calls are scoped to, or `all`. */
    scope: z.string().min(1).max(64).optional(),
  })
  .strict();

const tabsNode = z
  .object({
    size: z.number().positive().optional(),
    tabs: z.object({ panes: z.array(instanceId).min(1), active: instanceId.optional() }).strict(),
  })
  .strict();

interface SplitNodeShape {
  size?: number | undefined;
  split: 'row' | 'column';
  children: ArrangementNodeShape[];
}
type ArrangementNodeShape = SplitNodeShape | z.output<typeof tabsNode>;

const splitNode: z.ZodType<SplitNodeShape> = z
  .object({
    size: z.number().positive().optional(),
    split: z.enum(['row', 'column']),
    get children(): z.ZodArray<z.ZodType<ArrangementNodeShape>> {
      return z.array(arrangementNodeSchema).min(1);
    },
  })
  .strict();

export const arrangementNodeSchema: z.ZodType<ArrangementNodeShape> = z.union([splitNode, tabsNode]);

export const layoutDocumentSchema = z
  .object({
    schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
    revision: z.number().int().min(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    title: z.string().min(1).max(60),
    instances: z.record(instanceId, paneInstanceSchema),
    arrangement: arrangementNodeSchema,
    /** Floating groups wait for the engine check; the field is kept as data. */
    floating: z.array(z.json()).optional(),
    engineState: z
      .object({ engine: z.string().min(1), engineVersion: z.string().min(1), arrangementHash: z.string().min(1), state: z.json() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const placed = new Map<string, number>();
    const walk = (node: ArrangementNodeShape, path: (string | number)[]): void => {
      if ('split' in node) {
        node.children.forEach((child, index) => walk(child, [...path, 'children', index]));
        return;
      }
      node.tabs.panes.forEach((id, index) => {
        if (!(id in layout.instances)) ctx.addIssue({ code: 'custom', path: [...path, 'tabs', 'panes', index], message: `no instance ${id}` });
        placed.set(id, (placed.get(id) ?? 0) + 1);
      });
      if (node.tabs.active !== undefined && !node.tabs.panes.includes(node.tabs.active)) {
        ctx.addIssue({ code: 'custom', path: [...path, 'tabs', 'active'], message: `active pane ${node.tabs.active} is not in this tab group` });
      }
    };
    walk(layout.arrangement, ['arrangement']);
    for (const id of Object.keys(layout.instances)) {
      const count = placed.get(id) ?? 0;
      if (count !== 1) ctx.addIssue({ code: 'custom', path: ['instances', id], message: `instance ${id} is placed ${count === 0 ? 'nowhere' : 'more than once'}` });
    }
  });

export type Binding = z.output<typeof bindingSchema>;
export type PaneInstance = z.output<typeof paneInstanceSchema>;
export type ArrangementNode = ArrangementNodeShape;
export type LayoutDocument = z.output<typeof layoutDocumentSchema>;

export interface LayoutIssue {
  /** JSON Pointer into the document, such as `/instances/main/type`. */
  readonly path: string;
  readonly message: string;
}

export type LayoutValidation = { readonly ok: true; readonly layout: LayoutDocument } | { readonly ok: false; readonly issues: readonly LayoutIssue[] };

/** Validates a layout document and reports every problem with its JSON Pointer. */
export function validateLayout(value: unknown): LayoutValidation {
  const result = layoutDocumentSchema.safeParse(value);
  if (result.success) return { ok: true, layout: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? '' : `/${issue.path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`,
      message: issue.message,
    })),
  };
}
