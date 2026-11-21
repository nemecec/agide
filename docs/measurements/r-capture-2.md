# r-capture-2: review of the second fix pass of the window capture

Start: 2026-11-21T11:54:21Z. End: 2026-11-21T12:11Z.

Independent review of the changes recorded in `f-capture-2.md`. No product code was changed. Scratch specs and backup copies were removed afterwards; each mutated source file was restored and checked against its checksum.

## Scope checks (scratch e2e, agent of folder Work)

| Case | Agent result | Agent time | User result | User time |
| --- | --- | --- | --- | --- |
| loaded tab of Other open in the surface host | `unavailable` empty, `main` masked, slot shows the pane mask | 61 ms | page still drawn | 107 to 155 ms |
| never-loaded tab of Other open in the surface host | `unavailable` empty, `main` masked | 60 to 80 ms | `unavailable` names the tab | 1591 to 1624 ms |
| surface host bound to the tab of Other by a `value` binding (applied by the user, and by the agent) | `main` not masked; the chrome with the tab's address is drawn, the slot shows "not shared" | 78 to 84 ms | not measured | not measured |
| user opens the tab of Other while the agent capture waits for its own blank tab | `main` not masked; the PNG shows the title and address of the tab of Other | 1627 to 1678 ms | not measured | not measured |
| loaded own tab, consecutive agent captures | `unavailable` empty every time | 110 to 134 ms | not measured | not measured |

The agent's capture time does not depend on the state of a tab of another folder. The agent result text never contained the leaf id of a tab of another folder. The last two rows are scope leaks through the image: `maskedInstances` ignores `value` bindings, and `masked` is computed before the patience wait, so a pane that changes to another folder during the wait is drawn unmasked.

## Mutation checks

| Mutation | Result |
| --- | --- |
| folder scope check removed from the overlay predicate | `browser.test.ts` filter test fails |
| masked-pane check removed | `browser.test.ts` filter test fails |
| capture every view | `browser.test.ts` filter test fails |
| predicate ignored in `visibleViews` | `ElectronViews.test.ts` predicate test fails |
| race removed from `capturePageWithin` | both never-settling tests fail |
| cap replaced by a very long timeout | cap test fails |
| cap replaced by the patience of 0 | cap test fails |
| scope not passed by `ui_capture_window` | `layout.test.ts` scope test fails |
| masked leaf ids not read from the DOM | no unit test fails; the e2e leak test passes |
| `unavailable` dropped from the result | e2e "names a shared tab that never loaded" fails |
| both guards removed, e2e leak test with `--repeat-each=5` | 3 failed, 2 passed |
| both guards removed, scratch leak test that waits until the foreign view is placed | fails, foreign id in `unavailable`, 1631 ms |
| scope guard removed, scratch leak test that waits | passes: the masked-pane guard alone holds |

The e2e leak test captures right after the pane becomes visible, before the foreign view is placed, so it passes without either guard in part of the runs.

## Verification

| Command | Result |
| --- | --- |
| `pnpm typecheck` | ok |
| `pnpm check:colours` | ok |
| `pnpm coverage` | 216 files, 2212 passed, 15 skipped; 92.1 % lines |
| spec "switches observation off", `--repeat-each=20` | 20 passed, 43 s |
| `pnpm e2e`, run 1 | 81 passed, 2.2 min |
| `pnpm e2e`, run 2 | 81 passed, 2.3 min |

Free disk stayed at 4.7 GiB or more. `app/test-results/.last-run.json` is rewritten by every Playwright run and was left in place.
