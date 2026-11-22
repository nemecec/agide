# Review of the milestone 5 contracts (0041)

Start: 2026-11-21T15:56:50Z (date -u). End: 2026-11-21T16:15:17Z (date -u).

## What was checked

- 0041 against 0040: the slices, the module list, the contracts, ownership, the module order and the test strategy; the code under `app/src/core/review`, `app/src/main/modules/review.ts`, the shared-file changes (`commands/types.ts`, `mcp/tools.ts`, `swarm/runtime/types.ts`, `swarm/commands.ts`, `events`, `profile`, `blocks`, `main/context.ts`, `main/modules.ts`) and the renderer stubs.
- The `background_tasks_changed` payload against `probes/out/p32_control_requests.jsonl` (entries with `task_id`, `run_id`, `task_type`, `description`; an empty list after the stop); `manual` as a permission mode against P22 in `probes/RESULTS.md`.
- `pnpm typecheck`, `pnpm test`, `AGIDE_HIDDEN=1 pnpm e2e` (before and after the changes), `pnpm check:colours`, `pnpm parity`: green.
- Mutations of the in-memory store, manager, reviewer runtime, anchors, tool-set filter and state machine, run in a copy of `app/src` under `/tmp` with the tree's `node_modules` linked, so the shared tree never held a mutated file.

## Contract defects found and fixed

- No contract named who reads the policy at swarm start or how a capture learns the swarm's policy hash, and nothing persisted the link. `CaptureService` gains `prepare` (policy and repository snapshot at swarm start, `SwarmReviewSetup` with `baseDiffers` for `policy.base_differs`), `resumePending`, `compareRepo` (before a reviewer start and a merge, also `reviewer.user_config_changed`) and `acceptRepoChange`; `review_repo_snapshots` gains `policy_hash` and `base_differs`.
- The capture service had no contract for what it reads from the swarm (base commit, worktree, tier, result text, telemetry). `ReviewSwarmView.repository` and `ReviewSwarmFacts.captureFacts` (`CaptureAgentFacts`) carry it.
- A failed capture could not tell `repo.armed` apart for the `high` alert: the `failed` result carries its subject and reasons.
- `ReviewRunRequest` lacked the prompt data of 0040 section 10.3 (files and hunks, the check, the reasons, the claim), so the runner would have needed the store; added. The prompt version of 0040 section 10.3 had no field or column: `promptVersion` on the run, `prompt_version` in `review_runs`, and on the `started` event.
- The reference manager added `reviewer.*` and budget reasons at catalogue rungs, ignoring the policy's `rungs`; it now applies them (hard reasons only rise). `FakeRiskRules` applies them to the `check.*` reasons.
- Contract suites let these wrong implementations pass: a report from an ended run, summary marks without the hash, an accept at E with unseen hunks, the gate ignoring `repo.armed` accepted below E, an agent branch as merge target, `report_outcome` ignored or taken from a readonly agent, a reviewer accept over a contradicted claim or a check that did not pass, unchecked comment anchors, a deletable sent comment, the retry limit ignored, the check run without the stored policy, anchoring that ignores the side, a reviewer tool set that lists default tools. Tests were added to `manager/reviewManagerContract.ts`, and new `anchors.test.ts` and `commands.test.ts`; each of these mutations now fails a test.

## Account

- Longest step: running the mutations and writing the contract tests that kill them.
- No real-Claude calls.
- Disk: about 3.9 GiB free at the start, 3.7 GiB during the e2e run.
- Temporary files: `/tmp/agide-review-contracts/` (logs, the mutation script and the copy of `app/src`), removed at the end.
