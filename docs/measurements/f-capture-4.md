# f-capture-4: review findings on the third capture pass

Start: 2026-11-21T13:02:19Z. End: 2026-11-21T13:13:02Z.

## Findings and handling

| Finding | Handling | Test |
| --- | --- | --- |
| Binding check refused bindings the user wrote | `requireScopesInFolder` takes the current layout and checks only value bindings that the change adds or changes, and only on inputs whose manifest `contextKey` is a `node.*` key. | `layout.test.ts` (modules) "checks only the node bindings a change adds or changes" |
| Object in `selection.object` crashed the mask | `bindsOutside` treats a resolved context value that is not a string as outside; the context parameter is typed `unknown`. | `mask.test.ts` object value with a scope that throws on non-strings |
| Result and PNG disagreed on a missing slot | `overlayScript` skips an item whose slot is missing and resolves with the leaf ids it drew as "page not captured". `captureAppWindow` builds `unavailable` from that value; `CaptureOverlay.unavailable` and the `hiddenLeaves` filter are gone. | `windowCapture.test.ts` overlay script tests, "names as unavailable the leaves the overlay script drew"; `browser.test.ts` reads the labels from the script |
| Unread badge of the title bar was not masked | The badge carries `data-capture-scoped`; `maskScript(ids, scoped)` marks it for a scoped caller, also when no pane is masked; `layout.css` fills it like the masked tab (replaced in the fifth pass by a root attribute and a slot of fixed size, see `f-capture-5.md`). The plan usage meter stays visible because it shows account-level plan usage, not data of folders (noted in the README). | `windowCapture.test.ts` script and capture tests; `TitleBar.test.ts` attribute |
| Leak test asserted too little | The test asserts that `masked` contains `main`. `f-capture-3.md` records that the elapsed check isolates the overlay guards. | `browser.spec.ts` |
| README wording | Layout paragraph and Observation paragraph corrected; the same sentence in `f-capture-3.md` corrected. | |

## Mutation checks

Each file was restored from a copy and compared with `cmp`.

| Mutation | Tests that failed |
| --- | --- |
| equality with the current binding removed | the modules layout test |
| node-input filter removed | the modules layout test |
| object value passed to `inScope` | the mask object test |
| missing slot not skipped in `overlayScript` | the overlay script test |
| `unavailable` taken from nothing instead of the script result | the `windowCapture.test.ts` unavailable test |
| scoped flag not passed to `maskScript` | the badge capture test |
| scoped masking applied to the user too | the badge capture test and one earlier capture test |
| `data-capture-scoped` removed from the badge | the `TitleBar.test.ts` test |
| surface host never masked (build rebuilt) | `browser.spec.ts` leak test, at the `masked` assertion |
| scope and masked checks removed from the overlay (build rebuilt, 5 runs) | 5 of 5 failed, at the elapsed check |

## Verification

| Command | Result |
| --- | --- |
| spec "switches observation off", `--repeat-each=5` | 5 passed |
| the four leak tests of `browser.spec.ts`, `--repeat-each=5` | 20 passed |
| `pnpm e2e` | 84 passed, 2.3 min |
| `pnpm typecheck` | ok |
| `pnpm coverage` | 2249 passed, 15 skipped; 92.2 % lines |
| `pnpm parity` | ok; `docs/parity.md` gained the swarm rows of earlier work |
| `pnpm check:colours` | ok |

Free disk stayed at 4.7 GiB or more. The directory `/tmp/fc4-mut` (mutation copies) and `/tmp/fc4_start.txt` were created by this step; removal was denied and they remain.
