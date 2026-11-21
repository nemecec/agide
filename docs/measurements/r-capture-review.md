# r-capture-review: independent review of the blank window capture fix

Start: 2026-11-21T11:27Z. End: 2026-11-21T11:41Z.

## Scope

Review of the change recorded in `f-capture.md`: the retry of `capturePage` in `ElectronViews.visibleViews`, the "page not captured" placeholder, the `unavailable` field of `ui_capture_window`, the decode wait in the overlay script and the polling sample in `e2e/browser.spec.ts`. No product or test code was changed by this review.

## Runs

| Command | Result |
| --- | --- |
| `pnpm build`, then `playwright test e2e/browser.spec.ts --repeat-each=20` | 180 passed, 5.5 min |
| `pnpm e2e`, run 1 | 80 passed, 2.2 min |
| `pnpm e2e`, run 2 | 80 passed, 2.2 min |
| `pnpm typecheck` | no errors |
| `pnpm coverage` | 2207 passed, 15 skipped; 92.03 % lines |

## Mutation checks

Each check changed `src/main/browser/ElectronViews.ts` in place, rebuilt where the e2e tests needed it, and restored the file from a copy. The SHA-256 of the restored file matched the copy, and `cmp` reported no difference.

| Mutation | Test | Result |
| --- | --- | --- |
| file replaced by the committed version (no retry, no blank check) | `ElectronViews.test.ts` | 3 of 39 failed, the new retry tests |
| same | e2e "names a browser view without a painted page", repeated 3 times | failed each time, `unavailable` empty |
| same | e2e "switches observation off", repeated 3 times | passed each time |
| blank check forced to reject every capture | e2e "switches observation off" | failed after 11.2 s: "Expected > 60, Received 0" |

A view that stays blank still fails the observation test. The failure message is the same as in the original failed run and does not say that the product reported the tab in `unavailable`.

## Scope of `unavailable`

A scratch spec (removed afterwards) opened a never-loaded tab of a second folder in the main pane while an agent of another folder called `ui_capture_window`. The result was `masked: ["rail","tree","main","inbox"]` and `unavailable` held the leaf id of the out-of-scope tab. The capture also waited the full patience for that masked view.

## Cleanup

Scratch spec, logs, the file copy and the test-results directories of the failing scratch runs were removed.
