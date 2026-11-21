# f-capture: blank window capture in the observation-switch test

Start: 2026-11-21T10:57Z. End: 2026-11-21T11:27Z.

## Question

Can `ui_capture_window` return a page region without page pixels because the native view has not painted, and where does the handling belong. The cause of the single failed run is inferred from the blank states below and was not observed again.

## Blank states found

The window capture takes a still of every shared view with `webContents.capturePage()` and draws it as an image over the slot. Two outcomes of `capturePage` were not handled:

| Outcome | Before the change | Pixel at the sample point |
| --- | --- | --- |
| Rejects ("Current display surface not available for capture", "UnknownVizError") | still dropped, the overlay draws the grey "not shared" mask | grey, green minus red is 0 |
| Resolves with an empty image | data URL of an empty PNG, the image never loads, the overlay is transparent | renderer background, green minus red is 0 |

Both give the received value 0 of the failed run, and the product reported neither. The first sample of the test ran right after the page title was set, with no wait for a frame.

## Evidence

- A probe with a hidden `BrowserWindow` and a `WebContentsView` (own scratch Electron script, removed afterwards): `capturePage` of the view failed on every attempt for 5 s with "Current display surface not available for capture", after `did-finish-load` as well. The capture of the host window itself worked, and so did the view capture after `showInactive()`.
- The same probe launched through Playwright's `_electron.launch` captured the view at once (9 ms). The availability of a display surface for a hidden window depends on the host state, which fits an app that captures fine in nearly every run and fails rarely.
- Main-process logging in a scratch copy of `visibleViews` over three full suite runs showed one view per run returning an empty image in 0 to 1 ms: views that never loaded (empty url). Loaded views returned the full page (non-black pixels) on every capture, including captures made straight after creation.
- The failure itself did not reproduce. Runs of the spec alone (with the scratch logging and immediate repeated captures, also next to a parallel full suite), runs of the whole browser spec and three full suites before the change all passed. The states in which a capture returns nothing were shown (hidden window without surface, view without frame); the single failed run is consistent with them but was not observed again.
- The overlay set the image and waited two animation frames. The image decode is asynchronous, so under load a frame could pass before the image is drawn. This was not observed; the script now waits for `decode()` first.

## Changes

- `ElectronViews.visibleViews(capture, patienceMs)` handles the known blank states, a never-loaded view and no display surface for a hidden window: an empty or fully transparent capture, or a rejection, is tried again every 100 ms for up to `patienceMs`; a view without a painted frame afterwards is reported without `dataUrl`. Drag stills keep one attempt (patience 0), so a drag never waits.
- The window capture waits up to 1.5 s per view, draws a "page not captured" placeholder for a shared view without a still (before: the "not shared" mask, which told the agent the user had switched observation off) and returns the leaf ids in `unavailable` next to `masked`.
- The overlay script waits for the images to decode before it counts frames.
- The test polls the capture for up to 10 s and asserts on the final state.
- New tests: unit tests of the retry in `ElectronViews.test.ts` (they fail with the blank check removed), an overlay label test in `guards.test.ts`, and an e2e test where a never-loaded tab is named in `unavailable` (it fails without the result field).

## Verification

| Command | Result |
| --- | --- |
| spec "switches observation off", `--repeat-each=20` | 20 passed |
| full Playwright suite, run 1 | 80 passed, 2.2 min |
| full Playwright suite, run 2 | 80 passed, 2.2 min |
| full Playwright suite, run 3 | 80 passed, 2.2 min |
| `pnpm typecheck` | ok |
| `pnpm coverage` | 2207 passed, 15 skipped; 92.03 % lines |
| `pnpm parity` | ok |
| `pnpm check:colours` | ok |

The full runs used `playwright test` after one `pnpm build`, the steps of `pnpm e2e`.
