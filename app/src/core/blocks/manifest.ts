import { z } from 'zod';
import { CONTEXT_KEYS } from './context';

/**
 * The block manifest, `agide/block.json` in a block package (0020 section 2). This schema is the single
 * source: TypeScript types, the JSON Schema for `blocks_list` and `docs/blocks.md` derive from it.
 * The first slice covers panes; the other parts are listed so a manifest that names them validates.
 */

export const BLOCK_API_VERSION = '1.0';
/** Block id reserved for first-party blocks; type ids `agide/<local>`. */
export const FIRST_PARTY_BLOCK_ID = 'agide';

const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const blockIdSchema = z.string().max(64).regex(kebab, 'kebab case, starting with a letter');
export const paneTypeIdSchema = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/, '<block id>/<local id>');
const commandId = /^[a-z]+(_[a-z0-9]+)+$/;
const sourceId = /^[a-z][a-z0-9_.-]{0,127}$/;
const eventType = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Permission ids form a closed set (0020 section 8). An unknown id is an error. */
export const permissionSchema = z.union([
  z.string().regex(new RegExp(`^commands\\.invoke:${commandId.source.slice(1, -1)}$`)),
  z.string().regex(new RegExp(`^events\\.subscribe:${eventType.source.slice(1, -1)}$`)),
  z.string().regex(new RegExp(`^context\\.read:(${CONTEXT_KEYS.map((key) => key.replaceAll('.', '\\.')).join('|')})$`)),
  z.literal('context.write:selection.object'),
  z.string().regex(new RegExp(`^data\\.read:${sourceId.source.slice(1, -1)}$`)),
  z.string().regex(/^net\.fetch:https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/),
  z.enum(['storage.block', 'clipboard.write', 'notify']),
]);

export const paneTierSchema = z.enum(['builtin', 'declarative', 'code']);

export const paneInputSchema = z
  .object({ contextKey: z.enum(CONTEXT_KEYS).optional(), required: z.boolean().default(false) })
  .strict();

export const paneManifestSchema = z
  .object({
    type: paneTypeIdSchema,
    title: z.string().min(1).max(60),
    icon: z.string().max(200).optional(),
    tier: paneTierSchema,
    /** HTML entry inside the package; code panes only. */
    entry: z.string().max(200).optional(),
    configVersion: z.number().int().min(1),
    /** JSON Schema of the pane's config. */
    configSchema: z.record(z.string(), z.unknown()).default({ type: 'object' }),
    defaultConfig: z.record(z.string(), z.unknown()).default({}),
    size: z
      .object({
        minWidth: z.number().int().positive().optional(),
        minHeight: z.number().int().positive().optional(),
        preferredWidth: z.number().int().positive().optional(),
        preferredHeight: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    inputs: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), paneInputSchema).default({}),
  })
  .strict()
  .refine((pane) => (pane.tier === 'code') === (pane.entry !== undefined), { message: 'a code pane needs an entry; other tiers have none', path: ['entry'] });

export const blockManifestSchema = z
  .object({
    apiVersion: z.string().regex(/^\d+\.\d+$/),
    id: blockIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
    title: z.string().min(1).max(60),
    engines: z.object({ agide: z.string().min(1).max(60) }).strict(),
    panes: z.array(paneManifestSchema).default([]),
    compositions: z.array(z.string().max(200)).optional(),
    templates: z.array(z.string().max(200)).optional(),
    dataSources: z.array(z.string().max(200)).optional(),
    commands: z.array(z.string().max(200)).optional(),
    events: z
      .object({
        emits: z.array(z.object({ type: z.string().regex(eventType), schema: z.string().max(200) }).strict()).default([]),
        consumes: z.array(z.string().regex(eventType)).default([]),
      })
      .strict()
      .optional(),
    context: z
      .object({
        reads: z.array(z.enum(CONTEXT_KEYS)).default([]),
        writes: z.array(z.literal('selection.object')).default([]),
      })
      .strict()
      .optional(),
    permissions: z.array(permissionSchema).default([]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    manifest.panes.forEach((pane, index) => {
      if (!pane.type.startsWith(`${manifest.id}/`)) {
        ctx.addIssue({ code: 'custom', path: ['panes', index, 'type'], message: `pane type must start with ${manifest.id}/` });
      }
    });
    const prefix = `ext.${manifest.id.replaceAll('-', '_')}.`;
    manifest.events?.emits.forEach((event, index) => {
      if (!event.type.startsWith(prefix)) {
        ctx.addIssue({ code: 'custom', path: ['events', 'emits', index, 'type'], message: `emitted event types must start with ${prefix}` });
      }
    });
  });

export type BlockManifest = z.output<typeof blockManifestSchema>;
export type PaneManifest = z.output<typeof paneManifestSchema>;
export type Permission = z.output<typeof permissionSchema>;
