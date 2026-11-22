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

# Milestone 4 contracts (swarm orchestration, 0038)

Start: 2026-11-21T06:58:42Z
End: 2026-11-21T07:25:16Z

## What was built

- `docs/decisions/0038-milestone-4-architecture-and-contracts.md`: the slices of w-runtime, w-manager and w-ui, modules, contracts, ownership, initialization order, test strategy and choices.
- `app/src/core/swarm`: the definition schema with the graph checks, the tier table and its resolution, budget types, swarm settings, the strictest-mode helper, the manager types, the `swarm_*` command inputs and bindings with `registerSwarmCommands`; `runtime/` with the `AgentRuntime` interface, the step language of the fake agents, `InMemoryAgentRuntime` and the runtime contract suite; `manager/` with `InMemorySwarmManager`, `InMemorySwarmFolders` and the manager contract suite; `fixtures/fake-claude-stream.mjs` with a test that drives it over pipes.
- Session seam: `core/session/streamSpawner.ts` (`StreamSpawner`, `StreamSpawners`), the stream-json branch in `PtySessionService` (`streamSpawner` option, `SessionCreateInput.id`, `sendText` to the stream process, `write` and `resize` refused), with a test.
- Shared files, each with the smallest change: `AgentEnvironment.processCommand` (optional) and `ProcessLaunch`; `CommandErrorCode` gains `limit_reached` and `refused`; `AppEvent` gains `SwarmEvent`; `ProfileSettings.swarm`; the `agide/swarm` pane type; `mcp__app__swarm_start` in the `app.agent_start` class with one more line in the inspector contract; `Services.swarm`; `modules.ts` creates `StreamSpawners` and initializes the swarm module last; the session module takes `streams` and adopts a leaf made in a session's folder for a session without one; the service-order line of `m3Modules.test.ts`.
- `main/modules/swarm.ts` (stub with a pending manager and the commands without handlers) and `swarm.test.ts`.
- Renderer stubs and hook points: `StartSwarmDialog`, `SwarmPane`, `SwarmFolderDecorations`, `SwarmAgentDecorations`, `swarmMenuEntries`, `SwarmApprovalActions`; the `new-swarm` dialog request, "New swarm…" in the tree menus, the network glyph for the pane and the menu entry.
- Regenerated `docs/parity.md` and `docs/blocks.md`.

## Commands run

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` | pass; the stream-json runtime and persistent manager suites are skipped as pending |
| `pnpm e2e` | pass |
| `pnpm check:colours` | pass |
| `pnpm parity` | pass |
| `pnpm blocks-docs` | wrote `docs/blocks.md` |
| Mutation: drop the folder check of the leaf adoption | the swarm module test fails, as it should |

## What took long

- The seam between the runtime and the session service. 0037 placed a stream session service in `core/session`, a folder no builder may edit. The choice of a spawner slot plus a launch contributor for the per-agent flags keeps the launch preparation in one place; finding that the agent's deny rules fit through the contributor (`mergeContributions` appends deny rules) took a second pass over the record.
- The in-memory manager surfaced ordering issues: concurrent scheduling launched an agent twice, and a synchronous turn finished before the agent's state was set. Both are fixed and covered by the contract suite; `isBusy` is now defined at the `result` event.
- A session without a tree leaf is closed at start by the session module, so agent sessions need leaves; the adoption rule came from that.

## What was not done

- No independent agent reviewed this step: the step has no tool for starting agents. The user asked for a review by another agent; it should run before the builders start.
- No real Claude call was made.
- `processCommand` stays optional in the interface until w-runtime adds it to every provider.

## Temporary files

The e2e log under `/tmp` and the session-module backup used for the mutation were removed. The tests remove their temporary directories.

# Milestone 5 contracts (review ladder, 0041)

Start: 2026-11-21T15:24:45Z (date -u). End: see the last line.

## What was built

- `docs/decisions/0041-milestone-5-architecture-and-contracts.md`: the first slice of 0040 split over w-capture, w-reviewer, w-manager and w-ui; the modules; the contracts; ownership and contract files; the module initialization order with `review` after `swarm`; the test strategy; the choices.
- `app/src/core/review`: zod schemas and types of changesets, files, hunks, reasons, checks, runs, reports and findings, decisions, comments, seen marks and policy snapshots (`schemas.ts`); the service interfaces `CaptureService`, `PolicyLoader`, `CheckExecutor`, `RiskRules`, `ReviewerRuntime`, `ReviewBudget`, `SendBackChannel`, `Merger`, `ChangesetStore`, `ReviewManager` and `ReviewSwarmFacts` (`types.ts`); the policy schema and the user overlay schema (`policy/schema.ts`); the reason catalogue; `computeRung` with demotions, the reviewer tier rule and the summary hash (`rungs.ts`); the transition table and `checkTransition` (`stateMachine.ts`); anchoring (`anchors.ts`); the `review_*`, `report_review` and `report_outcome` commands with tool sets and the parity exemptions (`commands.ts`); the review profile settings; the migration of the `review` tables; `InMemoryChangesetStore` with its contract suite; `InMemoryReviewManager` with its contract suite; `InMemoryReviewerRuntime` over the swarm `AgentRuntime` with its contract suite; fakes and fixtures.
- Shared files, smallest changes: `swarm/runtime/types.ts` (reviewer launch fields, the `background_tasks` event), `swarm/commands.ts` (`swarm_merge`), `commands/types.ts` (`toolSets`, `inToolSet`), `mcp/tools.ts` (the tool-set filter, default `default`), `events/index.ts`, `profile/types.ts` and `schemas.ts` (`review` settings), `blocks/firstParty.ts` (`agide/review`), `main/context.ts`, `main/modules.ts`, `renderer/panes/paneComponents.tsx`, `renderer/panes/inbox/ItemCard.tsx` (calls `ReviewCardActions`), `renderer/ui/icons.ts` (`PANE_ICONS.review`). Tests updated for the new tool and service: `core/swarm/commands.test.ts`, `main/modules/swarm.test.ts`, `main/modules/m3Modules.test.ts`, `e2e/swarmManager.spec.ts`.
- `app/src/main/modules/review.ts` (stub: migrates and registers pending commands) with `review.test.ts`; renderer stubs `panes/review/ReviewPane.tsx`, `ChangesetList.tsx`, `ChangesetView.tsx`, `FileView.tsx`, `HunkView.tsx`, `review.css`, `panes/inbox/ReviewCardActions.tsx`, with `ReviewPane.test.ts`.
- Regenerated `docs/parity.md` (`pnpm parity`) and `docs/blocks.md` (`pnpm blocks-docs`).

## Commands run and account

- Commands run: `pnpm typecheck` (green), `pnpm test` (green after the module order test was updated), `AGIDE_HIDDEN=1 pnpm e2e` (one failure in the first run, the swarm tool list of `e2e/swarmManager.spec.ts`, which now includes `swarm_merge`; see the last line for the second run), `pnpm check:colours` (green), `pnpm parity` (green).
- Mutation checks, each restored after the run: the reviewer accept above B, a merged changeset not final, the floor ignoring hard reasons, a demotion ignored, accept without the hash check, accept without the rung check, `report_review` for another changeset, the seen rule at D dropped, an agent's request below the current rung, a merged changeset superseded, the store's compare-and-swap dropped, an accept at B without a report or the tick, the tool list ignoring tool sets. Each fails a test. The hash mutation survived at first, because the seen rule refused before the hash check; the contract test now marks the hunk seen first.
- Longest step: the in-memory review manager and its contract suite, since it has to carry every rule of 0040 sections 9 to 16 that the persistent manager must pass.
- No real-Claude calls.
- Disk: about 3.7 GiB free at the start, about 3.5 GiB during the runs.
- Not done here, by design: the capture, the check executor, the rules, the policy reader, the stream reviewer runner, grant tool sets on `GrantStore`, the SQLite store, the persistent manager, inbox items, `app.merge`, the UI. The contract suites for the SQLite store, the persistent manager and the stream reviewer runner are skipped with `[pending ...]`.
- Second e2e run with hidden windows: all passed. Final `pnpm typecheck`, `pnpm test` and `pnpm check:colours`: green.
- Temporary files: `/tmp/agide-contracts/` (logs, the mutation script and its backups, about 100 KB).

End: 2026-11-21T15:55:57Z (date -u).
