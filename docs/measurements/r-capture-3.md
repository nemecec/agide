# r-capture-3: review of the third capture fix pass

Start: 2026-11-21T12:36:12Z. End: 2026-11-21T13:00:31Z.

Independent review of the pass recorded in `f-capture-3.md`. No product code or test was changed. Scratch tests were appended to `app/e2e/browser.spec.ts` and `app/src/main/browser/ElectronViews.test.ts`, and a scratch unit file was added under `app/src/core/tree/`; each file was restored from a copy and compared with `cmp` (or removed), and every mutated source file was compared with its copy before the final runs.

## Scratch checks

| Check | Result |
| --- | --- |
| Race, main pane: the user focuses a loaded tab of another folder 0, 150, 400, 900, 1300 and 1480 ms into the wait for a blank tab of the agent, 4 runs each | `main` in `masked`, chrome and dock tab only the mask colour, foreign id not in `unavailable`, elapsed 1613 to 1642 ms |
| Race, focus at 1600 ms | the capture had ended before the focus; `main` not masked, the PNG shows the agent's own blank tab |
| Race, side pane through `ui_open_to_side` at 400 ms, 4 runs | `side` masked, chrome and dock tab only the mask colour |
| Sweep of the focus time from 1540 to 1680 ms in 7 ms steps, 2 runs | 42 captures: masked or the agent's own chrome, no foreign chrome unmasked |
| User leaves the foreign tab for an own tab as a fast capture runs, focus 0 to 78 ms after the capture starts, 3 runs | 120 captures: masked or the own chrome, no foreign chrome unmasked |
| User opens the foreign tab as a fast capture runs, focus 0 to 39 ms, 3 runs | 120 captures: 115 masked with only the mask colour, 5 own chrome, no error |
| Value binding of a pane to the foreign tab, set by the user | the pane is masked; the "not shared" still of the foreign view is drawn below the mask (no 85,85,85 pixel in the slot) |
| Agent: surface host bound by value to an own node, added and removed | allowed; not masked |
| Agent: source binding | allowed; the pane is masked |
| Agent: value binding to a string that is not a node | refused with `out_of_scope` |
| Agent: unrelated config patch while the user's layout holds a value binding to the other folder | refused with `out_of_scope`, naming the user's instance |
| Agent: `layout_get` | returns the user's value binding with the foreign node id |
| Binding to the context key `selection.object` with a selection set, `maskedInstances` with `SqliteTreeService` | throws "Unknown named parameter 'kind'" |
| Deadline, fake timers: rejection every call, blank frame every 90 ms, never-settling third call | returns at 1500 to 1520 ms; no call starts after the return |
| Deadline: a painted frame from a call started at 1400 ms that takes 100, 450, 499, 600, 1400 ms | kept for 100 to 499 ms (returns by 1899 ms), dropped for 600 and 1400 ms (returns at 1900 ms) |
| Deadline: a healthy view whose first call takes 1000, 1499, 1600 ms | captured, captured, not captured |

## Mutation checks

| Mutation | Result |
| --- | --- |
| mask read once at the start, overlay guards removed, value bindings ignored in `maskedInstances`, one rebuild | the race test, the leak test and the value binding test failed 5 of 5 each; the leak test failed on its elapsed check (1624 ms) |
| deadline check after the pause removed | one `ElectronViews.test.ts` test failed |
| floor removed | two `ElectronViews.test.ts` tests failed |
| value binding check removed from `layout_apply` | the refusal test in `layout.test.ts` (modules) failed |
| slot lookup replaced by an empty set | two `windowCapture.test.ts` tests failed |

## Verification

| Command | Result |
| --- | --- |
| spec "switches observation off", `--repeat-each=20` | 20 passed |
| capture tests of `browser.spec.ts`, `--repeat-each=5` | 25 passed |
| `pnpm e2e`, run 1 | 84 passed, 2.4 min |
| `pnpm e2e`, run 2 | 84 passed, 2.3 min |
| `pnpm typecheck` | exit 0 |
| `pnpm coverage` | exit 0; 2242 passed, 15 skipped; 92.2 % lines |
| `pnpm parity` | exit 0 |
| `pnpm check:colours` | exit 0 |

Free disk stayed at 4.4 GiB or more. Temporary files: the copies and logs in `/tmp/review-fc3`; its removal was denied by the permission system, so it is left for the owner to delete. The scratch unit file under `app/src/core/tree/` was removed.
