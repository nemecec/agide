# Milestone 2 contracts

Start: 2026-11-17T15:38:39Z
End: 2026-11-17T15:58:42Z

## Work

- Read 0013, 0014, 0020, 0021, 0022, `notes/probes-m2.md` and the milestone 1 code in `app/src`.
- Updated 0021 with the P13, P14 and P15 results: new fact rows (waiting permission hook, background subagents and `<task-notification>` prompts, the `Elicitation` hook in form mode, OSC 9 output), the verification column of the hook table (`elicitation_dialog` and `elicitation_response` probed, the card answer probed with a transport to build, `UserPromptSubmit` split for task notifications, the interrupt row after Esc on a dialog), the first slice, the waits table and the consequences.
- Wrote 0023 with the slices, modules, contracts, init order, ownership, test strategy and choices.
- Wrote the contracts and stubs: `src/core/profile`, `src/core/isolation`, `src/core/blocks`, `src/core/inbox` with shared contract suites and reference implementations; `LocalProvider` and `FakeProvider`; the main module stubs `profile.ts`, `layout.ts`, `inbox.ts`; `src/main/desktop.ts` with the `Desktop` seam; the renderer stubs `InboxPane.tsx`, `ProfileRail.tsx`, `paneTypes.ts`, `paneComponents.tsx`.
- Checked in `node:sqlite` (Node 22, SQLite 3.51) that a `BEFORE DELETE` trigger on `tree_nodes` marks inbox items of a deleted folder and its deleted child before the foreign key action sets `folder_id` to NULL.

## Commands run

- `pnpm typecheck`: pass.
- `pnpm test`: pass (the run before the changes passed as well).
- `pnpm e2e`: pass, run during the step and again after the last change.
- `docs/parity.md` is unchanged; the parity test in `appModules.test.ts` passes.

## What took long

- zod optional keys against `exactOptionalPropertyTypes`: the schemas no longer claim to satisfy the interfaces, and parsed values are cast once at the store boundary.
- The order of bus handlers: a typed handler runs before `onAny`, so a nested emit shows first to an `onAny` listener. The stub test compares the event set.

## Not done

- No real-Claude run; nothing in this step needs one.
- `Desktop` was run only in its quiet mode under the hidden e2e runs; real notifications and the dock badge were not shown.
- The relayed user request asks for a commit of the README changes. This step forbids commits, so none was made; `git status` at the start showed no uncommitted README change.

# Milestone 3 contracts

Start: 2026-11-17T21:41:23Z
End: 2026-11-17T22:09:49Z

## Work

- Read 0023, 0024, 0025, 0026, 0027, 0028, `notes/probes-m3-permissions.md`, `notes/probes-m3-isolation.md`, the milestone 3 part of `probes/RESULTS.md`, the parts of 0010, 0011, 0019 and 0022 the probes touch, and the application code.
- Wrote 0029 with the slices, the srt and container provider designs, the probe results that change 0010, 0011, 0019 and 0022, the modules, contracts, initialization order, ownership, test strategy and choices.
- Built the seams that keep the builders apart: launch contributions in the session service (settings fragments, replaced base hooks, arguments, environment, MCP servers and session files, merged with a single owner per key), provider selection and network policy per launch, `SessionInfo.permissionMode`, `stop` and `setPermissionMode`, the per-grant `Host` allowance on the MCP server, tools per MCP server with `Command.mcpServer`, the isolation provider registry with its w-iso entry points, the dialog host and settings panel, the tree hook points for agent rows, leaf marks, session creation and leaf creation.
- Wrote the contracts and stubs: `core/permissions` (types, schema, defaults, mode helpers, stub builder and inspector, contract suites marked pending), `core/browser` (types, service table, recognizer for Jira and GitHub, tool schemas, in-memory observation service with its contract), `core/agents` (types, in-memory agent store with its contract), `core/tasks` (types, strict source parser, input schema), srt and container provider stubs with the contract suite marked pending, main module stubs for permissions, browser, agents and tasks, and the renderer stubs.
- Regenerated `docs/blocks.md` for the new pane types; `docs/parity.md` is unchanged.

## Commands run

- `pnpm typecheck`: pass.
- `pnpm test`: pass, with the pending suites skipped. The run before the changes failed once in `appModules.test.ts` under load and passed on the next runs (the flake listed in 0024).
- `pnpm e2e`: pass, run after the first wiring and again after the last change.
- `pnpm blocks-docs`, `pnpm parity`: ok.

## What took long

- Finding a seam for the session launch that every module can add to without editing it: the order of prepare, hook delivery, MCP grant and session files decided where contributors run.
- Keeping the tree menu behaviour while moving session and leaf creation behind files other builders own.

## Not done

- No real-Claude run and no probe; nothing in this step needs one.
- The srt and container providers, the inspector, the class table, the SQLite stores, the browser views and every UI beyond placeholders are the builders' work.
- The dialog host and the settings panel were not seen on screen; the hidden e2e runs do not open them.
