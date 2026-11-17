# 0014 Milestone 1 results

Status: accepted
Date: 2026-11-17
Decided by: spike agents
Inputs: 0004, 0005, 0006, 0007, 0009, 0010, 0012, 0013; `probes/RESULTS.md`, `notes/probes-stage2.md`; `docs/measurements/*.md`; `docs/parity.md`; the builder, integration, review, verification and fix reports of the milestone 1 run (summarized here, not stored as files)

## Context

0012 accepted the greenfield Electron shell and started milestone 1: the shell, the task tree with persistence (S1), the Claude session surface in a PTY (0004), the app MCP server with the command registry and the parity table (S3), and the probes that gate them (P6 to P10). 0013 fixed the toolchain, modules and contracts. The code is in `app/`, its own git repository on the branch `spike/stage2`, with no commits; every file is untracked until the user asks for a commit.

Builders worked in parallel on the tree, the session surface, the MCP server and the probes. An integration step joined the slices. Independent reviews then read the core (tree, store, commands, MCP) and the session, main process, preload and renderer code, and a verification step rebuilt the app from a clean copy. A fix step applied the review findings and amended 0013.

This record states what milestone 1 shows against the requirements, which statements in 0004 the probes change, what the reviews found and what was fixed, the measured effort against the 0005 estimates, what stays open, and what milestone 2 should do.

## Decision

### What milestone 1 built

| Part | Built | Shown by |
|---|---|---|
| Shell | Electron 45 window with context isolation, sandbox, CSP, a deny-all web permission handler, a single-instance lock, generic `commands:invoke` IPC limited to the main frame of an app window, module lifecycle with ordered dispose | `pnpm e2e` (hidden window), `pnpm build`. The lock, the permission handler and the frame check have no test; the lock was checked by hand in the review |
| Tree (S1) | `SqliteTreeService` on `node:sqlite` with per-module migrations, one `BEGIN IMMEDIATE` transaction per operation, events after commit; headless-tree pane with nested folders, drag and drop (reorder, move into folders, cycle drops refused), inline rename, keyboard navigation, context menu | shared contract tests against the in-memory and SQLite services; `e2e/tree.spec.ts` (nested folders, drag between folders, restart on the same data directory, rename and keyboard, rejected cycle drop, reorder) |
| Claude session surface | `PtySessionService`: `claude` in node-pty per session with `--session-id` or `--resume`, an explicit `--permission-mode`, `--setting-sources user`, hooks through `--settings` delivered to a per-session inbox directory, status from hooks and PTY exit, SQLite persistence, xterm.js `TerminalPane` with fit, resize, input and replay after renderer reload; `session_*` commands | unit tests with a fake `claude` through real node-pty; `e2e/session.spec.ts`; `scripts/smoke-real-claude.mjs` and `scripts/e2e-real-claude.mjs` against the real CLI |
| App MCP server (S3) | official MCP SDK, Streamable HTTP, stateless per request, bound to 127.0.0.1 on a random port, per-session URL and bearer token, Origin and Host checks, tools generated from the command registry with JSON Schema and readable validation errors, folder scope for every MCP caller | `HttpAppMcpServer.test.ts` with the SDK client; `scripts/e2e-claude-mcp.mjs` (`claude -p`) and `scripts/e2e-real-claude.mjs` (PTY) against the real CLI |
| Parity table | `pnpm parity` over the registry that the real module graph builds; `mcpExempt` states why a UI-bound command is not a tool | `docs/parity.md`; `src/main/modules/appModules.test.ts` fails when the table is out of date |
| Integration | App owns the node list and the open node; "New Claude session" in a folder starts a session and opens its terminal; a session leaf from an earlier run shows as exited with Resume; `AGIDE_CLAUDE_ARGS` and `AGIDE_SESSION_CWD` | `e2e/integration.spec.ts`: restart and resume, a folder created over MCP appears in the tree without reload, out-of-folder nodes are hidden from the agent, terminal input and redraw |
| Probes P6 to P10 | PTY permissions, PTY session ids, `additionalContext`, setting sources, PTY interrupt | `notes/probes-stage2.md`, `probes/out/p6_*` to `p10_*`, `p9b_*` |

At the end of the fix step `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` and `pnpm parity` pass, and the real-Claude scripts pass on Haiku with the budget cap. `pnpm typecheck` and `pnpm test` were run again when this record was written and pass. The cross-model review of this record ran `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm e2e:claude-mcp` and `pnpm e2e:real-claude` once more on the same day; all pass.

### What each slice shows against the requirements

| Requirement (0005 row) | What is shown | What is not shown |
|---|---|---|
| R1 desktop GUI | A greenfield Electron shell builds, starts hidden under Playwright, persists data and quits cleanly. A second instance on the same data directory exits at once (a manual run in the review; no test). Hardening from the review is in place. | `pnpm dev` with a visible window and the CSP under the Vite dev server; packaging, signing and updates; the app was not used by the user. |
| R6 task tree (S1) | Nested folders with drag and drop and persistence across restart. The e2e suite nests two folder levels with a leaf below; the tree service tests go deeper. A review run with three folder levels and a leaf below them (drag across levels, a rejected cycle drop, restart) passed; it is not in the suite. Leaves exist for each known surface type. The S1 stop rule of the spike plan (3 days) is far from reached. | Task start from a prompt, PR URL, Jira key, Slack permalink or Notion URL (S2, the other half of R6). `browser-tab` and `slack-thread` leaves are tree entries with no surface behind them. Expanded folders are not persisted. |
| R8 agent drives the UI (S3) | A real Claude session, launched from the tree, found the app tools through `ToolSearch`, called `mcp__app__ui_create_folder`, and the folder appeared under the session's folder in the tree within a fraction of a second after the script answered the CLI's approval dialog with Enter in the terminal pane. Every command that declares a UI binding is an MCP tool or carries a stated exemption; the check reads the declared `ui` field and does not see which commands the renderer calls. An MCP caller sees and changes only its own folder (the limit against an agent with shell access is in 0013). | `surface_*` tools beyond `surfaces_list`; the show-the-user actions of R14 (open, reveal, highlight) apart from `ui_focus_node`; long-running tool calls and server notifications (no SSE). |
| R4 Claude launch path | The interactive TUI in a PTY works as the primary path of 0004 decision 1: chosen session ids, resume, hooks from `--settings` for status, the app MCP server through `--mcp-config`, the CLI's own approval dialog with the `PermissionRequest` hook marking the session as waiting, the inherited-variable scrub with `CLAUDE_CONFIG_DIR` kept. | The `-p` stream-json path for background agents (the session type field exists, the service ignores it). Interrupt state, image paste and a session started from the Finder with fish as the login shell. |

### Probe results that change 0004

0004 is still `proposed`. P6 to P10 (`notes/probes-stage2.md`) and the session builds settle several of its open points. The statements below need amendment when 0004 is next revised.

| 0004 statement | Finding | Amendment |
|---|---|---|
| Context table, row "Multi-turn, `--session-id`, `--resume`, `--fork-session`", PTY column: "not tested" | P7: `--session-id` sets the id and the transcript name; `--resume` keeps id and file; `--resume --fork-session` makes a new id and file with history; `--resume --fork-session --session-id` forks into a chosen id. A reused id, and `--resume` with `--session-id` but no fork, exit with code 1 and no hook fires. | PTY: works. Decision 2, "probed in `-p` only; the PTY case is a stage 2 probe", becomes probed in both paths. |
| Context table, row "Interrupt", PTY column: "not tested" | P10: Esc and Ctrl-C stop the turn and the session keeps running. No hook fires, including no `Stop`. The transcript gets a user line `[Request interrupted by user]` or `[Request interrupted by user for tool use]`. SIGINT ends the process with `SessionEnd` reason `other`. | PTY: works; the turn state machine reads interrupts from the transcript or the screen, because no hook reports them. |
| Context table, row "Approval", PTY column: "deny and built-in tools not exercised"; decision 3: "PTY deny and built-in tools in the PTY must be tested before the hook is relied on there"; risk row "PTY deny path untested" | P6: in manual mode the hook fires for Bash, Edit and an MCP tool; deny blocks each call and the message reaches the agent as an error tool result; allow runs each call. The TUI draws its approval dialog while the hook runs, and the hook's answer closes the dialog without a keypress: the raw PTY output of every case (`p6_*_raw.bin`) holds the dialog text, and the probe sent no key. `notes/probes-stage2.md` and `probes/RESULTS.md` say that no dialog appears; the raw output does not support that. The probe hook answers at once, so a hook that waits for an answer from the app was not exercised. The `PermissionRequest` payload has no `tool_use_id` and no `agent_id`; the `PreToolUse` payload of the same call has `tool_use_id`. | The hook can be relied on in manual mode for a decision it gives at once. Pair a request with its `PreToolUse` by order and `tool_input`. Add: the dialog is on screen while the hook runs, so a keypress in the terminal can reach it before a slow hook answers; which answer wins is not tested. The risk row moves to the untested modes (`acceptEdits`, `auto`, `bypassPermissions`), subagents and a slow hook. |
| Context table, row "`--strict-mcp-config`", PTY column: "not checked in the PTY; assumed the same"; the paragraph that calls the connector evidence indirect | P9b: controlled comparison in `-p`, in one directory with one prompt. With the flag `mcp_status` lists no servers; without it connectors and user-scope servers are listed. P9 in the PTY (one run per configuration, not a controlled comparison): with the flag the `/mcp` screen and the model's own list hold only the built-in `claude-in-chrome`; without it they hold the connectors, the user-scope servers and the plugin servers. | Same in both paths, with `claude-in-chrome` kept in the PTY. The stored `-p` evidence is now controlled (`probes/out/p9b_strict_compare.json`); the PTY evidence is `probes/out/p9_pty_report.json` and `p9_pty_user_strict_raw.bin`. |
| "The first `system/init` has no claude.ai connectors and no claude.ai tools" | P9 and P9b: the first init's server list varies between runs and sometimes lists connectors. In P9b the two runs without the flag gave the same `mcp_status` list while their inits differed. | The first init is unreliable in either direction. Decision 5 stands: read `mcp_status`. |
| Hook context: "The probes did not return `additionalContext`, so injection is documented but not exercised" | P8: `additionalContext` and plain stdout of a `UserPromptSubmit` hook reach the model in both paths. In `-p`, 9,900 characters arrive whole and from 10,100 the model gets a preview of about 2,000 characters and a file note. The PTY cases were 200 and 5,000 characters (whole) and 12,000 and 60,000 (preview); the two sizes next to the limit ran in `-p` only. The transcript stores the context as an `attachment` line. Imperative wording was obeyed in the single `-p` run and not in the single PTY run. | Exercised. Use it for per-turn state, under 10,000 characters, most important lines first, worded as facts. |
| Decision 7: PR tasks run with `--strict-mcp-config` and no connectors until a probe confirms `--setting-sources user` in both paths; risk row "Connectors absent in PR tasks" | P9: `--setting-sources user` without `--strict-mcp-config` skips the project `.mcp.json`, the project hooks and the project `CLAUDE.md`, and keeps connectors and user-scope MCP servers, in `-p` and in the PTY. | PR tasks and reviewers launch with `--setting-sources user` without `--strict-mcp-config`. The app supplies repo guidance, since `CLAUDE.md` is skipped. User-scope servers from the login's `.claude.json` stay. The folder-trust dialog in an untrusted checkout is still untested. |
| Decision 1: "Status comes from hooks ... and from the transcript file" | Session build: a working directory the CLI has not seen shows a folder-trust prompt before any hook fires, with the cursor on "No, exit"; the session stays `starting` until the user answers. The answer is stored per path in the user's Claude config. | Add: the launch handles the trust prompt (the user answers in the terminal, or the app warns before launch in an unseen directory). |
| Context table, row "Turn completion and status", PTY column: "no cost field" | Session build: the `Stop` payload has no cost. The transcript gets `cost-state` rows with `totalCostUSD` and per-model `modelUsage` when the process ends, not at `Stop`; `message.usage` token counts are on assistant rows. `--max-budget-usd` is accepted interactively; enforcement there is not tested. | PTY cost is known per process at exit and as token counts per turn. |
| Decision 2: the app's hooks through `--settings` | Integration: under `--setting-sources user` the user's own hooks run in app sessions next to the app's hooks. Review: the hook command must not depend on the login shell (fish here) and concurrent hooks must not share one file. Cross-model review: in one `-p` run with `SHELL` set to zsh the CLI started the hook command with `/bin/sh -c`, and no shell start-up text reached the model from the hook. | Add: hook commands run under `/bin/sh -c` and write one file per hook (0013 amendments). The user's own hooks stay active. |
| Decision 2: `--permission-mode` set by the app | Session build: the CLI names the prompting mode `manual`; hook payloads report it as `default`. | Wording only: the app's `default` maps to the CLI's `manual`. |
| Not verified list | P6, P7, P8, P9, P9b and P10 cover PTY interrupt, the PTY session flags, the stored `--strict-mcp-config` comparison, `--setting-sources user` in a checkout with a `.mcp.json`, PTY deny through the hook, and `additionalContext` in a run. | Remove those items. Add the gaps listed under "What remains open". |

### Review findings and what was fixed

The reviews rejected the integrated code. The fix step addressed the findings below; the code and tests follow the 0013 amendments.

| Finding | Severity | Status |
|---|---|---|
| An agent could create a `claude-session` leaf with another folder's session id, then move it to take over that session (`session_send_text` succeeded) or remove it to close that session. Both reviews reproduced it. | blocker | Fixed. `ui_create_leaf` from an MCP caller accepts only agent-creatable types (`browser-tab`, `slack-thread`); the session module acts only on the leaf it recorded for each session. Mutation checks on both guards fail the new tests. |
| Concurrent hooks appending to one events file interleaved; large payloads were lost, which could leave a session `busy` or `waiting`. | major | Fixed. One file per hook, written to a temporary name and renamed; `HookInbox` replaces `JsonlTail` and clears the inbox at each launch. |
| The parity check ran over a test registry and missed `session_create`, a UI-bound command without a tool. | major | Fixed. Parity runs over the real module graph; `session_create` is exempt with a stated reason. Only `pnpm parity` writes `docs/parity.md`. |
| Cycle and `isWithin` tests used only a direct child, so a one-level check passed; a stored cycle would make the recursive query loop. | major | Fixed. Contract cases at depth; `isWithin` uses `UNION`. With `UNION ALL` the stored-cycle test does not fail; it never returns. |
| Scope checks on `ui_create_leaf` and on the moved node of `ui_move_node` had no test. | major | Fixed with tests. |
| The session module (scope of `session_*` for MCP callers, revoke on close, startup cleanup, rescope on move) and the IPC sender check had no tests that failed under mutation. | major | Fixed for the session module through `appModules.test.ts` on the real module graph: removing the scope check, the startup cleanup, the rescope on move, the revoke on a top-level move or the revoke on exit fails a test (mutation run in the cross-model review). The revoke on close has no test of its own, because the process exit before it already revokes. The IPC frame check is still covered only on the normal path. |
| The rename e2e test was flaky. | minor | Fixed. Cause: a test race (the rename input opened before focus moved to the new item). Passed in repeated runs after the fix. |
| Unknown node ids answered `out_of_scope`; `cycle` and `parent_not_folder` answered `failed`. | minor | Fixed. `not_found` first; tree input errors map to `invalid_input`; the out-of-scope message names `ui_list_tree`. |
| A throwing tree listener turned a committed operation into an error. | minor | Fixed with `onListenerError`. |
| A session leaf moved to the top level kept its grant; grants survived exit and failed launches. | minor | Fixed. Revoked on top-level move, exit and a failed `session_create` launch; resume issues a new grant. The revoke after a failed launch and the withheld grant for a resumed session whose leaf is outside its folder have no test. A failed resume launch keeps its unused grant. |
| No single-instance lock, no `busy_timeout`, migrations accepted a newer schema. | minor | Fixed. The migration check has a test; the lock and `busy_timeout` have none. |
| Unhandled rejection in the MCP request handler; oversized bodies reported as invalid JSON. | minor | Fixed (500 and 413). The 500 branch has no test. |
| No web permission handler; dev URL honoured in a packaged app; frame URL not checked. | minor | Fixed. No unit tests, because the code imports Electron. |
| `session_create` accepted `bypassPermissions` without confirmation. | minor | Fixed with `confirmBypassPermissions`. |
| `OutputBuffer` trimming untested; replay can start inside an escape sequence. | minor | Test added; the escape-sequence case is not fixed. |
| A hook test compared a constant with itself. | minor | Fixed with a literal event list. |
| The bearer token is in the `claude` process arguments, visible to same-user processes. | minor | Not fixed. 0013 states that the folder scope protects against agent mistakes, not against an adversarial agent with shell access. |
| Sessions default to the CLI's manual mode; 0012 sets the user's auto mode with ask rules for app-launched agents. | minor | Not changed. Open decision for the user. |

The review step found defects that the builders' own tests and mutation checks did not: the forged leaf, the hook race, and untested security rules. The builders' unit and e2e suites were green when the reviews started.

The cross-model review of this record repeated the mutation checks on the fixed code. Removing either forged-leaf guard, the scope check of `ui_create_leaf` or of the moved node, the bypass confirmation, the migration version check, the listener error handling, the 413 answer, the `OutputBuffer` trim, the inbox reset at launch or the exemption rule of the parity check fails a test. The removals that pass every test are listed in the 0013 amendments under "Rules without a test".

### Measured effort

Wall times as recorded with `date -u` by each agent in `docs/measurements/`. Token spend is not recorded: the agents do not see it, and the column below is empty until the totals of the workflow notification are added. 0012 asks for tokens per slice, so this is an open item. The run asked the user for nothing after the go-ahead message. The time the user spends reading the results is not measured.

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time | Tokens |
|---|---|---|---|---|---|
| Scaffold and contracts (0013) | `scaffold.md` | 08:24:50 | 08:47:10 | about 22 min | to be added |
| Tree, S1 | `w-tree.md` | 08:48 | 08:55 | about 7 min | to be added |
| Claude session surface | `w-session.md` | 08:48:13 | 09:08:20 | about 20 min | to be added |
| App MCP server, S3 | `w-mcp.md` | 08:48:14 | 08:53:05 | about 5 min | to be added |
| Probes P6 to P10 | `w-probes.md` | 08:48:13 | 09:24:18 | about 36 min | to be added |
| Integration | `integrate.md` | 09:24:43 | 09:31:48 | about 7 min | to be added |
| Review: tree, store, commands, MCP | `review-core.md` | 09:32:34 | 09:37:30 | about 5 min | to be added |
| Review: session, main, preload, renderer | `review-session-main.md` | 09:32:35 | 09:43:12 | about 11 min | to be added |
| Verification from a clean copy | `verify.md` | 09:32 | 09:36:47 | about 5 min | to be added |
| Fixes | `fix.md` | 09:44:20 | 09:58:22 | about 14 min | to be added |
| This record | `record.md` | 09:58:52 | 10:02:40 | about 4 min | to be added |
| Cross-model review of 0013 and 0014 | `cross-review.md` | 10:03:08 | 10:42:25 | about 39 min | to be added |

Milestone 1 from the scaffold start to the end of the fixes took about 94 minutes elapsed. The sum of agent wall times over the same steps is about 132 minutes, because builders and reviewers ran in parallel. Real-Claude runs dominated the probe step (PTY cases of 20 to 60 seconds each). What took long in each step: the Playwright quit hang and the node-pty `spawn-helper` permission (scaffold), the folder-trust prompt and the late cost row (session), the dynamic tool list on the low-level SDK server (MCP), the trust dialog and the dialog regex (probes), and the rename flake (fixes).

Against the greenfield estimates in 0005 (working days for one engineer plus agents to reach score 3):

| 0005 row | Estimate | Built in milestone 1 | Remaining in the row |
|---|---|---|---|
| R1 desktop GUI | 4 days | shell, lifecycle, hardening, persistence | visible-window check, packaging and signing, layout state |
| R4 Claude | 3 days | PTY path with hooks, resume, MCP config, approval through the TUI | `-p` stream-json path, interrupt state, trust prompt handling, Finder launch |
| R6 task tree and start | 10 days | S1 tree with drag and persistence | S2 task start from prompt, PR, Jira, Slack and Notion; expanded state |
| R8 agent drives UI (incl. R14) | 8 days | S3 server, registry tools, folder scope, parity | `surface_*` tools, reveal and highlight, tools of later modules |

The estimates and the measurements are in different units. 0005 counts engineer days to a finished requirement; milestone 1 measures agent wall time to a spike that passes its tests, has had one review and fix round, has not been committed and has not been used by the user. The comparison is therefore a ratio with a wide error, not a conversion.

### Re-estimate of greenfield effort

Judged share of the 0005 rows built in milestone 1: about 3 of 4 days of R1, 2 of 3 of R4, 4 of 10 of R6 and 5 of 8 of R8, about 14 of the 168 days in 0007. The shares are a judgement by the agents that built the slices; no measurement gives them. That share took about 132 agent minutes (about 9 minutes per estimated day) and about 94 elapsed minutes (about 7 minutes per estimated day). The 132 minutes include the probe step (about 36 minutes), which 0007 lists as a stage 2 item of its own, outside the requirement rows; without it the figure is about 96 minutes, about 7 minutes per estimated day.

| Basis | Remaining | Projection at the milestone 1 rate |
|---|---|---|
| 0007 total minus the built share | about 154 estimated days | about 24 hours of summed agent wall time, about 17 hours elapsed with the same parallelism |

The projection is an extrapolation from the first slices. It is not a plan, and the points below make the real time longer:

- Later slices need more verification outside tests: a real browser surface, real Slack, connector writes, visible windows, swarms under the subscription. Milestone 1 already shows real-Claude and PTY work taking the longest.
- The user's time for decisions, reading reviews and using the app is not measured and becomes the limit. Records 0009, 0010 and 0011 are still proposed, and R19 alone is 29 estimated days.
- R20 (0015) and R21 (0016) are proposed requirements outside the 168 days.
- Review found blocker-level defects that tests missed. Every slice needs the same review and fix round, and the review cost grows with the attack surface (browser, outward actions).

The 192-day threshold of 0007 is in engineer days, and milestone 1 measured agent minutes with no user hours, so the measurements do not give a greenfield total in that unit. What they show is narrower: the built share took far less agent time than its estimated days, no step needed the user, and nothing in the run suggests that the 0005 rows are too low. That gives no reason to raise the greenfield total towards 192 days. The fork estimates in 0005 were made on the same code-reading basis and were not re-measured, and agents would shorten fork work as well, so the rule 3 ratio is not recomputed and 0007 is not reopened.

### What remains open

| Item | Where |
|---|---|
| Default permission mode for user-started sessions (manual today, 0012 says auto with ask rules); whether `mcp__app__*` is allowed by default (every app tool call asks today) | 0013 open decision; user |
| Bearer token in the `claude` arguments | 0013 security limits |
| Folder-trust prompt in unseen directories; trust entries for temporary paths left in the user's Claude config by the smoke runs and a probe | session module; user |
| `-p` stream-json launch path for background agents | 0004 decision 1; milestone 2 agent work |
| Interrupt as a turn end state (no hook fires) | session status |
| A denied approval stays `waiting` until the next tool call or `Stop` | session status |
| The TUI draws its approval dialog while a `PermissionRequest` hook runs (P6 raw output). A hook that waits for an answer from the app, and a keypress in the terminal during that wait, are not tested | probes; approval design |
| `notes/probes-stage2.md` and `probes/RESULTS.md` still say that no dialog appears when the hook answers | notes |
| Hooks from a Finder launch with fish as the login shell; `--resume` of a session that never got a prompt; child processes of `claude` after SIGTERM | not run |
| `pnpm dev` with a visible window and the CSP under the Vite dev server | not run |
| Replay after an `OutputBuffer` trim can start inside an escape sequence | session |
| Electron-side handlers (permission, frame URL, packaged dev URL) and the single-instance lock have no tests | main process |
| No test for the revoke after a failed `session_create` launch, the withheld grant for a resumed session whose leaf is outside its folder, `busy_timeout` and the 500 answer of the MCP handler; the stored-cycle test hangs under `UNION ALL` where it should fail | 0013 "Rules without a test" |
| The e2e suite nests two folder levels; S1 names three (a review run at three levels passed and was not kept) | `e2e/tree.spec.ts` |
| `browser-tab` and `slack-thread` leaves have no surface; the delete confirmation for a folder with children has no test | tree pane |
| Expanded folders are not persisted; renaming a session leaf does not rename the session | tree, session |
| Buttons inside panes (Resume) call commands that declare no UI binding, so the parity table does not list them as UI actions | parity check |
| Order of hooks that fire at the same instant is not defined | `HookInbox` |
| PTY approval in other permission modes and for subagents; `updatedInput`; the folder-trust dialog in an untrusted checkout and project hooks behind it; image paste; interrupt during an approval dialog; whether imperative injected context is followed; models other than Haiku; concurrency on one subscription. P6 to P8 and P10 ran once per case | probes |
| Real-Claude scripts ran a few times each; flake rate unknown | scripts |
| Token spend per step is not recorded; user hours are not measured | 0012; measurements |
| No linter until typescript-eslint supports TypeScript 7 | 0013 |
| Scratch files of the session review and of the cross-model review are still under `/tmp` (`review-hookrace`, `review-scripts`, `review-bak.*`, `agui-review-*`); their removal was refused | user |

## Consequences

### Recommendations for milestone 2

Order, following the 0007 stage 2 list and 0002, which makes the browser and observation core parts:

1. Browser surface (0006 option C). `WebContentsView` with persistent partitions, hosted browser tools whose schemas follow the Claude in Chrome tool list, CDP highlight, and "open in Chrome" per leaf. Apply the surface ownership rule from 0013: the browser module creates the surface for a leaf and acts only on leaves it recorded; `browser-tab` stays agent-creatable, so the module must check scope on every tool call and refuse leaves outside the caller's folder. Give the module its own review with a forged-leaf and cross-folder test from the start. Expect the review to look at navigation, partitions, downloads and `will-navigate`, the next attack surface after the MCP server.
2. Observation. `surfaces_observe` with the per-surface switch, the indicator and the access log, on-demand by default (0012). Deliver the per-turn digest through a `UserPromptSubmit` hook with `additionalContext`, under 10,000 characters, most important lines first, worded as facts (P8). Treat page content as untrusted data in the digest.
3. Task start (S2). Prompt, PR URL and Jira key first. PR tasks launch with `--setting-sources user` without `--strict-mcp-config` (P9), and the app passes repo guidance itself because `CLAUDE.md` is skipped. Handle the folder-trust prompt for new checkouts before launch, and run the trust-dialog probe that P9 could not run. The Atlassian v2 connector move stays with the user (0012).
4. Agent nodes (0009). Build the event normaliser on the hook inbox, pair `PermissionRequest` with `PreToolUse` by order and `tool_input` (P6), read interrupts from the transcript (P10), probe a `PermissionRequest` hook that waits for an answer from the app while the TUI dialog is on screen (P6 raw output), and add the `-p` stream-json path for agents the app starts without a terminal, under the cap of 2 concurrent app-started agents (0012).
5. Keep the milestone 1 process: contracts first, parallel builders, an integration step, independent reviews that run mutations and write exploit tests, then a fix step. Run `pnpm dev` with a visible window once per milestone, with the user present if the user wants to see it.
6. Record user hours per milestone next to agent wall time and tokens, so the next re-estimate has the limiting quantity.

### Questions for the user

- Default permission mode for sessions you start from the tree: manual (every tool call asks, as now), or your auto mode with ask rules and the app's hook (0012)? And should the app's own tools (`mcp__app__*`) be allowed without a prompt?
- Is the bearer token in the `claude` process arguments acceptable for a personal tool, or should the config move to a 0600 file?
- The smoke runs and a probe left folder-trust entries for temporary paths in your Claude config. Should they be removed (you run the removal), and should the app ask before launching in a directory Claude has not seen?
- Do you want to try the app with a visible window (`pnpm dev`) before milestone 2, and should the work so far be committed on `spike/stage2`?
- Milestone 2 order: browser surface and observation first (as 0002 and 0007 say), or task start first?
- With the re-estimate above, does the scope question of 0007 ("Total effort and scope") change, and are R20 (0015) and R21 (0016) in scope with weight 3?
- The 0012 rows still open: swarms on the subscription login, confirmation of 0009 to 0011, and whether the claude.ai login is an organization account with connector controls.
