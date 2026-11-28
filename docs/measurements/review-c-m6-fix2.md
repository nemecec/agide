# Review of the second fix step of c-m6 (review:c-m6-fix2)

Start: 2026-11-28T14:09:31Z
End: 2026-11-28T14:21:31Z

## Work

An independent review of the second fix step of the contract step c-m6 (record 0043), against the uncommitted working tree and `docs/measurements/c-m6.md`. Read-only apart from scratch mutations, each restored and compared with `cmp`.

- Read `main/modules.ts`, the session, inbox, ask and hooks module files, `core/summary/createSummaryHandlers.ts`, `m6ModuleGraph.test.ts`, the ask contract, sections 5, 13 and 14 of 0043 and the report of the step.
- Scratch mutations of the in-memory ask service and access broker against the contract suites alone.
- Gate: typecheck, the tests of the touched areas, the m6 mutation entries, the CI-like coverage run, the build, parity, the colour check and the hidden-window e2e run.

## Results

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| vitest of `src/main`, `core/inbox`, `core/hooks`, `core/summary`, `core/access` | 50 files, 611 tests pass |
| `node scripts/mutation-checks.mjs 'm6 '` | 80 killed, 0 survived, 0 skipped |
| CI-like coverage (a directory with a `node` symlink only) | 301 files pass, 1 skipped; src/core lines 97.46 (threshold 97), statements 94.94, branches 87.29, functions 95.88 |
| `pnpm build` | pass |
| `pnpm parity` | ok; `docs/parity.md` and `docs/blocks.md` unchanged (cmp) |
| `pnpm check:colours` | no literal outside the allowlist |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |

| Scratch mutation (contract suite only) | Result |
|---|---|
| ask: notice typed for an answered ask whose call still waits | killed |
| access: quiet deny for a session without a running process | killed |
| access: the second of concurrent reads runs the read again | killed |
| ask: call marked returned, settle deferred by a microtask | killed by the in-call delivery case |
| ask: the same, with the record reporting `in_call` | survived: no delivery runs in the turn right after `answer` returns |

## What took long

The m6 mutation run and the e2e run, each several minutes.

## Not checked

`pnpm coverage` with the full path (the CI-like run covers the same tests), a visible-window e2e, real-Claude runs.

## Cleanup

`/tmp/agide-c-m6-fix2` holds logs, the `node` symlink, the scratch helper scripts and the scratch copies. Its removal was denied by the permission system and is left to the coordinator.
