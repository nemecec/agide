# Check follow-up contracts (c-checks)

Start: 2026-11-28T14:41:01Z
End: 2026-11-28T15:33:43Z

## Work

The contract step c-checks of record 0045: the types, stubs, in-memory implementations and contract suites of sections 4.1 to 4.8 that w-base, w-reports, w-rules, w-ui and i-checks build against. The base job, the report reader, the baseline, the comparison and the SQLite stores are not built.

- Dependency: `saxes` 6.0.0 as a direct dependency. The lockfile gains the importer entry and no package entry; `pnpm install --offline --frozen-lockfile` accepted the lockfile as it stands and linked the package, so no network was used and no other package changed.
- Reports: `core/review/reports/types.ts` has the test statuses, the report sources and statuses, `testRunSummarySchema`, `TestCase`, `ParsedRun`, `TestFailure`, `TestRef`, `REPORT_LIMITS`, the baseline and the failure sets, `ReportReader`, the `CompareToBaseline` signature and the pure helpers `summaryOf` and `failuresOf`.
- Base checks: `core/review/base/types.ts` (job record, states, triggers, verdict, `BaseChecks`, the `BaseRunner` seam to the executor, `ComputeBaseline`, `BaseChangedEvent`), `InMemoryBaseChecks` and `describeBaseChecksContract`. The in-memory implementation runs the state table of 3.1: one open job per pair, joins, slots, the confirm run unless the pair is known red, the baseline run when the policy names a report source, `await`, `rerun`, `release`, `shutdown`.
- Schemas and types: `checkRecordSchema` gains optional `tests` and `rerunOf`; `types.ts` gains `rerunOf` on `CheckRequest`, `failures`, `baseline` and `testRun` on `CheckOutcomeSet`, `TestRunStore`, `purpose` on `ReviewSwarmView`, `swarmPurpose` on `AssessInput`, the `review.base_changed` event in `ReviewEvent`, `BaseAlertPayload` and the origin of the no-tests alert.
- Policy: `check.reports`, `check.minTests`, `check.redBaseSendBack` and `check.baselineLowers` in the project schema and the overlay schema, and the first per-field merge of the check in `mergeOverlay`.
- Reasons: `check.no_tests`, `check.base_no_tests`, `check.report_missing`, `check.known_failures`, `check.flaky_pass` and `check.base_fix` with the sources and rungs of 4.5.
- Commands: `review_base_status` (UI and tool), `review_base_verdict`, `review_base_rerun` and `review_base_fix_draft` (UI only, each with its reason). A base command without a handler answers `not_built`.
- Store: migration 2 as written in 4.4. `InMemoryChangesetStore` also implements `TestRunStore`; a check read from it carries `tests` once a test run is stored. `describeTestRunStoreContract` is the suite for it.
- Manager: `decide` calls `checkDecision.ts` and `sendBackText.ts`, which reproduce today's behaviour and text. The manager also asks the seam once, after the checkpoint run, whether to run the check again (`rerun`), stores the repeat with `rerunOf`, passes `swarmPurpose` to the rules and stores the failing cases of a run when it has a `TestRunStore`.
- Swarm definition: optional `purpose` (`base_fix`).
- Fakes: `fakeBase.ts` (`ScriptedBaseRunner`, `parsedRun`, `RecordingBaseline`); `FakeCheckExecutor` can answer a repeat and report test counts; `FakeRiskRules` adds `check.base_fix` for a fix swarm; `InMemorySwarmFacts` takes a purpose.
- Docs: `docs/parity.md` lists the base commands; `docs/blocks.md` is unchanged.

## Differences from the record

| Item | Record | Built | Reason |
|---|---|---|---|
| `ReportReader.read` input `output` | `Buffer` | `Uint8Array` | the web tsconfig has no node types and the type reaches the renderer through `schemas.ts`; a `Buffer` is a `Uint8Array` |
| `CheckOutcomeSet` | `failures`, `baseline` | also `testRun` (failing cases and list path) | the manager stores the check row first and the test run after it (foreign key); the cases have to come with the outcome |
| Rerun of a checkpoint run | decided in `decide` | `rerun` is asked before the rules, `decide` after them | a repeat that passes must replace the outcome the rules see; reasons are append-only, so a rerun after the assess would leave `check.failed` stored |
| `core/events/index.ts` | gains the event | not edited | `ReviewEvent` is already in `AppEvent`; the event joins `ReviewEvent` in `core/review/types.ts` |
| `describeTestRunStoreContract` | part of the store contract | a second suite in `changesetStoreContract.ts` | the SQLite store satisfies `ChangesetStore` and has no test-run statements until w-base; the new suite runs on the in-memory store only |

## Files outside the row that were touched

| File | Change | Reason |
|---|---|---|
| `capture/ProcessCheckExecutor.test.ts`, `capture/ProcessCheckExecutor.srt.test.ts` | the check literal of the request helper names `redBaseSendBack` and `baselineLowers` | the schema defaults make both required in the policy type |
| `main/modules/review.test.ts` | the tool list of a default session gains `review_base_status` | the new command is a tool |
| `store/changesetStore.test.ts` | the review module is at version 2; the test-run suite runs on the in-memory store | migration 2 |
| `core/review/commands.test.ts`, `core/swarm/definition.test.ts`, `policy/policy.test.ts` | new cases and the tool list | the new commands, the purpose and the overlay rules |
| `vitest.config.ts` | `base/baseChecksContract.ts` joins the coverage exclusions | contract files are not production code, as for the other contracts |
| `scripts/mutation-checks.mjs` | entries with the prefix `c-checks ` | the mutation targets of this step |

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm coverage` | 308 test files pass (one skipped); src/core lines 97.48 against the threshold 97, statements 94.98, branches 87.43, functions 95.89; the thresholds of `src/core/review` and the other areas hold |
| CI-like coverage (directory with a `node` symlink only, no srt and no Docker on the path) | the same files pass; src/core lines 97.48, statements 94.98, branches 87.43, functions 95.87 |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |
| `pnpm parity` | ok; `docs/parity.md` gains the rows of the base commands |
| `pnpm check:colours` | no literal outside the allowlist |
| `node --check scripts/mutation-checks.mjs` | ok |

## Mutation entries (`node scripts/mutation-checks.mjs 'c-checks '`)

| Area | Entries | Killed |
|---|---|---|
| overlay rules of `mergePolicy` | 9 | 9 |
| policy schema | 7 | 7 |
| reason catalogue | 6 | 6 |
| base checks (state table, join, release, slots, await, rerun, stored rows, baseline) | 28 | 28 |
| in-memory store (test runs, limits, baselines, repeats) | 12 | 12 |
| migration 2 | 11 | 11 |
| commands | 6 | 6 |
| swarm definition | 2 | 2 |
| manager seams, decision and send-back text, fakes | 15 | 15 |
| report helpers | 3 | 3 |

The first full run had survivors. Some were equivalent: a branch that the field spread of `mergeCheck` makes redundant (now simplified), and a commit filter that the pair key makes redundant (its entry was dropped). An entry hung the process, since an aborted signal ignored in a wait loop keeps the microtask queue busy; it was replaced by one that removes the listener. Other survivors exposed missing cases, which are now in the contracts: a job that did not run after an earlier run with reports, and a failing suite name over the limit.

## What took long

- The base job state machine and its contract suite: the order of events between a finished run, the confirm run, a release and the next queued job, with a runner the test steers call by call.
- Where the repeat of a checkpoint run sits: after the assess it cannot replace `check.failed`, so the seam is asked before the rules.
- The mutation run: the entries for the commands run the module test, which starts the whole module graph.

## Not done

- The real base job, the executor seams (`bases`, `reports`, `runBase`), the report reader, the baseline, the comparison, the SQLite statements for jobs, test runs and baselines, the handlers of the base commands, the inbox actions and the UI are the builders' work.
- `describeTestRunStoreContract` does not run on the SQLite store yet; `rerun_of` and the joined `tests` are for w-base.
- The rule that the policy cannot set `check.known_failures` below B is a rule of w-rules; the catalogue only holds the default.
- No real-Claude run; nothing in this step needs one.
- Not run: `pnpm e2e` under a visible window.

## Cleanup

The temporary directory `/tmp/agide-c-checks` (logs, the `node` symlink of the CI-like run, copies of `package.json`, the lockfile and `mutation-checks.mjs` from before the step). Its removal was denied by the permission system and is left to the coordinator.

## Fix round after the independent review (c-checks-fix)

Start: 2026-11-28T16:05:48Z
End: 2026-11-28T16:48:31Z

### Work

- Error codes: the BaseChecks contract asserts `refused` for a rerun while a job of the pair is open and for a request after shutdown, and `not_found` for a rerun of a pair never requested. The TestRunStore contract asserts `not_found` for `putTestRun` of an unknown check and `refused` for rows outside the limits and for `putCheck` with an unknown `rerunOf`.
- `CheckDecisionInput.policy` carries the effective policy; `decide` passes it and the seam test asserts it.
- Restart: the harness has an optional `restart(liveSwarms)`; the restart cases run when it is present. `InMemoryBaseChecks` takes `resume` and offers `openJobs()`, and its own harness uses both, so the cases run in this step.
- State table: a cancelled job and a `not_run` job between two red jobs, and a `check.reports` entry that names no source. The last one is the behaviour of the code; 0045 section 3.1 now says so.
- Failure sets are stored with the test run (`putTestRun` takes optional `sets`, `failureSets(checkId)` reads them, column `review_test_runs.sets`, `failureSetsSchema` for the limits). `ChangesetDetail.failures` and `ReviewRunRequest.failures` carry them, `callerView.ts` quotes their test text for a session, and `PersistentReviewManager.storedChecks` reads the sets and the baseline back, so a decision after a restart has them.
- `CHECK_BLOCKS` in `InMemoryReviewManager.ts` gains `check.no_tests`, `check.report_missing` and `check.known_failures`: the reviewer never accepts over a check condition. Today's behaviour is unchanged since no rule produces these reasons yet.
- `FailureCountsEvidence` names the evidence counts of `check.failed` that w-rules writes and the inbox message of w-base reads.
- 0045 section 13 holds the amendments and the ownership audit of every builder row, with the resolution of each place where a builder would have needed a contract file or a file of another builder; the rows of section 5 are amended.
- Counts removed from prose in this file and in a comment.

### What took long

- The ownership audit: the card, the reviewer prompt and a decision after a restart all need the failure sets, which existed only while the pipeline ran. Storing the sets with the test run closed all three seams at once.
- The mutation run: each entry runs a test directory, so the run of all entries takes close to an hour.

### Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm coverage` | 309 test files pass (one skipped); src/core lines 97.48 against the threshold 97, statements 94.98, branches 87.44, functions 95.93; every threshold holds |
| CI-like coverage (directory with a `node` symlink only) | the same files pass; src/core lines 97.48, statements 94.99, branches 87.45, functions 95.93 |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |
| `pnpm parity` | ok |
| `pnpm check:colours` | no literal outside the allowlist |
| `node --check scripts/mutation-checks.mjs` | ok |
| `node scripts/mutation-checks.mjs 'c-checks '` | 135 entries, all killed, none survived; the source files compared equal to a copy made before the run (cmp) |

Mutation entries added by this round:

| Area | Entries |
|---|---|
| base checks (error codes, known-red rule, report source, restart) | 9 |
| in-memory store (error codes, failure sets) | 9 |
| migration 2 and the failure sets schema | 3 |
| manager (decision input, detail, reviewer request, check blocks) | 9 |
| rebuilt checks after a restart | 2 |
| caller view | 4 |

Two earlier entries were adjusted to the changed lines they mutate.

### Not done

- `describeTestRunStoreContract` and `describeBaseChecksContract` do not run on the SQLite implementations yet (w-base).
- The slot sharing between base jobs and checkpoint runs is not modelled by `InMemoryBaseChecks`; w-base tests it in `capture/baseSeam.test.ts`.

### Cleanup

The directory `/tmp/agide-c-checks-fix` (logs, the `node` symlink directory of the CI-like run, copies of the sources and of the mutation script made for the byte comparison) was removed at the end of the round.
