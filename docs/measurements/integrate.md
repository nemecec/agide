# Integration of R19 (label integrate)

Start: 2026-11-21 17:00:38 UTC.

## What was built

Review fixes, by builder:

- w-capture: `policy.base_differs` keeps its catalogue rung whatever the doubted policy says; the base after a merge stays the merged checkpoint for every later capture; the `package.json` classifier counts a changed entry whose block the hunk does not show as both a script and a dependency (known top-level fields excepted); `acceptRepoChange` takes the hash of the difference the alert showed and refuses another one, and accepted ref moves stay on later captures as `repo.ref_moved`; `refreshRef` moves only the ref the app merged into, from the tip it expected; a test with a recording git exec shows no work-tree call before a capture that ends with `repo.armed`; the overlay no longer lowers a catalogue default; the output tail spans the head when nothing was dropped; `check.env` no longer brings back a scrubbed name.
- Shared git guard: `swarm/workspace/git.ts` holds `driverSettings`, `blankingEnv` and `DRIVER_LISTING`, and its guard adds `core.attributesFile=/dev/null`, `core.autocrlf=false`, `core.safecrlf=false` and `GIT_ATTR_NOSYSTEM`. Every guarded call of the swarm `Git` and the worktree creation blank the filter and merge drivers the configuration names. The capture's `GuardedGit`, `GitMerger` and the reviewer checkout use the same helpers.
- w-reviewer: the reviewer checkout blanks the drivers (a filter named in `info/attributes`, a process filter and fsmonitor are tested); a cancel that arrives while the checkout is prepared launches nothing; `dispose` removes the read-only checkouts of open runs; start failures are logged.
- w-manager: `GitMerger` refuses a target checked out in a linked worktree; a merge holds the swarm's decisions from before the gate until the merge decisions are written, and a capture waits for it; the merge and every reviewer start compare the repository snapshot first; the app's merge refreshes the target in the snapshot; the rules get the paths of the other agents' latest changesets; recovery and the midnight timer start once the pipeline is connected; recovery applies a report a crash stored before the state moved and settles the day for runs it ends; check output and reviewer text in send-backs are untrusted-data blocks and a user send-back quotes the commented line; a dropped finding at major or above blocks the reviewer's accept; reviewer sessions get a UUID.
- w-ui: the views read the module's result shapes (`{ changesets }`, `{ changeset }`), and the e2e backend and the renderer test fakes answer in them; `untrustedText.test.ts` uses `import.meta.glob`, so the web typecheck passes; the inbox payload carries `hasReport` and the card sends the "without the reviewer" tick when no report exists; the card offers Accept up to rung C only; the pane's tick is sent only while a report is missing; the check command renders through `plainText`.

One application:

- `main/modules/review.ts` builds `GitCaptureService`, `GitPolicyLoader`, `DefaultRiskRules`, `ProcessCheckExecutor` (local provider; `srt` and `container` give `not_run`) and `StreamReviewerRuntime` on the swarm runtime, connects them at init, prepares a swarm before its first launch through a hook of the swarm manager, and captures a worktree agent when its run ends.
- The swarm module declares launch tool sets on the MCP grant, gives worktree agents the `worker` set, and exposes its runtime.
- `docs/parity.md` names the tool set of `report_review` and `report_outcome`.
- The fake stream CLI reads reviewer steps from `FAKE_CLAUDE_REVIEWER_STEPS` and refuses a `--session-id` that is not a UUID, as the real CLI does.
- `e2e/reviewLadder.spec.ts` runs the whole ladder on the real module graph with the fake CLI. `scripts/e2e-real-review-ladder.mjs` is the real-Claude script.

## Found on the way

- The real CLI refuses `--session-id review-run_...`: the manager's reviewer session id was not a UUID. The fake accepted it, so every unit test passed; the first real run ended both reviewer attempts with `spawn`.
- The plan reported `allowed_warning` for the `seven_day` window, and the milestone 4 swarm manager paused every swarm on it, so the worker was interrupted after a few seconds. `allowed_warning` now posts the alert and pauses nothing; other non-`allowed` statuses still pause. This changes the table of 0037 for that status.
- When the app quit right after a report, the reviewer's read-only checkout stayed behind under the task base, and the cost of the run was never recorded, since it arrives with the process end.

## Real-Claude run (one complete run, Haiku)

Started from the start dialog, one worktree agent, policy `retryLimit 0` in the repository. The worker wrote `discount.ts` with `p * 2` as asked (cost 0.0047 USD, two turns) and itself noted that the line is no ten percent discount. The capture gave one added file; the reasons were `check.none` and `tests.missing` at B. The reviewer (Haiku, prompt `review-b-1`, cost 0.0028 USD) called `report_review` once: verdict escalate to C, claim contradicted, a major finding on line 1 and a minor one, both anchored. The changeset waited at rung C, the inbox had one review item, and `swarm_merge` was refused. No approval card appeared and no request was denied. Earlier attempts in this run of work cost about 0.02 USD more (worker runs while finding the session-id and rate-limit problems, and one reviewer run).

## Took long

Finding why the real reviewer failed: the app's stdout had to be captured in the script before the UUID error showed.

## Not finished

- Held messages during a capture, the background wait, reviewer runs in the live count, per-launch outward modes and the deploy ask rules are not built.
- No command or card action accepts a repository alert (`acceptRepoChange` has no caller), so a user's own commit on the target branch during a swarm closes the merge gate for good.
- The check under `srt` and `container` is not connected.
- Left minor findings: secret detection in files the caps turned large; the container network for development checks and the srt tool key release; HEAD, `refs/remotes` and include files in the snapshot; the check executor does not compare the snapshot before its checkout; prompt lines without line numbers; `ReviewRunDriver` (unused by the app) still settles a given-up run at zero; the reopen nonce of the review pane; `review.dwellMs`; the `__agideApi` seam; a `worktreeGitDir` test; the GitMerger compare-and-swap and the store rung compare-and-swap tests; inbox `follow()` on superseded changesets.

## Commands

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm coverage` | pass, 262 files, thresholds met |
| `pnpm build` | pass |
| `pnpm e2e` | 85 passed, 1 failed: `tree.spec.ts` rename timed out on a key press; it passed when run again with the review specs |
| `pnpm parity` | pass |
| `pnpm check:colours` | pass |

End: 2026-11-21 18:01:55 UTC.
