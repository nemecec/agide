# review:d-review: independent review of the review ladder design (0040)

Start: 2026-11-21T15:11:46Z (`date -u`). End: 2026-11-21T15:26Z (`date -u`, after the final edits and this file).

## What was done

- Read `docs/decisions/0040-review-ladder-design.md` in full, `notes/probes-m5-review.md`, the new section of `probes/RESULTS.md`, the P32 log in `probes/out/p32_control_requests.jsonl`, 0010, and the parts of 0021 and 0037 the record cites.
- Checked the code claims against `core/swarm` (`runtime/types.ts`, `runtime/streamLaunch.ts`, `manager/PersistentSwarmManager.ts` `onResult`, `finish`, `remove`, `workspace/git.ts`, `workspace/SwarmWorkspaces.ts`, `definition.ts`, `tiers.ts`, `settings.ts`, `budget.ts`, `manager/BudgetLedger.ts`), `core/inbox/types.ts`, `core/commands/types.ts`, `core/mcp`, `core/permissions` (`types.ts`, `classTable.ts`), `core/isolation/types.ts`, `core/store/Store.ts`, `core/theme/tokens.ts` and the ui components.
- Checks in `/tmp/agide-review-d-review/` with git 2.54.0: `--attr-source` at the empty tree does not stop a clean filter named in `info/attributes` of the common directory or through `core.attributesFile` during a guarded temporary-index `add -A`, nor a merge driver named in `info/attributes` during `merge-tree --write-tree` from the common directory; `-c core.attributesFile=/dev/null` closes the second path and blanking the names through `GIT_CONFIG_COUNT` or `-c` stops all three; `commit-tree` does not sign with `commit.gpgsign` set and a missing gpg program while `commit` fails; `write-tree` without `--attr-source` ran no filter.
- Ran the policy schema with the app's zod 4.6.7 (`{ "version": 1 }` and the example parse with nested defaults) and the edited SQL of section 3.3 in `node:sqlite` (rung below floor refused; the `app-exit` failure and `pid` accepted; deleting the swarm row keeps the changesets).

## What took long

Working through the state machine against crash, quit and merge races, and reproducing the attribute paths that `--attr-source` leaves open.

## Not finished

- No real-Claude runs (none needed for a design review).
- The subdirectory `CLAUDE.md` question and the guard changes are listed under "Not verified" in 0040.

## Disk

About 4.0 GiB free at the start, 3.7 GiB near the end (other agents share the machine). The temporary directory used under 1 MB; its removal (`rm -rf /tmp/agide-review-d-review`) was denied by the permission system, so the coordinator removes it (two small test repositories, a SQL file and two scripts).
