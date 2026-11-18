import { SURFACE_BROWSER_TAB, SURFACE_SLACK_THREAD } from '../../../core/surfaces/types';
import type { TreeNode } from '../../../core/tree/types';
import { api } from '../../api';

/**
 * What the tree's "New <surface>" does for a surface type other than a Claude session. A `browser-tab` leaf is
 * created by the browser module together with its view (0026 section 1), never as a bare tree entry.
 */
export async function createSurfaceLeaf(input: { readonly surfaceType: string; readonly title: string; readonly parentId: string | null }): Promise<TreeNode | { readonly error: string }> {
  if (input.surfaceType === SURFACE_BROWSER_TAB || input.surfaceType === SURFACE_SLACK_THREAD) {
    if (input.parentId === null) return { error: 'browser tabs go inside a folder' };
    const created = await api().invoke<{ leafId: string; node: TreeNode | undefined }>('browser_new_tab', { folderId: input.parentId, url: 'about:blank' });
    if (!created.ok) return { error: created.error.message };
    return created.value.node ?? { error: 'the new tab is not in the tree' };
  }
  const result = await api().invoke<TreeNode>('ui_create_leaf', {
    title: input.title,
    surfaceType: input.surfaceType,
    surfaceId: crypto.randomUUID(),
    ...(input.parentId === null ? {} : { parentId: input.parentId }),
  });
  return result.ok ? result.value : { error: result.error.message };
}
