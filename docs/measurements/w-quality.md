# w-quality

Start: 2026-11-17 17:41:38 UTC
End: 2026-11-17 17:57:16 UTC

## What was built

- Decision logic moved out of the Electron entry points into functions the Vitest suite runs: `src/main/ipcPolicy.ts` (which senders may call commands), `src/main/windowPolicy.ts` (app frame URLs, `window.open` decision, web preferences), `src/main/focusRequest.ts`, `src/shared/rendererApi.ts` (the `window.api` object over a minimal `ipcRenderer` interface). `ipc.ts`, `window.ts`, `index.ts` and the preload now only wire them.
- `isAppFrameUrl` no longer throws for a frame URL that does not parse while a dev server is set; it answers false.
- Negative cases tested: sender outside an app window, subframe of an app page, main frame on a foreign page, command id that is not a string, other origin, other port, other scheme, look-alike host, sibling directory with the same name prefix, `window.open` to web, file, data and script URLs, cancelled navigation, denied permissions.
- `ipc.ts` and `window.ts` are tested against a mocked `electron` module. Mutations (dropping the main-frame check, widening the link scheme, loosening the directory prefix, removing the navigation cancel) each fail a test.
- Renderer: `layout/hostModel.ts` extracted from `LayoutHost.tsx` (tab titles, input bindings, header hiding, the engine sync and save decisions). Tests for treeModel, profileModel, inbox format, hostModel, useTreeNodes, useInbox, useLayoutState, useProfiles, InboxPane with ItemCard, and TerminalPane (xterm mocked). Hook and pane tests run in jsdom with a fake `window.api` (`src/renderer/testing`). Stale-answer ordering, debounce, unsubscribe on unmount, plain-text rendering of agent text and the snapshot/stream ordering of the terminal are covered.
- `pnpm coverage:e2e` (`scripts/coverage-e2e.mjs`, `e2e/coverageHook.ts`): builds with source maps, runs Playwright with `NODE_V8_COVERAGE` for the main process and `page.coverage` for each window, maps both to `src` with `monocart-coverage-reports`, prints a table. Not a CI gate. The hook is installed from `playwright.config.ts` only when `AGIDE_E2E_COVERAGE_DIR` is set, so the specs are unchanged.
- Dependencies added as dev dependencies: `jsdom`, `monocart-coverage-reports` (no install scripts).
- Thresholds in `vitest.config.ts` raised and extended; `coverage-e2e/` added to `app/.gitignore`; `app/README.md` updated. The root README names no test commands and is unchanged.

## Unit coverage (pnpm coverage)

| Area | Statements | Branches | Functions | Lines | Threshold (stmt/branch/func/line) |
|---|---|---|---|---|---|
| src/core | 93.2 | 82.9 | 95.0 | 96.8 | 92 / 81 / 94 / 95 (was 85 / 70 / 85 / 85) |
| src/main | 66.5 | 51.6 | 69.2 | 69.4 | 65 / 50 / 68 / 68 (new) |
| src/main/modules | 78.7 | 62.4 | 78.8 | 81.7 | 77 / 61 / 77 / 80 (was 70 / 55 / 65 / 70) |
| src/shared | 100 | - | 100 | 100 | 98 / - / 98 / 98 (new) |
| renderer logic files | 94.6 | 88.5 | 89.2 | 96.0 | 93 / 87 / 88 / 95 (new) |
| src/renderer, all files | 47.8 | 49.1 | 42.2 | 47.1 | no threshold |
| src/preload | 0 | - | - | 0 | no threshold; the logic is in src/shared |
| All files | 82.3 | 73.3 | 82.1 | 85.0 | |

The renderer logic threshold covers dockviewAdapter, hostModel, useLayoutState, treeModel, profileModel, useTreeNodes, useProfiles, TerminalPane, InboxPane, format, useInbox and ItemCard. TreePane, LayoutHost, SessionPeek, ProfileRail, SetupPane, ContextMenu and the other components have no unit test. src/main stays low because `index.ts` (process start-up) and `desktop.ts` have none; the end-to-end run reaches them.

## End-to-end coverage (pnpm coverage:e2e, V8, mapped to source)

| Process | Area | Functions | Branches | Lines |
|---|---|---|---|---|
| renderer | src/renderer | 81.7 | 65.8 | 82.9 |
| renderer | src/shared | 83.3 | - | 97.1 |
| main | src/core | 70.9 | 43.5 | 74.6 |
| main | src/main | 77.5 | 63.4 | 83.2 |

V8 reports no statement counts. The preload does not appear in the main-process data and shows in the renderer data as covered.

## What took long

- `page.coverage` entries from Playwright carry `url`, `source` and `functions` directly; passing Puppeteer's `includeRawScriptCoverage` produced entries without function data and an empty report.
- Node's coverage files carry no source text, so the report read the built bundle from disk for its source map. A report directory with the same name as the raw data directory deleted the raw data.
- Electron leaves through `app.exit`; `v8.takeCoverage()` is called through `app.evaluate` before close so the counters are written.

## Not finished or not clean

- The PTY session tests in `src/core/session/PtySessionService.test.ts` are timing sensitive. Under the parallel load of `pnpm coverage`, a different test of that file timed out in each of two separate runs (a multi-line prompt paste, a permission-request wait) and passed on the next run and alone. Not changed.
- The end-to-end test of two profiles expects a default profile that adopts the CLI login; it fails when `CLAUDE_CONFIG_DIR` is set in the environment of the run and passes with the variable unset. The workspace Undo test failed once with a detached button in one coverage run and passed in all later runs.
- `pnpm e2e` passed with `CLAUDE_CONFIG_DIR` unset.
- `pnpm coverage:e2e` has no threshold and exits with the status of the Playwright run.

## Milestone 3 pass

Start: 2026-11-17 23:43:57 UTC
End: 2026-11-18 00:11:56 UTC

### What was built

- Decision logic taken out of Electron-bound or e2e-only code into functions with unit tests: `src/main/browser/viewPlacement.ts` (zoom-scaled native bounds, eviction victim, download attribution, aborted load), `src/core/permissions/inspectCommand.ts` (the PreToolUse hook command; `inspectEntry.ts` only reads stdin and prints), `src/core/browser/blocked.ts` (blocked-address file), `isChatService` in `src/core/browser/services.ts` (replaces the Slack and Discord test that was written four times), `src/core/usage/alertAction.ts` (which session an alert action runs on), `transcriptMetaFinished` and `withoutPaths` in `src/core/agents`, and `placementRequest` in `src/renderer/panes/browser/model.ts` (the dedupe of view placements that `BrowserPane` did inline).
- New unit tests: `preview.test.ts` (task start preview, including input that nearly matches a pull request form), the negative cases of the shell parser (unterminated forms, depth and length limits, heredoc variants, here-strings, descriptor numbers), `ElectronViews.test.ts` against a mocked `electron` module, the browser module chrome commands (placement, suspend, navigation, address refusal, site data, agent refusal, blocked file, page events), the agents and usage commands, the permission commands, terminal commands for unknown sessions, and a run of the browser module without Electron.
- Renderer tests in jsdom: `useBrowserTab`, `ObservationControl`, `ApprovalBar`, `NewTaskDialog`, `SetupPane`, `newSession`, and the placement request. `src/renderer/testing/dom.ts` sets field values the way input does.
- `pnpm mutation` (`scripts/mutation-checks.mjs`): each mutation edits one line, runs the guarding tests, restores the file. Areas: folder scope check (`requireInScope`, tab resolution), navigation scheme policy (`checkUrl`, `decideTopLevel`, `decideWindowOpen`, permissions, the guards), inspector deny rules (deny mode, bypass, strictest hit, hard floor, unknown classes, unreadable commands, host allowlist), redaction rules (query keys, fragment, headers, field traits, cookie and field values, titles, digest URL), observation switch (off mode, chat services, blocked addresses, service defaults, non-tab surfaces). A mutation counts as killed only when a test fails and no suite failed to load.
- A fixture race fixed in `src/core/tasks/fixtures/fake-claude-trust.mjs`: two keys written back to back arrived in one read and only the first was handled, so the trust dialog test hung now and then under coverage. The fixture handles each key in order and writes its frame after the input handler exists.
- `vitest.config.ts` thresholds raised and the renderer logic list extended; `app/README.md` names `pnpm mutation` and the extracted modules.

### Mutation results

Every mutation is killed. The first run left five alive; each led to a test:

| Mutation that survived | Test added |
|---|---|
| `requireInScope` treats the top level as inside the folder (the id lookup threw a different error) | `scope.test.ts`: top level is `out_of_scope`, unknown id is `not_found` |
| Class missing from the profile table defaults to allow | inspector: class without a row asks |
| Bash call without a readable command passes | inspector: no command field, non-text command, non-object input ask |
| Shorter secret values replace before longer ones | redaction: longest value first |
| Blocked host matched by substring | blocked patterns: host that ends with the pattern, case of the host |

### Unit coverage (pnpm coverage)

Before this pass the thresholds already failed on `src/core` and `src/main` after milestone 3 (`ElectronViews`, `agents`, `browser` and `index` had no unit tests).

| Area | Before (stmt/branch/func/line) | After | Threshold now |
|---|---|---|---|
| src/core | 91.5 / 81.0 / 93.7 / 94.4 | 92.8 / 82.9 / 94.1 / 95.7 | 92 / 82 / 94 / 95 |
| src/main | 57.3 / 46.4 / 53.2 / 61.1 | 78.0 / 62.5 / 76.3 / 81.9 | 77 / 62 / 76 / 81 |
| src/main/modules | 71.4 / 53.4 / 63.7 / 75.5 | 81.7 / 63.8 / 79.9 / 85.2 | 81 / 63 / 79 / 85 |
| src/shared | 100 / - / 100 / 100 | 100 / - / 100 / 100 | 98 / - / 98 / 98 |
| renderer logic files | 94.6 / 88.5 / 89.2 / 96.0 (earlier list) | 95.6 / 90.1 / 92.2 / 96.7 (extended list) | 95 / 89 / 91 / 96 |
| src/renderer, all files | 47.8 / 49.1 / 42.2 / 47.1 (milestone 2 figure) | 59.5 / 58.9 / 57.0 / 59.9 | no threshold |
| All files | - | 84.2 functions, 88.6 lines | |

The renderer logic list now also holds `SetupPane`, `NewTaskDialog`, `newSession`, `taskForm`, and in `panes/browser` the `model`, `useBrowserTab`, `ObservationControl` and `ApprovalBar`. Components without a unit test (`TreePane`, `BrowserPane`, `LayoutHost`, `SessionPeek`, `ProfileRail`, `NewSessionDialog`, `ContextMenu`) stay covered by the end-to-end tests only. `src/main/index.ts` and `desktop.ts` have no unit test.

### End-to-end coverage (pnpm coverage:e2e)

| Process | Area | Functions | Branches | Lines |
|---|---|---|---|---|
| renderer | src/renderer | 77.6 | 69.8 | 83.8 |
| renderer | src/shared | 83.3 | - | 97.1 |
| main | src/core | 73.8 | 47.3 | 73.0 |
| main | src/main | 70.3 | 59.3 | 81.1 |

### Commands run

`pnpm typecheck`, `pnpm coverage` (thresholds pass; repeated runs stable), `pnpm mutation`, `pnpm e2e` (all pass) and `pnpm coverage:e2e`.

### What took long

Finding which decisions lived only in `ElectronViews` and the agents module, and getting the mocked `electron` module right (a failed `loadURL` must still emit `did-stop-loading`, as Electron does). The trust-dialog flake needed several coverage runs to isolate before the fixture race showed.

### Not done

- `BrowserPane`, `TreePane`, `LayoutHost` and `SessionPeek` have no component test; their decisions that can be pure were extracted (placement dedupe), the rest is drawing and event wiring that the end-to-end tests exercise.
- `src/main/index.ts` start-up has no unit test.
- `ElectronViews.page()` is tested for attach, reuse and detach only; the dialog events and the cookie callback of the page session run in the end-to-end tests.

