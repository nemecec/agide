# 0024 Milestone 2 results

Status: accepted
Date: 2026-11-17
Decided by: spike agents
Inputs: 0004, 0006, 0009, 0010, 0012, 0013, 0014, 0015 to 0023; `probes/RESULTS.md`, `notes/probes-m2.md`; `docs/measurements/*.md`; `docs/parity.md`, `docs/blocks.md`; the design, review, builder, integration, quality, verification and fix reports of the milestone 2 run (summarized here, not stored as files)

## Context

0014 closed milestone 1 and recommended the browser surface first. The user then added R20 to R24 (0015 to 0019) and asked for milestone 2 to start with them. Milestone 2 ran in these steps:

1. Surveys and probes in parallel: the block and layout prior art (`notes/blocks-prior-art.md`), profiles and isolation (`notes/profiles-and-isolation.md`), and the probes P11 to P15 (`notes/probes-m2.md`).
2. Designs, each with an independent review that edited it: 0020 (blocks and layout), 0021 (inbox and tasks), 0022 (profiles and isolation). The probe report had its own review and re-run.
3. Contracts and stubs (0023).
4. Builders in parallel on disjoint files: w-profiles, w-provider, w-layout, w-inbox.
5. Integration, then a test-quality step (extraction of Electron decisions, renderer tests, end-to-end coverage).
6. Independent code reviews of the modules and of the main process, renderer and session code, and a verification from a clean copy.
7. A fix step that applied the review findings and added "Amendments after review" to 0023.
8. This record, then a cross-review of 0020 to 0024 and the READMEs against the code, the test runs and the probe logs. Its corrections are in the text below; `docs/measurements/cross-review.md` lists them.

The code is in `app/` of this repository. HEAD is the user's commit from before the run; every milestone 2 change is uncommitted, because each step of the run was told not to commit.

This record states what milestone 2 built and what it shows against R20 to R23 and the milestone 1 findings, which statements in 0004, 0019 and 0021 the probes and the build change, what the reviews found and what was fixed, the test and coverage figures, the measured effort, the re-estimate, what stays open, and what milestone 3 should do.

## Decision

### What milestone 2 built

| Part | Built | Shown by |
|---|---|---|
| Profiles (w-profiles) | File `ProfileStore` and `ProfileRegistry` (atomic 0600 writes in 0700 directories, validation, staleness by pid and age), the milestone 1 migration into `profiles/default` (lock takeover by rename, staging per pid, `Partitions` moved), profile resolution before `ready`, `userData` and `sessionData` per profile, the single-instance lock with the profile id as `additionalData`, the launcher, window title and colour strip, dock badge, switcher rail with unread badges, creation form, setup pane with `claude auth status`, `profileEnv` with the `isolated` tool mode (allow list of variables, tool location variables inside the profile, generated gitconfig and ssh_config), `profile_*` commands (not MCP tools) | `src/core/profile/*.test.ts`, `src/main/profileMain.test.ts`; `e2e/profiles.spec.ts`: profiles side by side with separate data, trees, Claude directories and titles; a second start of one profile exits and the first gets the focus request; a rail click focuses the running profile; an `inbox_post` in one profile shows as a badge in the other profile's rail and on the dock, and the registry entry holds no item text |
| Isolation (w-provider) | Session launch through `IsolationProvider`: `LocalProvider` (default) and `FakeProvider` with a shared contract suite, `prepare` per profile, `ptyCommand`, `attach`, `terminate`, `releaseSession`; the MCP config as `mcp.json` (0600 in a 0700 session directory, passed by path, removed on the first `SessionStart`), stale session directories removed at start, deny rules for the app root in `--settings`, a working directory inside the app root refused, `onLaunchFailed` revoking the grant on create and resume, `AGIDE_PERMISSION_MODE` | `src/core/isolation`, `src/core/session` tests; `e2e/integration.spec.ts`: the config file has mode 0600 and no spawned argument contains the token; `scripts/e2e-real-claude-inbox.mjs`: the real CLI reads `--mcp-config` from the file path |
| Blocks and layout (w-layout) | dockview-react 8.9.0 behind `dockviewAdapter.ts` with Agide's arrangement tree as the source of truth; layout files in `layouts/<id>.json` with hot reload, atomic writes and the invalid-file rule; migrations, structural diff, JSON Patch, revision history in SQLite with undo as a new revision; the shared context store; `App.tsx` as a layout host; `agide/tree`, `agide/surface-host`, `agide/placeholder`, `agide/inbox` and `agide/profile-rail` panes; the Session and Pair presets; tools `blocks_list`, `layout_get`, `layout_validate`, `layout_apply`, `layout_undo`, `layout_switch`, `ui_open_to_side`, `ui_capture_window` (image result in the MCP mapping, mask over the tree, inbox and rail for folder-scoped callers); `docs/blocks.md` generated with an out-of-date test | `src/core/layout`, `src/core/blocks`, `src/renderer/layout` tests; `e2e/layout.spec.ts` and `e2e/workspace.spec.ts`: a layout file edit and an MCP `layout_apply` change the window, Undo restores it, an invalid file keeps the running layout and is not rewritten, apply and undo survive a restart, a PNG capture from a hidden window |
| Inbox and tasks (w-inbox) | SQLite inbox and task stores with migrations on the existing database (tree migration 2 for the project description, a `folder_removed` column with a `BEFORE DELETE` trigger), hook mapping (`Stop`, `StopFailure`, `PermissionRequest`, `Notification` types, `PostToolUse` and `UserPromptSubmit` resolution), `inbox_post`, `inbox_list`, `inbox_resolve`, `task_*` and `reminder_*` tools, macOS notifications with a throttle, an RRULE subset in wall time with the gap and repeat rules, a persisted scheduler with catch-up and snooze, the inbox pane with list, detail card, context layers and a read-only session peek, plain-text rendering of agent text | `src/core/inbox` tests (store contract on SQLite, hook sequences, RRULE in Europe/Tallinn gap and repeat, scheduler with a fake clock, crash rollback, time budget for an old dense rule); `e2e/inbox.spec.ts`; `scripts/e2e-real-claude-inbox.mjs` |
| Integration | Module order profile, tree, mcp, session, layout, inbox; the dock badge set only by the profile module from `inbox.unread_changed`; both presets with the rail at the left edge and the inbox as a tab beside the surface; the strip above the layout and the setup pane over it; `e2e/sessionMcp.ts` and `scripts/lib/realClaude.mjs` as shared helpers; the trust answer that reads the latest frame | the full suites below |
| Test quality | Sender trust, window, navigation and `window.open` policy, web preferences, focus request and the `window.api` object moved into pure modules (`ipcPolicy.ts`, `windowPolicy.ts`, `focusRequest.ts`, `shared/rendererApi.ts`, `layout/hostModel.ts`) with negative cases; renderer hook and pane tests in jsdom; `pnpm coverage:e2e`; thresholds raised | mutation checks in the quality step: dropping the main-frame check, widening the link scheme, loosening the directory prefix and removing the navigation cancel each fail a test |
| Probes P11 to P15 | Notification hook, status line through `--settings`, transcript usage, a waiting `PermissionRequest` hook, `Elicitation` | `notes/probes-m2.md`, `probes/RESULTS.md`, `probes/out/p11_*` to `p15_*`; reviewer re-run in `probes/out/m2-review/` |

At the end of the fix step `pnpm typecheck`, `pnpm coverage`, `pnpm build`, `pnpm e2e` and `pnpm parity` pass, and `e2e-claude-mcp.mjs` and `e2e-real-claude.mjs` pass against the real CLI on Haiku. `pnpm typecheck` and `pnpm test` were run again when this record was written and pass. A cross-review after this record ran every command of the table under "Tests and coverage" again; its one finding in the code, a real-Claude script that the fix step had broken, is fixed and described there.

### What each slice shows against the requirements

| Requirement | What is shown | What is not shown |
|---|---|---|
| R20 composable UI (0015, design 0020) | The window is a layout document that a person or an agent edits. A hand edit of the file changes the window while the app runs; an invalid file keeps the running layout, shows its issues and is never rewritten. An agent applies a patch with `layout_apply` (expected revision, readable diff, Undo in a notice) only while the focused node lies in its folder, and `layout_undo` checks the target revision's scopes. dockview runs in the Electron renderer with React 19.3.1, and a resize is not written back as a change (3 percent tolerance). Missing block types render as placeholders. | Third-party and agent-written blocks (code tier, sandbox, plugin install), compositions and templates, policies as blocks, popouts and floating groups, the `engineState` cache, pane config validation against `configSchema`, a docking drag over a native view (no browser surface exists), a drag tested in Playwright, a real-Claude layout script, masking of surfaces with observation off and the capture access log. |
| R21 tasks, reminders, inbox (0016, design 0021) | Items from hooks and from agents reach one inbox per profile with dedupe, unread count, notification throttle and dock badge. An approval item appears on `PermissionRequest`, notifies only after the `permission_prompt` signal, and clears on the matching `PostToolUse`. A real Haiku session posted an item with `inbox_post` after the CLI's own approval dialog, and the item showed in the inbox tab. Reminders follow wall time across daylight-saving changes, catch up once after a restart, and refuse rules above 48 occurrences a day. Agent text renders as plain text. | `inbox_ask` (waits for P16), approving from the card (waits for the `http` hook transport), elicitation forms, the tasks pane, session summaries, saved views and back stack, wake from sleep through `powerMonitor`, the interrupt line, `SessionEnd`, `SubagentStop` and `Elicitation` mapping, a notification click that opens the item, real macOS notifications on screen. |
| R22 profiles (0017, design 0022) | Profiles run side by side as separate processes with separate data, browser partitions, Claude configuration directories and titles. A second start of a profile focuses the running one. A registry entry holds the profile id, the pid, a random id per process start, the time of the last refresh and the unread count, and nothing else crosses profiles at run time; name and colour come from the definitions. The milestone 1 data moves into the default profile once, with the login unchanged. Isolated profiles get their own gh, git, ssh, AWS, npm and Docker locations and an allow list of inherited variables. | A real login in a new profile (the setup pane flow ran only against a fake `claude`), a real-Claude run in profile mode, focus and the dock badge on screen, dock tiles of several processes, plan usage in the rail, profile deletion, "Quit all profiles". Plain `ssh` and `scp` in an isolated profile still use the user's default keys. |
| R23 pluggable isolation (0018, design 0022) | Every session launches through the provider interface; `FakeProvider` and `LocalProvider` pass one contract suite. The MCP token is no longer a process argument. The provider states its capabilities, and the setup pane says that local agents run as the user. | Any provider other than local: srt, container, OpenShell, ssh. The `http` hook transport and its probe C3. `--settings` as a file: the settings stay inline JSON in the arguments (hook commands and deny rules, no token), and the `settings.json` session file of 0023 is not written. The Bash sandbox allowlist (`bash-allowlist`). The local provider cannot stop an agent that runs as the user from reading the app root or other profiles through the shell. |

### Milestone 1 findings closed

| 0014 open item | Status after milestone 2 |
|---|---|
| Bearer token in the `claude` arguments | Closed. `mcp.json` 0600 in a 0700 directory, passed by path, removed on the first `SessionStart`, stale directories removed at start. An e2e test checks the mode and that no argument holds the token; the real CLI read the file. Same-user processes can still read the file until the first `SessionStart`. |
| Default permission mode | Made explicit: `default` (the CLI's manual mode) unless `AGIDE_PERMISSION_MODE` or the session names another; `bypassPermissions` only per session with confirmation. The choice of 0012 (auto with ask rules) stays with the user. |
| The TUI draws its dialog while a `PermissionRequest` hook runs; a waiting hook and a keypress during the wait are untested | Closed by P14. `notes/probes-stage2.md` and `probes/RESULTS.md` are corrected. |
| Electron-side handlers and the single-instance lock have no tests | Closed. The decisions are pure functions with negative cases; `ipc.ts` and `window.ts` are tested against a mocked `electron`; the lock per profile is covered by `e2e/profiles.spec.ts`. `src/main/index.ts` and `desktop.ts` are reached only by e2e. |
| No test for the revoke after a failed `session_create` launch; a failed resume keeps its grant | Closed through `onLaunchFailed` with tests for both. |
| Folder-trust prompt in unseen directories | Partly. The real-Claude scripts answer it by the latest frame. The app itself still leaves the dialog to the user in the terminal, and the selection moved back once in a run for a reason not found. |
| `-p` stream-json path, interrupt state, `OutputBuffer` replay inside an escape sequence, expanded folders, `pnpm dev` with a visible window, token spend per step | Still open (below). |

### Probe and build results that change earlier records

0004 is still `proposed`; 0019 is a requirement record; 0021 is the reviewed design that the build followed. The statements below need amendment when each record is next revised.

0004:

| 0004 statement | Finding | Amendment |
|---|---|---|
| Decision 2: "`--mcp-config` with the app server entry (`"type":"http"`, per-session URL with a bearer token ...)" | The build passes a 0600 file path; the real CLI read it (integration inbox run) and still connected after the app removed the file on `SessionStart` (fix step runs). | `--mcp-config <path>` to a 0600 file in a 0700 session directory, removed after the first `SessionStart` and written again on resume. |
| Decision 1: status from the hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`, `PermissionRequest` and the transcript | P11: `Notification` fires with `notification_type` `permission_prompt` and `elicitation_dialog` about 6 s after the dialog opens and only while it is open, and `idle_prompt` about 59 s after `Stop`; no tool fields. The TUI writes the same messages as OSC 9 sequences. A `claude -p` run accepted `StopFailure` in `--settings`. P15: `Elicitation` fires with `mcp_server_name`, `message`, `mode`, `requested_schema`. | Add `Notification` (a delayed second signal and the only hook for the idle prompt), `StopFailure` (accepted, not seen firing) and `Elicitation` (form mode). |
| Context table, row "Turn completion and status", PTY column: "no cost field" (0014 added: cost per process at exit) | P12: a status line command from `--settings` receives `cost.total_cost_usd` (includes subagent requests by inference from one run), the latest request's context, `prompt_cache` and, after the first request, `rate_limits.five_hour` and `seven_day`. It overrides a project status line. P13: count each `message.id` once; subagents write `<session>/subagents/` files; internal agents leave no file, so `cost-state` at exit holds the process total. | PTY cost is live through the status line, and complete per process at exit from `cost-state`. |
| Context table, row "Approval"; decision 3 (0014 added that a keypress can reach the dialog while a slow hook runs) | P14: the dialog shows while a hook waits; a keypress answers and wins (Enter runs the call and a later deny is ignored; Esc rejects, ends the hook and fires no `Stop`); a hook `timeout` hands the decision back to the dialog. | An app can hold an approval in its own UI with a waiting hook while the TUI shows the dialog; the first answer wins. The hook `timeout` must exceed the longest wait the app allows. |
| Not verified: "MCP over SSE and server-initiated requests" | P15 used a stdio server: an elicitation request reaches the `Elicitation` hook, and a hook answer reaches the server with no dialog. The app's HTTP server still sends no server-initiated requests. | Server-initiated elicitation works over stdio; HTTP stays unverified. |
| The folder-trust prompt (added by 0014) | The dialog highlights "No, exit"; Enter on it exits with "didn't start because this folder isn't trusted" and no hook fires. The selection moved back once after a Down key in a passing run. Each answer adds a trust entry to the user's Claude config. | The launch must read the current selection before answering, or the app must ask the user before launching in an unseen directory. |
| Decision 2: the app's `--settings` | The build adds `permissions.deny` rules for Read and Edit of the app root. Their effect in a real session was not checked, and they do not cover shell commands. | Add the deny rules as a mitigation against the file tools only. |

0019:

| 0019 statement | Finding | Amendment |
|---|---|---|
| "transcript usage records (all launch paths, including subagents)" | P13: internal agents leave no transcript; one API message spans several lines with the same `message.id` and usage. | Transcripts give per-message usage counted by `message.id`, including `subagents/`; the session total comes from `cost-state` at process exit or from the status line cost. |
| "a status line command that the app supplies through `--settings` and that writes the received JSON to the session's events directory" | P12: works; atomic writes held under concurrency; Claude Code may cancel a running status line command, so readers ignore and remove `.tmp` files. The payload holds absolute user paths. Whether a user-level `statusLine` is replaced was not tested. | Keep, with the `.tmp` rule and the per-session file kept out of anything shared. |
| "token counts in `context_window`" | P12: `total_input_tokens` and `total_output_tokens` describe the latest request, not the session. | Use `context_window` for the current context size only; session token totals come from transcripts. |
| The rate-limit fields "appear after the first API response" | Confirmed. `refreshInterval` repeats the last values; they change only after the next request. | Plan-window forecasts update per request, not per refresh. |
| "Probes to run" list | Done: the status line through `--settings` in the PTY, its cadence, `rate_limits` in the interactive session, usage in subagent transcripts. Open: a user-level status line, a per-request check that the cost includes subagents, roll-up of workflow usage. | Shorten the list to the open items. |
| "The concurrent-agent cap of 0012 defaults to 4" | 0014 recommendation 4 says a cap of 2; 0012 says 4. | 0014 is wrong on this point; the default is 4. |

0021:

| 0021 statement | Build or review finding | Amendment |
|---|---|---|
| Section 2: "Tree migration 2 and session migration 2"; Consequences: "the session summary columns live in the session module" | Session summaries are in an inbox-owned table `session_summaries`; the session module has no migration 2. `inbox_asks`, `inbox_views` and `inbox_policies` are not created yet. | Summaries live in the inbox module; the other tables come with their features. |
| Section 2 and the 0021 review's open point on deleted folders | A `folder_removed` column set by a `BEFORE DELETE` trigger on `tree_nodes` before the foreign key action (0023). Checked in `node:sqlite` by the unit tests. The e2e runs of the build created the tables and posted items inside Electron, and none removed a folder; the cross-review added an e2e test in `e2e/inbox.spec.ts` that removes the folder of a hook item inside Electron 45: the item stays, with `folderRemoved` set and no folder. | Settled as in 0023. |
| Section 7, recurrence: the `rrule` npm package if it passes the daylight-saving tests | No package; an own RRULE subset in `core/inbox/rrule.ts` with the gap and repeat rules, refusing more than 48 occurrences a day; enumeration starts at the period before `from` for rules without `COUNT`. | Record the own implementation and the daily limit. |
| Section 7, task due time: a one-off reminder schedule in wall time | The wall-time round trip fired a reminder in the repeated autumn hour an hour early. Task reminders now store the due instant in zone `UTC`. Enabling a schedule sets its next due time to the first occurrence after now. `updateTask` keeps the reminder when the due time is unchanged. | Record these rules. |
| Section 7, scheduler: recomputes on wake from sleep (`powerMonitor` resume); a firing in one transaction | Wake handling is not built; the 60 s timer cap and the earliest snooze end bound the delay. Events of a firing are held until the commit (`holdEvents`). | Wake stays to build; events after commit. |
| Section 10: the dock badge | The profile module alone sets the badge from `inbox.unread_changed`; the registry carries the count. | Badge owned by the profile module. |
| Section 12, first slice: tasks pane, the interrupt line | Not built. Profile registry publishing, listed under "Waits", was built. | Move the tasks pane and the interrupt line to the next slice; remove registry publishing from "Waits". |
| Not verified: `StopFailure`; the `rrule` package's daylight-saving handling | `StopFailure` is accepted in `--settings` by 2.1.326 (not seen firing). The own RRULE code is tested in the Europe/Tallinn gap and repeat. | Narrow both items. |
| Section 4, agent rules | An agent resolves only items it posted, with `superseded` or `dismissed`; at most 20 reminders per folder; item URLs are http or https only. | Add these rules. |

### Review findings and what was fixed

The code reviews accepted the integrated code with fixes. The fix step addressed the findings below. Contract changes are in 0023 under "Amendments after review".

| Finding | Severity | Status |
|---|---|---|
| The login terminal ran in the profile data directory, and tree sessions defaulted to the home directory; both enclose `data/sessions/*/mcp.json` of every profile, so an agent could read another session's token and act in its scope, also across profiles | major | Fixed. The login terminal runs in an empty `data/login`; `mcp.json` is removed on the first `SessionStart`; the default working directory is `Agide/<folderId>` below the home directory; a working directory inside the app root is refused; deny rules for the app root go into `--settings` (effect unverified). The local provider still cannot stop shell reads; the setup pane says so. |
| A UI apply (also after a resize) overwrote a layout file that was invalid on disk, losing the user's hand edit | major | Fixed. While the file is invalid, a change stays in memory with a warning at `/file`; the next valid file replaces it. Test added. |
| Each scheduler tick enumerated every occurrence since `dtstart`; an agent could create a dense rule that blocks the main thread (about 1 s per tick after a month) | major | Fixed. Enumeration near `from`, at most 48 occurrences a day. A time-budget test fails without the fix. Rules with `COUNT` still enumerate from the start, bounded by the daily limit. |
| Re-enabling a schedule fired every occurrence of the pause as "missed" items; the test never re-enabled | major | Fixed with a test that fails without the fix. |
| `updateTask` dropped a reminder edited after its due time and before the tick; not in one transaction | minor | Fixed. |
| A task due in the repeated autumn hour got its reminder an hour early | minor | Fixed (due instant in `UTC`). |
| The 60 s timer cap and snooze wake had no test | minor | Fixed; snoozes count towards the timer. |
| Scheduler events emitted before the commit | minor | Fixed with `holdEvents`. |
| Migration lock takeover race; browser partitions left behind | minor | Fixed (rename takeover, staging per pid, `Partitions` moved); covered by a simulated interleaving test only. |
| `layout_undo` skipped the folder scope check; a file written to `layouts/` bypasses it | minor | Undo fixed. The file path is a recorded limit of the local provider. |
| Session directories with tokens survived a crash | minor | Fixed (removed when `LocalProvider` is constructed). |
| Isolated profiles inherited credential variables missing from a deny list | minor | Fixed (allow list). |
| Grants stayed valid after a failed create or resume; removing the cleanup broke no test | minor | Fixed through `onLaunchFailed`, with tests. |
| Second-instance and rail focus may not bring the window to the front on macOS | minor | `app.focus({ steal: true })` added; not checked on screen. |
| `useInbox` could show the previous filter's items | minor | Fixed with a test that fails without the fix. |
| Plain `ssh` and `scp` in an isolated profile use the user's default keys | minor | Recorded limit in 0023 and in the setup pane; the ssh wrapper on `PATH` is not built. |
| Vacuous tests: the active-tab check and `chmod` of an existing directory | minor | Fixed; the `ensureDir` test fails without the `chmod`. |
| Item text kept LRM, RLM, ALM, zero-width characters and line separators | minor | Fixed (Unicode format characters removed, separators become line feeds). |
| Flaky `appModules` grant test under parallel load | minor | Explicit poll timeouts; no flake in later runs. |
| 0023 stale against the code (`profileEnv` throw, stubs without commands, MCP listener order) | minor | 0023 corrected. |

As in milestone 1, the reviews found defects that the builders' green suites did not: the token reachable from an agent's working directory, the lost hand edit, the schedule cost and the re-enable flood. Each was confirmed by a probe test or a mutation before it was fixed.

### Tests and coverage

| Suite | Result at the end of the fix step |
|---|---|
| `pnpm typecheck` | passes; also in the cross-review. |
| `pnpm test` / `pnpm coverage` | 61 files, 597 tests pass; thresholds met. Run again for this record and in the cross-review: same result. |
| `pnpm e2e` | 26 tests pass. The verification ran it twice from a clean copy with no flake (from the verification report; no file records it). The cross-review ran it twice in the working tree: 26 pass. With the test the cross-review added for an item of a removed folder, 27 pass. |
| `pnpm parity`, `pnpm blocks-docs` | ok; `docs/parity.md` and `docs/blocks.md` regenerate byte for byte, also in the cross-review. |
| Real-Claude scripts | `e2e-claude-mcp.mjs` and `e2e-real-claude.mjs` passed after the fixes. `e2e-real-claude-inbox.mjs` passed at integration and was not run after the fixes; the cross-review found it failing, because it read the mode of `mcp.json` after `SessionStart`, when the app has removed the file. The script now reads the mode right after the launch and checks that the file is gone at the end. In the cross-review `e2e-claude-mcp.mjs`, `smoke-real-claude.mjs`, `e2e-real-claude.mjs` and the corrected `e2e-real-claude-inbox.mjs` pass on Haiku, at 0.0036 to 0.0048 USD per run (0.0053 USD for the inbox run at integration). |

Unit coverage after the fix step (`pnpm coverage` in the cross-review, 597 tests; computed per area from `coverage/coverage-summary.json`). The figures of the quality step, before the fixes, are in `docs/measurements/w-quality.md`:

| Area | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/core` | 93.1 | 83.5 | 95.1 | 96.6 |
| `src/main` | 68.4 | 55.6 | 70.3 | 71.0 |
| `src/main/modules` | 82.5 | 69.6 | 80.5 | 84.9 |
| `src/shared` | 100 | - | 100 | 100 |
| renderer logic files | 94.6 | 88.5 | 89.2 | 96.0 |
| all `src/renderer` files | 47.8 | 48.9 | 42.2 | 47.1 |
| all files | 82.8 | 74.3 | 82.4 | 85.4 |

End-to-end coverage after the fix step (`pnpm coverage:e2e` in the cross-review, the run in which all 26 tests pass; V8 mapped to source; V8 reports no statements). The quality step's figures are in `docs/measurements/w-quality.md`:

| Process | Area | Functions | Branches | Lines |
|---|---|---|---|---|
| renderer | `src/renderer` | 81.7 | 67.6 | 83.6 |
| renderer | `src/shared` | 83.3 | - | 97.1 |
| main | `src/core` | 70.4 | 43.5 | 73.6 |
| main | `src/main` | 77.1 | 65.3 | 83.6 |

The cross-review ran `pnpm coverage:e2e` four times. The first run failed in the two-profiles test: the coverage hook put the process environment back under the environment a spec passes, so a `CLAUDE_CONFIG_DIR` that `profiles.spec.ts` removes came back and the default profile adopted it. This explains the failure the quality step saw with the variable set; `pnpm e2e` alone does not show it. `e2e/coverageHook.ts` now uses the spec's environment as it is. Of the three runs after that, two failed in one inbox test each (the approval item from a hook did not show within 5 s; the status item was not resolved after its time in view), with the load average of the machine near 18, and each failing test then ran far past its 60 s timeout before the run went on. The fourth run passed. `pnpm e2e` passed in both runs of the cross-review.

Gaps: `TreePane`, `LayoutHost`, `SessionPeek`, `ProfileRail`, `SetupPane` and `ContextMenu` have no unit test; `src/main/index.ts` and `desktop.ts` are reached only by e2e.

### Measured effort

Wall times as recorded with `date -u` by each agent in `docs/measurements/`. Token spend is not recorded by the agents; the column stays empty until the totals of the workflow notification are added. User hours are not measured.

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time | Tokens |
|---|---|---|---|---|---|
| Survey: blocks prior art | `d-blocks-survey.md` | 15:00:01 | 15:05:07 | about 5 min | to be added |
| Survey: profiles and isolation | `d-iso-survey.md` | 15:00:04 | 15:04:45 | about 5 min | to be added |
| Probes P11 to P15 | `d-probes.md` | 15:00:04 | 15:25 | about 25 min | to be added |
| Design 0021 inbox and tasks | `d-inbox-design.md` | 15:00:02 | 15:08 | about 8 min | to be added |
| Design 0020 blocks and layout | `d-blocks-design.md` | 15:05:30 | 15:10:02 | about 5 min | to be added |
| Design 0022 profiles and isolation | `d-iso-design.md` | 15:05:07 | 15:10:27 | about 5 min | to be added |
| Review of 0021 | `review-inbox-design.md` | 15:08:43 | 15:20 | about 11 min | to be added |
| Review of 0020 | `d-blocks-review.md` | 15:10:43 | 15:17:21 | about 7 min | to be added |
| Review of 0022 | `d-iso-review.md` | 15:11:04 | 15:22:54 | about 12 min | to be added |
| Review and re-run of P11 to P15 | `review-probes-m2.md` | 15:25:15 | 15:38 | about 13 min | to be added |
| Contracts and stubs (0023) | `contracts.md` | 15:38:39 | 15:58:42 | about 20 min | to be added |
| Profiles, R22 | `w-profiles.md` | 15:59 | 16:39 | about 40 min | to be added |
| Isolation provider, R23 | `w-provider.md` | 15:59 | 16:38 | about 39 min | to be added |
| Blocks and layout, R20 | `w-layout.md` | 15:59:46 | 17:20:00 | about 80 min | to be added |
| Inbox and tasks, R21 | `w-inbox.md` | 15:59:47 | 17:21:09 | about 81 min | to be added |
| Integration | `integrate.md` (milestone 2 section) | 17:22:07 | 17:40:44 | about 19 min | to be added |
| Test quality | `w-quality.md` | 17:41:38 | 17:57:16 | about 16 min | to be added |
| Review: main, renderer, session, e2e | `review-m2-app.md` | 17:57:46 | 18:06:19 | about 9 min | to be added |
| Review: modules | `review-m2-modules.md` | 17:57:47 | 18:06 | about 8 min | to be added |
| Verification from a clean copy | none (the step was told not to change docs) | about 17:58 | not recorded | not recorded | to be added |
| Fixes | `fix.md` (milestone 2 section) | 18:21:40 | 18:53:36 | about 32 min | to be added |
| This record | `record.md` (milestone 2 section) | 18:54:07 | 19:00:41 | about 7 min | to be added |
| Cross-review of the records | `cross-review.md` (milestone 2 section) | 19:01:24 | 19:30:12 | about 29 min | to be added |

Milestone 2 from the first survey to the end of the fixes took about 234 minutes elapsed. The sum of agent wall times over the same steps is about 440 minutes: about 96 for surveys, probes, designs and their reviews, and about 344 for contracts, builders, integration, quality, code reviews and fixes. What took long: the real-Claude probe runs and the folder-trust dialog (probes); zod optional keys against `exactOptionalPropertyTypes` (contracts); the full test runs overlapping with other builders' edits (every builder); the echo loop of `ui.focus_node` through the bus and slow e2e runs under load (layout); the trust answer matching an older frame of the screen (integration); Playwright and Node coverage formats (quality); moving the default working directory out of the data directory and a test that wrote below the real home directory because `os.homedir()` ignored `HOME` (fixes).

### Re-estimate

Judged share of the estimates built in milestone 2, in 0005 units (working days for one engineer plus agents). The shares are a judgement by this step from the slice reports; no measurement gives them.

| Requirement | Estimate | Built in milestone 2 | Judged share |
|---|---|---|---|
| R20 composable UI | 15 to 25 days (0015); first slice 4 to 6 (0020) | the first slice of 0020 without the real-Claude script, a drag test and the observation mask | about 5 days |
| R21 tasks, reminders, inbox | 10 to 15 days (0016); first slice 4 to 6 (0021) | the first slice without the tasks pane and the interrupt line, plus registry publishing | about 4 days |
| R22 profiles | 3 to 6 days (0017) | items 1 to 4 and 8 of 0022 without a real login run | about 4 days |
| R23 isolation | 8 to 12 days for interface, local and one container provider, plus 5 to 10 for OpenShell (0018) | interface, local and fake providers, the 0600 session files | about 3 days |
| Total | | | about 16 days |

| Basis | Agent minutes | Minutes per estimated day |
|---|---|---|
| Build steps (contracts to fixes), summed | about 344 | about 21.5 |
| Build steps, elapsed (15:38:39 to 18:53:36) | about 195 | about 12 |
| All steps including surveys, probes and designs, summed | about 440 | about 27.5 |
| Milestone 1 for comparison (0014: about 14 days built), summed / elapsed | about 132 / 94 | about 9.4 / 6.7 |

Both sides of each rate carry a judgement: the minutes are measured, the days built are judged, and a change of the judged 16 days by 4 moves the milestone 2 rates by a fifth to a third. With that limit, milestone 2 took more than twice the agent time per estimated day of milestone 1. Reasons visible in the reports: more UI work and integration across slices that share the window, more e2e runs under parallel load, the trust dialog in every real-Claude path, and a larger review and fix step (the fix step alone took longer than any milestone 1 build or fix step; only the milestone 1 probe step took longer).

Remaining work in 0005 units: about 154 days of the 0007 rows (0014), plus the rough guesses of 0015 to 0019 (R20 15 to 25, R21 10 to 15, R22 3 to 6, R23 13 to 22, R24 5 to 8 days) minus about 16 days built, about 30 to 60 days. Together about 184 to 214 estimated days.

| Rate | Summed agent time | Elapsed with the same parallelism |
|---|---|---|
| Milestone 1 rate | about 29 to 34 hours | about 21 to 24 hours |
| Milestone 2 build rate | about 66 to 77 hours | about 37 to 43 hours |
| Milestone 2 rate with designs and probes | about 84 to 98 hours | not derived |

The hours are the remaining days times the unrounded rates above (minutes divided by days built), as 0014 computed its projection. The projection is an extrapolation, not a plan. It leaves out the cross-review steps of both milestones and every hour of the user. The points of 0014 still hold: later slices need verification outside tests (browser, Slack, connector writes, visible windows, swarms), user time for decisions is not measured and becomes the limit, and review cost grows with the attack surface. Milestone 2 adds one point: slices that share the window and the session launch need an integration step that grows with the number of slices built at once.

0007 reopens if the greenfield total reaches 192 days. That total counts R1 to R19 (168 days). R20 to R24 are requirements added after the base decision; they apply to any base, and the forks were not estimated for them, so the comparison of rule 3 is not recomputed. On R1 to R19 alone, nothing in milestone 2 suggests that the 0005 rows are too low. Whether the larger total changes the scope question of 0007 is for the user.

### What remains open

| Item | Where |
|---|---|
| All milestone 2 work is uncommitted | user |
| Default permission mode (manual today; 0012 says auto with ask rules); whether `mcp__app__*` is allowed without a prompt | user; 0012 |
| Local agents run as the user: shell reads of the app root, other profiles and `mcp.json` before the first `SessionStart` are not prevented; the deny rules cover the CLI's file tools only and their effect is unverified | 0022, 0023 limits; isolation providers |
| A layout file written straight to `layouts/` is adopted without a scope check | 0023 limit |
| Plain `ssh` and `scp` in an isolated profile use the default keys | 0023 limit; setup pane |
| The app does not handle the folder-trust dialog; trust entries for temporary directories (`agide-smoke-cwd`, `probes/work/*`) are in the user's Claude config | session module; user |
| No on-screen check: window focus with `steal`, the dock badge, notifications, the rail at its share width, resizing | visible-window run |
| Real login in a new profile and a real-Claude run with `AGIDE_ROOT` | profiles |
| dockview drag over a native view; drag in Playwright; real-Claude layout script; capture masking of surfaces with observation off and the access log | layout; observation |
| `inbox_ask` (P16), approval and elicitation from the card (`http` hook transport, P17), tasks pane, session summaries, `powerMonitor` wake, interrupt line, `SessionEnd`, `SubagentStop` and `Elicitation` mapping, notification click to the item | inbox |
| Providers beyond local; probes E2, C1, C3, C4, G1 and the D, O and S series of 0022 (E1 is covered by `e2e/profiles.spec.ts`; of C2, the `--mcp-config` path is shown and `--settings` as a path is not); the probe scripts C2 and C3 that 0023 gave to w-provider are not written; the Bash sandbox allowlist against 0012's network default | isolation |
| 0020, 0021 and 0022 have status `proposed`; the build followed them before the user confirmed them | user |
| `-p` stream-json path, interrupt as a turn state, `OutputBuffer` replay inside an escape sequence, expanded folders | from 0014 |
| A user-level `statusLine` and its replacement, workflow usage roll-up, a per-request check of subagent cost | probes (0019) |
| Unit tests for several renderer components; `index.ts` and `desktop.ts` only in e2e | tests |
| `PtySessionService` tests are timing sensitive under parallel coverage load | tests |
| Inbox e2e tests fail now and then under `pnpm coverage:e2e` on a loaded machine (hook item within 5 s, resolve after time in view), and a failing test then runs far past its timeout; cause not found | tests |
| Token spend per step and user hours | measurements |
| Scratch files under `/tmp` from reviews and the verification (`agide-verify.*`, `agide-mutate`, `claude-rev-0021`, `rv-*`); their removal was refused | user |

## Consequences

### Recommendations for milestone 3

Keep the milestone 2 process: survey and probes, designs with an independent review, contracts, parallel builders on disjoint files, integration, a test-quality pass, code reviews that run mutations and probe tests, then fixes. Run `pnpm dev` with a visible window once, with the user present if the user wants to see it.

1. Browser surface (0006 option C, R12). A `WebContentsView` per `browser-tab` leaf inside an `agide/surface-host` pane, with a partition per service under the profile's `userData` (0022), hosted browser tools whose schemas follow the Claude in Chrome tool list, CDP highlight and "open in Chrome". The browser module creates the view for a leaf it recorded and checks folder scope on every tool call (0013 ownership rule). Settle the 0020 checks that wait for a native view: hiding the view during a docking drag, and `capturePage` with view children. The review should cover navigation, downloads, permissions per partition and `will-navigate`, with forged-leaf and cross-folder tests from the start.
2. Observation (R13). `surfaces_observe` with the per-surface switch, the indicator and the access log; the capture mask for surfaces with observation off; the per-turn digest through a `UserPromptSubmit` hook with `additionalContext` (P8). Page content is untrusted data.
3. Task start (S2). Prompt, PR URL and Jira key first, each creating a folder with a working directory outside the app root. The app handles the folder-trust dialog before launch (ask the user, or show the dialog's state in the pane). PR tasks use `--setting-sources user` without `--strict-mcp-config` (P9).
4. Agent nodes and usage views (0009, R24). The event normaliser on the hook inbox, with `Notification`, `StopFailure` and the `<task-notification>` prompts of background subagents (P11, P13); the `-p` stream-json path under the cap of 4 concurrent app-started agents (0012); the app's status line command through `--settings` as the live cost and plan source (P12), transcripts counted by `message.id` and `cost-state` at exit for totals (P13); the ranking, heat markers and plan usage per profile as blocks; usage alerts as inbox items. Run P16 with this slice so `inbox_ask` can follow.
5. Review slice (0010). The first slice of the ladder: rung A and B checks on a changeset, review items in the inbox, and the `http` hook transport, which also unlocks approval from the inbox card (P14) and elicitation forms (P15, P17).
6. Isolation providers beyond local (R23). First the probes that need no third-party software (E2, C1, `--settings` as a path from C2, C3, C4, G1), then, if the user agrees to installs, srt and a container provider with the per-profile Claude directory of 0022, then OpenShell for API-key profiles. A provider that runs the agent outside the user's account is the only way to close the shell-read limit above.
7. Record user hours and tokens per step next to wall time.

### Questions for the user

- The last commit ("Add a root README and bring the docs index and app README up to date") was made two minutes before the run started and holds README changes, so the README commit of the request appears to be done. The milestone 2 work, with its own README updates, is uncommitted, because the run's steps were told not to commit. Should it be committed now, in one commit or per slice, and on which branch?
- 0020, 0021 and 0022 are `proposed`. Do you confirm them, with the amendments listed above for 0021?
- Default permission mode for sessions you start: manual (every tool call asks, as now), or auto with ask rules (0012)? Should `mcp__app__*` tools be allowed without a prompt?
- Local agents run as you and can read other profiles' files through the shell. Is that acceptable until a container or srt provider exists, and do you agree to install the third-party software those probes need (0022 D, O and S series)?
- Confirm or correct the reading of the Anthropic terms in 0022 on setup tokens and credential-injecting proxies.
- The Bash sandbox allowlist breaks git over SSH inside Bash on macOS. How should it relate to 0012's network-allowlist default?
- Should the rail show plan usage of other profiles (0019), which 0017 does not allow today?
- Trust entries for temporary directories from the probe and real-Claude runs are in your Claude config. Do you want to remove them (you run the removal), and should the app ask before launching in a directory Claude has not seen?
- Do you want to try the app with a visible window (`pnpm dev`), including a second profile and a real login in it?
- Milestone 3 order: the list above starts with the browser surface and observation, as 0002 and 0007 do. Should task start or agent nodes with usage views come first?
- With the re-estimate above, does the scope question of 0007 change, and what weights do R20 to R24 get?
- The 0012 rows still open: confirmation of 0009 to 0011, and whether the claude.ai login is an organization account with connector controls.
