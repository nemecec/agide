# Review: drag test guard

Start: 2026-11-22 01:22 UTC. End: 2026-11-22 01:28 UTC.

Change: `app/e2e/browser.spec.ts`, test "hides the native view behind a still of its page during a drag and shows it again afterwards". The guard before the `dragstart` now polls until `browser_views_suspend` returns at least one still.

Verdict: accept.

- Race reproduced. A scratch test held every visible `browser_view_place` call for 2.5 s through the `window.__agideApi` seam. The old guard passed after 3 ms with no view placed, and `.browser-still` was not found within 5 s, the same error as in CI. The new guard passed after about 3 s (6 rounds), the still appeared and was removed after `dragend`.
- Without an injected delay, the old guard with `dragstart` right after `openLeaf` failed 1 of 10 runs locally.
- The title wait does not prove placement: `browser_new_tab` creates and loads the view in the parking window.
- An entry in `stills` exists for every view that is placed in the app window and has bounds, also when the capture fails (then without `dataUrl`, and the renderer shows the fallback). The poll calls the main process directly, so the renderer state in `suspension.ts` stays unchanged, and `resume` shows the views again before the next `dragstart`.
- The dialog test waits until the main window has one visible view, which needs a placed view. No other test or helper uses the weak guard.
- Drag test 20 times: 20 passed. Whole browser spec twice: 26 passed. `pnpm typecheck`: passed.
