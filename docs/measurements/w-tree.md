# w-tree

Start: 2026-11-17 08:48 UTC
End: 2026-11-17 08:55 UTC
Wall time: about 7 minutes

## What was built

- `src/core/tree/SqliteTreeService.ts` with `treeMigrations.ts`: `TreeService` over the app database (table `tree_nodes`, migration 1 through `migrate`). Each operation is one `BEGIN IMMEDIATE` transaction; events are emitted after the commit; sibling orders are rewritten densely; `isWithin` uses a recursive query; subtree removal uses the foreign key cascade.
- `surfaceCatalog.ts` and `surfaceTypeCommands.ts`: command `ui_list_surface_types` over a static list of the three known surface types (no surface registry exists yet).
- `src/main/modules/tree.ts`: SQLite tree, bus forwarding, surface type command.
- `src/renderer/panes/TreePane.tsx` with `ContextMenu.tsx`, `treeModel.ts`, `useTreeNodes.ts`, `TreePane.css`: headless-tree with nested folders, drag and drop (reorder and move into folders, cycle drops refused), inline rename (F2 or menu), keyboard navigation, Delete key, context menu (new folder, new surface of each type, rename, delete). All changes call `commands:invoke`; the tree refreshes on `tree.*` events and selects on `ui.focus_node`.
- Tests: the shared contract gained cases (reorder in a parent, append, leaf to top level, rejected moves, not found, order gap after removal, events); `SqliteTreeService.test.ts` runs the contract plus reopen from a database file, schema version, row removal and rollback on failure. `e2e/tree.spec.ts` has four Playwright tests: nested folders and a leaf, drag between folders, restart on the same data directory with the same tree; inline rename and keyboard; rejected cycle drop with a control drop; reorder by dropping above an item.

## Results

- `pnpm test`: all unit tests pass. `pnpm e2e`: all end-to-end tests pass. Mutation checks on `SqliteTreeService` (cycle check removed; renumbering of the old parent removed) fail the contract tests.
- `pnpm typecheck` stops on two errors in `src/core/session/PtySessionService.ts` (another builder's file, `exactOptionalPropertyTypes`). The renderer config and every file of this slice typecheck.

## Contract changes and overlaps

- The mcp builder had already written `src/core/commands/treeCommands.ts` (`ui_create_folder`, `ui_create_leaf`, `ui_move_node`, `ui_rename_node`, `ui_remove_node`, `ui_list_tree`, `ui_focus_node`), registered from the mcp module. My own versions of these collided at startup (duplicate id), so I deleted mine and the renderer uses theirs: input key `nodeId`, `ui_list_tree` returns `{ nodes }`, `ui_create_leaf` needs a `surfaceId` (the renderer generates a UUID), and `parentId` is omitted for the top level on create. Node commands therefore come from `registerBuiltinCommands`, not from the tree module.
- No contract file was changed.

## What took long

- The command overlap above, found when the app exited at startup.

## Not finished

- Expanded folders are not persisted; a restarted app shows folders collapsed (the e2e test expands them). Persisting needs a field or command outside the current contract.
- The "new surface" menu creates a leaf with a generated surface id and starts no surface; session and browser creation will replace those entries.
- Leaf selection does not open a surface in the right pane.
- Delete asks for confirmation through `window.confirm` only for folders with children; not covered by a test.
