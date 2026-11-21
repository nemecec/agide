# f-capture-3: review findings on the second capture pass

Start: 2026-11-21T12:13:53Z. End: 2026-11-21T12:35:41Z.

## Findings and handling

| Finding | Handling | Test |
| --- | --- | --- |
| Race: the mask was computed before the overlay waited for a blank view of the caller | `WindowCapturer` takes a request with a `masked()` function that reads the current layout and context. The capturer reads it after the overlay wait, applies it, takes the pixels, reads it again and takes the capture again when it differs (three attempts, then it fails with a message). The result carries the mask that was applied, and `unavailable` leaves out every leaf whose slot sits in a masked pane. | `browser.spec.ts` "masks the pane of the other folder when the user opens it while the capture waits for a blank tab of the agent"; `windowCapture.test.ts` three capture tests; `layout.test.ts` (modules) mask read again |
| Value and source bindings were not checked by the mask | `maskedInstances` resolves value bindings that are strings and masks a pane whose value is not a node of the folder or is unknown; a source binding counts as outside. `layout_apply` and `layout_undo` refuse a value binding to a node outside the folder of an MCP caller, with the same answer for a foreign and an unknown node. | `mask.test.ts`; `layout.test.ts` (modules) binding refusal; `browser.spec.ts` "masks a surface host that is bound by value to a tab of another folder" |
| Leak test passed for the wrong reason | The test polls a capture of the user until `unavailable` names the other folder's view before the agent captures. The claim in `f-capture-2.md` is corrected. | `browser.spec.ts` "does not name or wait for a blank tab of another folder that sits in a masked pane" |
| `maskedSlotsScript` untested | The scripts are exported and run against a jsdom document (the renderer tests already use the `jsdom` environment). `captureAppWindow` runs against a fake Electron whose scripts run in that document. The lookup no longer uses `CSS.escape`; it compares attribute values in the script. | `windowCapture.test.ts` |
| Deadline checked only before the pause | The deadline is checked again after the pause. A call is cut at the time left before the deadline, or at the floor of 500 ms when less time is left. | `ElectronViews.test.ts` three tests |
| README wording | The paragraph says a view of another folder, in a masked pane, with observation off or of a chat service is not captured, waited for or listed, and that the capture draws the placeholder when no painted frame arrives, also in a hidden window without a display surface. | |

Since the overlay script leaves out a leaf whose slot sits in a masked pane, the leak test "does not name or wait for a blank tab of another folder that sits in a masked pane" fails on the overlay guards through its elapsed check only: the result no longer names the leaf in either case, and the capture waits 1.5 s or more for the blank view when the guards are missing.

Upper bound of one view in a capture: the patience of 1.5 s plus the floor of 0.5 s, 2 s. A call starts only before the deadline and lasts at most the larger of the time left and the floor. Without patience (drag stills) one call is cut at the cap of 2 s.

## Other paths checked

Found and fixed:

- The dock tab of a surface host shows the title of the bound node and the status chip of its session, and lay outside the masked element. It now carries `data-pane-tab`, the mask script marks it, and the mask draws a plain fill on it. Test: the race and value binding e2e tests sample the tab rectangle.
- Panes for usage, agent history, transcripts, the observation log and swarms (and any pane of a code block) list agents, costs or transcripts of every folder and were not masked. An agent could add one with `layout_apply`. The mask is now an allow-list: only a surface host and a placeholder are shown, and the surface host only while it is bound to a node of the folder. Test: `mask.test.ts` per pane type and the e2e test that adds an agent history pane.
- The unread badge and the plan usage meter of the title bar were handled in the fourth pass; see `f-capture-4.md` and `f-capture-5.md`.
- A still of a view inside a masked pane carried the label "page not captured"; it now carries "not shared".

Checked, no change:

- `layout_get`, `layout_validate`, `blocks_list`: they return layout content and layout titles of the shared layouts and no node titles or addresses. A value binding in a layout the user wrote shows a node id.
- `ui_open_to_side`, `ui_focus_node`, `surface_highlight`, `surfaces_list`, `surfaces_observe`, `browser_open_in_chrome`: each checks the folder scope before it acts or answers.
- Errors: the capture failure after repeated mask changes names no tab. The binding refusal does not tell a foreign node from an unknown one.
- Timing: the capture waits only for views the caller may see, outside masked panes, and a retry happens only when the layout or context changed during the capture.

Not changed, for the owner to decide:

- A dialog, menu or popover the user opens during a capture is part of the window and is not masked. The layout change banner lists the diff of the last layout change, which can name node ids.
- `requireInScope`, used for `scope` fields and node ids in other commands, answers `not_found` for an unknown id and `out_of_scope` for a foreign one, so ids can be probed. The ids are not guessable.

## Mutation checks

Each file was restored and compared with its copy by `cmp`.

| Mutation | Tests that failed |
| --- | --- |
| mask read once at the start of the capture | three `windowCapture.test.ts` tests; the race e2e test |
| value bindings ignored by `maskedInstances` | three `mask.test.ts` tests; the value binding e2e test |
| source binding not masked | one `mask.test.ts` test |
| pane types other than the tree not masked | seven `mask.test.ts` tests; the agent history e2e test |
| dock tab not marked by `maskScript` | two `windowCapture.test.ts` tests |
| `data-pane-tab` attribute removed | the race and value binding e2e tests |
| plain fill of the masked dock tab removed (CSS) | the race and value binding e2e tests (text in the tab) |
| slot lookup replaced by an empty list | two `windowCapture.test.ts` tests |
| value binding check removed from `layout_apply` | the binding refusal test in `layout.test.ts` (modules) |
| deadline check after the pause removed | the no-call-after-deadline test |
| floor removed | the floor test and the upper bound test |
| scope and masked checks removed from the overlay, build rebuilt, leak test 5 times | 5 of 5 failed (before this pass: 3 of 5) |

## Verification

| Command | Result |
| --- | --- |
| spec "switches observation off", `--repeat-each=20` | 20 passed |
| the four leak tests of `browser.spec.ts`, `--repeat-each=10` | 40 passed |
| `pnpm e2e`, run 1 | 84 passed, 2.3 min |
| `pnpm e2e`, run 2 | 84 passed, 2.3 min |
| `pnpm typecheck` | ok |
| `pnpm test` | 2242 passed, 15 skipped |
| `pnpm coverage` | 2242 passed, 15 skipped; 92.2 % lines |
| `pnpm parity` | ok (`docs/parity.md` unchanged by this step) |
| `pnpm check:colours` | ok |

Free disk stayed at 4.5 GiB or more. Temporary files: the mutation directory under `/tmp`, removed. `app/out`, `app/coverage` and `app/test-results` are regenerated by the commands and ignored by git.
