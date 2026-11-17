# w-mcp

Start: 2026-11-17T08:48:14Z (UTC)
End: 2026-11-17T08:53:05Z (UTC)

## Built

- `src/core/commands`: input JSON Schema (`jsonSchema.ts`), readable validation messages (`validationMessage.ts`, used by `CommandRegistry.invoke`), `UiEvent`, tree commands (`ui_create_folder`, `ui_create_leaf`, `ui_move_node`, `ui_rename_node`, `ui_remove_node`, `ui_list_tree`, `ui_focus_node`), `surfaces_list`, `registerBuiltinCommands`, and the parity check (`parity.ts`).
- `src/core/mcp`: `HttpAppMcpServer` on the official SDK (low-level `Server` with Streamable HTTP, JSON responses, one server and transport per request), `GrantStore`, `requestGuard` (Origin, Host, path, bearer), `tools.ts` (tools from the registry, errors as `isError` results), and a test harness over `InMemoryTreeService`.
- `src/main/modules/mcp.ts`: registers the built-in commands, starts listening during init.
- `scripts/parity.mjs` (`pnpm parity`), `scripts/e2e-claude-mcp.mjs` (`pnpm e2e:claude-mcp`), `scripts/lib/loadTs.mjs` (Vite SSR loader so scripts can import the TypeScript sources).
- Tests: `HttpAppMcpServer.test.ts`, `treeCommands.test.ts`, `parity.test.ts`. The parity test writes `docs/parity.md`.

## Behaviour worth knowing

- MCP callers: `ui_create_folder` and `ui_create_leaf` default the parent to the caller's folder; every node id and destination is scope-checked; a session cannot remove its own folder; `ui_list_tree` and `surfaces_list` show the caller's folder and below.
- Command input schemas use `z.strictObject`, so an unknown field is an error that names it, and the JSON Schema has `additionalProperties: false`.
- Unknown or out-of-scope node ids give the same `out_of_scope` error.
- Streamable HTTP is stateless: GET and DELETE return 405, no `Mcp-Session-Id` is issued. Revoke closes in-flight requests of the session.
- `ui_create_leaf` has no UI binding and is exposed as a tool; it adds a tree entry without starting a surface.

## Contract changes (for the integration step)

1. `core/events/index.ts`: `AppEvent` now includes `UiEvent` (`ui.focus_node`). The renderer reacts to it.
2. `core/commands/CommandRegistry.ts`: the `invalid_input` message is built by `validationMessage` instead of the raw zod message. `details` still carries the issues.
3. `package.json`: scripts `parity` and `e2e:claude-mcp`.
4. Ownership overlap: 0013 gives the `ui_*` tree commands to the tree builder. They are registered here, from the mcp module init, because the task assigned them to this slice. The tree module must not register the same ids (the registry throws on duplicates). The mcp module registers them when it initializes, after the tree module.
5. `mcp.start()` is called inside the mcp module init, so sessions can call `grant` during their own init. The later call in `modules.ts` returns the same port.

## Results

- `pnpm test`: all unit tests pass.
- `pnpm parity`: ok.
- `pnpm e2e:claude-mcp`: passed. Claude (haiku) connected to server `app`, found the tool through ToolSearch, called `ui_create_folder`, and the folder `from-agent` exists under the session folder.
- `pnpm typecheck`: errors only in `src/core/session/PtySessionService.ts` (another builder's file, `exactOptionalPropertyTypes` on two assignments of `undefined`). None in files of this slice.

## What took long

The decisions were in the contract; most time went to the dynamic tool list (the high-level SDK `McpServer` registers fixed tools, so the low-level `Server` with request handlers is used) and to getting scripts to import TypeScript (solved with the Vite SSR loader, no new dependency).

## Not finished

- No commands beyond tree and `surfaces_list`; other modules register theirs and the parity check runs over the registry it is given. The parity script and test check the built-in registry only; the integration step should point the check at the full registry.
- The module init in `src/main/modules/mcp.ts` is covered by typecheck only (the unit tests run core code in plain Node).
- Behaviour of long-running tool calls and server-initiated notifications is not supported (no SSE stream).
