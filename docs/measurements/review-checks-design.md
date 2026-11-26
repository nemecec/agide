# review:checks-design

Start: 2026-11-26T14:00:27Z (date -u). End: 2026-11-26T14:16:35Z (date -u).

Independent review of record 0045, `notes/probes-checks-design.md`, the P54 to P56 scripts and their section of `probes/RESULTS.md`. Verdict: accept with changes.

## Checked

- The audit of 0045 section 1 against `app/src/core/review`: the executor (`baseRun`, `reusable`, `compared`, the end sweep before the removal, the 8,000-character tail, the output ring of 64 KiB and 960 KiB that takes stdout and stderr in arrival order), the base store, `ReviewInbox.watchBase`, `ReviewCardActions`, the launch hook in `main/modules/review.ts`, the merge base in `GitCaptureService`, the reason catalogue, `runRules.checkReasons`, `DefaultRiskRules`, the policy schema, `mergeOverlay` and the hash over the effective JSON, the command registry and the parity check, migration 1. The audit holds.
- P55 rerun from a private copy of the scripts with fast-xml-parser unpacked from the cached tarball: the same outcome in every case. saxes `fail` goes on after an error when an error handler is set.
- P54 and P56 from the stored evidence (`probes/out/`): the forged `... ok` line in a failing test's section, nextest without the ignored test, BEL dropped by vitest and replaced by U+FFFD in Gradle, the zero-test exits.
- The saxes release date from the npm metadata in the local cache (6.0.0 of 2021-11-07 is the latest); saxes and xmlchars in the lockfile through jsdom.
- A small `node:sqlite` probe: with `foreign_keys = ON`, a plain foreign key on `swarms(id)` makes the swarm delete fail; `ON DELETE CASCADE` and `ON DELETE SET NULL` behave as the corrected migration needs.
- Style and data scan of the new files: no employer name, user path, e-mail address or token; no banned word.

## Changes made (0045 unless named)

- Section 3.2: the base job starts before agent code only when a check slot is free (default one slot); a capture awaits the job before it takes a slot, since awaiting inside the slot blocks with one slot. Question 1, section 1 and the security table follow.
- Section 3.3: the flaky rerun only for a parsed report with at least one failure, all flaky, once per changeset; a rerun pass adds the new reason `check.flaky_pass` (B) and never accepts at A (section 4.5 row, tests, mutation targets, security row).
- Section 3.5: test names leave the fix swarm's goal (user text for the reviewer) and go into an untrusted-data block.
- Section 3.6: a glob-directed walk (an entry limit over a whole checkout with `node_modules` or `target` would refuse every real project); a `$TMPDIR/` prefix for the temporary directory; reports committed at a glob path removed before the setup; saxes `processinginstruction` and `xmldecl` wording; stop at the first error; a repeated key fails when any entry failed.
- Section 3.8: a `partial` source gives no test reason (the app's own output cap is not the agent's fault).
- Section 4.2: the overlay rule for `libtest`; the hash of every policy with a check changes on upgrade.
- Section 4.3: the new record fields optional; the store methods in a separate `TestRunStore`; `CheckExecutorDeps` lives in `ProcessCheckExecutor.ts` and gains optional fields in w-base; `compared` reads the stored tail; `purpose` on the swarm view and the assess input; where `reports.read` and the removal sit.
- Section 4.4: `review_base_jobs.swarm_id` without a foreign key, `review_base_job_swarms` cascading, `rerun_of` set to null on delete; the false claim that migration 1 has no cascade from `swarms` corrected.
- Section 4.6: the send-back carries the whole stored tail (at most 8,000 characters), not 4,000 (4,000 is the reviewer prompt's).
- Section 4.8: the payload keeps `baseCommit` and makes the new fields optional for alerts posted before the upgrade.
- Section 5: `rules/testRules.ts` already exists (the `tests.*` reasons), so w-rules adds `checkTestRules.ts` and edits `runRules.ts` and `DefaultRiskRules.ts`; c-checks creates the `sendBackText.ts` and `checkDecision.ts` stubs and owns `mergePolicy.ts`; w-base owns the executor seams and `SwarmReviewFacts.ts`; c-m6 and c-notes also edit `core/events/index.ts`, `docs/parity.md` and (c-notes) `package.json` and the lockfile, so the contracts steps run one at a time.
- Section 10: the lockfile gains an importer entry, no package; the rerun result.
- `notes/probes-checks-design.md` and the P54 to P56 section of `probes/RESULTS.md`: the temporary directory was not removed (the text said it was); the rerun of P55 noted.

## Not resolved, not checked

- Not resolved: the libtest suite from `Running` lines that arrive on stderr in a different order than the blocks on stdout in the app's ring (listed as not verified in 0045); a disturbed baseline run that marks many tests flaky only buys reruns, left as is.
- Not checked: pytest, surefire and jest formats (documentation only); saxes in Electron; Gradle and cargo were not rerun (stored evidence only); the w-ui e2e may need the e2e fixtures that the eighth pass edits.

## Leftovers

- `/tmp/agide-review-checks-design/` (about 253 MB: a copy of the P55 inputs with the 200 MB report, the unpacked fast-xml-parser, the private probe scripts): the permission system denied the removal. No process uses it. `/tmp/agide-checks-design/` of the design run is still there too.
