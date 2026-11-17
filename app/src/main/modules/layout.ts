import { join } from 'node:path';
import { FIRST_PARTY_MANIFEST, InMemoryBlockRegistry, PRESETS, type LayoutService } from '../../core/blocks/index';
import { ContextStore } from '../../core/context/index';
import {
  LayoutFiles,
  LayoutManager,
  MAIN_WINDOW,
  registerLayoutCommands,
  SqliteLayoutHistory,
  type WindowCapturer,
} from '../../core/layout/index';
import type { TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';
import { captureAppWindow } from '../windowCapture';

/** Layout module: block registry, layout files with hot reload, history, shared context and the layout tools. */
export async function init(
  ctx: ModuleContext,
  deps: { tree: TreeService },
  options: { capture?: WindowCapturer } = {},
): Promise<ModuleHandle<LayoutService>> {
  const blocks = new InMemoryBlockRegistry();
  const unsubscribeBlocks = blocks.subscribe((event) => ctx.events.emit(event));
  const unregister = blocks.register(FIRST_PARTY_MANIFEST, 'first-party');

  const context = new ContextStore((event) => ctx.events.emit(event));
  const files = new LayoutFiles(join(ctx.dataDir, 'layouts'), join(ctx.dataDir, 'window-layout.json'));
  const manager = new LayoutManager({
    files,
    presets: PRESETS,
    registry: blocks,
    history: new SqliteLayoutHistory(ctx.db),
    emit: (event) => ctx.events.emit(event),
  });
  manager.start();
  context.set(MAIN_WINDOW, 'window.layout', manager.activeId());

  // The window's layout id follows switches; the tree and the agent set node.current through ui_focus_node.
  const unsubscribeFocus = ctx.events.on('ui.focus_node', (event) => context.set(MAIN_WINDOW, 'node.current', event.nodeId));
  const unsubscribeApplied = ctx.events.on('layout.applied', () => context.set(MAIN_WINDOW, 'window.layout', manager.activeId()));
  const unsubscribeRemoved = ctx.events.on('tree.subtree_removed', () => {
    for (const key of ['node.current', 'node.secondary'] as const) {
      const id = context.get(MAIN_WINDOW, key);
      if (id !== undefined && !deps.tree.get(id)) context.clear(MAIN_WINDOW, key);
    }
  });

  registerLayoutCommands(ctx.commands, {
    manager,
    blocks,
    context,
    tree: deps.tree,
    capture: options.capture ?? captureAppWindow,
  });

  const service: LayoutService = {
    blocks,
    get: (layoutId) => {
      try {
        return manager.get(layoutId).layout;
      } catch {
        return undefined;
      }
    },
    list: () => manager.list().map(({ id, title }) => ({ id, title })),
  };

  return {
    service,
    dispose: () => {
      manager.stop();
      unsubscribeFocus();
      unsubscribeApplied();
      unsubscribeRemoved();
      unregister();
      unsubscribeBlocks();
    },
  };
}
