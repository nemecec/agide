import { PANE_TYPES } from './firstParty';
import type { LayoutDocument } from './layout';

/** Shipped layouts (0020 section 4). Read only; editing one saves a copy in the profile. */

const tree = { type: PANE_TYPES.tree, version: '^1', configVersion: 1, config: {} };
const rail = { type: PANE_TYPES.profileRail, version: '^1', configVersion: 1, config: {} };
const inbox = { type: PANE_TYPES.inbox, version: '^1', configVersion: 1, config: {} };
/** The profile rail at the left window edge; its group shows no tab header. */
const railColumn = { size: 0.2, tabs: { panes: ['rail'], active: 'rail' } };
const surfaceHost = (emptyText: string, key: 'node.current' | 'node.secondary') => ({
  type: PANE_TYPES.surfaceHost,
  version: '^1',
  configVersion: 1,
  config: { emptyText },
  bindings: { node: { context: key } },
});

/** The milestone 1 arrangement: tree on the left, the open surface on the right, with the inbox as a tab beside it. */
export const SESSION_PRESET: LayoutDocument = {
  schemaVersion: 1,
  revision: 1,
  id: 'session',
  title: 'Session',
  instances: {
    rail,
    tree,
    main: surfaceHost('Open a session or tab from the tree', 'node.current'),
    inbox,
  },
  arrangement: {
    split: 'row',
    children: [
      railColumn,
      { size: 1, tabs: { panes: ['tree'], active: 'tree' } },
      { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } },
    ],
  },
};

/** A second surface beside the first; "Open to the side" fills it. */
export const PAIR_PRESET: LayoutDocument = {
  schemaVersion: 1,
  revision: 1,
  id: 'pair',
  title: 'Pair',
  instances: {
    rail,
    tree,
    main: surfaceHost('Open a session or tab from the tree', 'node.current'),
    side: surfaceHost('Use Open to the side on a tree item', 'node.secondary'),
    inbox,
  },
  arrangement: {
    split: 'row',
    children: [
      railColumn,
      { size: 1, tabs: { panes: ['tree'], active: 'tree' } },
      { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } },
      { size: 3, tabs: { panes: ['side'], active: 'side' } },
    ],
  },
};

export const PRESETS: readonly LayoutDocument[] = [SESSION_PRESET, PAIR_PRESET];
