import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { CONTEXT_KEYS } from '../blocks/context';
import { PANE_TYPES } from '../blocks/firstParty';
import { layoutDocumentSchema, type LayoutDocument } from '../blocks/layout';
import type { BlockRegistry } from '../blocks/types';
import type { CommandRegistry } from '../commands/CommandRegistry';
import type { ImageResult } from '../commands/imageResult';
import { requireInScope } from '../commands/scope';
import { CommandError, type Caller } from '../commands/types';
import type { ContextStore } from '../context/index';
import type { TreeService } from '../tree/types';
import { LayoutError, type LayoutInput, type LayoutManager } from './LayoutManager';
import { patchOperationSchema } from './jsonPatch';
import { maskedInstances } from './mask';
import { validateLayoutDocument } from './validate';

export const MAIN_WINDOW = 'main';

/** What a window capture is asked for. */
export interface CaptureRequest {
  /**
   * The pane instances to hide, read from the current layout and context at each call. The capturer calls it
   * again after it has waited for the views and after it took the pixels, so a change in between is seen.
   */
  readonly masked: () => readonly string[];
  /** Set for a caller scoped to a folder: tells which tree nodes it may see; the capture reports nothing about a node it refuses. */
  readonly inScope?: ((nodeId: string) => boolean) | undefined;
}

/** A PNG of the window with the instances that were hidden in it and the shared views that had no painted frame. */
export interface WindowCapture {
  readonly data: string;
  readonly width: number;
  readonly height: number;
  readonly masked: readonly string[];
  readonly unavailable?: readonly string[];
}

/** Takes a PNG of the window. Provided by the Electron side. */
export type WindowCapturer = (request: CaptureRequest) => Promise<WindowCapture>;

export interface LayoutCommandDeps {
  readonly manager: LayoutManager;
  readonly blocks: BlockRegistry;
  readonly context: ContextStore;
  readonly tree: TreeService;
  readonly capture: WindowCapturer;
}

const layoutId = z.string().min(1).optional().describe('Layout id; defaults to the layout the window shows');
const document = z.record(z.string(), z.unknown()).optional().describe('The whole layout document (see layout_get for the shape)');
const patch = z
  .array(patchOperationSchema)
  .optional()
  .describe('JSON Patch operations (add, replace, remove, move, copy, test) against the layout returned by layout_get');

const oneOf = z.strictObject({ layoutId, document, patch });

function toInput(input: { document?: Record<string, unknown> | undefined; patch?: z.output<typeof patchOperationSchema>[] | undefined }): LayoutInput {
  if ((input.document === undefined) === (input.patch === undefined)) {
    throw new CommandError('invalid_input', 'give exactly one of document (the whole layout) or patch (JSON Patch operations)');
  }
  return input.patch === undefined ? { document: input.document } : { patch: input.patch };
}

/** Maps layout errors to command errors an agent can act on. */
function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof LayoutError)) throw error;
    throw new CommandError(error.code === 'not_found' ? 'not_found' : 'invalid_input', error.message, error.details);
  }
}

/** The window's `node.current` must lie in the folder of an MCP caller (0020 section 9). */
function requireWindowInScope(deps: LayoutCommandDeps, caller: Caller): void {
  if (caller.kind === 'ui') return;
  const shown = deps.context.get(MAIN_WINDOW, 'node.current');
  if (shown === undefined || !deps.tree.get(shown) || !deps.tree.isWithin(shown, caller.folderId)) {
    throw new CommandError(
      'out_of_scope',
      'you can change the layout only while the window shows a node in your folder; ask the user to open your session in the tree',
    );
  }
}

/**
 * Whether a value bound to the input names a node. A pane type that is not registered and the placeholder
 * declare no inputs yet can become a type that reads one, so every value there counts as a node reference.
 */
function inputNamesNode(deps: LayoutCommandDeps, instance: { type: string }, input: string): boolean {
  const paneType = deps.blocks.paneType(instance.type);
  if (!paneType || instance.type === PANE_TYPES.placeholder) return true;
  return paneType.pane.inputs[input]?.contextKey?.startsWith('node.') ?? false;
}

/** Node bindings that a change adds or changes, and the scope of every instance, must stay in the folder. A binding the layout already holds is not checked. */
function requireScopesInFolder(deps: LayoutCommandDeps, caller: Caller, layout: LayoutDocument, current: LayoutDocument): void {
  if (caller.kind === 'ui') return;
  for (const [id, instance] of Object.entries(layout.instances)) {
    for (const [name, binding] of Object.entries(instance.bindings ?? {})) {
      if (!('value' in binding) || typeof binding.value !== 'string' || !inputNamesNode(deps, instance, name)) continue;
      const before = current.instances[id];
      if (before?.type === instance.type && isDeepStrictEqual(binding, before.bindings?.[name])) continue;
      if (!deps.tree.get(binding.value) || !deps.tree.isWithin(binding.value, caller.folderId)) {
        throw new CommandError('out_of_scope', `instance ${id}: binding ${name} names a node that is not in your folder ${caller.folderId}; bind to a node from ui_list_tree or to a context key`);
      }
    }
    if (instance.scope === undefined) continue;
    if (instance.scope === 'all') {
      throw new CommandError('out_of_scope', `instance ${id}: scope "all" is wider than your folder; use your folder id ${caller.folderId} or leave scope out`);
    }
    requireInScope(deps.tree, caller, instance.scope);
  }
}

export function registerLayoutCommands(registry: CommandRegistry, deps: LayoutCommandDeps): void {
  const { manager, blocks, context, tree } = deps;

  registry.register({
    id: 'blocks_list',
    title: 'List blocks',
    description:
      'List the block types a layout can place: each pane type with its title, tier, config JSON Schema, default config and inputs, plus the layouts and the context keys. Set includeSchemas to also get the JSON Schema of a layout document.',
    input: z.strictObject({ includeSchemas: z.boolean().optional() }),
    ui: false,
    mcp: true,
    run: (input) => ({
      blocks: blocks.list().map(({ manifest, origin, enabled }) => ({
        id: manifest.id,
        version: manifest.version,
        title: manifest.title,
        origin,
        enabled,
        panes: manifest.panes,
      })),
      layouts: manager.list(),
      contextKeys: [...CONTEXT_KEYS],
      ...(input.includeSchemas ? { layoutSchema: z.toJSONSchema(layoutDocumentSchema, { io: 'input', unrepresentable: 'any' }) } : {}),
    }),
  });

  registry.register({
    id: 'layout_get',
    title: 'Get layout',
    description:
      'Return a layout with its revision: instances (pane type, config, bindings), the arrangement of splits and tab groups, how each instance resolves (ok or placeholder), problems of the file on disk, and the last change. Without layoutId it returns the layout the window shows.',
    input: z.strictObject({ layoutId }),
    ui: false,
    mcp: true,
    run: (input) => {
      const view = guarded(() => manager.get(input.layoutId));
      const resolutions = Object.fromEntries(
        Object.entries(view.layout.instances).map(([id, instance]) => {
          const resolved = blocks.resolve(instance);
          return [id, resolved.status === 'ok' ? { status: 'ok' } : { status: 'placeholder', reason: resolved.reason, message: resolved.message }];
        }),
      );
      return { ...view, resolutions, activeLayoutId: manager.activeId(), layouts: manager.list() };
    },
  });

  registry.register({
    id: 'layout_validate',
    title: 'Validate layout',
    description:
      'Check a layout document or a JSON Patch against a layout without applying it. Returns ok, errors and warnings with JSON Pointer paths, the instances that would render as placeholders, and the diff the change would make.',
    input: oneOf,
    ui: false,
    mcp: true,
    run: (input) => {
      const id = input.layoutId ?? manager.activeId();
      const { report, diff, summary } = guarded(() => manager.validate(id, toInput(input)));
      return { ok: report.ok, errors: report.errors, warnings: report.warnings, placeholders: report.placeholders, ...(diff ? { diff, summary } : {}) };
    },
  });

  registry.register({
    id: 'layout_apply',
    title: 'Apply layout',
    description:
      'Change a layout with a whole document or a JSON Patch. expectedRevision must be the revision from layout_get; a stale revision is refused with the current one. Returns the new revision, a diff of instances added, removed, moved and changed, and the layout_undo arguments that restore the previous revision.',
    input: z.strictObject({ layoutId, expectedRevision: z.number().int().min(1), document, patch }),
    ui: false,
    mcp: true,
    run: (input, { caller }) => {
      requireWindowInScope(deps, caller);
      const id = input.layoutId ?? manager.activeId();
      const layoutInput = toInput(input);
      if (caller.kind === 'mcp') {
        const checked = guarded(() => manager.validate(id, layoutInput)).report;
        if (checked.layout) requireScopesInFolder(deps, caller, checked.layout, guarded(() => manager.get(id)).layout);
      }
      return guarded(() => manager.apply(id, input.expectedRevision, layoutInput, caller.kind === 'ui' ? 'ui' : 'mcp'));
    },
  });

  registry.register({
    id: 'layout_undo',
    title: 'Undo layout change',
    description:
      'Restore an earlier revision of a layout as a new revision. Without toRevision it restores the revision before the current one; calling it again undoes the undo.',
    input: z.strictObject({ layoutId, toRevision: z.number().int().min(1).optional() }),
    ui: { accelerator: 'CmdOrCtrl+Z' },
    mcp: true,
    run: (input, { caller }) => {
      requireWindowInScope(deps, caller);
      const id = input.layoutId ?? manager.activeId();
      if (caller.kind === 'mcp') {
        const target = guarded(() => manager.undoTarget(id, input.toRevision));
        if (target) requireScopesInFolder(deps, caller, target, guarded(() => manager.get(id)).layout);
      }
      return guarded(() => manager.undo(id, input.toRevision));
    },
  });

  registry.register({
    id: 'layout_switch',
    title: 'Switch layout',
    description: 'Make the window show another layout (a preset or a layout of the profile), by id. Returns the layout view.',
    input: z.strictObject({ layoutId: z.string().min(1) }),
    ui: { menu: 'app' },
    mcp: true,
    run: (input, { caller }) => {
      requireWindowInScope(deps, caller);
      return guarded(() => manager.switchTo(input.layoutId));
    },
  });

  registry.register({
    id: 'ui_open_to_side',
    title: 'Open to the side',
    description: 'Show a node beside the one in front, in the pane bound to node.secondary (the "Pair" layout has one).',
    input: z.strictObject({ nodeId: z.string().min(1).describe('Id of a tree node, as returned by ui_list_tree') }),
    ui: { menu: 'tree-node' },
    mcp: true,
    run: (input, { caller }) => {
      requireInScope(tree, caller, input.nodeId);
      if (!tree.get(input.nodeId)) throw new CommandError('not_found', `no node ${input.nodeId}`);
      context.set(MAIN_WINDOW, 'node.secondary', input.nodeId);
      return { secondary: input.nodeId };
    },
  });

  registry.register({
    id: 'ui_get_context',
    title: 'Get shared context',
    description: 'The shared context values of the window, for the renderer.',
    input: z.strictObject({}),
    ui: false,
    mcp: false,
    run: () => context.all(MAIN_WINDOW),
  });

  registry.register({
    id: 'ui_capture_window',
    title: 'Capture window',
    description:
      'Return a PNG of the app window. For an agent, every pane except a surface host that shows a node of your folder is hidden (the task tree, the inbox, the profile rail, the agent, usage and swarm panes, and a surface host bound outside your folder); the result names the hidden instances in "masked". A browser view that had no painted page to show is drawn as a "page not captured" placeholder and named in "unavailable".',
    input: z.strictObject({}),
    ui: { menu: 'app' },
    mcp: true,
    run: async (_input, { caller }): Promise<ImageResult> => {
      const inScope = caller.kind === 'ui' ? undefined : (nodeId: string) => tree.isWithin(nodeId, caller.folderId);
      const masked = (): string[] =>
        inScope === undefined ? [] : maskedInstances(manager.get().layout, context.all(MAIN_WINDOW), inScope);
      const shot = await deps.capture({ masked, inScope });
      const view = manager.get();
      return { type: 'image', mimeType: 'image/png', data: shot.data, width: shot.width, height: shot.height, layoutId: view.layoutId, revision: view.revision, masked: [...shot.masked], unavailable: [...(shot.unavailable ?? [])] };
    },
  });
}

export { validateLayoutDocument };
