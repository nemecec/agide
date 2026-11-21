# 0039 Milestone 4 results

Status: accepted
Date: 2026-11-21
Decided by: spike agents
Inputs: 0004, 0008 (R18), 0009, 0010, 0011, 0012, 0013, 0021, 0022, 0025, 0027, 0028, 0029, 0030, 0035, 0036, 0037, 0038; `notes/probes-m4-swarm.md`, `probes/RESULTS.md` (P30 to P37), `notes/swarm-orchestration.md`, `notes/swarm-visibility.md`; `docs/measurements/*.md`; `docs/parity.md`; the probe, design, contract, builder, integration, quality, review, verification and fix reports of the milestone 4 run (summarized here, not stored as files)

## Context

0030 closed milestone 3 and 0036 the restyle. The user set the order of the next work: R18 swarm orchestration, then R19, R21, notes (0034) and apps (0033). Milestone 4 is R18 alone. The frame comes from 0012 and 0025: swarms run on the user's subscription login, a configurable cap of 4 concurrent app-started agents applies, and the permission mode is selectable with auto as the default.

Milestone 4 ran in these steps:

1. Probes P30 to P37 of the `claude -p` stream-json path on Claude Code 2.1.330 (`notes/probes-m4-swarm.md`), with an independent review that re-ran part of them.
2. The design 0037, with an independent review that edited it.
3. Contracts and stubs (0038), with a review that added contract tests and moved the `system/init` mode check to the manager.
4. Builders in parallel: w-runtime (the stream-json runtime and `processCommand` in the providers), w-manager (the persistent manager, workspaces and the swarm module), w-ui (the dialog, the pane, the tree decorations and the approval card).
5. Integration, with real-Claude runs and read-only `claude -p` reviewers.
6. A test-quality step (unit tests, swarm mutations, thresholds).
7. Code reviews of the runtime and manager and of the renderer, and a verification from a clean copy.
8. A fix step, a review of the fixes, and a second fix step.
9. This record.

The steps were told not to commit, push or open pull requests. HEAD is still 46f7724, the last commit before the run, and the milestone 4 changes are uncommitted in the working tree.

None of the steps could start a sub-agent. The user's request that every piece of work is reviewed by another agent was met by separate review steps of the workflow and, in the integration step, by read-only `claude -p` reviewers. The second fix step had no independent review. This record was checked by a read-only `claude -p` reviewer (sonnet) against the sources; its findings (a missing measurement section, the source of the test counts, figures in prose) were applied. A cross-review step then checked the records against the code, the probe logs and its own runs of the test commands; what it changed is in `docs/measurements/cross-review.md` (milestone 4 section).

## Decision

### What milestone 4 built

| Part | Built | Shown by |
|---|---|---|
| Probes P30 to P37 | stream-json agent with `can_use_tool`, interrupt, control requests, resume, concurrency, budgets, worktrees, `--bare` | `probes/p30_*.mjs` to `p37_*.mjs`, `probes/p_swarm_lib.mjs`; reports and logs in `probes/out/` (not tracked) |
| Stream-json runtime (w-runtime) | `core/swarm/runtime`: `StreamAgentRuntime` launched through the session service and the isolation provider (`processCommand` in the local, srt, container and fake providers, the container with `-i` and without `-t`), the NDJSON reader with the 4 MiB line limit, normalization into `RuntimeEvent`, the control channel with the 20 s timeout, `can_use_tool` answers, `control_cancel_request`, interrupt, steering with `now`, resume, end, stop with escalation to the process group, usage, cost and rate-limit events; `HookItemMapper` skips permission items of stream-json sessions | `src/core/swarm/runtime` tests, the runtime contract suite over `fixtures/fake-claude-stream.mjs`; `scripts/e2e-real-swarm-runtime.mjs` |
| Manager (w-manager) | `core/swarm/manager`: validation that collects every problem, tiers with `maxTier`, run states, the cap with a queue (oldest swarm, then stage, then definition order), stages, the failure policies and one retry, the budget ledger with reservations, the review pot, the 80 percent alert, the swarm cap and the wall clock, approval items with the app timeout and supersession, the `system/init` mode check, quit, crash and restart, the SQLite tables; `core/swarm/workspace`: worktree, readonly and scratch workspaces, `inputs.md`, patch collection, merge previews; `main/modules/swarm.ts` with every `swarm_*` handler | `src/core/swarm/manager` and `workspace` tests, the manager contract suite; `e2e/swarmManager.spec.ts` |
| UI (w-ui) | the start dialog with Form and JSON tabs, templates and a preview; the `agide/swarm` pane with the Agents and Results tabs, the budget meter and the group controls; swarm folder and agent leaf decorations with the `queued`, `interrupted` and `stopped` chips; the swarm and agent menus; Allow and Deny on the inbox card | renderer swarm tests; `e2e/swarm.spec.ts`; the `swarm` phase of `pnpm visual-check` |
| Integration | `processCommand` required; swarm agents as app-started agent rows with the cost the CLI reports; usage from stream `assistant` messages; one cap for swarm agents and `task_start` sessions; scratch and inputs directories outside the app root | `e2e/swarmIntegration.spec.ts` with `e2e/fixtures/fake-claude-dispatch.mjs`; `scripts/e2e-real-swarm-mcp.mjs`, `scripts/e2e-real-swarm-dialog.mjs` |
| Test quality | `assertUser` and `countOtherLive` extracted; unit tests for caller views, live count, alerts, the fake script parser, the usage store, the swarm menu and the agents editor; swarm entries in `pnpm mutation`; thresholds for `src/core/swarm/**` and the swarm renderer folders | `pnpm mutation`: no survivor in the full run of the quality step and in the full run of the cross-review after the fixes |
| Fixes | the findings of the code reviews and of the fix review (below) | the tests added with each fix, each checked by reverting the fix |

### What each slice shows against R18

R18 (0008) asks that the user, or an agent through the app MCP server, starts a group of agents for a goal with a tier, a budget, steering and stopping per agent and per group, and isolated workspaces.

| Area | What is shown | What is not shown |
|---|---|---|
| Cap | `agents.maxConcurrentAppStarted` (default 4) counts live swarm agents of every swarm and live sessions that agents started with `task_start`. With the cap at 2 in `e2e/swarmIntegration.spec.ts`, the agent of a second swarm waits with reason `slot` until a slot frees; with the cap at 1 in the real MCP script, the second agent waited until the first ended. `task_start` reads the same setting and refuses at the cap. | The manager and `task_start` each check the count before the other has recorded its agent, so for a short time both can pass at the cap (needs one slot counter). The folder label counts swarm agents only. More than two real agents at once. |
| Queue | Ordered by swarm start, stage and definition position; an agent queued for longer than 5 minutes for a slot raises `swarm:cap:<swarm>`; a raised cap releases the queue at once (unit tests). | The alert in a real run. |
| Stages and failure policy | Stages and `dependsOn` gate starts; `continue`, `stop-dependents` and `stop-swarm`; one retry after 30 s for `exit`, `spawn` and `api_error` failures; a CLI that exits before its first output is `failed` with reason `spawn` and retried (unit tests, including the real session service with a scripted fake CLI). | Retries and dependents with real agents. |
| Steering | `swarm_send` queues a message until the turn's result, `now` interrupts first; `swarm_interrupt` pauses one agent or the group; `swarm_stop` stops one agent or the group (interrupt, close stdin, SIGTERM, SIGKILL, process group). The fake-CLI e2e stops a group with `swarm_stop`. A message to an agent that is being stopped is refused; group Resume continues a paused swarm only, and a stopped swarm continues agent by agent with a message. | Interrupt and resume with a real agent through the app (P31 and P33 showed both in the CLI). A process resumed after an app restart. |
| Budgets | A reservation per agent from the swarm total, passed as `--max-budget-usd`; the agent's own spend counts against its pot, also on a resume; estimates between results come from tokens and the price table, scaled per agent by the ratio of reported to estimated cost of its latest turn; the swarm stops at `usdTotal` and at the wall clock. In the real runs the ledger equalled the costs the CLI reported. | A real agent stopped at its budget through the app. The first turn of an agent has no ratio yet, so a long first turn is estimated with the unscaled table, whose Haiku row is about ten times the reported cost. The calibration is not kept across a restart. |
| Approvals from the inbox card | A `can_use_tool` request becomes an `approval` item with origin `swarm:can_use_tool`; only the UI answers it (`swarm_approval_answer` is not an MCP tool). The card shows the tool input in full above Deny and Allow, names the swarm and the agent, and says when the call is denied automatically. In the real dialog run, the writer agent's Write became a card and Allow on the card wrote the file. A request is denied after `swarm.approvalTimeoutMinutes` (default 60) and superseded by a `control_cancel_request`. | "Always" (built and hidden, since the command takes allow and deny only and `updatedPermissions` is not probed). "Edit and allow". Which calls reach `can_use_tool` in auto mode: in the real runs, auto-mode agents that used no tools raised none, and a Write in default mode raised one. The e2e deny test checks the inbox state, not what the agent received (the manager test checks the runtime message). |
| Worktrees | Worktree (a branch per agent from one base commit), readonly (detached, with Edit and Write deny rules) and scratch workspaces; patches collected with `git add -N` and `git diff --binary`, read and written as bytes; merge previews for later-stage reviewers with each applied patch committed; a forced removal only after the stored patch passes `git apply --check`. Every git call in an agent's directory runs with `--git-dir` and `--work-tree`, refuses a `.git` file that points elsewhere, switches off `core.fsmonitor`, `core.hooksPath` and `core.untrackedCache`, and reads no attributes of the worktree (`--attr-source` names the empty tree). Tested on temporary repositories. | Any real agent in a worktree or readonly workspace (both real scripts used scratch workspaces). `git apply --3way` on real swarm output. The "Remove swarm…" dialog: no `swarm_remove` command exists, so worktrees and scratch directories are not removed from the UI. |
| Tools | `swarm_start`, `swarm_list`, `swarm_status`, `swarm_send`, `swarm_interrupt`, `swarm_stop` and `swarm_results` are MCP tools; `swarm_start` is in the `app.agent_start` class, so a session's call asks the user. In the real MCP run the session found the tool through ToolSearch, the CLI showed "Rule mcp__app__swarm_start from command line arguments overrides auto mode", and the script accepted it. Sessions see swarms in their folder scope and steer the swarms they started; agents see their own swarm and cannot steer it. A swarm the user starts has depth 1, so with `maxSpawnDepth` 1 its agents cannot start swarms; `task_start` records a spawn depth, so a hop through a task does not reset it. For a session caller, agent-written strings in results and status are quoted lines or untrusted-data blocks. | A child swarm is not bounded by the connectors, tools and budget of the agent that starts it. The caller's mode comes from the session's launch mode. Native subagents of a swarm agent and the app MCP tools (P5 and docs only). |
| UI | Swarm folders with agent leaves and run-state chips, the cap label, the start dialog (both tabs round-trip, field errors after Start), the pane with the meter label "list-price equivalent, not billed", Pause, Resume and Stop, results with numstat and warnings; built from the 0035 components and tokens (`pnpm check:colours` passes). The visual check of the swarm screens found a faint meter track, a wrapping segmented control and an overflowing table, all fixed. | A visible window; narrow widths; light theme captures of the swarm screens. A swarm started by a session is not drawn under that session's leaf (needs `TreePane`). No keyboard shortcut for "New swarm…". No changed-files column in the Agents table. Tree menu actions report no failure. The swarm feed reloads every swarm every 3 s. "Open transcript" on an agent leaf is "Open swarm", since stream agents have no transcript command. |
| Usage | Each swarm agent is an app-started row whose cost is the one the CLI reports; its `assistant` messages feed the ranking; a resumed process adds to the cost of earlier processes from the ledger. A stream-json session is counted from its stream only, so its hooks and transcript do not count it again. | Usage totals of PTY sessions are not restored after a restart (`SqliteUsageStore.loadTotals` is never called; this predates the milestone). |
| Isolation | `processCommand` in every provider, required by the interface; a provider refusal reaches the caller as `spawn` with the provider's reason. | srt and container providers without a terminal were tested for the command shape only; no real agent ran under them. |

### What the probes and the build change in earlier records

None of these records is rewritten; the amendments apply when each is next revised.

0004:

| 0004 statement | Finding | Amendment |
|---|---|---|
| Decision 1: agents the app starts without a terminal use `-p` stream-json while it works with the subscription | Built for swarm agents: `StreamAgentRuntime` launches through the session service and the provider. P37 on 2.1.330: `-p` is still not bare by default and works with the subscription. Reviewers are not built (R19). | Settled for swarm agents. |
| Decision 2: `--session-id` chosen by the app | P33: `--session-id` on an existing id fails with "Session ID ... is already in use." and no events; `--resume <id>` continues after SIGKILL and from another directory; two live processes can hold one id. | `--session-id` for a new agent only, `--resume` afterwards, and one live process per session id held by the app. |
| Decision 2: `--permission-mode` set by the app; Details: the user setting is "the likely cause" of auto in `-p` | P37: a `defaultMode` in the user settings applies to `-p` runs without `--permission-mode` (auto on this login), so the docs' manual default does not hold here. `--permission-mode` accepts `manual`, and `system/init` reports it as `default`. | The user setting is the cause. Swarm agents pass the mode on every launch, `default` sent as `manual`. |
| Decision 3: one `PermissionRequest` hook implementation for both paths, `can_use_tool` where the richer payload helps | The base `PermissionRequest` hook also fires in `-p` (P1c), and its item cannot answer the call. For stream-json sessions `HookItemMapper` skips `PermissionRequest` and the `permission_prompt` notification; `can_use_tool` is the only approval source. P30: allow, deny and a changed `updatedInput` work; an unanswered request stayed pending for 60 s. | `can_use_tool` answers stream-json approvals; the hook stays for the PTY. |
| Context table, row "Interrupt" | P31: the `interrupt` request ends the turn in about 20 ms (`aborted_streaming` or `aborted_tools`) and cancels a pending `can_use_tool` with `control_cancel_request`; SIGINT ends the process; the docs say SIGTERM exits 143 without a result. | Stop is interrupt first, then the process. |
| Context table, row "Turn completion": partial messages with `--include-partial-messages` | Swarm agents do not pass it; the node shows the last tool and the result. | Not used for swarm agents. |
| Details: transcripts under `<cwd with / replaced by ->` | P33 review: every character other than a letter or digit becomes `-`. | Correct the rule. |
| "The expected `--bare` default" and the risk row | P37: `--bare -p` answers "Not logged in" with exit 1 on the subscription login; no opt-out flag is in `--help` of 2.1.330. The runtime records `apiKeySource` from `system/init`. | Never pass `--bare`; check for the opt-out on each CLI upgrade. |
| Risk: `--permission-prompt-tool` absent from `--help` | Still absent and still working in 2.1.330 (P30, the real runs). | Unchanged. |

0011:

| 0011 statement | Finding | Amendment |
|---|---|---|
| Section 2, Budget: `--max-budget-usd` and `--max-turns` per process | P35: `--max-turns` counts model turns per user message; `--max-budget-usd` is cumulative per process, checked after a response (the crossing response still streams), and the process stays alive and answers every later message with `error_max_budget_usd`. P33: a resumed process counts from zero. | The app reserves per agent, passes the reservation, ends the agent after an error result and subtracts earlier spend on resume. |
| Section 2, Stop: interrupt probed, the rest docs only | P31 with a pending approval and a running Bash call; P32: `stop_task` ends a background Bash task. `TaskStop` for native subagents is still docs only. | Record. |
| Section 2, Isolated workspace: docs only | P36: `git add -N .` and `git diff HEAD` (or `get_workspace_diff`) show new files; `git worktree remove --force` loses edits. Built as worktree, readonly and scratch workspaces with stored patches. | Settled for app worktrees; subagent `isolation: worktree` stays docs only. |
| Section 2, Approvals: probed in manual mode | Still manual only in the probes. In the real runs, auto-mode agents without tools raised no request. | Auto mode stays open. |
| Section 3: the YAML definition with `shared-readonly`, `merger` and an `--mcp-config` URL carrying the swarm and agent id | 0037 defines a JSON schema with `worktree`, `readonly` and `scratch`; `merger` waits with `swarm_merge`; each agent has its own session grant scoped to the swarm folder. | Replaced by 0037 section 1. |
| Section 3: a swarm under `bypassPermissions` is refused unless the policy allows it | Bypass is not in the schema; only the start dialog may ask for it, and the module sets no `bypassAllowed`, so every bypass start is refused. | Refused until a provider check is wired. |
| Section 3: tools `swarm_result`, `swarm_budget`, `swarm_merge`; start, stop and merge need the parent role | Built: `swarm_results`, budget inside `swarm_status`, `swarm_list` and `swarm_interrupt` added, `swarm_merge` not built; sessions steer the swarms they started, agents never steer their own swarm; spawn depth. | As in 0037 section 9 and 0038 "Changes after the review". |
| Section 4, tiers | `fable`/`high`, `sonnet`/`medium`, `haiku`/`low`; `fable` is in the `initialize` models list (P32). No real call ran on `fable` or `sonnet`. | Record. |
| Section 4: between results the app estimates from tokens and a price table | The Haiku row of `prices.json` is about ten times the cost the CLI reports for `claude-haiku-5-5` (integration). Estimates are scaled per agent by the latest reported-to-estimated ratio. | Calibrate estimates; correct the table. |
| Section 4: pause the group on a limit event | P34: `rate_limit_event` carries `status`, `rateLimitType`, `resetsAt` and the five-hour and seven-day `utilization`; only `allowed` was seen. The manager reads the fields defensively. | The pause is built against an unseen payload. |

0027:

| 0027 statement | Finding | Amendment |
|---|---|---|
| Section 5, Limit: a start at the cap is refused with an `alert` item | Swarm agents queue at the cap; the alert fires after 5 minutes in the queue. `task_start` still refuses, and now reads `agents.maxConcurrentAppStarted` and counts swarm agents. Swarm agents are recorded with `trackAppStarted`, which skips the check because the manager holds the slot. | Queue for swarm agents, one shared cap. |
| Section 5, Tree place: rendered under the caller | Swarm agents are leaves in the swarm's folder; a swarm started by a session is not drawn under that session's leaf. | Open (needs `TreePane`). |
| Section 5, Stop: close stdin, end the process after 5 s | Interrupt and wait up to 2 s, close stdin, wait 5 s, SIGTERM, SIGKILL, and the process group on every exit. | Use 0037 section 2.3 with the process group. |
| Section 5: a read-only transcript viewer for an app-started agent | No transcript command for stream agents; the leaf menu opens the swarm pane. | Open. |
| Section 1 and 7: the stream adapter feeds the agent store and usage | A stream-json session is read through the stream adapter only; its hooks and transcript no longer create agent records or usage. | Record. |
| Section 7: whether a new process after `--resume` starts from 0 is not probed | P33: the first `result` of a resumed process counts from zero. A swarm agent's cost is the sum of its processes' reported costs, kept in the ledger across a restart. | Settled for stream-json. |
| Section 7: the price table is checked against list prices when the slice is built | Not done; the Haiku row is about ten times the reported cost. | Open. |

0037 (status proposed; the build followed it except as listed):

| 0037 statement | Build or review finding | Amendment |
|---|---|---|
| Section 2.1: a `StreamSessionService` in `core/session` | The runtime reaches `PtySessionService` through a spawner slot (0038). | As 0038. |
| Section 3: `SwarmManager` in `core/swarm/SwarmManager.ts` | `PersistentSwarmManager` in `core/swarm/manager`. | Record. |
| Section 3.2: `beginAppStarted` becomes the one place that counts | The manager counts its live agents plus the live `task_start` sessions (`countOtherLive`); `task_start` counts app-started rows. A short window remains. | One slot counter for both is open. |
| Section 4.1: scratch under the swarm's data directory | The CLI refused the agent's writes there, because every launch denies Read and Edit on the app root. Scratch and inputs directories are at `<task base>/swarms/<swarm id>`; patches stay in the data directory. | Record. |
| Section 4.1: `GitWorkingDirectoryManager` gains a detached variant and a swarm branch name | The task-start worktree manager is unchanged; swarm workspaces use their own `Git` class in `core/swarm/workspace/git.ts`. | Record. |
| Section 4.3: `git -C <worktree>` collection | Runs with `--git-dir`, `--work-tree`, the command-setting overrides, `--attr-source` at the empty tree and fixed diff flags, reads bytes, and checks the patch before a forced removal. | As 0038 "Changes after the review". |
| Section 4.4: "Remove swarm…" Dialog | Not built; the contract has no `swarm_remove`. | Open. |
| Section 6: estimates from the price table | Scaled per agent (limits 0.05 and 4); the agent's own spend counts in its pot. | Record. |
| Section 7.1: bypass only from the dialog on a qualifying provider | `bypass: true` sets `bypassPermissions` over the definition's swarm mode; the dialog offers no bypass and `bypassAllowed` is not wired. | Open. |
| Section 6.2 and 6.3: the user raises a budget from the pane or an alert; alerts with actions | The alerts are posted with their action names in the payload. No command raises a budget and no button runs an alert action. | Open. |
| Section 7.2: "Always" and "Edit and allow" | "Always" built and hidden; "Edit and allow" not built; `editedInputs` is always false. | Open. |
| Section 7.2: the inspector record on the approval item; the same buttons on the agent's node | The payload field exists and nothing fills it; the buttons are on the inbox card only. | Open. |
| Section 8: Resume a group resumes every interrupted agent | Group Resume is for paused swarms; it skips agents that are ending as stopped or failed. | Record. |
| Section 9: spawn depth | A user-started swarm has depth 1; `task_start` records the depth (migration 2); a session below a plain user session keeps 0. | As 0038. |
| Section 10: `Cmd+Shift+S`, nesting under the caller's leaf, changed files in the Agents table, Open transcript, the plan windows in the pane header | Not built. | Open. |
| Section 14: one real script `scripts/real-swarm.mjs` with worktree agents, a readonly reviewer, an interrupt, a resume, "Always" and the auto-mode check | Separate scripts: `e2e-real-swarm-runtime.mjs`, `e2e-real-swarm-mcp.mjs`, `e2e-real-swarm-dialog.mjs`, all with scratch workspaces; none covers worktrees, interrupt, resume, "Always" or auto mode. | Open. |
| Section 2.4: after a crash, SIGTERM to a recorded pid | Sent to the process group of the pid, after the command-line check. | Record. |

### Review findings and what was fixed

The integration step's `claude -p` reviewers found that a stream-json session's usage was counted twice through its hooks and transcript, that a resumed process's cost replaced the earlier cost (also after a restart), that the transcript copy at exit was lost and that the cap was shared in one direction only; all fixed before the step ended. The code reviews, the verification and the fix review found the following.

| Finding | Severity | Status |
|---|---|---|
| A stop of one agent did not hold when a message reached it during the stop; the agent could end `done`, or `failed` and be retried | major | Fixed: a message to an agent ending as stopped or failed is refused. |
| A process silent past the start timeout that exited later was never reported, so its agent held a slot for ever | major | Fixed: `exited` for every process once `launch` returned. |
| A CLI that exited before any output was recorded as stopped by the user, with no retry | major | Fixed: `session.closed` ignored while the runtime closes a launching session itself; a close by the user still stops the agent. |
| Agents of a UI-started swarm had depth 0 and could start swarms | major | Fixed: depth 1. |
| Depth and `mayStartSwarms` could be bypassed through `task_start` | major | Fixed: `task_start` records the spawn depth. |
| The ledger left an agent's own spend out of its pot, so a resume could spend past the pot | major | Fixed. |
| Patches depended on the user's git configuration and were decoded as UTF-8 | major | Fixed: fixed diff flags, bytes, `git apply --check` before a forced removal. |
| An agent could make the app's git calls run a command on the host through the worktree's `.git` (fsmonitor; then, in the fix review, a filter driver with `.gitattributes`, and a git directory forged inside the worktree) | major | Fixed in the fix step and the second fix step: recorded git directory, refusal of a `.git` pointing elsewhere, command settings off, `--attr-source` at the empty tree. A worktree of an earlier run has no in-memory record; a forged git directory outside the worktree that the agent can write is still accepted there. |
| A stop during launch left an orphan process outside the cap | major | Fixed: the manager stops a process that starts after its agent ended. |
| Agent-written strings (commit subjects, paths, approval inputs) reached callers unwrapped; a path with a newline could write lines into `inputs.md` | major | Fixed: quoted lines and untrusted-data blocks. |
| Budget stops acted on estimates about ten times too high for Haiku | major | Fixed with the per-agent calibration (after the fix review: per agent, not per swarm). The first turn is still unscaled. |
| Group Resume on a stopped swarm did nothing | major | Fixed: Resume for paused swarms only; the banner says to message an agent. |
| The approval card showed only a 140-character summary next to a primary Allow | major | Fixed: input in full above the buttons. |
| The approval card's busy and error state carried over to the next item | major | Fixed: keyed by item. |
| Duplicate tree leaf for a resumed agent after a restart | minor | Fixed; tested after the fix review. |
| Bypass from the dialog was dead code | minor | Changed: bypass overrides the swarm mode; still refused, since `bypassAllowed` is not wired. |
| `recover` signalled the pid only, not its group | minor | Fixed; tested with a grandchild after the fix review. |
| `swarm_interrupt` could hang or fail after changing the state | minor | Fixed: bounded wait, state restored. |
| A group resume threw when one agent was being stopped | minor | Fixed (fix review). |
| A close by the user during an agent's start led to a retry | minor | Fixed (fix review). |
| The approval card did not name the swarm; Dismiss and Peek were misleading for swarm items; the tree showed contradictory tallies for a swarm agent | minor | Fixed. |
| Tests without behaviour (a smoke test, an "Always" test the schema rejects) | minor | Removed. |
| 0038 stale on `processCommand`, the depth source and script names | minor | Corrected. |
| A word from the style rules' banned list in a new comment and a measurement file | minor | Removed. |
| Field errors in the agents table of the start dialog had no text and no `aria-describedby` | minor | Fixed: a message next to the name and stage cells, named by the field. |
| The shared cap window; child swarms unbounded by their caller; tree menu failures not shown; agent rows of the dialog keyed by position; the swarm feed polls every 3 s | minor | Not fixed; recorded in 0038 and below. |

As in earlier milestones the reviews found defects that green suites did not, most of them at trust boundaries: the host's git calls on a directory the agent controls, agent text reaching another agent or a caller, and a stop or a budget that an agent's own message could undo. The fix review found that the first git fix was incomplete; the second fix step closed what it found.

### Tests and coverage

| Suite | Result |
|---|---|
| `pnpm typecheck` | passes (second fix step; again for this record and in the cross-review). Counts below come from the step reports of the workflow, which the measurement files do not all repeat, and from this record's own run. |
| `pnpm test` / `pnpm coverage` | 216 files, 2203 tests pass, 15 skipped (the srt and container suites: srt is not installed on this host now and the container test image is not local, so the suites that ran in milestone 3 did not run in milestone 4), thresholds met (second fix step; the same for this record and in both runs of the cross-review). Before the fixes: 211 files, 2161 tests (quality step, three verification runs). |
| `pnpm e2e` | 79 tests pass with hidden windows (integration, quality, verification twice, both fix steps, the fix review, the cross-review). |
| `pnpm coverage:e2e` | 79 pass (quality step); not run after the fixes. |
| `pnpm mutation` | full run in the quality step: no survivor after one stale anchor was repaired. The fix steps did not run it and checked each fix by reverting it. After the fixes the list had two entries whose source text the fixes had changed (the launch that ends before its first line, the working directory in a status), so the script would have skipped them and ended with exit code 1. The cross-review repaired both entries and ran the whole list: every mutation killed, none survived, none skipped, about 15 minutes. |
| `pnpm parity` | ok; `swarm_approval_answer` is the exempt command (`agents never answer approvals`). |
| `pnpm check:colours` | no colour literal outside the allowlist. |
| Real-Claude scripts (Haiku, 0.25 USD cap per process, claude 2.1.330) | `e2e-real-swarm-runtime.mjs` (about 0.001 USD), `e2e-real-swarm-mcp.mjs` (agents 0.0077 USD plus the session), `e2e-real-swarm-dialog.mjs` (0.0082 USD) pass in the integration step and in the verification; the verification also passed `smoke-real-claude.mjs`, `e2e-claude-mcp.mjs`, `e2e-real-claude.mjs`, `e2e-real-claude-inbox.mjs`, `e2e-real-claude-m3.mjs` and `real-claude-gate.mjs`. The fix steps ran none of them. The cross-review ran the three swarm scripts after the fixes and all pass: runtime 0.0010 USD, MCP 0.0103 USD for the agents (the second agent started when the first had ended, with the cap at 1), dialog 0.0082 USD (Allow on the card wrote the file). The other scripts were not run after the fixes. |

Unit coverage from the run made for this record (`pnpm coverage`, 2203 tests; computed per area from `coverage/coverage-summary.json`):

| Area | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/core` | 94.0 | 85.2 | 94.6 | 96.8 |
| `src/core/swarm` | 95.9 | 90.0 | 94.3 | 98.6 |
| `src/core/swarm/runtime` | 96.1 | 91.6 | 92.8 | 99.1 |
| `src/core/swarm/manager` | 95.9 | 90.0 | 94.8 | 98.3 |
| `src/core/swarm/workspace` | 93.9 | 81.9 | 92.2 | 98.8 |
| `src/core/agents` | 93.4 | 82.9 | 95.5 | 96.3 |
| `src/core/tasks` | 96.4 | 85.5 | 95.5 | 96.8 |
| `src/core/isolation` | 96.1 | 82.2 | 97.1 | 99.1 |
| `src/main` | 79.6 | 66.2 to 66.5 | 78.3 | 83.2 |
| `src/main/modules` | 83.0 | 67.7 to 68.1 | 82.0 | 86.1 |
| `src/renderer/panes/swarm` | 98.0 | 93.2 | 95.2 | 98.2 |
| `src/renderer/dialogs/swarm` | 98.0 | 92.5 | 96.6 | 98.1 |
| `src/renderer/ui` | 98.2 | 92.3 | 98.6 | 99.3 |
| all `src/renderer` files | 77.6 | 73.1 | 77.6 | 77.7 |
| all files | 89.6 | 81.3 | 88.8 | 92.0 |

End-to-end coverage (quality step, before the fixes; functions / branches / lines): main `src/core` 72.0 / 47.8 / 72.8, main `src/main` 71.9 / 62.3 / 81.3, renderer `src/renderer` 76.4 / 70.8 / 85.4.

The branch figures of `src/main` and `src/main/modules` differ between runs of the same tree: the lower values are from the run made for this record, the higher ones from both runs of the cross-review. Every other cell was the same in all three runs.

Gaps: the wiring in `src/main/modules/swarm.ts` (leaf creation on start, the runtime subscription) is reached by the end-to-end tests only; srt and container `processCommand` are tested for their command shape only; the `src/main/modules` branch threshold (67) has a margin of about one point at most, on a figure that moves between runs.

CLI version: every probe, real script and real run of milestone 4 used 2.1.330. The records before 0037 hold for 2.1.326 and 2.1.327.

### Measured effort

Wall times as recorded with `date -u` in `docs/measurements/`. Token spend is not recorded by the agents; the column stays empty until the totals of the workflow notification are added. User hours are not measured.

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time | Tokens |
|---|---|---|---|---|---|
| Probes P30 to P37 | `p-swarm.md` | 06:24:13 | 06:35 | about 11 min | to be added |
| Review of the probes | `review-swarm-probes.md` | 06:35:15 | 06:41 | about 6 min | to be added |
| Design 0037 | `d-swarm.md` | 06:41:02 | 06:49:01 | about 8 min | to be added |
| Review of 0037 | `review-swarm-design.md` | 06:49:37 | 06:59 | about 9 min | to be added |
| Contracts and stubs (0038) | `contracts.md` (milestone 4 section) | 06:58:42 | 07:25:16 | about 27 min | to be added |
| Review of the contracts | `review-m4-contracts.md` | 07:26 | 07:38 | about 12 min | to be added |
| Stream-json runtime | `w-runtime.md` | 07:38 | 08:02 | about 24 min | to be added |
| Manager, workspaces, module | `w-manager.md` | 07:38:48 | 08:15:07 | about 36 min | to be added |
| Swarm UI | `w-ui.md` | 05:38 as recorded (the builders started at 07:38) | 08:02 | about 24 min from 07:38 | to be added |
| Integration | `integrate.md` (milestone 4 section) | 08:15:50 | 08:44:00 | about 28 min | to be added |
| Test quality | `w-quality.md` (swarm section) | 08:44:58 | 09:22:30 | about 38 min | to be added |
| Review: runtime, manager, module | `review-swarm-runtime.md` | 09:22:29 | 09:34:00 | about 12 min | to be added |
| Review: renderer and e2e | `review-swarm-ui.md` | 09:22:30 | 09:29:46 | about 7 min | to be added |
| Verification from a clean copy | none (times from its report) | 09:22 | 09:33 | about 11 min | to be added |
| Fixes | `fix-m4-review.md` | 09:35:16 | 09:57 | about 22 min | to be added |
| Review of the fixes | `review-fix-m4.md` | 09:57:28 | 10:05 | about 8 min | to be added |
| Second fixes | `fix-2.md` | 10:06 | 10:14 | about 8 min | to be added |
| This record | `record.md` (milestone 4 section) | 10:14:29 | 10:24:31 | about 10 min | to be added |
| Cross-review of the records | `cross-review.md` (milestone 4 section) | 10:25:11 | 10:52 | about 27 min | to be added |

| Total | Minutes |
|---|---|
| First probe to the end of the second fix step, elapsed (06:24 to 10:14) | about 230 |
| Agent wall times summed over the same steps | about 291 |
| of which probes, design and their reviews | about 34 |
| of which contracts, builders, integration, quality, reviews, verification and fixes | about 257 |
| Build steps, elapsed (06:58 to 10:14) | about 196 |
| Code reviews, verification, fixes and fix review, summed (milestone 3: about 72) | about 68 |
| Contracts, integration, quality, code reviews, verification and fixes, summed, without the review of the contracts (milestone 3: about 147) | about 161 |

Real-Claude spend as the CLI reported it (list-price equivalents under the subscription, not bills):

| Use | USD |
|---|---|
| Probes and their review | a few cents |
| Integration real runs and a raw stream probe | about 0.04 |
| Integration reviewers (opus, read-only) | about 2.33 |
| Verification real scripts | a few cents |
| Reviewer of this record (sonnet, read-only) | about 0.36 |
| Cross-review: the three swarm scripts | about 0.02 for the agents, plus the session of the MCP script |

The reviewer runs of the integration step and of this record are outside the run's rule for real-Claude calls (Haiku, 0.25 USD per call, a few cents in total): they used opus and sonnet with `--max-budget-usd` between 1.5 and 3. The steps chose them because no step could start a reviewing sub-agent.

What took long, from the measurement files: the stop path with the process group and the order of the last stdout lines against the exit (runtime); the in-memory runtime ending inside the `result` event before the budget check, and a merge preview whose failed `git apply --3way` reset the earlier patches (manager); the fake backend for the e2e test, which was dropped once the manager landed (UI); the real run that found the denied scratch directory, and the review rounds on the usage path (integration); the full mutation run, which edits sources in place for about ten minutes (quality); a database check that hid a launch error (fixes); a stop that runs during a group resume (second fixes).

### Re-estimate

0037 estimated its first slice at 9 to 12 days and 0011 put R18 at 14 days with merge excluded (0005 units: working days for one engineer plus agents). Judged share built: about 8 days. Missing from the slice are the removal dialog, "Always", the real worktree and auto-mode runs and a few UI items. The judgement is this step's; no measurement gives it.

| Basis | Agent minutes | Minutes per estimated day |
|---|---|---|
| Build steps (contracts to second fixes), summed | about 257 | about 32 |
| Build steps, elapsed (06:58 to 10:14) | about 196 | about 25 |
| All steps including probes and design, summed | about 291 | about 36 |
| Milestone 3 for comparison (0030), summed build / all | about 380 / 528 | about 14.6 / 20.3 |

Milestone 4 took about twice the agent time per estimated day of milestone 3. Reasons visible in the reports: the steps that every milestone runs once (contracts, integration, quality, code reviews, verification, fixes) took about a tenth longer than in milestone 3 (see the totals above), but they are spread over one requirement instead of several; one requirement split by layer made the builders depend on each other's files while they changed (w-ui built and then removed a fake backend, w-manager reformatted the contract files once, and full test runs failed on other builders' work in progress); and the integration found a defect no fake could show (the denied scratch directory).

| Judged days built | Build minutes per estimated day |
|---|---|
| 6 | about 43 |
| 8 | about 32 |
| 10 | about 26 |

| Projection (remaining 0005 days after 0030, minus milestone 4, without the restyle R25 of 0036) | Value |
|---|---|
| Remaining estimated days | about 150 to 180 |
| Summed agent hours at the milestone 4 build rate | about 80 to 96 |
| Summed agent hours at the milestone 3 build rate | about 37 to 44 |

The projection is an extrapolation and leaves out user hours.

### What remains open

| Item | Where |
|---|---|
| `swarm_remove` and the "Remove swarm…" dialog; worktrees and `~/Agide/swarms/<swarm id>` directories stay until then | swarm |
| "Always" (needs a real check of `updatedPermissions`), "Edit and allow", `editedInputs` | swarm, 0028 |
| Real runs with worktree and readonly agents, an interrupt and a resume through the app, auto-mode approvals, a resumed agent after an app restart, a real `rate_limit_event` other than `allowed`, `fable` and `sonnet` tiers | real-Claude scripts |
| One slot counter for the manager and `task_start`; the folder cap label counts swarm agents only | swarm, tasks |
| Child swarms bounded by the caller's connectors, tools and budget | swarm |
| First-turn estimates uncalibrated; calibration not kept across a restart; the Haiku row of `prices.json` about ten times the reported cost; usage totals of PTY sessions not restored after a restart | usage |
| A forged git directory outside the worktree for worktrees of an earlier run | swarm workspace |
| Bypass from the dialog (provider check, `bypassAllowed`) | swarm, permissions |
| UI: nesting under the caller's leaf, a shortcut, a changed-files column, failure notices for tree menu actions, stable row keys in the agents editor, the 3 s polling, a transcript view for stream agents, the plan windows in the pane header, the approval buttons on the agent's node, a visible-window check | renderer |
| Raising a budget: no command changes a swarm's or an agent's budget, and the swarm alerts carry their actions (raise budget, raise and resume, pause, resume, leave) in the payload with no button that runs them | swarm, inbox |
| The inspector record (class, mode, audience) on swarm approval items: the payload has the field and nothing fills it | swarm, permissions |
| srt and container `processCommand` executed with a real agent | isolation |
| `pnpm coverage:e2e` and the real-Claude scripts of the earlier milestones after the fix steps (the cross-review ran `pnpm mutation` and the three swarm scripts) | tests |
| The srt and container suites did not run in milestone 4: srt is not installed on the host now and the container test image is not local | tests, isolation |
| 0037 has status `proposed` | user |
| `docs/measurements/w-ui.md` of the restyle (0036 step 2) was overwritten by the swarm UI step; `git show HEAD:docs/measurements/w-ui.md` holds it | measurements |
| Token spend per step and user hours | measurements |
| Leftovers the agents could not remove (removal was denied): `/tmp/rev-fix-m4` (about 613 MB, an app copy with `node_modules`), `/tmp/rev-app`, `/tmp/rev-scripts`, `/tmp/rev-swarm-ui` (logs and screenshots), `/tmp/rev-typecheck.log`, `/tmp/rev-coverage.log`, `/tmp/rv38` with its logs, `/tmp/agide-w-ui-*` screenshot directories; the probe step deleted `probes/__pycache__`, which it had not created (it regenerates) | user |
| An Electron process of the app that Playwright started at 23:01 UTC on 2026-11-20, before milestone 4, still runs without a parent (found by the cross-review; not ended, since no milestone 4 step started it) | user |

## Consequences

### Recommendations for milestone 5

Keep the milestone 4 process, with these changes: give every step a way to start a reviewing sub-agent, so the review sits inside the step that made the work; split builders by feature when a single requirement is built, so builders do not edit each other's files while they change; run the real-Claude scripts and `pnpm mutation` again after the last fix step.

1. R19, the layered review ladder (0010): changeset capture at turn end, rung A checks, a rung B reviewer through `report_review` as a stream-json agent on the swarm runtime, review items in the inbox, the project policy file read from the base commit. It reuses the swarm's readonly workspaces, merge previews, tiers and the review pot, and it unblocks `swarm_merge`.
2. R21 (0016, 0021): a tasks pane, `inbox_ask` (with P16, the MCP call wait), and the reminder parts of 0021 that are not built; the `http` hook transport of 0030 recommendation 1 belongs here, since approvals of hook requests from the card and a mode source the agent cannot write both wait on it.
3. Notes and live read-only mounts (0034).
4. Apps (0033): GitHub, Jira, Slack, Notion and Google sources with routing.
5. Carried from milestone 4, before or beside R19: `swarm_remove` with its dialog, the real worktree and auto-mode script, the "Always" check, one slot counter, the price table, and the open UI items above.
6. Record user hours and tokens per step next to wall time.

### Questions for the user

- 0037 is `proposed`. Do you confirm it with the amendments above, in particular the queue at the cap for swarm agents (where 0027 refuses) and the default spawn depth of 1?
- The default approval timeout and the default wall clock are both 60 minutes, and the wall clock runs while an agent waits for approval, so an unanswered approval can stop the swarm first. Change either default?
- Should a swarm whose agents ended `done` and `stopped` count as `done` or `stopped`?
- The Haiku row of the price table is about ten times what the CLI reports. May a step update `prices.json` from the CLI's reported costs, or only from the published list prices?
- A child swarm is bounded only by your approval of its `swarm_start` call. Should it also be limited to the connectors, tools and budget of the agent that starts it?
- May the real-Claude scripts use `sonnet` or `fable` for one short call each, so the tiers are checked beyond Haiku?
- Plan limits: is a run with more parallel agents than P34 used, or with mid and strong tiers, acceptable on your subscription, to see a `rate_limit_event` other than `allowed`?
- The leftovers above, including the 613 MB app copy in `/tmp/rev-fix-m4`, need your removal. Which should go?
- Should the swarm UI step's overwrite of the restyle's `docs/measurements/w-ui.md` be undone from git, with the swarm record moved to a new file?
- Order after R19: R21, notes, apps as decided. Should the milestone 4 carry-overs (item 5) come before R19?
