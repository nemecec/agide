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
