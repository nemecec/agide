# w-layout

Start: 2026-11-17T15:59:46Z
End: 2026-11-17T17:20:00Z

## Work

- Added `dockview-react` 8.9.0 (MIT, no install scripts; `allowBuilds` unchanged).
- `src/core/layout`: JSON Patch, migration runner (no steps yet, tested with a fixture step), structural diff with readable lines, layout validation with explained messages and placeholder warnings, `LayoutHistory` (in memory and SQLite, bounded), `LayoutFiles` (atomic writes, debounced watcher, original kept as `<id>.v<N>.json`), `LayoutManager` (revision check, apply, undo as a new revision, hot reload, invalid-file rule, read-only newer files, hash recognition of own writes), capture mask, and the commands.
- `src/core/context`: shared context store per window with value schemas and `context.changed`.
- Commands: `blocks_list`, `layout_get`, `layout_validate`, `layout_apply`, `layout_undo`, `layout_switch`, `ui_open_to_side`, `ui_capture_window` (tools), `ui_get_context` (renderer only). MCP callers may change a layout only while `node.current` lies in their folder, and cannot set an instance scope wider than the folder.
- Image results: `core/commands/imageResult.ts` and `core/mcp/tools.ts` map an image command result to an MCP image block plus a text block with the details.
- `src/main/modules/layout.ts`: files, history in the app database, context, `ui.focus_node` to `node.current`, capture through `src/main/windowCapture.ts` (Electron loaded on demand; masks panes by a DOM attribute, then `capturePage`).
- Renderer: `App.tsx` is `LayoutHost`; dockview behind `layout/dockviewAdapter.ts`; `agide/tree`, `agide/surface-host`, `agide/placeholder` components; layout switcher, change notice with Undo, invalid-file notice. Dragging panes writes the arrangement back through `layout_apply`. Tree menu gained "Open to the side".
- `docs/blocks.md` generator (`pnpm blocks-docs`) with an out-of-date test; README updated; `pnpm parity` regenerated.

## Contract changes needed (for the integration step)

- `vitest.config.ts`: include `src/renderer/**/*.test.ts` (done here, one line).
- `package.json`: `dockview-react` dependency and the `blocks-docs` script (done here).
- `BlocksEvent` has no event for an invalid file or a layout switch. The module emits `layout.applied` with the current revision in both cases and the renderer refetches `layout_get`, which carries `fileIssues`. A dedicated event would be cleaner.
- `PaneProps` carries no `setConfig`, `invoke`, `subscribe`, `context` or `storage` yet; the first-party panes call `window.api`.

## Not done

- `engineState` cache is not written; the arrangement is always rebuilt. Floating groups and popout windows are disabled.
- Drag over a native view, observation `off` masking and the access log of captures wait for the browser surface and the observation slice.
- Pane config is not validated against the pane's `configSchema`.
- The real-Claude script (agent switches to Pair with `layout_apply`, checks with `ui_capture_window`) was not written; the MCP path is covered by `src/main/modules/layout.test.ts`.
- Bridge-level scope checks for bindings with fixed node ids are not implemented; only `scope` is checked.

## What took long

- The full e2e run is slow when other builders run at the same time (the first run took over ten minutes).
- A first run showed the pane frame covering the tree pane's lower area; the pane blocks now fill their frame.
- The tree pane subscribes to `ui.focus_node` and calls `onOpen`; with `onOpen` invoking `ui_focus_node` this looped through the bus and broke keyboard focus. `TreeBlock` drops the echo of its own request.

## Commands run

- `pnpm typecheck`: my files pass; `e2e/inbox.spec.ts` (w-inbox) fails on `window` typing.
- `pnpm exec vitest run` on `src/core/layout`, `src/core/blocks`, `src/renderer` and `src/main/modules/layout.test.ts`: pass.
- `pnpm e2e`: layout, app and tree specs pass. Failures outside this slice: `--mcp-config` is now a file path in the session launch (integration and inbox specs parse it as JSON), the inbox peek spec, two profile specs.
- `pnpm parity`: ok, `docs/parity.md` lists the layout tools; `pnpm blocks-docs` wrote `docs/blocks.md`.
