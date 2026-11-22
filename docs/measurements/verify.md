# verify

Start 2026-11-21T19:09Z. End about 19:35Z.

Independent verification of the quality step and the integration step. No code or test was changed.

| Command | Result |
|---|---|
| pnpm typecheck | pass |
| pnpm check:colours | pass |
| node ../notes/scripts/token-contrast.mjs | pass, pairs below target 0 |
| pnpm coverage, three runs | all pass, 266 files, 2990 passed, 15 skipped, no failing test; totals 90.88 / 82.66 / 90.11 / 93.26 |
| pnpm build | pass |
| pnpm parity | pass (the permission inspector script warning is printed) |
| AGIDE_HIDDEN=1 pnpm e2e, two runs | both 86 passed, no flaky retries |
| pnpm mutation | not run: free disk fell to 2.91 GiB after the second e2e run, below the 3 GiB floor |

Scan of changed and new files: no employer name, user path or real e-mail address. Token-like strings are test fixtures for the secret detectors and example.invalid addresses. Style hits: the word "pin" in docs/measurements/w-quality.md ("No test pins it either way") and in a doc comment in app/src/core/review/manager/reviewDecisionContract.ts ("do not pin down"). Count-like text: docs/measurements/integrate.md ("262 files") and a test boundary table in rules.test.ts (data, acceptable).
