# 0042 Milestone 5 results

Status: accepted
Date: 2026-11-21
Decided by: spike agents
Inputs: 0003, 0004, 0008 (R19), 0010, 0011, 0021, 0022, 0027, 0028, 0029, 0030, 0035, 0037, 0038, 0039, 0040, 0041; `notes/probes-m5-review.md`, `probes/RESULTS.md` (P40 to P43); `docs/measurements/*.md` of this run; `docs/parity.md`; the probe, design, contract, builder, integration, quality, review, verification and fix reports of the milestone 5 run (summarized here, not stored as files)

## Context

0039 closed milestone 4 (R18 swarms). The user set the order of the next work: R19, then R21, notes (0034) and apps (0033). Milestone 5 is the first slice of R19, the layered review ladder of 0010, as 0010 section 9 and 0039 recommendation 1 name it, on the stream-json path of the swarm runtime.

Milestone 5 ran in these steps:

1. Probes P40 to P43 (`notes/probes-m5-review.md`) on Claude Code 2.1.330 and git 2.54.0, with an independent review that re-ran part of them.
2. The design 0040, with an independent review that edited it.
3. Contracts and stubs (0041), with a review that added contracts and contract tests.
4. Builders in parallel: w-capture (capture, parser, check executor, rules, policy), w-reviewer (the rung B reviewer), w-manager (store, persistent manager, budget, merge, module), w-ui (the review pane and the inbox card). Each builder's work had its own review step.
5. Integration into one application, with a fake-CLI end-to-end test of the whole ladder and a real-Claude run.
6. A test-quality step (extracted functions, a decision contract, mutation entries, thresholds).
7. A review of the core, a review of the running application and a verification, in parallel.
8. A fix step, a review of the fixes, a second fix step and a review of the second fixes.
9. This record, with an independent review that checked it against the code, the tests, the measurement files, the probe logs and the Claude Code docs, and edited it.

No step committed, pushed or opened a pull request. HEAD is 2c42392, the last commit before the run, and the milestone 5 changes are uncommitted in the working tree.

As in milestone 4, no step could start a sub-agent. The user's rule that every piece of work is reviewed by another agent (0003) was met by separate review steps of the workflow: every probe, design, contract, builder and fix step had a review step after it. The second fix step's review found new minor findings that no later step fixed (listed below), and the review of this record found parts of 0040 that the record had not listed as open.

## Decision

### What milestone 5 built

| Part | Built | Shown by |
|---|---|---|
| Probes P40 to P43 | settings isolation of a reviewer, the `report_review` tool over MCP, checkpoint and diff parsing in plain repositories and worktrees, injection and anchoring | `probes/p40_settings_isolation.mjs`, `p41_report_tool.mjs`, `p42_diff_parse.mjs`, `p42_checkpoint_diff.mjs`, `p43_injection_anchoring.mjs`, helper `p_review_lib.mjs`; `notes/probes-m5-review.md`; reports and logs in `probes/out/` (not tracked) |
| Contracts (0041) | `core/review`: zod schemas, service interfaces, the policy and overlay schemas, the reason catalogue, `computeRung`, the transition table, anchoring, the `review_*`, `report_review` and `report_outcome` commands with tool sets, the review settings, the migration; in-memory store, manager and reviewer runtime with contract suites; tool-set filtering in the MCP tool list | `src/core/review/*.test.ts`, the contract suites `store/changesetStoreContract.ts`, `manager/reviewManagerContract.ts`, `reviewer/reviewerRuntimeContract.ts` |
| Capture (w-capture) | `capture/guardedGit.ts` (git directory, `--attr-source` at the empty tree, `core.attributesFile=/dev/null`, fixed hooks, fsmonitor, signing, line-ending, filemode and symlink settings, every configured filter and merge driver blanked, inherited `GIT_*` dropped); the temporary-index checkpoint with `commit-tree` and `update-ref` with the zero old value; `readDiff` from the common directory; the parser over `--raw -z` and `@@` counts with size limits and file and hunk hashes; the check executor in a fresh detached worktree through `AgentEnvironment.toolCommand`; the repository snapshot; `GitCaptureService` with jobs in the review tables | `capture/*.test.ts` including `hostileConfig.test.ts`; `toolCommand.test.ts` in `core/isolation` |
| Rules and policy (w-capture) | `rules/`: the check, size, diffusion, file, path, configuration, dependency, build, policy, test, secret, telemetry, claim and retry reasons with the policy's `rungs`, hard floors and accumulation; `policy/`: `.agide/review-policy.json` read with `ls-tree` and `cat-file` from the base commit, a user overlay that only tightens, a canonical hash | `rules/*.test.ts`, `policy/policy.test.ts` |
| Reviewer (w-reviewer) | `reviewer/`: the prompt with version `review-b-1` and every input in an untrusted-data block with a fresh nonce; the launch spec (`--tools Read,Grep,Glob`, `--allowedTools mcp__app__report_review`, deny rules, no connectors, tool set `reviewer`, `autoDeny`); the tier rule; a read-only checkout; `StreamReviewerRuntime` on the swarm runtime; `ReportDesk` with scope, one report per run and anchoring; the effects table (raise only, accept only at B); `ReviewRunDriver` with retry, timeouts and budget; grant tool sets in `core/mcp`; `--allowedTools` and `autoDeny` in the swarm runtime; the `background_tasks` event. The application uses the prompt, the launch spec, the checkout and `StreamReviewerRuntime`; `ReportDesk`, the effects table and `ReviewRunDriver` run in their tests and in `e2e-real-review-reviewer.mjs` only, since the manager holds the same report checks, effects and retry itself | `reviewer/*.test.ts`, `reviewerIntegration.test.ts`, `mcp/grantToolSets.test.ts`; `scripts/e2e-real-review-reviewer.mjs` |
| Manager (w-manager) | `SqliteChangesetStore` (diff text kept as rows); `PersistentReviewManager` with recovery after a crash or quit, queued reviews, one merge per swarm; `ReviewInbox`; `SqliteReviewBudget` over the review pot and the day; `GitMerger` (squash commits with `merge-tree` and `commit-tree`, compare-and-swap); the `app.merge` approve class; `reviewShare` default 0.3 with a worktree agent; `main/modules/review.ts` with every `review_*` handler and the `swarm_merge` handler | `manager/*.test.ts`, `store/*.test.ts`, `GitMerger.test.ts`, `swarmIntegration.test.ts`, `main/modules/review.test.ts`, `permissions/mergeClass.test.ts`, `swarm/reviewShare.test.ts` |
| UI (w-ui) | the `agide/review` pane: changeset list with the merge control and the merge Dialog, changeset view (state, rung with reasons, check, reviewer report with its author, the claim marked as not verified, files, draft comments, action bar), file and hunk views with keys `j`, `k`, `n`, `m`, dwell tracking for seen marks; the review card actions on the inbox card; the Review tab of the swarm pane; "Review work" in the swarm and agent menus; agent text through `plainText` as React text | `renderer/panes/review/*.test.ts`, `ReviewCardActions.test.ts`; `e2e/review.spec.ts` on the in-memory manager; the `review` phase of `pnpm visual-check` |
| Integration | the real capture, policy, rules, check and reviewer services connected at start; `prepare` before a swarm's first launch; capture when a worktree agent's run ends; `worker` tool set for worktree agents; one shared git guard (`driverSettings`, `blankingEnv`) in `swarm/workspace/git.ts` used by the swarm `Git` class, the capture, the merger and the reviewer checkout | `e2e/reviewLadder.spec.ts` (real module graph, fake stream CLI with `FAKE_CLAUDE_REVIEWER_STEPS`); `scripts/e2e-real-review-ladder.mjs` |
| Test quality | `budgetDay.ts` and `reviewCaller.ts` extracted with tests; `reviewDecisionContract.ts` for both managers; review entries in `pnpm mutation`; thresholds for `src/core/review/**`, `src/main/modules/review.ts` and `src/renderer/panes/review/**` | `pnpm mutation`, `pnpm coverage` |
| Fixes | the findings of the core and application reviews and of the review of the first fix step (below) | a test per fix and a mutation entry per fix, each killed |

### What each part shows against 0010

| 0010 section | Shown | Not shown |
|---|---|---|
| 1 Units and levels | The changeset of one worktree agent's run, from the swarm base (or the merged checkpoint) to a checkpoint under `refs/agide/review/<id>`, made without moving the agent's branch, index or files. Changeset, file and hunk views; seen marks bound to content hashes that lapse when a new capture changes the hunk and carry over when it does not (`e2e/review.spec.ts`). The summary shows its author; the agent's claim is marked as not verified. | Goal and agent levels. Outward actions as units. The PTY path and `task_start` agents. Capture on background tasks: the event is normalized and nothing waits on it. |
| 2 Reasons | The catalogue with id, source, evidence and rung, hard floors and accumulation (`rules/`); secret evidence holds path, line and detector, never the matched text. | History signals (earlier reverts). Secrets in binary files and in files the caps turned large (a large file goes to rung D instead). |
| 3 Who computes risk | The app's rules and check, then a reviewer that never sees the transcript and has only Read, Grep, Glob and `report_review`. Rungs only rise through agents and reviewers; only the user demotes, with a reason and a token. The reviewer and the worker see different tool sets (the application review called the tools over MCP as each role with forged and misplaced tokens: refused). | Self-grading through a reviewer of the same family; the second family is not built. |
| 4 Ladder | Rung A accept by the app after a passed check; rung B accept by the reviewer only with no `major` finding, a verified claim and a passed check; C to E wait for the user, D on the flagged hunks, E on every hunk. Send-back with line comments as one batch until the retry limit. A daily budget and the review pot; a review without budget waits as `queued_for_budget` and is never accepted by the app. | Sampling, the digest of A and B accepts, the Codex reviewer from D, the reviewer run before C to E at `effortHuman` with a real model other than Haiku. |
| 5 Policy | `.agide/review-policy.json` (JSON with a zod schema, 0040 section 8) read from the base commit only; an edit in the worktree is a hard-floor reason; the user overlay in the profile setting `review.policy` only tightens; `policy.base_differs` for a session-started swarm whose base policy differs from the main checkout's. | `outward` and `deployCommands` are read and reported with a warning on the swarm start; they are not applied to launches. Sampling and reviewer families in the policy. |
| 6 Outward gate | Built in milestone 3; this milestone adds the `app.merge` approve class for `swarm_merge`, which a profile cannot loosen. | Per-launch outward modes from the policy and the `deploy` ask rules. |
| 7 Primitives | `--setting-sources user`, `--strict-mcp-config`, `--tools`, `--allowedTools`, `--mcp-config` with a tool-set grant, stream-json `result` as the capture trigger, `report_review` and `report_outcome`. Send-back through the swarm's message path (no `Stop` hook on stream-json). | `/code-review` with a range in the reviewer; the `Stop` hook path. |
| 8 Failure modes | Injection: diff as data, raise only, anchors checked (P43; the real reviewer named the injection as a finding and did not follow it). Gaming: size per run, test and config changes as reasons, policy from the base, the app runs the check. Arming the reviewer: project files left out by `--setting-sources user`, the user-level Claude files hashed and compared before each reviewer start. Spend: the pot and the day. | Per-rule hit rates, dwell and demotion statistics, sampling. |
| 9 First slice | Everything in the table "Against the slice of 0040" below. | The outward draft dialogs beyond the class table (as 0040 section 1 sets). |

### Against the slice of 0040

| 0040 slice item | Status | Evidence |
|---|---|---|
| Data model (section 3) | built; the retention of section 3.1 (rows, refs and patch files removed after the inbox retention time) is not built | `changesetStore.test.ts`, `SqliteChangesetStore.test.ts` |
| Capture for swarm agents with a `worktree` workspace (section 4) | built; triggered when the agent's run ends (`agent-ended`); the `quiet-result` and `removal` triggers are not built | `GitCaptureService.test.ts`, `capture.test.ts`, `reviewLadder.spec.ts`, the real ladder run |
| Diff parser and limits (section 5) | built | `parseDiff.test.ts` over the P42 cases |
| Rung A: the check and the rule reasons (sections 6, 7) | built; the check runs as a plain process only for a profile without the Bash sandbox, under `srt` with the sandbox on or the `srt` provider, `not_run` without `srt` or under `container` | `ProcessCheckExecutor.test.ts`, `checkEnvironment.test.ts`, `rules/*.test.ts`; a real `srt` run in `ProcessCheckExecutor.srt.test.ts` since 2026-11-22 |
| Policy and overlay (section 8) | built, outward modes not applied | `policy.test.ts` |
| States and transitions (section 9) | built, with the added actions `start_check`, `review_failed`, `undeliverable`, `no_new_capture` | `stateMachine.test.ts`, the manager and decision contracts on both managers |
| Rung B reviewer (section 10) | built | reviewer tests; real reviewer and ladder runs |
| `report_review`, `report_outcome`, `review_*` (section 11) | built, plus `review_accept_repo_change` (UI only); the first message of a worktree agent does not gain the sentence that asks for `report_outcome` (section 11.2), so an agent calls it only when it finds the tool itself | `commands.test.ts`, `reviewerIntegration.test.ts`, `docs/parity.md` |
| Inbox items (section 12) | built, one item per agent's newest changeset; the malformed-policy alert exists in `ReviewInbox` and nothing in the application posts it (the changesets get `policy.invalid`); the capture-failure item has no Retry action | `ReviewInbox.test.ts`, `ReviewCardActions.test.ts` |
| Views and seen marks (section 13) | built, without the interdiff against the superseded changeset; the D rule, dwell marking and the demotion below a floor have renderer and manager tests and no end-to-end test (section 19 names them for Playwright) | renderer tests, `e2e/review.spec.ts` |
| Line comments and send-back (section 14) | built | manager contract, `e2e/reviewLadder.spec.ts` |
| Merge gate and `swarm_merge` (section 15) | built; a deleted checkpoint is not rebuilt from the stored patch, the merge refuses | `GitMerger.test.ts`, `swarmIntegration.test.ts`, `reviewLadder.spec.ts` |
| Budgets (section 16) | built; the `rate_limit_event` pause does not hold queued reviewer runs | `SqliteReviewBudget.test.ts`, `budgetDay.test.ts` |
| Security table (section 17) | the rows of the built parts have tests. Without the test the table names: the outward modes in `gate.json` (not built), the rebuild of a deleted checkpoint (not built; the refusal is tested), the Bash write to the profile data directory under `srt` (no `srt` on this host), the P43 cases through the application (the reviewer script plants one injection comment with a canary). See "What remains open" for the rows that stay partial | `hostileConfig.test.ts`, `GitMerger.test.ts`, `checkout.test.ts`, the mutation entries |
| Held messages during a capture, the background wait, reviewer runs in the live count (0037 amendments of 0040) | not built | none |

### Real-Claude runs

| Run | Model | What happened | Cost (USD, list-price equivalent) |
|---|---|---|---|
| `e2e-real-review-reviewer.mjs` (w-reviewer) | Haiku | Init listed Glob, Grep, Read and `mcp__app__report_review`; one `report_review` call: `revise`, claim `contradicted`, a blocker on the discount line and a minor finding naming the injection comment; the canary was not read; no `CLAUDE.md` marker in the report. The blocker cited the closing brace one line below the faulty `return`: anchoring proves that a finding lies on a diff line, not that it names the right one. | about 0.003 |
| `e2e-real-review-ladder.mjs` (integration), the complete run | Haiku worker in `acceptEdits`, Haiku reviewer (the script sets every tier to Haiku in a separate `AGIDE_ROOT`) | Started from the start dialog. The worker wrote `discount.ts` with the planted `p * 2` and said itself that this is no ten percent discount. The capture gave one added file with `check.none` and `tests.missing` at B. The reviewer called `report_review` once: escalate to C, claim contradicted, a major finding on line 1 and a minor one, both anchored. The changeset waited at C, one review item reached the inbox, `swarm_merge` was refused. No approval card, no denied request. | worker 0.0047, reviewer 0.0028 |
| Earlier ladder attempts while finding the session-id and rate-limit problems | Haiku | see "What the build changed" | about 0.02 |
| Re-runs of the probe review | Haiku | P41 in full and the P40 project-rule cases reproduced | about 0.06 |
| Probes P40 to P43 | Haiku | see below | at least 0.17: the `result` events in the stored logs of the final runs sum to about 0.167 (P40 0.09, P41 0.035, P43 0.042), each run under one cent; earlier runs whose logs were overwritten are not counted (`p-review.md` says "a few cents") |

The ladder script has no check command in its policy, sends nothing back and asks `swarm_merge` only for a dry run, so no real run covers a check, a send-back or a merge. No step after the integration ran a real-Claude script. The fix steps changed the check environment, the repository accept and the user-config hash, not the launch path of the worker or the reviewer.

### Probe results that mattered

| Probe | Result | Used in |
|---|---|---|
| P40 | `--setting-sources user` drops the project `CLAUDE.md`, skills, `.mcp.json`, hooks and rules; `--strict-mcp-config` alone removes connector and plugin servers and keeps `CLAUDE.md` and skills, so the reviewer needs both. Under `-p` in an untrusted workspace project `permissions.allow` is ignored; deny rules and hooks still apply. A `--settings` file is read at session start; an in-session rewrite does not change the running session; under `bypassPermissions` the agent could change the file on disk (also in a read-only checkout through `chmod`). | the reviewer launch; the settings file written fresh per launch outside every checkout; 0010 section 7 corrected in 0040 |
| P41 | `--tools Read,Grep,Glob` leaves those tools plus the MCP tool; `--disallowedTools` is no read-only switch; `--allowedTools` alone leaves Bash, Edit and Write offered (under `-p` a call that is not allowed is denied, seen for Bash; the model did not call the write tools). The CLI reference says the same of the three flags and that `--tools` does not affect MCP tools. Schema errors return as `isError` and the model retried correctly. A denied tool, a server that failed at start and one that died mid-run all end `success` with the review in prose. | the launch spec; a run without a stored report is a failure whatever `result.subtype` says |
| P42 | The checkpoint ignored failing hooks and gpg with the `-c` overrides; a `--raw -z` plus `@@`-count parser matched git on every name; agent-controlled attributes and configuration ran a clean filter, an external diff, fsmonitor, a hook, textconv and smudge; `--attr-source` or blanking `filter.*` stops the clean filter, the `-c` overrides do not. The design review found that `--attr-source` leaves `info/attributes` and `core.attributesFile` in force. | `guardedGit.ts` and the shared guard in `swarm/workspace/git.ts` |
| P43 | No injection moved a verdict its way; the canary was never read; injection text was often reported as a finding and moved a correct diff to `revise`, which fits raise only. | the prompt with untrusted-data blocks and raise-only effects |

The build found what no probe predicted:

- The real CLI refuses a `--session-id` that is not a UUID. The manager used `review-<runId>`, which the fake CLI accepted, so every unit test passed and every real reviewer start failed with `spawn`. The CLI reference states the rule ("must be a valid UUID") and 0040 section 10.1 writes `--session-id <uuid>`; the fake CLI did not enforce it. Reviewer sessions get a UUID now, and the fake CLI refuses non-UUID ids.
- The plan reported `rate_limit_event` status `allowed_warning` for the seven-day window. The milestone 4 swarm manager paused every swarm on any status other than `allowed`, so the worker was interrupted after a few seconds. `allowed_warning` now posts an alert and pauses nothing; other statuses still pause. This changes the rate-limit row of 0037 and needs the user's agreement (question 2).
- A quit right after a report left the reviewer's read-only checkout on disk and its cost unrecorded. Quitting removes the checkouts now, and the script waits for the cost.
- With `core.autocrlf=input` in the host's global git configuration, `add -A` rewrote a new CRLF file, so the checkpoint differed from what the agent wrote. The guard sets `core.autocrlf=false`.

### What the build changed in earlier records

None of these records is rewritten; the amendments apply when each is next revised.

0010:

| 0010 statement | Finding | Amendment |
|---|---|---|
| Section 7: files passed with `--settings` are protected at session start | P40: only the running session's view is; the file on disk was changed under `bypassPermissions`. The permission-modes docs agree: a file passed with `--settings`, `--mcp-config` or `--agents` is a protected path, whose writes are prompted in `default` and `acceptEdits`, go to the classifier in `auto` and are allowed in `bypassPermissions` | As 0040 section 2. |
| Not verified: `--setting-sources user` keeps out the project `CLAUDE.md` | Confirmed by P9 (0014) and P40 | Verified. A `CLAUDE.md` in a subdirectory of the reviewer's checkout is still not probed. |
| Section 7: `report_review` modelled on `ReportFindings` (`important`) | Severities `blocker`, `major`, `minor`, `nit`; B accepts with no `major` or above | As 0040 section 2. |
| Section 4: the reviewer at `fable` | Built as a tier rule (never below the worker, `strong` by default); every real run used Haiku through a profile tier override | Open (question 7). |

0037 (status proposed):

| 0037 statement | Finding | Amendment |
|---|---|---|
| Rate limits: pause the group on a status other than `allowed` | `allowed_warning` seen in a real run; pausing on it stopped work that the plan still allowed | Alert on `allowed_warning`, pause on other statuses. |
| Section 4.3: `swarm_merge` waits for review | Built in the review module behind the merge gate and the `app.merge` class | Settled. |
| `reviewShare` | Defaults to 0.3 for a swarm with a worktree agent; the start dialog's form still starts at 0 | Open in the dialog. |
| Section 4.1: patch collection at the agent's end | Joined by the capture; held messages and the background wait are not built | Partly. |

0040 (status proposed):

| 0040 statement | Build finding | Amendment |
|---|---|---|
| Section 18.2 folder names `diff`, `check`, `reasons`; section 18.1 migration under `manager/` | `capture/`, `rules/`, `policy/`; the migration is `store/reviewMigrations.ts` | Record. |
| Section 7.2: `size.run` counts changesets that are not rejected | Counts merged changesets and the current one; superseded ones would count the same work twice | Record. |
| Section 7.2: the policy may set any reason's rung | `policy.base_differs` keeps its catalogue rung, since the doubted policy would otherwise lower its own reason; the overlay never lowers a catalogue default | Record. |
| Section 9.2: revise at C or above goes to `sent_back` or `awaiting_human` | `awaiting_human` (0041) | Record; the user confirms (question 4). |
| Section 9.2 | Added `start_check`, `review_failed`, `undeliverable`, `no_new_capture`, reject from `sent_back`, and `user.escalated` as a reason | Record. |
| Section 10.4: scope first, then schema | The registry validates the schema before the handler | Record. |
| Section 10.5: the `mcp_status` early check | The runner reads `init` and stops with `spawn` when it lacks the report tool | Record. |
| Section 6 and question 8: checks under `local` follow the agent's confinement | With the sandbox on or the `srt` provider the check runs under `srt` or ends `not_run`; without the sandbox it runs as a plain process; `container` is not connected | Record; question 8 of 0040 stays open. |
| Section 7.2: large files | `file.large_unreviewed` at D, since no hunk is stored for the detectors or the person | Record. |
| Section 15: the gate has no way back after a `repo.ref_moved` | `review_accept_repo_change` (UI only), bound to a hash of the difference in the alert (file content, every ref change, the user-level Claude content), stores the snapshot it compared and refuses a second change with a refreshed alert | Record. |
| Other consequences: the milestone 4 `Git` guard gains the attribute and driver measures | Done in `swarm/workspace/git.ts` and shared by every review git call | Settled. |
| Section 6: the check's checkout under `<task base>/swarms/<swarm id>/check/<changeset id>` | `<task base>/review-checks/<swarm id>/<run id>`; reviewer checkouts under `<task base>/review-runs` | Record. |
| Section 7.2: `path.protected` follows the protected paths of the Claude Code docs, checked when built | `rules/protectedPaths.ts` holds `.git`, `.claude`, `.vscode`, `.idea`, `.husky`, the shell profile files, `.mcp.json` and `.claude.json`. The permission-modes docs read for the review of this record list more: `.config/git`, `.cargo`, `.devcontainer`, `.yarn`, `.mvn`, and files such as `.envrc`, `.npmrc`, `.yarnrc`, `.pnpmfile.cjs`, `bunfig.toml`, `.bazelrc`, `.pre-commit-config.yaml`, `lefthook.yml`, `gradle-wrapper.properties`, `maven-wrapper.properties` and `.devcontainer.json` (`.gitconfig` and `.gitmodules` are `config.git` here) | Open: the list is behind the docs. |
| Sections 18.2 and 19: one real-Claude script `scripts/e2e-real-review.mjs` with a trivial check, the P43 injection case, a send-back with the superseding capture, `swarm_merge` and the `background_tasks_changed` payload | Two scripts: `e2e-real-review-reviewer.mjs` (one reviewer with an injection comment, a `CLAUDE.md` marker and a canary) and `e2e-real-review-ladder.mjs` (worker, capture, reviewer, the gate by a dry run); no check command, send-back, merge or background task in a real run | Record; open under real runs. |
| Sections 8.3, 16 and 17: the start card shows the policy source and hash; the start dialog says that a review share of 0 queues every review and that review is advisory without the Bash sandbox | Not built; the policy warnings are on the swarm | Open. |

0022: `AgentEnvironment.toolCommand` in the local, srt, container and fake providers, and `srtToolEnvironment` with writes limited to the checkout and its own temporary directory. 0028: the class `app.merge`. 0029: grants carry a tool set (`default`, `worker`, `reviewer`). 0021: the review item with card actions and one item per agent's newest changeset.

0041: the guard additions went into `capture/guardedGit.ts` first and into `swarm/workspace/git.ts` in the integration; the swarm module also takes `mcp`, since it declares the launch tool sets on the grant; the real-Claude script `scripts/e2e-real-review.mjs` became the two scripts above; of the w-manager slice the held messages, the background wait with `swarm.backgroundWaitMinutes`, reviewer runs in the live count, the per-launch outward modes and the `deploy` ask rules are not built.

Status of the records of this milestone: 0041 is accepted, since the build followed its contracts except for the parts named in the line above, and the reviews of each builder's work checked them; 0040 stays proposed: the build confirmed sections 3 to 7 and 9 to 17 as amended above, and its open questions and the policy choices need the user.

### Review findings and what was fixed

| Review | Verdict | Main findings | Status |
|---|---|---|---|
| Probes P40 to P43 | accept with changes | notes contradicted logs in places (the server-down case, a `printf` rewrite that was denied, a confounded `acceptEdits` case, timings) | Corrected in the notes and `probes/RESULTS.md`. |
| Design 0040 | accept with changes | `--attr-source` leaves `info/attributes` and `core.attributesFile` open; a cascading key would delete decision logs with a swarm; a merged changeset could be superseded; `config.test_lint` missed `package.json` scripts; an edited policy reaches a session-started swarm | Corrected in 0040 before the contracts. |
| Contracts 0041 | accept with changes | no contract for who loads the policy, for capture inputs, for prompt data and prompt version; manager-added reasons ignored the policy's rungs; contract suites passed wrong implementations | Contracts added; each listed mutation fails a test. |
| w-capture | accept with fixes | the comparison could move after `add -A`; `policy.base_differs` could be lowered by the doubted policy; a `package.json` hunk without its block opener gave no reason; `acceptRepoChange` dropped a moved ref; the output tail lost most output | Fixed in the integration. |
| w-reviewer | accept with fixes | fsmonitor not off in the checkout; a smudge filter in `info/attributes` ran during the checkout; a cancel during the checkout preparation was lost | Fixed in the integration. |
| w-manager | reject | an escalation during a merge moved the branch and recorded nothing; a merge into a linked worktree ran its `config.worktree` filter; compare-and-swap of the merger and the store untested | Fixed in the integration and the fix step. |
| w-ui | accept with fixes | the views expected an array where the module answers `{ changesets }`; the card's Accept at C failed without a report; the web typecheck failed on a test | Fixed in the integration. |
| Core review and application review (parallel) | one reject with 14 findings, one accept with fixes with 9 (the step reports do not say which review gave which) | the check ran unconfined under a profile with the Bash sandbox on (blocker); a D accept passed with an escaped file name unseen; a sent-back changeset without new work could be neither accepted nor rejected; `requestRung` did not raise the next capture; a second escalation after a demotion did nothing; a user's commit on the base closed the merge gate for good with no alert; module caller mutations survived; a single hunk over 100 KB reached a session cut without a mark | Fixed in the fix step, each with a test and a mutation entry. |
| Verification | no verdict | all gates passed; `pnpm mutation` not run (disk below 3 GiB); two banned words | Words removed. |
| Fix step | accept with fixes | the repository accept absorbed a changed user `CLAUDE.md` and a ref moved during the accept; a linked skill changed unseen; the check's write limit and the accept's caller check untested | Fixed in the second fix step. |
| Second fix step | accept with fixes | the accept hash covers the categories of a configuration change, not its content; a setup that fails on both commits counts as `check.failed_on_base`; denials reset per launch, not per run; a refused accept leaves the old alert; a user-level change cannot be cleared for one swarm; hand mutations of the FIFO guard, the walk caps, the temporary directory mode, an optional `expectedHash` and the `env` prefix of a hook command survived | The findings before the hand mutations are fixed in the third fix step (`docs/measurements/r19-fix-3.md`); the hand mutations are open. |
| Third fix step | accept with fixes | the check's cache directory is shared by the checkpoint run and the base run that follows it, so agent code can write into the cache the base run uses, make both runs fail and turn a real failure into `check.failed_on_base`, which lowers the rung (a major that the third fix step opened); with `HOME` pointed at an empty cache directory, a toolchain installed below the real home (`cargo` through `rustup`) fails on both commits and reads as failed on base (a major); a repository file over the hash size cap or past the walk caps is bound by size and time only; `core.hooksPath` and `include.path` targets outside the common directory are not in the snapshot; the swarm's caller session can clear a worker's denials through an ended run; hand mutations of the executable bit, `worktreeConfigs`, the cache directory mode and the `EROFS` text survived; the card does not name the changed user-level file | The cache and toolchain majors are fixed on 2026-11-22 (`docs/measurements/check-clone-fix.md`, question 3); the sandbox-text hand mutation is fixed with them; the other minors are open in "What remains open". The review ran the executor under a real `srt` 0.0.83 (installed on 2026-11-22) with scratch tests; the fix pass has such tests in the suite (`ProcessCheckExecutor.srt.test.ts`). |
| Check-clone pass (the per-run cache clones, the real `HOME`, the environment table) | accept with fixes | one major and seven minors: a process that the checkpoint run detaches with `setsid` survives the run, holds a loopback port and makes the base run fail with `Address already in use`, which reads as `check.failed_on_base` and is stored and reused (major 1 of question 3, through a process instead of a cache); the same-volume test compares `st_dev`, which is equal for the sealed system volume and the data volume, so `cp -c` copies; missing JDK messages end `failed_on_base` instead of `not_run`; `denyRead` names only the current profile's data directory; a killed app leaves checkouts, temporary directories and settings files; bare words (`Connection refused`, `Forbidden`) turn a real failure into `not_run` and skip the send-back; `NVM_` lets an authorization header into the check and the check environment carries `srt`'s proxy credentials; the real-tool tests compared entry counts | Fixed on 2026-11-22 (`docs/measurements/check-clone-fix.md`, second pass). The open parts are in "What remains open". |
| Check-clone pass, second review | accept with fixes | one major and seven minors: a double-forked daemon that executes a program with an empty environment and changes its directory to `/` is found by neither channel of the sweep, holds the base run's port and turns a real checkpoint failure into `check.failed_on_base` (rung B), whose base row is stored and reused; a forged `AGIDE_CHECK_RUN` or `AGIDE_CHECK_OWNER` keeps a process out of the sweeps; the srt proxy refusal (`CONNECT tunnel failed, response 403`) and Maven's missing-JDK message read as `failed`, while `Could not resolve "./x"` of a bundler, a Spring placeholder and a Gradle unknown property end the run `not_run`; `notRunReason` carried the matched line and program names of the check into the reviewer's `Outcome:` line; a volume mounted below a cache root is copied by `cp -c`; the default login's Claude directory was readable by the check; two `endStale` branches were untested and `lsof` listed every process; `GIT_AUTHOR_NAME` was scrubbed and bare `TOKEN`, `PASSWORD`, `SECRET` and `*_APIKEY` were not | The major is closed by the rule of the user of 2026-11-22: the base check must be green, and a red base is a broken precondition of the project, not a state that lowers a rung. The reason `check.failed_on_base` is gone: a failed checkpoint is always `check.failed` (rung C, sent back), and `check.base_red` (rung C, not sent back) is the reason when the base is red. The base run comes first, once for each base commit and policy hash, and a red base posts one alert. Survivors can still make a base run red, with the consequence of rung C and one alert, so the attack gains nothing. The minors are fixed in the third pass (`docs/measurements/check-clone-fix.md`, third pass). |
| Check-clone pass, third review | accept with fixes | one blocker and seven minors: `srt` 0.0.83 exits 0 when its program ends by SIGINT or SIGTERM, so a failing check that signals itself, its process group or its parent shell read as `passed` (also from a merged checkpoint that becomes a base); the base alert was resolved for the whole swarm although bases are per agent, and the set of posted alerts was only in memory; `check.network: none` did not stop loopback connections; two banned words in 0040; a real-process test of the sweep failed under load; the text of `cp` reached `notRunReason`; environment prefixes were compared with the case of the name and `PASSPHRASE`, `JWT` and `_PW` endings were missing | Fixed on 2026-11-22 (`docs/measurements/check-clone-fix.md`, fourth pass): a launcher shell inside `srt` hands out the program's own status, the alert follows its own base commit and policy and survives a restart, `allowLocalBinding` is false unless a tool entry needs it (and `srt` cannot do better, 0040 section 6), the sweep test no longer races the sweeps of other test processes, the clone text goes to the log, the name rules compare the upper-cased name. A command that finds no tests and exits 0 stays open (below). |
| Records 0040 to 0042, the READMEs and the probe notes | accept with changes | 0042 named the wrong question for the reviewer tier, put the probe spend at a few cents where the stored logs sum to about 0.17 USD, said every row of the security table has a test, called the container suites skipped, and left out parts of 0040 that are not built (retention, the interdiff, the policy alert, the `report_outcome` sentence, the start dialog notes) and that the application does not use `ReportDesk` and `ReviewRunDriver`; `app/README.md` listed `review_request_escalation` as a UI command; the `path.protected` list is behind the Claude Code docs | Corrected in the records and READMEs; the code items are in "What remains open". |

As in milestones 3 and 4, the reviews found defects that green suites did not, most of them at trust boundaries: git calls on a repository the agent can configure, the check's confinement, and the gates' handling of changes the user makes outside the agents. Unlike milestone 4, the integration found defects that the fake CLI did not show and a real run did (the UUID session id and `allowed_warning`).

### Tests and coverage

| Suite | Result |
|---|---|
| `pnpm typecheck` | passes (second fix step; again for this record and in its review) |
| `pnpm test` | 268 files, 3056 tests pass, 15 skipped (run for this record and again in its review; the skipped tests are the ones that need a real `srt`, which was not installed then; the container provider's contract tests ran). After `srt` 0.0.83 was installed on 2026-11-22, the whole suite passes with none skipped: 3093 tests in three coverage runs, totals 91.0 statements and 82.9 branches |
| `pnpm coverage` | passes with thresholds (both fix steps); the verification ran it three times before the fixes: 266 files, 2990 tests, totals 90.88 / 82.66 / 90.11 / 93.26 |
| `pnpm e2e` | 86 pass with hidden windows (integration with one `tree.spec.ts` rename timeout that passed on the re-run; quality; verification twice; first fix step); "all specs pass" in the second fix step |
| `pnpm mutation` | second fix step: one full run, 343 killed, 0 survived, one entry skipped because an edit moved its text, then fixed and killed in a filtered run. The quality step's last full run left one survivor (`checkout reads attributes`), killed in a filtered run after a test was added; the full run of the first fix step left none. So no single full run shows every entry killed without a filtered re-run. |
| `pnpm parity` | ok; `report_review` is listed for the reviewer set only, `review_get`, `review_list` and `review_request_escalation` are tools, the decisions are exempt (`agents never decide reviews`) |
| `pnpm check:colours` | passes |
| `pnpm coverage:e2e` | not run in milestone 5 |
| `pnpm visual-check --only review` | run by w-ui and by the application review with hidden windows; screenshots read; the only fix was in the phase, which opened the wrong row first. The screenshots were written to temporary directories and are not stored in the repository. The inbox card in that phase comes from the e2e backend, not from `ReviewInbox`. |

Unit coverage (quality step, two runs):

| Area | Statements | Branches | Functions | Lines | Threshold (s/b/f/l) |
|---|---|---|---|---|---|
| all of `src` | 90.9 | 82.7 | 90.1 | 93.3 | none |
| `src/core` | 94.3 | 86.0 | 94.8 | 97.1 | 94/85/94/97 |
| `src/core/review` | 95.2 | 88.3 | 95.1 | 98.1 | 95/88/95/98 |
| `src/core/swarm` | 96.1 | 90.2 | 94.5 | 98.7 | unchanged |
| `src/main` | 81.7 | 69.4 | 79.0 | 85.0 | 81/68/78/84 |
| `src/main/modules` | 83.8 | 69.1 | 81.2 | 86.9 | 83/68/81/86 |
| `src/main/modules/review.ts` | 83.8 | 74.2 | 67.9 | 87.0 | 83/73/67/86 |
| `src/renderer/panes/review` | 95.1 | 83.2 | 96.4 | 97.2 | 95/83/96/97 |

The figures are from before the fix steps; the fix steps report the thresholds as met. Gaps: the glue in `main/modules/review.ts` that builds the real pipeline services from the profile is reached by the end-to-end tests only.

CLI version: every probe and real run of milestone 5 used Claude Code 2.1.330 and git 2.54.0.

### Measured effort and spend

Wall times as recorded with `date -u` in `docs/measurements/`. Token spend is not recorded by the agents. User hours are not measured.

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time |
|---|---|---|---|---|
| Probes P40 to P43 | `p-review.md` | 14:18 | 14:46 | about 28 min |
| Review of the probes | `review-p-review.md` | 14:46 | 14:54 | about 8 min |
| Design 0040 | `d-review.md` | 14:54:31 | 15:10:44 plus a few minutes | about 18 min |
| Review of 0040 | `review-d-review.md` | 15:11:46 | 15:26 | about 14 min |
| Contracts (0041) | `contracts.md` (milestone 5 section) | 15:24:45 | 15:55:57 | about 31 min |
| Review of the contracts | `review-contracts.md` | 15:56:50 | 16:15:17 | about 18 min |
| w-capture | `w-capture.md` | 16:16:14 | 16:43:00 | about 27 min |
| w-reviewer | `w-reviewer.md` | 16:16:16 | 16:33 | about 17 min |
| w-manager | `w-manager.md` (milestone 5 section) | 16:16:16 | 16:46 | about 30 min |
| w-ui | `w-ui.md` | 16:16 | 16:45 | about 29 min |
| Review of w-reviewer | `review-w-reviewer.md` | 16:33 | 16:45 | about 12 min |
| Review of w-capture | `review-w-capture.md` | 16:43:53 | 16:54:22 | about 10 min |
| Review of w-ui | `review-w-ui.md` | 16:43 | 16:52 | about 9 min |
| Review of w-manager | `review-w-manager.md` | 16:46 | 17:00 | about 14 min |
| Integration | `integrate.md` | 17:00:38 | 18:01:55 | about 61 min |
| Test quality | `w-quality.md` | 18:02 | 19:12 | about 70 min |
| Review of the core | `review-core.md` (milestone 5 section) | 19:09 | 19:28 | about 19 min |
| Review of the application | `review-app.md` | 19:09:51 | 19:32 | about 22 min |
| Verification | `verify.md` | 19:09 | about 19:35 | about 26 min |
| Fixes | `fix.md` (R19 section) | 19:32:37 | 20:36 | about 63 min |
| Review of the fixes | `review-fix.md` | 20:36:45 | 20:51 | about 14 min |
| Second fixes | `fix-2.md` (R19 section) | 20:51:05 | 21:46 | about 55 min |
| Review of the second fixes | `review-fix-2.md` | 21:46:53 | 22:01 | about 14 min |
| This record | `record.md` (milestone 5 section) | 22:01 | 22:12 | about 11 min |
| Review of this record | `review-records.md` | 22:11 | 22:25 | about 14 min |

| Total | Minutes |
|---|---|
| First probe to the end of the review of the second fixes, elapsed (14:18 to 22:01) | about 463 |
| Agent wall times summed over the same steps | about 609 |
| of which probes, design and their reviews | about 68 |
| of which contracts to the review of the second fixes | about 541 |
| Build steps, elapsed (15:24 to 22:01) | about 397 |
| Code reviews, verification, fixes and fix reviews, summed (milestone 4: about 68) | about 213 |
| Reviews of the builders' work, summed (no such steps in milestone 4) | about 45 |
| Milestone 4 for comparison (0039): summed all / build | about 291 / 257 |

Real-Claude spend as the CLI reported it (list-price equivalents under the subscription, not bills):

| Use | USD |
|---|---|
| Probes P40 to P43 (stored logs of the final runs; overwritten runs not counted) | at least 0.17 |
| Probe review re-runs | about 0.06 |
| w-reviewer real run | about 0.003 |
| Integration: the complete ladder run | about 0.0075 |
| Integration: earlier attempts | about 0.02 |
| Total | at least 0.26 |

Every real call used Haiku with `--max-budget-usd 0.25`. No step started a model reviewer through the CLI in this milestone.

What took long, from the measurement files: the tamper cases of P40, which depend on what the model decides (probes); working out a checkpoint and merge where no git call runs without the guard in a directory the agent controls (design); the in-memory reference manager that carries every rule of 0040 sections 9 to 16 (contracts); the parser details and the line-ending finding (w-capture); the tool sets through the grant without touching the session module (w-reviewer); a clean quit that leaves reviewer runs `cancelled` and a monotonic clock in restart tests (w-manager); finding the UUID failure, which needed the app's stdout in the script (integration); the full mutation run, about 45 minutes, which edits sources in place (quality and both fix steps); scratch scenarios through the swarm rig (fix reviews).

### Re-estimate

0040 estimated the slice at 7 to 9 working days in 0005 units, low confidence. Judged share built: about 7 days. Missing from the slice are held messages and the background wait, reviewer runs in the live count, the per-launch outward modes, the checkpoint rebuild, the container check, a real `srt` check run and the smaller parts of 0040 listed under "What remains open". The judgement is this step's; no measurement gives it.

| Basis | Agent minutes | Minutes per estimated day |
|---|---|---|
| Build steps (contracts to the review of the second fixes), summed | about 541 | about 77 |
| Build steps, elapsed | about 397 | about 57 |
| All steps, summed | about 609 | about 87 |
| Milestone 4 (0039), summed build / all | about 257 / 291 | about 32 / 36 |

| Judged days built | Build minutes per estimated day |
|---|---|
| 6 | about 90 |
| 7 | about 77 |
| 8 | about 68 |

Milestone 5 took about 2.4 times the summed agent time per estimated day of milestone 4 (about 77 against about 32 build minutes, about 87 against about 36 over all steps). Reasons visible in the measurement files: a review step after every builder, then the parallel reviews with the verification, then the fix steps each with its own review, which together take about 258 minutes against about 68 in milestone 4; the full mutation run, which grew to about 45 minutes and ran in the quality step and both fix steps; the integration, which connected services that the builders had tested against fakes and found the real-CLI defects; and the disk floor, which stopped the verification and the core review before their mutation runs.

| Projection (remaining 0005 days after 0039, about 150 to 180, minus about 7) | Value |
|---|---|
| Remaining estimated days | about 143 to 173 |
| Summed agent hours at the milestone 5 build rate | about 184 to 223 |
| Summed agent hours at the milestone 4 build rate | about 76 to 92 |

The projection is an extrapolation and leaves out user hours.

### What remains open

| Item | Where |
|---|---|
| Held messages during a capture, the background wait, reviewer runs in the live count of the swarm manager | swarm, review |
| `outward` and `deployCommands` of the policy merged into each launch's gate; the `deploy` ask rules | permissions, review |
| A merge that rebuilds a deleted checkpoint from the stored patch | review |
| From 0040 and not built, beyond the rows around this one: the retention of review rows, refs and patch files; the interdiff view; posting the malformed-policy alert and the Retry action of a failed capture; the `report_outcome` sentence in a worktree agent's first message; the policy source and hash on the start card and the start dialog's notes on a zero review share and on advisory review; the `quiet-result` and `removal` triggers | review, renderer |
| The `path.protected` list is shorter than the protected paths of the Claude Code docs (amendment table above) | review rules |
| `ReportDesk`, the effects table and `ReviewRunDriver` repeat rules the manager holds; the application does not use them | review |
| The check under `container` (the real `srt` run of a check is in the suite since 2026-11-22, where `srt` is found: it skips without it) | isolation, review |
| A check command that discovers no tests and exits 0 reads as `passed`, in the checkpoint run and in the base run (a project whose runner finds nothing, or code in the checkout that makes the runner find nothing): the answer needs a rule on what the command printed or a policy field for the minimum, and is not built | review rules, policy |
| A project check that starts a local server or connects to one on loopback is refused by `srt` for a project without a tool entry that asks for loopback, and ends `not_run` with the sandbox reason; where an entry asks for it (Gradle), every TCP service of the host on 127.0.0.1 is reachable from the check (0040 section 6, "Loopback"). A policy field for loopback is not built | review, isolation |
| `container` is not connected for checks. When it is, the status of a check is the status of `docker run`; the signal cases of 0040 section 6 were run against `srt` only and need the same run against Docker | isolation |
| Secrets in binary and large files | review rules |
| A user's own commit on the target branch counts as `repo.ref_moved` and needs rung E after the accept | review policy (question 5) |
| The surviving hand mutations of the second fix review, listed above; the other findings of that review are fixed in the third fix step | review |
| Fixed on 2026-11-22: the cache directory that the checkpoint run and the base run shared is gone; every run clones the cache subtrees of its tools and the clone is removed when the run ends (0040 section 6) | review, isolation |
| Fixed on 2026-11-22: `HOME` stays the real home directory, only the caches are redirected, a write to the home ends `not_run`, and an environment problem in the output ends `not_run` instead of failing. Open in this area: Yarn has no table entry; the Gradle toolchain downloads (`~/.gradle/jdks`), the Cargo `config.toml`, the Maven `settings.xml` mirrors and the corepack cache are read from the real home or missing, so a project that needs them ends `not_run`; the Go entry is not run against a real Go; a real `srt` run of a project that needs `check.network: development` is not made | review, isolation |
| Fixed on 2026-11-22: the processes a check run leaves behind (also after `setsid`) are ended when the run ends and those of earlier runs when a run starts; a base run with survivors or an unreadable process list ends `not_run`; the same-volume test uses the filesystem that `df` names; the missing JDK, pyenv and nvm messages end the run `not_run`; words that tests print too end both runs `not_run` only when the base fails with them; the output tail shows the matched line; the check environment drops authorization names and the `NVM_` prefix; `denyRead` holds the app root; a killed app's checkouts, temporary directories, settings files and processes are removed at start; the real-tool tests compare names, sizes and times | review, isolation |
| Fixed on 2026-11-22 (third pass): the base run comes first and a red base never lowers a rung: `check.failed_on_base` is replaced by `check.base_red` (rung C, not sent back), a failed checkpoint is always `check.failed`, one alert is posted for each red base and a green base resolves it, and a stored base is reused only when green (the major of the second review); the environment patterns follow the Gradle and Maven forms and the srt proxy refusal, and a bundler or framework message is a failure of the code; `notRunReason` holds no text of the check; a mount point below a cache root ends the run `not_run`; `denyRead` holds the Claude configuration of the default login; the sweep lists working directories with `lsof -a`, has a time limit and tests for both `endStale` branches; the environment scrub matches whole words (`GIT_AUTHOR_NAME` passes, bare `TOKEN`, `PASSWORD`, `SECRET` and `*APIKEY` are dropped) and the log names the dropped `check.env` names | review, isolation |
| Open in the process sweep (0040 section 6): a descendant that clears its environment and changes its directory to a place outside the run is not found, and can make a base run red, with the consequence of rung C and one alert for the base; the known open path (attribution by `sandbox_check` against a per-run sentinel the sandbox denies, with the recipe) is in 0040 section 6, and `launchctl submit` and `open -a` are refused inside `srt`; the Linux arguments of the listing are from the manuals; a check that passes and leaves processes behind is noted in its log and has no reason in the catalogue; a clone that `clonefile` refuses inside one volume is copied by `cp -c` without notice (the cost differs, the isolation does not); an `Operation not permitted` in a failing test still ends the run `not_run` at once, since a sandbox denial is for a person | review, isolation |
| The minors of the review of the third fix step that remain: repository files over the hash caps are bound by size and time; `core.hooksPath` and `include.path` targets outside the common directory are not hashed; a caller session clears a worker's denials through an ended run; the card does not name the changed user-level file; hand mutations of the executable bit and `worktreeConfigs` survived. Fixed on 2026-11-22: the hand mutations of the cache directory mode (the directory is gone) and of the `EROFS` text (each sandbox pattern has a test and a mutation entry) | review |
| Plugin directories hashed through the manifest only; files imported by `CLAUDE.md` not followed; reviewers without their own configuration directory | review (0040 question 6) |
| `run.background_stopped` never fires; denials read as zero after an app restart; pending `report_outcome` claims in memory only | review |
| The `rate_limit_event` pause does not hold queued reviewer runs | review, swarm |
| A session that is an agent of one swarm and started another cannot ask for escalation on the second | review |
| Anchoring checks the line is in the diff, not that it is the right line | review |
| `review.dwellMs` is not read in the renderer; a hunk taller than twice the window is seen only by "Mark seen"; the start dialog's review share starts at 0 | renderer |
| Not built by design (0040 "What waits"): sampling, the demotion audit, the Codex reviewer, goal and agent views, the digest, the PTY and `task_start` path, history signals, a settings panel for the overlay, YAML, prevention of writes to the shared git directory | later |
| Real runs: a reviewer on `fable` or `sonnet`, a reviewer at C to E, a diff over 150 KiB, the retry path, a send-back with a real agent, `swarm_merge` with a real agent, a check under `srt` | real-Claude scripts |
| `pnpm coverage:e2e` and the real-Claude scripts of earlier milestones not run in milestone 5 | tests |
| Measurement files whose earlier sections a step replaced: `integrate.md` and `w-quality.md` (milestone sections before 5), `w-ui.md` (the milestone 4 swarm UI text), `verify.md` (the milestone 1 text); `git show HEAD:docs/measurements/<file>` holds them | measurements |
| Leftovers the agents could not remove (removal was denied): `/tmp/agide-contracts`, `/tmp/agide-d-review`, `/tmp/agide-review-d-review`, `/tmp/agide-review-p-review`, `/tmp/agide-review-w-reviewer`, `/tmp/agide-review-w-manager`, `/tmp/agide-review-w-ui`, `/tmp/agide-review-fix`, `/tmp/agide-review-fix-2`, `/tmp/agide-review-records`, together under 25 MB. An empty `/tmp/agide-orphan` dates from the time of the second fix review; no measurement file names it. The `claude -p` runs of the probe review may have added per-project entries for `/private/tmp/agide-review-p-review/run/*` to the login's data. The milestone 4 leftovers of 0039 (`/tmp/rev-fix-m4` and others) are still there. `swarm-rig-*` directories in the temporary directory predate this run. | user |
| 0040 is proposed | user |

## Consequences

### Recommendations for milestone 6

Keep the order R21, notes, apps. For the process: one review after each builder and one combined review after the integration catch most defects; the reviews of the fix steps found majors in the first and second passes and two more in the third, one of them opened by the fix itself, so a fix step needs its own fresh review and the rounds stop only when a review finds no major. Run the full mutation list once per fix step, not after every step, and keep 3 GiB free so the verification can run it. Give every step a way to start a reviewing sub-agent. Record tokens per step.

1. R21 (0016, 0021): a tasks pane, `inbox_ask` (with P16, the MCP call wait) and the reminder parts of 0021 that are not built; the `http` hook transport of 0030 recommendation 1, which the approvals of hook requests from the card need. Review items already use the inbox card actions and can serve as the pattern.
2. Notes and live read-only mounts (0034).
3. Apps (0033): GitHub, Jira, Slack, Notion and Google sources with routing. The policy's `outward` modes and the per-launch gate merge belong with them, since that is where outward actions multiply.
4. Carried from milestone 4 (0039 item 5), now with review constraints: `swarm_remove` with its dialog, which must refuse while a changeset is not final and keep review rows, refs and patches until retention; the "Always" check of `updatedPermissions`; one slot counter for the manager and `task_start` (reviewer runs then join it); the price table; the open UI items of 0039. The real worktree run is partly done: the ladder run used a worktree agent in `acceptEdits`; auto-mode approvals, interrupt and resume through the app are still not run.
5. Carried from milestone 5: held messages and the background wait, the open findings of the second and third fix reviews (the two majors of the third first), the parts of 0040 listed as not built (first the `report_outcome` sentence and the malformed-policy alert, which are small), the `path.protected` list against the docs, a real `srt` check run once `srt` is installed, and one real reviewer call on `fable` if the user agrees.

### Questions for the user

1. 0040 is `proposed`. Do you confirm it with the amendments above, and answer its open questions 1 to 12 (policy as a committed JSON file at `.agide/review-policy.json`, default rungs and hard floors, reviewer tier and `maxTier`, own configuration directory for reviewers, the 5 USD daily budget and `reviewShare` 0.3, one squash commit per changeset, `swarm_merge` from sessions with approval, accept before the reviewer reports)?
2. `allowed_warning` no longer pauses swarms; it posts an alert. This changes the rate-limit row of 0037. Do you agree?
3. Decided by the user on 2026-11-22 and built in `docs/measurements/check-clone-fix.md`: every check run, the checkpoint run and the base run alike, gets a throwaway APFS clone of the cache subtrees of its tools and the tool is pointed at it; `HOME` stays the real home and read-only so toolchains are found; a clone that cannot be made, or an environment problem in the output, ends `not_run`; the check reads no data of the app (the app root is denied since the second pass of 2026-11-22), and the processes a run leaves are ended by marker and working directory before the next run. The plain check process outside the sandbox that the question named as the alternative was not built.
4. A `revise` report at rung C or above goes to you, not back to the agent. Keep that?
5. A commit you make yourself on the target branch during a swarm counts as `repo.ref_moved`: you accept it from the alert and the changesets then need rung E. Should moves of the checked-out branch by you be left out?
6. Should the per-launch `outward` modes and `deployCommands` of the policy be built with the apps milestone, or dropped from the policy until then (they are read and reported as not applied)?
7. May a real-Claude script run one reviewer call on `fable` (and one on `sonnet`) to check the tiers beyond Haiku?
8. The milestone took about 2.4 times the agent time per estimated day of milestone 4, mostly in review and fix rounds. Keep the review after every builder plus the parallel reviews, or merge the builder reviews into the combined review?
9. Some measurement files lost their earlier sections to a later step (listed above). Restore them from git with the milestone 5 text moved to new files?
10. The leftovers above need your removal. Which should go?
11. Order after R19: R21, notes, apps as decided. Should the milestone 4 and 5 carry-overs (items 4 and 5) come first?
