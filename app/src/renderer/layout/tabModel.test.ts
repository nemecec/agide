import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../core/tree/types';
import { PANE_ICONS, SURFACE_ICONS } from '../ui/icons';
import { tabIconFor, tabTitleFor } from './tabModel';

const session = { kind: 'leaf', id: 'l', parentId: null, title: 'Fix upload retry', order: 0, surfaceType: 'claude-session', surfaceId: 's' } as TreeNode;
const tab = { ...session, surfaceType: 'browser-tab' } as TreeNode;

describe('dock tab content', () => {
  it('titles a surface host with the title of its node and every other pane with its pane title', () => {
    expect(tabTitleFor('Surface host 1', 'agide/surface-host', session), 'node title').toBe('Fix upload retry');
    expect(tabTitleFor('Surface host 1', 'agide/surface-host', undefined), 'no node bound reads in words of the user, not the pane type').toBe('No surface');
    expect(tabTitleFor('Inbox', 'agide/inbox', session), 'other pane').toBe('Inbox');
  });

  it('draws the glyph of the shown surface for a surface host and the glyph of the pane type otherwise', () => {
    expect(tabIconFor('agide/surface-host', session), 'session').toBe(SURFACE_ICONS.session.icon);
    expect(tabIconFor('agide/surface-host', tab), 'browser tab').toBe(SURFACE_ICONS['browser-tab'].icon);
    expect(tabIconFor('agide/inbox', undefined), 'inbox').toBe(PANE_ICONS.inbox.icon);
    expect(tabIconFor('agide/unknown', undefined), 'unknown type').toBe(SURFACE_ICONS.note.icon);
  });
});
