import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../../core/tree/types';
import { rowTooltip, surfaceKindOf } from './treeIcon';

const folder: TreeNode = { kind: 'folder', id: 'f', parentId: null, title: 'Project', order: 0 };
const leaf = (surfaceType: string): TreeNode => ({ kind: 'leaf', id: 'l', parentId: 'f', title: 'Leaf', order: 0, surfaceType, surfaceId: 's' }) as TreeNode;

describe('tree row icons', () => {
  it('shows an open folder only while the folder is expanded', () => {
    expect(surfaceKindOf(folder, false), 'collapsed folder').toBe('folder');
    expect(surfaceKindOf(folder, true), 'expanded folder').toBe('folder-open');
  });

  it('gives a session and a browser tab their own glyph and every other surface the note glyph', () => {
    expect(surfaceKindOf(leaf('claude-session'), false), 'session').toBe('session');
    expect(surfaceKindOf(leaf('browser-tab'), false), 'browser tab').toBe('browser-tab');
    expect(surfaceKindOf(leaf('slack-thread'), false), 'other surface').toBe('note');
  });

  it('names the type after the title of a leaf and the title alone for a folder', () => {
    expect(rowTooltip('Fix upload', 'Claude session'), 'leaf').toBe('Fix upload (Claude session)');
    expect(rowTooltip('Project', undefined), 'folder').toBe('Project');
  });
});
