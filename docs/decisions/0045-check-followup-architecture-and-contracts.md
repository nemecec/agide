# 0045 Check follow-up: architecture and contracts

Status: accepted (2026-11-26, the user's answers in section 12)
Date: 2026-11-26
Proposed by: spike agents (design run `checks-design`); reviewed by an agent that did not write it (run `review:checks-design`, 2026-11-26, its changes listed in `docs/measurements/review-checks-design.md`); decided by the user on 2026-11-26 (every recommendation taken); section 12 written by run `decisions-amend`
Inputs: 0003, 0005, 0006, 0010, 0013, 0015, 0021, 0022, 0029, 0035, 0036, 0037, 0038, 0040, 0041, 0042, 0043 and 0044 (read for the shared files); `docs/measurements/check-clone-fix.md`; `notes/probes-checks-design.md` (P54 to P56, this run); the code in `app/src/core/review` (`capture`, `manager`, `store`, `policy`, `rules`, `reasonCatalogue.ts`, `schemas.ts`, `types.ts`, `commands.ts`), `app/src/main/modules/review.ts`, `app/src/renderer/panes/review/ChangesetSections.tsx` and `app/src/renderer/panes/inbox/ReviewCardActions.tsx`

## Context

The confined project check of the review ladder (R19; 0040 section 6, 0041, 0042) runs the policy's `check.command` on the base commit first and then on the checkpoint. Since the user's rule of 2026-11-22 the base must be green: a red base is a broken precondition of the project, `check.base_red` (rung C) is its reason, a red base is never sent back, a green base result is stored and reused, and one inbox alert is posted for each red base. The eighth hardening pass of the confined check ran at the same time as this design; the user's answer A1 of 2026-11-26 added a ninth and last pass, which runs while this record is accepted, and the build of this record waits for it (section 5).

The user approved these follow-up items:

- A. The base check in the background: run it when a swarm starts, before agent code runs; confirm a red base with one automatic rerun; an action "run base again"; an action "fix the base with an agent" (a one-agent swarm whose goal is to make `check.command` pass on the base).
- B. Per-tool test-report parsing: JUnit XML first, libtest text lines for a plain `cargo test`, a policy field `check.reports` with globs; the reports are read outside the sandbox with entity expansion off and size and count limits, test names are untrusted; the failing sets (new, fixed, known) go on the card and into the send-back; the trusted baseline is a clean base run at swarm start, run twice to find flaky tests, recomputed by a fresh background run after each merge; the baseline filters the send-back to new failures, and lowering a rung from it is only an explicit policy opt-in, off by default.
- C. The zero-test rule (open row of 0042): a command that finds no tests and exits 0 reads as passed today.

This record is the architecture-and-contracts step for these items in the form of 0041: an audit of the code, the scope and order, the behaviour, the contracts (types, tables, policy fields, reasons with their rungs, card and send-back text, commands with the parity rule, inbox items), the builder tasks with disjoint files and their order, the tests with mutation targets, the security table, estimates in the units of 0005, risks and the questions for the user.

## Decision

### 1. Audit: what exists

| Area | What the code has | Where | Missing for A, B, C |
|---|---|---|---|
| Capture pipeline | `pipeline` moves a changeset to `checking`, calls `CheckExecutor.run`, stores the checkpoint row and the base row unless the base did not run, hands both to `RiskRules.assess`, then `decide`: accept at A after a passed check, send back `check.failed` while attempts remain with the app text and the output tail in an untrusted-data block, else the reviewer | `manager/InMemoryReviewManager.ts` (`pipeline`, `decide`), `manager/PersistentReviewManager.ts` | a test summary and failing sets in the check outcome; a send-back text built from them |
| Check executor | base first (`baseRun`): a stored base row of the pair is reused only when `passed` (`reusable`), else the base runs inside the capture's check; then the checkpoint run; each run in its own checkout, temporary directory and cache clones; the end sweep (`processes.endRun`) runs before the checkout, the temporary directory and the clones are removed; a base run with survivors or an unreadable process list ends `not_run`; the output is kept as the first 64 KiB and the last 960 KiB (`outputRing.ts`) and written to a log; the tail on the record is 8,000 characters | `capture/ProcessCheckExecutor.ts` (`run`, `baseRun`, `execute`, `compared`), `capture/outputRing.ts` | a base run outside a capture; a seam to read reports after the end sweep and before the removal of the checkout |
| Base store | base runs are `review_checks` rows with `target = 'base'` and no changeset; `baseCheck(commit, policyHash)` returns the latest row of the pair; index `review_checks_base` | `store/reviewMigrations.ts` (migration 1), `store/SqliteChangesetStore.ts` (`putCheck`, `baseCheck`), `store/InMemoryChangesetStore.ts` | a job with its state (queued, running, confirming), the confirm run, the trigger, the baseline |
| Inbox | `ReviewInbox.watchBase` posts one `review:base` alert (`BASE_ALERT_ORIGIN`, key `review:base:<swarm>:<commit>:<policy>`) for a red base that an undecided changeset uses, with app text only, and resolves it when the pair's base passes or no undecided changeset uses it; the posted keys are rebuilt from the inbox at start; the alert has no actions; `ReviewCardActions` renders `RepositoryAlertActions` for `review:repo` alerts and the review actions for `review:changeset` items | `manager/ReviewInbox.ts`, `renderer/panes/inbox/ReviewCardActions.tsx` | actions on the base alert; the state of a base that is still running; an alert for a base without tests |
| Policy | `check` has `setup`, `command`, `timeoutSeconds`, `network`, `env`; read from the base commit; the profile overlay only tightens | `policy/schema.ts`, `policy/GitPolicyLoader.ts`, `policy/mergePolicy.ts` | `check.reports`, `check.minTests`, `check.redBaseSendBack`, `check.baselineLowers` |
| Reasons | `check.none` (B), `check.failed`, `check.base_red`, `check.timed_out`, `check.not_run` (C) | `reasonCatalogue.ts`, `rules/` | `check.no_tests`, `check.base_no_tests`, `check.report_missing`, `check.known_failures`, `check.base_fix` |
| Card | `CheckBlock`: chip, command, duration, exit code, `notRunReason`, a sentence on the base (`baseSentence`), the output tail marked untrusted | `renderer/panes/review/ChangesetSections.tsx` | the failing sets, the test counts, the base job state |
| Swarm start | `swarm.setBeforeFirstLaunch` runs `CaptureService.prepare` (policy, snapshot) before a swarm's first launch | `main/modules/review.ts` | the start of the background base job |
| Merge | `mergeSteps` sets `mergedCommit`; the agent's next changesets diff from its merged checkpoint (`latest.mergedCommit !== null ? latest.checkpointCommit : latest.baseCommit`), so bases are per agent | `manager/InMemoryReviewManager.ts` (`merge`, `mergeSteps`), `capture/GitCaptureService.ts` | a base job for the new base after a merge |
| Commands | `review_*` with `ui: {}` and `mcp: true` or an `mcpExempt` reason (the parity rule of 0029 and 0041) | `commands.ts`, `docs/parity.md` | the base commands |

Open rows that this record answers: the zero-test row of 0042 ("A check command that discovers no tests and exits 0 reads as `passed`"). Open rows it touches without closing: the process sweep row of 0042 (a hidden survivor can still turn a base run red; the background job at swarm start runs before agent code when a check slot is free, which narrows that window there, not after a merge), the `kill 0` and modulo-256 row (unchanged: a status decides pass and fail, a report never does), the container check (still not connected).

### 2. Scope and order

C needs B (a count of executed tests comes from a report), and the baseline of B needs A (the second base run, the job after a merge). The parts are still built in parallel against the contracts of section 4: A's job runs the check and hands the parsed report of each run to the store; B's reader and comparison are pure over files and records; C's reasons are rules over the comparison.

First slice, in this order of value:

1. The base job (A): start before the first launch, the confirm rerun, "run base again", a job after each merge, the executor waiting for a job in flight.
2. Report reading (B): `check.reports` with JUnit globs and the libtest source, the reader on saxes with limits, the test summary on every check row, the failing sets against the baseline, the card and the send-back.
3. The zero-test rule (C): `check.no_tests`, `check.base_no_tests`, `check.report_missing`, `check.minTests`.
4. "Fix the base with an agent" (A): the draft of a one-agent swarm and the `check.base_fix` reason.
5. The opt-in `check.baselineLowers` with `check.known_failures` (rung B), off by default.

What waits:

| Item | Waits for |
|---|---|
| A reason for single tests that ran on the base and not on the checkpoint (`missing` is a number on the card in the slice) | data from the slice; a renamed test gives noise |
| Report formats beyond JUnit and libtest (TAP, `go test -json`, `.trx`, libtest JSON, which needs a nightly toolchain) | user demand |
| Finding report globs without a policy entry (the card names a known tool and the field to set) | the slice in use |
| Real samples from pytest, Maven surefire and jest (documented formats only, P54) | a host where they run offline |
| Rebasing a running swarm onto a fixed base | a design of its own (question 5) |
| Test-level history across swarms (a test that turns flaky over weeks) | data |
| The base job under `container` | the container check (0042) |

### 3. Behaviour

#### 3.1 The base job

A base job is the work for one pair of base commit and policy hash, requested by a swarm. It runs the check on the base commit with the rules that base runs have today (0040 section 6: its own checkout, clones and temporary directory; survivors or an unreadable process list make the run `not_run`), in the same check slots as the checkpoint runs, ahead of every queued checkpoint run.

| State | Entered when | Next |
|---|---|---|
| `queued` | requested (section 3.2) and no job of the pair is `queued`, `running` or `confirming`; a request for a pair with an open job joins it | `running` |
| `running` | a check slot is free | `green` (the run passed); `confirming` (the run failed or timed out); `red` (the run failed or timed out and the pair is known red); `not_run` (the run did not run) |
| `confirming` | the first run was red and the newest earlier job of the pair is not `red` (a pair that is known red is not confirmed again, so a red base costs no confirm run at each capture); one automatic rerun starts at once | `green` (the rerun passed: the base is green and the tests that failed in the first run are flaky); `red` (the rerun failed or timed out too); `not_run` |
| `green`, `red`, `not_run` | the runs ended | final; a later request makes a new job |
| `cancelled` | every requesting swarm ended or was removed before the job ended, or the app quit (a restart makes the job `queued` again when a swarm still uses the pair) | final |

When `check.reports` is set, a job whose first run passed runs once more (the baseline run) and stays `running` until it ends: tests that fail in the second run only are flaky, a second run that fails leaves the base `green` (the first run decided it) with those tests in the flaky set. Without reports a passing first run ends the job: a second run without test names finds nothing to compare (question 6).

The verdict of a pair is that of its newest final job: `green` lets `reusable` take the pair's passing row; `red` is what `check.base_red` means; `not_run` lets the next capture try again, as a `not_run` row does today.

#### 3.2 Triggers

| Trigger | When | Pair |
|---|---|---|
| `swarm_start` | in the `setBeforeFirstLaunch` hook, after `prepare`, before the first agent launches, for a swarm with a `worktree` agent and a policy with a check command | the swarm's base commit and policy hash |
| `merge` | after `swarm_merge` merged a changeset | the agent's merged checkpoint (its next base) and the swarm's policy hash |
| `capture` | a capture's check finds no green row and no open job for its pair (after a restart, or a pair the start did not see) | the changeset's pair |
| `user` | "Run base again" | the alert's pair |

The swarm's agents do not wait for the job (question 1): the job is queued before the first launch and ahead of every checkpoint run, so with a free check slot its run starts before the agents' first turns have written code; when every slot holds a check of another swarm (`review.maxConcurrentChecks` is 1 by default), it starts at the next free slot, while the agents already work. A capture's check waits for the open job of its pair (`BaseChecks.await`) before it takes a check slot, and runs no base run of its own: a check that held a slot while it waited would block the base job forever with one slot. No checkpoint of the swarm has run yet, so no survivor of the swarm's checks can meet this run; checks of other swarms in the same profile can (0042, process sweep), and so can the agents' own sessions, which start at the same time outside the check's sandbox. A run that they disturb reads red, the confirm rerun runs it again, and the user can run it again from the alert.

#### 3.3 Red base and send-back

The rule of 2026-11-22 stays: a red base never lowers a rung, `check.base_red` is rung C, and the changeset goes to a person. With reports, the record proposes one change (question 2): when the baseline and the checkpoint's report are both `parsed`, a checkpoint that fails tests that are neither in the base's failing set nor in its flaky set has `check.failed` (rung C) and those new failures are sent back; a checkpoint whose failures are all known keeps `check.base_red` and is not sent back. The rung is C either way, so a forged report can choose only whether the agent hears about failures, never the rung. The policy field `check.redBaseSendBack` (`new_failures` by default, `never` for the rule as built) carries the choice; the overlay can set `never` only.

On a green base, a failed checkpoint is `check.failed` as today. The send-back lists the new failures first and states the flaky ones that failed as flaky. The app reruns the checkpoint once before it decides only when the checkpoint's report is `parsed`, lists at least one failure, and every listed failure is in the base's flaky set (a report that lists no failure for a failed status explains nothing and gets no rerun); a changeset gets at most one such rerun (`rerunOf`). A pass of the rerun reads as `passed` for the send-back, with the rerun noted on the check row, and adds `check.flaky_pass` (rung B, not sent back): a change that fails one run in two is never accepted at rung A, and a forged report that names only flaky tests buys one more run, not an acceptance.

#### 3.4 Merges

Bases are per agent: after a merge, the agent's next base is its merged checkpoint. The `merge` trigger queues a job for that pair as soon as the merge ends, so the baseline of the agent's next capture comes from a fresh run of the merged code, not from the checkpoint run that accepted it. The checkpoint run and its report are not promoted to a base: a base run follows the stricter rules (survivors end it `not_run`), and the second run finds flaky tests that the merged change brought. The base of the other agents does not move.

#### 3.5 Fix the base with an agent

"Fix with an agent" on a red base alert opens the swarm start dialog with a draft (`review_base_fix_draft`): one `worktree` agent on the red base commit, the swarm's repository, the default merge target, the user's permission mode and budget defaults, the goal "Make the project check pass on this commit: <command>. Do not delete, skip or weaken tests." in app text only, and the failing tests and the output tail of the confirmed red run as an untrusted-data block (`untrustedBlock`) in the agent's prompt, which the start dialog shows as data. Test names never enter the goal: the goal and the prompt are user text for the reviewer (0040 section 10.3), and after a merge the base code that wrote the names is agent code. The user starts it as any swarm (`swarm_start`, with its approval). The definition carries `purpose: { kind: 'base_fix', commitId, policyHash }`; every changeset of such a swarm has `check.base_fix` (rung C), so a person reviews a fix whose easiest form is a weaker test. A fixed base helps the swarms that start after its merge; the running swarm keeps its base (question 5, answered so). The swarm start dialog offers the same draft: when the newest verdict stored for the chosen base commit is `red` (`review_base_verdict`, section 4.7; before a swarm exists the policy hash is not known yet, so the dialog looks at the commit's stored pairs), the dialog shows a `Banner` (warning) "The project check fails on this commit" with the Button "Fix the base first", which loads the draft of `review_base_fix_draft` into the dialog; starting the swarm on the red base stays possible.

#### 3.6 Reports

- Sources (`check.reports`): `junit`, a list of globs relative to the checkout (no `..`, no absolute path, no leading `/`), matched with `rules/glob.ts`; a glob that starts with `$TMPDIR/` matches below the run's temporary directory instead; `libtest: true` reads the check's own output as libtest text. Both may be set (a nextest run with JUnit plus a doc-test step).
- Before the run: the files that match the globs right after the checkout is made (a report committed by mistake or on purpose) are removed before the setup step, so a report comes from this run.
- When: after the end sweep of the run (`processes.endRun`) and before the checkout, the temporary directory and the clones are removed, so no process of the run is known to write while the app reads. The read holds the run's check slot and has a time limit.
- How: a walk that never follows a link (`lstat`, `readdir` with types, a depth and an entry limit) and starts at the literal directory part of each glob (`target/nextest/ci/` of `target/nextest/ci/*.xml`), entering only directories that the glob can still match, so `node_modules` or `target` of a real project do not use up the entry limit; each matched file is opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, `fstat` on the descriptor must show a regular file with one link, on the device of the checkout, within the size limit; the real path of its directory must lie in the checkout or the temporary directory (the check of P52: open, `fstat`, resolve again, compare device and inode). A file that fails a test is refused with the rule's name and counts as no report.
- Parser: saxes 6.0.0 (question 3) in a streaming handler that refuses a `doctype` event, every `processinginstruction` event (saxes reports the XML declaration as its own `xmldecl` event), an undefined entity (saxes reports those itself, P55), and every limit of section 4.3; the `error` handler ends the read at the first error, since saxes goes on parsing after an error when a handler is set; it keeps `testsuite`, `testcase` with `failure`, `error`, `skipped`, `flakyFailure` and `rerunFailure`, the `name`, `classname`, `message` and `type` attributes, and the first characters of a failure's text; `system-out`, `system-err` and `properties` are skipped.
- libtest: blocks of `running N tests`, the case lines up to the first empty line, and the `test result:` line; a block whose case lines differ from N or from the result line's counts, or that names a test twice, is refused (P54: the output of a failing test, printed in its `failures:` section, holds forged `... ok` lines that a line reader would count). The `Running <target>` line names the suite. Output that the ring dropped in the middle makes the source `partial`.
- Identity: the key of a case is the SHA-256 of the tool, the suite (or `classname`) and the name, each through `cleanLine` and Unicode normalization (NFC); time, message and thread ids are not part of it (P54: nextest messages carry a thread id).
- Status: `failed` and `error` are failures; a `testcase` with `flakyFailure` and no `failure` passed; `skipped` (vitest `todo` too) is not executed; `executed` is passed plus failed plus error. A key that appears more than once in a run (vitest allows two tests of one name; a second report file or a printed block can repeat a name) is one case that failed when any of its entries failed, so a forged passing entry cannot hide a real failure.

#### 3.7 Baseline and failing sets

The baseline of a pair is computed when its job ends, from the reports of its runs: `known` are the tests that failed in every run of the job, `flaky` the tests that failed in some runs and passed in others, `executed` the tests that ran in the first run. Its state is `clean` (no failure), `flaky`, `red` (known failures), `no_tests` (fewer than `check.minTests` executed) or `unparsed` (a report of the job was missing, partial or refused).

For a checkpoint run with a parsed report against a baseline that is not `unparsed`:

| Set | Definition |
|---|---|
| `new` | failing on the checkpoint, not in `known` and not in `flaky` |
| `known` | failing on the checkpoint and in `known` |
| `flaky` | failing on the checkpoint and in `flaky` |
| `fixed` | in `known`, executed and passed on the checkpoint |
| `missing` | a number: executed on the base, not executed on the checkpoint |

Without a usable baseline the comparison is `none`: the card shows the checkpoint's failures as one list, and the send-back sends them all, as today.

#### 3.8 The zero-test rule

Applied only where a count exists, that is with `check.reports` set or with `libtest` (P56: cargo test, vitest with a filter or with every test skipped, and Gradle without test sources exit 0 with nothing executed). `check.minTests` defaults to 1 when a report source is set.

| Base executed | Checkpoint passed by its status, executed | Reason | Send-back |
|---|---|---|---|
| at least `minTests` | fewer than `minTests` | `check.no_tests` (C) | yes: "The check passed but ran <n> tests; the base ran <m>." |
| fewer than `minTests` | any (a failed status keeps its own reason) | `check.base_no_tests` (B), one info alert for the pair | no |
| at least `minTests`, reports parsed | no readable report (none matched, or every file refused) | `check.report_missing` (C) | yes, with the rule's fixed text |
| base reports missing or refused | any | no test reason; the card says that the base wrote no readable report | no |
| any | a `partial` source (the output ring dropped the middle of the libtest text, or the read hit its time limit) | no test reason; the card names the limit | no |

A tool without a report source has no zero-test rule: the card shows "test count unknown: set check.reports" when the command's program is a known test tool (`cargo`, `vitest`, `jest`, `pytest`, `gradle`, `gradlew`, `mvn`, `mvnw`, `npm`, `pnpm`), as `commandPrograms` names it. Reading counts from free text of other tools is not built: it is forgeable and differs with each version.

#### 3.9 Lowering from the baseline (opt-in)

`check.baselineLowers: true` in the base policy makes a failed checkpoint whose failures are all in `known` (no `new`, no `flaky`, `missing` zero, both reports `parsed`, `redBaseSendBack` not `never`) get `check.known_failures` (rung B) in place of `check.base_red` (C). It is off by default, the overlay can only turn it off, `policy.changed` (E, hard) covers an agent that turns it on in the worktree, and the card names the opt-in beside the reason, since the checkpoint's report is written by the code under test.

### 4. Contracts

#### 4.1 Module layout

```
src/core/review
  base/        types.ts (contract): BaseJobRecord, BaseVerdict, BaseChecks, BaseTrigger
               BaseJobQueue.ts, InMemoryBaseChecks.ts (reference), baseChecksContract.ts (contract suite)
               SqliteBaseChecks.ts, baseDraft.ts (the fix-swarm definition)          w-base
  reports/     types.ts (contract): TestCase, TestRunSummary, ReportSource, ReportStatus, Baseline, FailureSets, REPORT_LIMITS
               reportFiles.ts (walk and checked open), junitReader.ts (saxes), libtestReader.ts,
               testKey.ts, readReports.ts                                             w-reports
               baseline.ts (computeBaseline), compare.ts (compareToBaseline)          w-reports
               fixtures/ (the sanitized P54 samples)                                  w-reports
  rules/       checkTestRules.ts (the reasons of sections 3.3, 3.8, 3.9), the calls in runRules.ts and DefaultRiskRules.ts   w-rules
  manager/     sendBackText.ts (the send-back of section 4.6), checkDecision.ts (send back, hold or rerun)   w-rules
src/main/modules/review.ts   the job start in the launch hook, the merge trigger, the handlers   w-base
src/renderer/panes/review/TestResults.tsx, panes/inbox/BaseAlertActions.tsx               w-ui
```

#### 4.2 Policy fields

```ts
// policy/schema.ts, inside `check`
reports: z
  .object({
    notes,
    /** Relative to the checkout; no `..`, no absolute path. */
    junit: z.array(reportGlob).max(32).default([]),
    /** Read the check's own output as libtest text (`cargo test`). */
    libtest: z.boolean().default(false),
  })
  .strict()
  .optional(),
/** Fewer executed tests than this is `check.no_tests`; default 1 when `reports` is set, else unused. */
minTests: z.number().int().min(0).max(1_000_000).optional(),
/** On a red base: send back the failures the base does not have, or nothing. */
redBaseSendBack: z.enum(['new_failures', 'never']).default('new_failures'),
/** Opt-in: a failure set that the base has entirely reads as rung B (`check.known_failures`). */
baselineLowers: z.boolean().default(false),

/** `$TMPDIR/` as the first part names the run's temporary directory (section 3.6). */
const reportGlob = glob.refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), 'a glob relative to the checkout');
```

The overlay (`userPolicySchema`) gains the same fields, optional; the merge takes the larger `minTests`, `never` over `new_failures`, `false` over `true` for `baselineLowers`, `true` over `false` for `libtest`, and the union of the report globs (a report source added by the user only adds information). `mergeCheck` today takes the project's check whole when it has one, so these fields are its first per-field merge. The policy hash covers the new fields, so a changed report setting is a new pair and a new baseline. The hash is taken over the effective JSON (`GitPolicyLoader`), and the new defaults enter the effective JSON of every policy with a check, so after the upgrade every such policy has a new hash: stored base rows no longer match and each base runs once more.

#### 4.3 Types

```ts
// reports/types.ts
export const TEST_STATUSES = ['passed', 'failed', 'error', 'skipped'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];
export type ReportSource = 'junit' | 'libtest';
export type ReportStatus = 'parsed' | 'partial' | 'refused' | 'missing' | 'not_configured';

/** One test of one run. suite, name and message are untrusted: code under test wrote them. */
export interface TestCase {
  readonly key: string;            // sha-256 hex of tool, suite and name (section 3.6)
  readonly suite: string;          // cleanLine, at most 1,024 characters
  readonly name: string;           // cleanLine, at most 1,024 characters
  readonly status: TestStatus;
  readonly message: string | null; // control characters removed, at most 2,000 characters
}

export interface TestRunSummary {
  readonly source: ReportSource | null;
  readonly status: ReportStatus;
  /** App text naming the rule that refused a file or the limit that cut the read; never report text. */
  readonly refusal: string | null;
  readonly files: number;
  readonly bytes: number;
  readonly executed: number;
  readonly passed: number;
  readonly failed: number;       // failed plus error
  readonly skipped: number;
}

export interface ParsedRun extends TestRunSummary {
  readonly cases: readonly TestCase[]; // in memory only; failures go to the store, the full list to a file
}

export const REPORT_LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  files: 256,
  walkEntries: 20_000,
  walkDepth: 24,
  xmlDepth: 32,
  attributesPerElement: 64,
  attributeChars: 64 * 1024,
  cases: 200_000,
  nameChars: 1_024,
  messageChars: 2_000,
  storedFailures: 2_000,
  milliseconds: 20_000,
} as const;

export type BaselineState = 'clean' | 'flaky' | 'red' | 'no_tests' | 'unparsed';
export interface Baseline {
  readonly commitId: string;
  readonly policyHash: string;
  readonly jobId: string;
  readonly state: BaselineState;
  readonly known: readonly string[];   // test keys, at most storedFailures
  readonly flaky: readonly string[];
  readonly executed: number;
}

export interface TestRef { readonly key: string; readonly suite: string; readonly name: string; readonly message: string | null }
export interface FailureSets {
  readonly against: 'baseline' | 'none';
  readonly baselineState: BaselineState | null;
  readonly new: readonly TestRef[];
  readonly known: readonly TestRef[];
  readonly flaky: readonly TestRef[];
  readonly fixed: readonly TestRef[];
  readonly missing: number;
  /** A set was cut at storedFailures. */
  readonly truncated: boolean;
}

/** The `check.reports` entry of the effective policy. */
export type CheckReports = NonNullable<NonNullable<ReviewPolicy['check']>['reports']>;

export interface ReportReader {
  /** Reads the reports of one run; never throws for a file the run wrote, only for an app failure. */
  read(input: { readonly checkout: string; readonly tempDirectory: string; readonly reports: CheckReports; readonly output: Buffer; readonly outputTruncated: boolean; readonly signal: AbortSignal }): Promise<ParsedRun>;
}
export function computeBaseline(job: BaseJobRecord, runs: readonly ParsedRun[], minTests: number): Baseline;
export function compareToBaseline(checkpoint: ParsedRun, baseline: Baseline | undefined, baseFailures: ReadonlyMap<string, TestRef>): FailureSets;
```

```ts
// base/types.ts
export const BASE_TRIGGERS = ['swarm_start', 'merge', 'capture', 'user'] as const;
export const BASE_JOB_STATES = ['queued', 'running', 'confirming', 'green', 'red', 'not_run', 'cancelled'] as const;
export type BaseTrigger = (typeof BASE_TRIGGERS)[number];
export type BaseJobState = (typeof BASE_JOB_STATES)[number];

export interface BaseJobRecord {
  readonly id: string;                 // bjob_<hex>
  readonly swarmId: SwarmId;           // the swarm that requested it first
  readonly commitId: string;
  readonly policyHash: string;
  readonly trigger: BaseTrigger;
  readonly state: BaseJobState;
  readonly checkIds: readonly string[]; // the base rows of the job, in order: first, confirm or baseline run
  readonly requestedAt: string;
  readonly endedAt: string | null;     // null while queued, running or confirming
}

export interface BaseVerdict {
  readonly state: 'green' | 'red' | 'not_run' | 'pending' | 'unknown';
  readonly job: BaseJobRecord | undefined;
  readonly check: CheckRecord | undefined;  // the deciding run
  readonly baseline: Baseline | undefined;
}

export interface BaseChecks {
  request(input: { readonly swarmId: SwarmId; readonly commonDir: string; readonly commitId: string; readonly policyHash: string; readonly policy: ReviewPolicy; readonly trigger: BaseTrigger }): BaseJobRecord;
  verdict(commitId: string, policyHash: string): BaseVerdict;
  /** The newest final verdict of each stored pair of the commit, newest first; the start dialog's red-base banner. */
  verdictsOfCommit(commitId: string): readonly (BaseVerdict & { readonly policyHash: string })[];
  /** Resolves when no job of the pair is open; the executor calls it before it decides about a base run. */
  await(commitId: string, policyHash: string, signal: AbortSignal): Promise<BaseVerdict>;
  /** "Run base again": a new job with trigger `user`; refused while a job of the pair is open. */
  rerun(swarmId: SwarmId, commitId: string, policyHash: string): BaseJobRecord;
  /** A swarm ended or was removed: its open jobs that no other swarm requested end `cancelled`. */
  release(swarmId: SwarmId): Promise<void>;
  subscribe(listener: (job: BaseJobRecord) => void): Unsubscribe;
  shutdown(): Promise<void>;
}
```

Changes to existing contracts (integration of the contract step):

- `schemas.ts`: `checkRecordSchema` gains `tests: testRunSummarySchema.nullable().optional()` and `rerunOf: z.string().nullable().optional()` (the checkpoint rerun of section 3.3). Both are optional so that the code that builds a `CheckRecord` today (`ProcessCheckExecutor.ts`, `pipelineSlots.ts`, the renderer's `reviewFixtures.ts` and several tests, among them files of the hardening passes) still compiles after c-checks. `CHECK_TRIGGERS` is not needed, the job carries the trigger.
- `types.ts`: `CheckOutcomeSet` gains `failures?: FailureSets` and `baseline?: Baseline`; `CheckRequest` gains the optional `rerunOf` (the reports come with `policy.check.reports`); a new interface `TestRunStore` holds `putTestRun(checkId, summary, failures, listPath)`, `testFailures(checkId)`, `putBaseline(baseline)` and `baseline(commitId, policyHash)`, apart from `ChangesetStore`, so that `SqliteChangesetStore` (w-base) still satisfies `ChangesetStore` after c-checks; `ReviewSwarmView` gains `purpose?` and `AssessInput` gains `swarmPurpose` (the rule of `check.base_fix`); `ReviewItemPayload` is unchanged; `BaseAlertPayload` is new (section 4.8).
- `CheckExecutorDeps` is declared in `capture/ProcessCheckExecutor.ts`, not in `types.ts`: w-base adds `bases?: BaseChecks` and `reports?: ReportReader` there as optional fields, so the tests of the hardening passes compile unchanged, and i-checks sets both in the module.
- `ProcessCheckExecutor.run` calls `bases.await` before it takes a check slot (section 3.2), in place of its own `baseRun`, and `bases.request` with trigger `capture` when the pair has neither a green row nor an open job; the base run itself moves into `BaseChecks`, which calls a `runBase(request)` seam of the executor that is the present `runTarget(request, 'base', ...)` and takes a slot ahead of the waiting checkpoint runs. `compared` reads the base output from the base record's `outputTail`, since a base run of a job is no longer in the same call.
- `execute` calls `reports.read` between `processes.endRun` and the removal of the checkout when `reports` is set, and removes the files that match the globs right after the checkout is made (section 3.6).
- `swarm/definition.ts`: `purpose: z.object({ kind: z.literal('base_fix'), commitId: sha, policyHash: hash }).strict().optional()`.

#### 4.4 Tables and migration 2

Module `review`, migration 2. As in migration 1, a row that outlives its swarm carries the swarm id without a foreign key (`review_changesets`), and a row that matters only while its swarm exists cascades from `swarms` (`review_capture_jobs`, `review_repo_snapshots`). A plain foreign key on `swarms(id)` would make `SwarmStore.deleteSwarm` fail under `PRAGMA foreign_keys = ON` once the swarm had requested a job.

```sql
CREATE TABLE review_base_jobs (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL,                        -- no foreign key: the job and its baseline outlive the swarm row
  commit_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('swarm_start', 'merge', 'capture', 'user')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'confirming', 'green', 'red', 'not_run', 'cancelled')),
  check_ids TEXT NOT NULL DEFAULT '[]',          -- JSON array of review_checks ids, in run order
  requested_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK ((state IN ('queued', 'running', 'confirming')) = (ended_at IS NULL))
);
CREATE INDEX review_base_jobs_pair ON review_base_jobs (commit_id, policy_hash, requested_at);
CREATE UNIQUE INDEX review_base_jobs_open ON review_base_jobs (commit_id, policy_hash) WHERE ended_at IS NULL;

CREATE TABLE review_base_job_swarms (           -- every swarm that requested the job, for release and alerts
  job_id TEXT NOT NULL REFERENCES review_base_jobs(id),
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, swarm_id)
);

CREATE TABLE review_test_runs (                 -- one row per check run whose reports were looked for
  check_id TEXT PRIMARY KEY REFERENCES review_checks(id) ON DELETE CASCADE,
  source TEXT CHECK (source IS NULL OR source IN ('junit', 'libtest')),
  status TEXT NOT NULL CHECK (status IN ('parsed', 'partial', 'refused', 'missing', 'not_configured')),
  refusal TEXT CHECK (refusal IS NULL OR length(refusal) <= 300),   -- app text
  files INTEGER NOT NULL DEFAULT 0 CHECK (files >= 0),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  executed INTEGER NOT NULL DEFAULT 0 CHECK (executed >= 0),
  passed INTEGER NOT NULL DEFAULT 0 CHECK (passed >= 0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  list_path TEXT,                                -- JSON lines of every case, relative to the profile data directory
  CHECK (executed = passed + failed)
);

CREATE TABLE review_test_failures (             -- failed and errored cases; untrusted text
  check_id TEXT NOT NULL REFERENCES review_checks(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL CHECK (length(test_key) = 64),
  suite TEXT NOT NULL CHECK (length(suite) <= 1024),
  name TEXT NOT NULL CHECK (length(name) <= 1024),
  status TEXT NOT NULL CHECK (status IN ('failed', 'error')),
  message TEXT CHECK (message IS NULL OR length(message) <= 2000),
  PRIMARY KEY (check_id, test_key)
);

CREATE TABLE review_baselines (
  job_id TEXT PRIMARY KEY REFERENCES review_base_jobs(id),
  commit_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('clean', 'flaky', 'red', 'no_tests', 'unparsed')),
  known TEXT NOT NULL DEFAULT '[]',              -- JSON array of test keys
  flaky TEXT NOT NULL DEFAULT '[]',
  executed INTEGER NOT NULL CHECK (executed >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX review_baselines_pair ON review_baselines (commit_id, policy_hash, created_at);

ALTER TABLE review_checks ADD COLUMN rerun_of TEXT REFERENCES review_checks(id) ON DELETE SET NULL;
```

`checkRecordSchema.tests` is read from `review_test_runs` by a join, so `review_checks` keeps its columns apart from `rerun_of`. The list files live in `review/<swarm>/<name>.<run id>.tests.jsonl` beside the logs, mode `0600`, and go with the retention of the logs (0042: retention not built). Migration 2 adds no rows: existing base rows have no job and no baseline, and their pairs read as `unknown` until a job runs. The in-memory store gains the same records.

#### 4.5 Reasons

| Id | Source | Rung | Hard | Sent back | When |
|---|---|---|---|---|---|
| `check.failed` | check | C | no | yes | as today; on a red base only with new failures and `redBaseSendBack: new_failures` (section 3.3); evidence gains the failing sets |
| `check.base_red` | check | C | no | no | as today; on a red base with no new failure, or with `redBaseSendBack: never`, or without parsed reports |
| `check.no_tests` | check | C | no | yes | section 3.8 |
| `check.base_no_tests` | check | B | no | no | section 3.8 |
| `check.report_missing` | check | C | no | yes | section 3.8 |
| `check.known_failures` | check | B | no | no | only with `baselineLowers: true` (section 3.9) |
| `check.flaky_pass` | check | B | no | no | the checkpoint passed only on the rerun of section 3.3 |
| `check.base_fix` | policy | C | no | no | every changeset of a swarm with `purpose.kind = 'base_fix'` |

Evidence holds counts, test keys and the fixed text of the rule; test names and messages stay in `review_test_failures` and reach a view only through the untrusted paths of section 4.6. The policy's `rungs` may change these ids within the hard-floor rule, as for any id (0040 section 7.2); `check.known_failures` cannot be set below B by the policy.

#### 4.6 Card and send-back text

Card (`TestResults` under `CheckBlock`), app text with the counts; each name through `plainText`, one line, the suite muted before it:

- "Tests: <executed> ran, <failed> failed, <skipped> skipped (<source>)", or "Test count unknown: this check has no report source. Set check.reports in the policy." for a known tool without a source, or "The test report could not be read: <refusal>".
- "New failures (<n>)", "Known on the base (<n>)", "Flaky on the base (<n>)", "Fixed by this change (<n>)", "<n> tests that ran on the base did not run here"; each list shows the first 50 names with a "Show all" Disclosure; a failure's message in a `pre` under the name, marked "written by the code under test".
- The base line: "Base check: green", "green, with <n> flaky tests", "red, confirmed by a second run", "running", "queued", "did not run: <reason>", with the job's trigger.
- With `check.known_failures`: "Lowered to B because the policy turns on baselineLowers: every failure was already failing on the base. The test report comes from the code under test."

Send-back (`sendBackText.ts`), app text first, data in untrusted-data blocks with a nonce (0040 section 14):

```
The project check failed. Command: <argv as JSON>.
New failures, which the base commit does not have: <n>. The names and messages follow as data.
<untrusted block "new failures": one line per test, suite and name, then the message cut to 300 characters>
[Flaky on the base, failed here too: <n>. <untrusted block "flaky failures">]
[Already failing on the base, not caused by this change: <n> (not listed).]
The end of the output follows as data.
<untrusted block "check output": the record's output tail (at most 8,000 characters), as today>
```

For `check.no_tests`: "The project check passed but ran <n> tests; on the base commit it ran <m>. Check that the tests are still found." For `check.report_missing`: "The project check passed but wrote no readable test report matching <globs as JSON>; on the base commit it did."

The reviewer prompt gains the same sets in its check block, as untrusted data, and the inbox message of a review item gains no names: "<agent> in <goal>: rung C, check.failed (<n> new failures)".

#### 4.7 Commands, IPC and parity

| Command | Input | `ui` | `mcp` | Reason when exempt |
|---|---|---|---|---|
| `review_base_status` | `{ swarmId }` | `{}` | true | |
| `review_base_verdict` | `{ commitId }` | `{}` | false | "the start dialog's view for the user; agents see their swarm's base through review_base_status" |
| `review_base_rerun` | `{ swarmId, commitId, policyHash }` | `{}` | false | "a base result is the user's precondition; an agent could rerun a flaky base until it reads green" |
| `review_base_fix_draft` | `{ swarmId, commitId, policyHash }` | `{}` | false | "the user starts a fix swarm from the start dialog; agents use swarm_start" |

`review_base_status` returns, per pair in use by the swarm's undecided changesets and its base, the verdict, the job state and trigger, the counts of the deciding run and the baseline state; test names only through the module's caller view (wrapped as untrusted for session callers, as `callerView.ts` does). The caller scope is the swarm's (0041). The renderer calls the commands through `api().invoke`; no new IPC channel. Events: `review.base_changed { swarmId, commitId, policyHash, jobId, state }` on the app bus and across IPC. `docs/parity.md` lists the new commands. `swarm_start` keeps its own approval for a fix swarm.

#### 4.8 Inbox items

| Item | Origin and key | Text (app text) | Actions | Resolved |
|---|---|---|---|---|
| Red base | `review:base`, key unchanged | "The check fails on the base commit, also on a second run: <command>" and the details of today plus "<n> tests fail on the base" when reports are parsed | "Run base again" (`review_base_rerun`), "Fix with an agent" (opens the start dialog with `review_base_fix_draft`), "Open log" | as today; also when a newer job of the pair ends `green` |
| Base without tests | `review:base_no_tests`, key `review:base_no_tests:<swarm>:<commit>:<policy>` | "The check runs no tests on the base commit: <command>. Changesets cannot be accepted at rung A." | "Run base again", "Open policy" | a job of the pair ends with `executed >= minTests` |
| Base still running when a changeset waits for it | none | the changeset row shows "waiting for the base check" | | |

`BaseAlertPayload` is `{ swarmId, baseCommit, policyHash, jobId?, state?, failing?: number | null, canFix?: boolean }`: `baseCommit` keeps the name of today's payload, and the new fields are optional because the open alerts posted before the upgrade lack them (the actions then read the job through `review_base_status`). `canFix` is false for a swarm whose purpose is `base_fix`, so a fix swarm does not offer a fix of itself. `BaseAlertActions` reads only that payload; `ReviewCardActions` dispatches it for `BASE_ALERT_ORIGIN`, as it does `RepositoryAlertActions`, so `ItemCard.tsx`, which 0043 edits, is not touched.

#### 4.9 Settings

No new profile setting. `review.maxConcurrentChecks` covers base jobs; a base job takes the next free slot ahead of checkpoint runs.

### 5. Builder tasks

The hardening passes (the eighth, and the ninth and last that the user's answer A1 added) edit `core/review/capture/checkEnvironment.ts` and its tests, `ProcessCheckExecutor.test.ts`, `ProcessCheckExecutor.srt.test.ts`, `main/modules/review.test.ts`, `main/modules/session.ts`, `core/isolation/**`, `core/review/**`, `scripts/mutation-checks.mjs` and `app/README.md`. 0043 (R21) edits `core/inbox/**`, `core/hooks/**`, `core/access/**`, `renderer/panes/inbox/ItemCard.tsx` and the tasks pane, and its contracts step c-m6 also edits `core/events/index.ts` and `docs/parity.md`. 0044 (notes) edits `core/notes`, `core/mounts` and the editor, and its contracts step c-notes also edits `core/events/index.ts`, `docs/parity.md`, `package.json` and the lockfile. Below, "the hardening pass" is the ninth.

| Task | Files (only these) | Starts |
|---|---|---|
| c-checks (contracts) | `core/review/base/types.ts`, `base/InMemoryBaseChecks.ts`, `base/baseChecksContract.ts`, `core/review/reports/types.ts`, `schemas.ts` (the check fields, optional), `types.ts` (the seams of 4.3, `TestRunStore`, `purpose` on the swarm view and the assess input), `policy/schema.ts`, `policy/mergePolicy.ts` (the overlay rules of 4.2) with its test, `reasonCatalogue.ts`, `commands.ts` (the base commands of 4.7, handlers "not built yet"), `store/reviewMigrations.ts` (migration 2), `store/InMemoryChangesetStore.ts`, `store/changesetStoreContract.ts`, `manager/InMemoryReviewManager.ts` (the calls of `checkDecision` and `sendBackText` in `decide`, the purpose in the assess input), new stub files `manager/sendBackText.ts` and `manager/checkDecision.ts` that keep today's behaviour, `fakes/**`, `swarm/definition.ts` (`purpose`), `core/events/index.ts` (the event), `docs/parity.md` (regenerated by `scripts/parity.mjs`), `package.json` and `pnpm-lock.yaml` (saxes 6.0.0, exact) | after the ninth hardening pass and its review end, and never at the same time as the contracts steps c-m6 (0043) and c-notes (0044), which edit `core/events/index.ts`, `docs/parity.md` and (c-notes) `package.json` and the lockfile too |
| w-base | `core/review/base/**` other than the contract files; `capture/ProcessCheckExecutor.ts` (the optional `bases` and `reports` dependencies, the `await` before the slot, the `runBase` seam, `compared` on the stored tail, the removal of committed reports and the `reports.read` call of 4.3) with a new test file `capture/baseSeam.test.ts`; `store/SqliteChangesetStore.ts` (`TestRunStore`: the job, test run and baseline statements) with `store/SqliteBaseJobs.test.ts`; `manager/ReviewInbox.ts` (the alert texts, the no-tests alert); `manager/SwarmReviewFacts.ts` (`purpose` on the swarm view); `main/modules/review.ts` (the launch hook, the merge trigger, the handlers, `release` on swarm end) | after c-checks |
| w-reports | `core/review/reports/**` other than `types.ts`, with the P54 samples as fixtures (sanitized; no host, user or path; no secret-shaped literal) | after c-checks, beside w-base |
| w-rules | a new `core/review/rules/checkTestRules.ts` with its test (`rules/testRules.ts` exists already and holds the `tests.*` diff reasons), the red-base branch of `checkReasons` in `rules/runRules.ts` (`check.failed` with new failures) and the call in `rules/DefaultRiskRules.ts`, where the rules are registered (`rules/index.ts` only re-exports); `manager/sendBackText.ts` and `manager/checkDecision.ts` (the send-back, the hold on a red base and the checkpoint rerun of section 3.3), filling the stubs of c-checks; `reviewer/prompt.ts` (the sets in the check block) | after c-checks, beside w-base and w-reports (it builds against fixtures of `FailureSets`) |
| w-ui | `renderer/panes/review/TestResults.tsx`, the call in `ChangesetSections.tsx` (`CheckBlock`), `renderer/panes/inbox/BaseAlertActions.tsx` and its dispatch in `ReviewCardActions.tsx`, the start dialog's draft input and its red-base banner (`renderer/dialogs/swarm/StartSwarmDialog.tsx` and `swarmForm.ts`, a prefilled definition and the banner of section 3.5), `e2e/reviewBase.spec.ts`, the `review` phase of `scripts/visual-check.mjs` | after c-checks; its e2e after w-base |
| i-checks (integration) | wiring in `main/modules/review.ts` after w-base, the executor's `reports` dependency, `scripts/e2e-real-review-check.mjs` (a real Haiku worker in a tiny vitest project whose check has a report; at most a few cents), the mutation entries in `scripts/mutation-checks.mjs` (after the ninth pass has released it), `app/README.md`, 0040 and 0042 amendments | after every builder and its review |

Shared files and their order: `ProcessCheckExecutor.ts` (ninth pass, then w-base, then i-checks for the wiring of `reports`); `main/modules/review.ts` (ninth pass for its test, then w-base, then i-checks); `InMemoryReviewManager.ts` (a contract file: c-checks adds the seam, nobody else edits it); `manager/sendBackText.ts` and `manager/checkDecision.ts` (c-checks stubs, then w-rules); `scripts/mutation-checks.mjs` and `app/README.md` (ninth pass, then i-checks); `core/events/index.ts`, `docs/parity.md`, `package.json` and the lockfile (one contracts step at a time: c-m6, c-notes and c-checks in the order the user's queue reaches them). Each step compiles: the new record fields and dependencies are optional, and the new store methods sit in `TestRunStore`, which only the in-memory store implements until w-base. Each task gets its own review before the integration, and the integration gets the combined review and fix steps until a review finds no major (0042 recommendation).

### 6. Test plan

- Contract suites: `describeBaseChecksContract` over the in-memory and the SQLite implementation (the state table of 3.1 row by row; one open job per pair; a request joining an open job; the confirm rerun on red and on a timeout; `await` resolving on the end and on the signal; `rerun` refused while open; `release` cancelling only jobs no other swarm requested; restart: an open job is `queued` again when a swarm uses the pair, `cancelled` otherwise). The changeset store contract gains the test runs, the failures and the baselines.
- Reader (`reports`): every limit of `REPORT_LIMITS` with an input one over it; the P55 cases built at run time (billion laughs, deep nesting, a huge attribute, an external entity naming a canary file that must not appear, an undeclared entity, a large generated report against the case limit); a link to a file outside the checkout, a link in a parent directory, a directory swapped for a link between the walk and the open, a FIFO, a hard link (`nlink` 2), a file on another device (a mounted disk image where the host allows it, else a stubbed `fstat`), a file over the size limit; the P54 samples of vitest, nextest and Gradle and the documented pytest and surefire shapes, each giving the expected keys and statuses; a raw `>` in an attribute (valid XML); control characters, bidi marks and a 10,000-character name.
- libtest: the P54 text (forged `... ok` lines in a failing test's section ignored, the `--nocapture` interleave refused by the count), `should panic` lines, `ignored, <reason>`, several binaries named by their `Running` lines, an output with a dropped middle (`partial`).
- Baseline and comparison: a table over (known, flaky, executed) × checkpoint statuses for each set; truncation at `storedFailures`; `unparsed` when a run of the job had no readable report.
- Rules: each row of the tables of 3.3, 3.8 and 3.9; `redBaseSendBack: never`; the overlay never turning `baselineLowers` on and never lowering `minTests`; a policy that sets `check.known_failures` below B ignored; `check.base_fix` on every changeset of a fix swarm and on none of a plain swarm.
- Manager: the send-back text with new failures only, the flaky-only rerun, no names in the inbox message, the reviewer prompt's check block.
- Executor: with one check slot, a capture whose pair has a queued job ends (it waits outside the slot); a report committed at a glob path is removed before the setup and not read; a second report file that names a failing test as passed leaves it failed; a forged report with no failure for a failed status gets no rerun; a pass on the rerun gives `check.flaky_pass` and no acceptance at A; deleting a swarm that requested a job succeeds.
- Module: the job queued in the launch hook before the first launch (the fake runtime records the order), a capture waiting for the open job and running no base run of its own, the merge trigger, the alert actions through the command handlers with the caller scopes, `review_base_rerun`, `review_base_fix_draft` and `review_base_verdict` refused to a session caller.
- e2e (hidden windows): a red base alert with both actions; the card's sets from a fake check executor; the start dialog on a commit with a stored red verdict shows the banner, and "Fix the base first" loads the draft.
- Real: `scripts/e2e-real-review-check.mjs`, outside the default commands, Haiku, `--max-budget-usd 0.25`, an empty temporary directory, `--setting-sources user`, `--strict-mcp-config`.

Mutation targets (each must fail a test): the walk follows a link; `O_NOFOLLOW` dropped; the `nlink` test dropped; the file type test dropped; the device test dropped; the size, file, entry, depth and case limits removed; a `doctype` event accepted; an undefined entity accepted; `known` and `new` swapped; a flaky failure counted as new; skipped counted as executed; the base confirm rerun skipped; a red base decided by one red run; green from a confirm run that did not pass; the executor running its own base run while a job is open; the job queued after the first launch; no job after a merge; the checkpoint run promoted to a base; `review_base_rerun` callable by a session; test names in the inbox message; known failures listed in the send-back; `check.no_tests` without a base comparison; `check.no_tests` from a run without a report source; `baselineLowers` on by default; the overlay turning it on; `redBaseSendBack` ignored on a red base; the libtest block count check removed; a forged line after `failures:` counted; `check.base_fix` missing on a fix swarm; `bases.await` called while the slot is held; committed reports left in place; a repeated key taking its last status; the flaky rerun on a report without failures; `check.flaky_pass` missing after a rerun pass; test names in the fix swarm's goal.

### 7. Security

| Threat | Measure | Residual |
|---|---|---|
| A report file is a link, or sits under a linked directory, to a file the check cannot read but the app can (the app root, the Claude configuration, a key file), and its content reaches the card, the reviewer or the agent | the walk never follows a link; each file is opened with `O_NOFOLLOW` and checked by `fstat` (regular, one link, the checkout's device, size) and by a second resolve of its directory with a device and inode comparison (P52); the reader runs after the end sweep | a hidden survivor of the run (0042, process sweep) could swap a file between the checks and the read; the descriptor checks bind the content read to the file checked |
| A hard link to a protected file on the same volume | `nlink` must be 1 | none known |
| A FIFO or a device file blocks or floods the reader | `O_NONBLOCK` open and the type test before any read; the time limit | none known |
| Entity expansion, external entities, deep nesting, a huge attribute or file (billion laughs, XXE) | saxes processes no DTD and reads no file (P55); the handler refuses `doctype`, processing instructions and every limit of `REPORT_LIMITS`; byte limits per file and per run before parsing | saxes keeps an attribute whole until its tag ends, bounded by the file size limit (16 MiB) |
| Test names and messages carry injection text, control characters, bidi marks or markup | stored as untrusted columns; `cleanLine` and NFC for the key; `plainText` in the renderer; untrusted-data blocks with a nonce in the send-back and the reviewer prompt; the inbox shows counts only | the agent reads text its own code wrote; the reviewer reads it as data (0040 section 10.3) |
| A forged report (code under test writes the XML or prints libtest lines) | a report never turns a failed status into a pass and never lowers a rung by default; the libtest block rules refuse forged lines in a failing test's output (P54); the opt-in `baselineLowers` is named on the card | a forged report can claim tests ran (and so avoid `check.no_tests`) or claim that failures are known (and so keep a red-base failure from the send-back); the zero-test rule catches mistakes, not intent |
| The baseline is poisoned (a survivor or a flaky service during a base run) | the swarm-start job runs before agent code when a check slot is free; the confirm rerun; a base run with survivors is `not_run`; the base job after a merge runs merged code that a review accepted | a poisoned `known` set only shortens the send-back; the card shows every failure, the rung is C, and nothing is lowered unless the policy opts in |
| An agent reruns a flaky base until it reads green | `review_base_rerun` and `review_base_fix_draft` are UI only (`mcpExempt`) | the user can do it; the alert says that the first run was red |
| A fix agent weakens or deletes tests to make the base pass | `check.base_fix` (C) on every changeset of the fix swarm, plus `tests.*` and `config.test_lint`; the goal text says not to | a person decides |
| Report globs reach outside the checkout | the schema refuses `..` and absolute globs; the walk starts at the checkout and the run's temporary directory only | none known |
| A report is committed into the checkpoint (or the base) at a glob path, so it is read although the tool wrote none | the matching files are removed right after the checkout, before the setup | the code under test can still write one at run time (row of forged reports) |
| A second report file or a printed libtest block names a failing test as passed | a repeated key is failed when any entry failed | none known |
| Failing test names reach the goal of a fix swarm, which the agent and the reviewer read as user text | the draft's goal and prompt are app text; the names go into an untrusted-data block that the start dialog shows as data | the user starts the swarm after reading the draft |
| A flaky-only failure set buys a rerun until a run passes | one rerun per changeset, only for a parsed report with at least one failure, all flaky; a pass adds `check.flaky_pass` (B) | the change is reviewed at B, not accepted at A |
| Reading reports holds a check slot for long | `milliseconds` limit; the read ends `partial` with a refusal text | |
| The report holds host data (Maven properties, host names) | only suite, name, status and message are kept; the list file has mode `0600` | a message can still carry a path or a host name the test printed |

The trust boundary of the baseline: it is as trusted as the code that the base commit holds and the runs that made it. At swarm start that is the user's commit; after a merge it is agent code that a review accepted. It informs the agent and the person; it decides a rung only under the opt-in.

### 8. Estimates

In 0005 units (working days for one engineer plus agents), low confidence:

| Part | Days |
|---|---|
| c-checks | 0.5 to 1 |
| w-base | 2 to 3 |
| w-reports | 1.5 to 2.5 |
| w-rules | 1 to 1.5 |
| w-ui | 1.5 to 2 |
| i-checks, reviews and their fixes, the real-Claude script | 2 to 3 |
| First slice | 8.5 to 13 |
| What waits (section 2) | 3 to 5 |

At the milestone 5 build rate (about 77 summed agent minutes per estimated day, 0042) the slice is about 11 to 17 summed agent hours.

### 9. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| A slow check doubles its cost at each swarm start and merge (the baseline run) | the first capture of a swarm waits longer | the second run only with reports (question 6); base jobs go ahead of checkpoint runs; the agents do not wait |
| Test names change between runs (parametrized names with times or addresses, generated names) | flaky noise, missing counts | the key leaves out messages and times; a test whose name changes each run shows as new and missing, and the card shows both |
| A project's reports land outside the checkout (a build directory configured to `/tmp`) | no report | the run's temporary directory is walked too (`TMPDIR` points there); other places are refused by design |
| saxes 6.0.0 has had no release since 2021 | an XML defect unfixed upstream | the reader keeps saxes behind `junitReader.ts`, and the P55 cases run in the suite against it |
| The ninth hardening pass changes the executor again | the seam of 4.3 moves | c-checks starts after that pass and its review |
| Fix swarms on a red base are started and the running swarm stays red | the user expects the running swarm to turn green | the alert and the dialog say that the fix applies to swarms that start after its merge (question 5) |
| Base jobs for many agents' merged checkpoints pile up | the check slot is busy with bases | a job is per pair; a merged checkpoint whose agent has ended needs no job until a capture asks for it (the `merge` trigger only for an agent that is still running or waiting) |

### 10. Probe results

`notes/probes-checks-design.md` (P54 to P56): real JUnit reports from vitest 5.1.0, cargo nextest 0.9.149 and Gradle 9.5.1 and real libtest text from cargo 1.99.0, the documented pytest, surefire and jest shapes, the hostile inputs against saxes, fast-xml-parser and a prototype reader, and the zero-test behaviour of each tool. The design effects listed there are used in sections 3.6 to 3.8 and 7.

XML parser choice (question 3), from P55: the repository has no XML parser in `dependencies`; saxes 6.0.0 and its dependency `xmlchars` 2.2.0 are in the lockfile through jsdom (dev); `parse5` is an HTML parser. saxes refused every entity case and the external entity without reading the canary, streamed 200 MB in 1.8 s at 84 MB, and needs the depth and attribute limits in the handler. fast-xml-parser 5.11.2 (not in the repository; its package lists dependencies of its own) refused the external entity and deep nesting, left entities as literal text, and took about 1.8 GB for 200 MB, since it parses one string into a tree. The prototype refuses every hostile case but cuts a tag at the first `>`, so a valid report with a raw `>` in an attribute is refused, and every such gap is code the app owns. The choice is saxes as a direct dependency at exact version 6.0.0: it adds `saxes` to `dependencies` and an importer entry to the lockfile, and no new package (the npm registry metadata in the local cache shows 6.0.0 as the latest release, of 2021-11-07). The independent review reran P55 on the same host and day with the same outcomes for every case (saxes 1.9 s and 82 MB for 200 MB; fast-xml-parser 7.2 s and about 1.85 GB).

### 11. Questions for the user

The user answered these questions on 2026-11-26 (the decision page numbered them D1 to D6), each with its recommendation; section 12 holds the answers. They stay here as asked.

1. Should the agents of a swarm wait for the base check before they start? Recommendation: no. The job is queued before the first launch and ahead of every checkpoint run, so it runs before agent code whenever a check slot is free; when the slots hold checks of other swarms, the agents start first and the job runs at the next free slot (waiting there is the alternative). Captures wait for it; a long check does not hold the agents.
2. On a red base with readable reports, should the failures that the base does not have be sent back to the agent (the rung stays C)? Recommendation: yes, as the policy default `redBaseSendBack: new_failures`, with `never` for the rule as built.
3. Add saxes 6.0.0 as a direct dependency for the JUnit reader? Recommendation: yes; it is in the lockfile already, streams, expands no entity and reads no file. The alternatives are fast-xml-parser (a new package with dependencies of its own and a tree in memory) and an own reader (code to own).
4. The zero-test rule as in section 3.8: `check.no_tests` (C, sent back) when the base ran tests and the checkpoint ran fewer than `check.minTests`; `check.base_no_tests` (B, an info alert, no send-back) when the base runs none; no rule for a tool without a report source. Recommendation: yes, with `minTests` 1 by default when reports are set.
5. "Fix the base with an agent" starts a separate one-agent swarm on the red base, whose merge helps the swarms that start after it, and the running swarm keeps its red base. Is that enough for now, or should rebasing a running swarm onto the fixed base be designed next? Recommendation: build the separate swarm now and offer it also in the start dialog when the stored base of the chosen commit is red; rebasing waits.
6. Run the second base run (for flaky tests) only when the policy sets `check.reports`? Recommendation: yes; without test names a second run can tell only that the whole base is flaky, which the confirm rerun of a red base already tells.

### 12. Decisions of the user

The user answered on a decision page on 2026-11-26 and took every recommendation. The same page asked about the hardening of the confined check (A1): one more fix round, then one commit for everything; c-checks therefore starts after that ninth pass and its review (section 5).

| Question | Answer | Differs from the recommendation |
|---|---|---|
| D1: should a swarm's agents wait for the base check | no: agents start at once; the job is queued before the first launch and captures wait for it | no |
| D2: on a red base with readable reports, send back the failures the base does not have | yes, policy default `redBaseSendBack: new_failures`, `never` for the rule as built | no |
| D3: saxes 6.0.0 as a direct dependency | yes | no |
| D4: the zero-test rule of section 3.8 | yes, with `minTests` 1 by default when reports are set | no |
| D5: "fix the base with an agent" as a separate one-agent swarm; rebasing running swarms later | yes, and the fix is offered in the start dialog when the commit's stored base is red | no |
| D6: the second base run only when reports are configured | yes | no |

Changes that follow: the start dialog's red-base banner, which the recommendation of D5 named and the design did not yet describe (section 3.5, the command `review_base_verdict` and `BaseChecks.verdictsOfCommit` of sections 4.3 and 4.7, w-ui, the tests); the waits for the ninth hardening pass (section 5, the risks). No estimate changes: the banner fits the range of w-ui.

## Consequences

- 0040 gains, when next revised: the base job (section 6, "Base comparison"), the report reading and its limits (section 6, a new bullet), the new reasons in section 7.2, the policy fields in section 8.2, the alert actions in section 12, the test sets on the card in section 13 and in the send-back in section 14, and the rows of section 7 above in section 17.
- 0042's zero-test row is answered by sections 3.8 and 4.5 once built; the process sweep row stays open after merges.
- 0037 gains `purpose` on a swarm definition.
- 0041's contract list grows by the files of c-checks; `docs/parity.md` lists the new commands.
- The application gains one direct dependency, saxes 6.0.0 (question 3, answered yes).
- Not verified: pytest, Maven surefire and jest reports from a real run on this host; saxes inside the Electron main process (P55 ran Node 22 only); report reading under `srt` with a real survivor that swaps files during the read; the time a baseline run adds to a swarm start on a real project; the libtest block rule against interleaved stdout and stderr in the app's output ring (P54 captured the two streams apart).
