# f-capture-4-review: independent review of the fourth capture pass

Start: 2026-11-21T13:13:39Z. End: 2026-11-21T13:20:44Z.

## Scope

The hunks listed in the report of the fourth pass, and the code they touch: `requireScopesInFolder` and its callers, `bindsOutside`, `overlayScript`, `captureAppWindow` and `maskScript`, the unread badge and its CSS, the leak test in `browser.spec.ts`, the README and `f-capture-3.md`.

## Scratch checks

A scratch test in the module graph ran these layout calls as an agent whose window shows its own folder. The file was removed afterwards.

| Case | Result |
| --- | --- |
| add a surface host bound by value to a node of another folder | refused, `out_of_scope` |
| copy the user's instance with a foreign value binding to a new id | refused, `out_of_scope` |
| the user binds the surface host to a deleted node, the agent changes the title | accepted |
| add an instance of a missing type `acme/ghost` bound by value to a node of another folder, then replace its type with `agide/surface-host` | both accepted; the surface host resolves `ok` and is bound to the foreign node |
| the same with type `agide/placeholder` first | both accepted |

The binding check skips a binding that is deep-equal to the binding of the same instance id in the current layout, without comparing the type, and does not check inputs of a type the registry does not know or of `agide/placeholder`. The third pass refused the first step of both two-step cases. The capture still masks the resulting surface host for the agent.

## Mutation checks

Each file was copied, changed with a substitution, tested, copied back and compared with `cmp`.

| Mutation | Tests that failed |
| --- | --- |
| equality skip removed from `requireScopesInFolder` | modules `layout.test.ts` new test |
| node-input filter removed | modules `layout.test.ts` new test |
| object context value passed to `inScope` | `mask.test.ts` object test |
| missing slot not skipped in `overlayScript` | `windowCapture.test.ts` overlay script test |
| masked-slot branch removed from `overlayScript` | `windowCapture.test.ts` overlay script test |
| `unavailable` not taken from the apply script | `windowCapture.test.ts` unavailable test |
| scoped branch of `maskScript` disabled | both badge tests in `windowCapture.test.ts` |
| scoped flag not passed by `captureAppWindow` | the badge capture test |
| mask script run only when a pane is masked | the badge capture test |
| `data-capture-scoped` removed from the badge | `TitleBar.test.ts` badge test |
| surface host never masked, build rebuilt | `browser.spec.ts` leak test at the `masked` assertion (received rail, tree, inbox) |

After the e2e mutation the source was restored, compared with `cmp` and the build was run again.

## Verification

| Command | Result |
| --- | --- |
| `pnpm typecheck` | ok |
| `pnpm check:colours` | ok |
| `pnpm coverage` | 2249 passed, 15 skipped; 92.2 % lines |
| `AGIDE_HIDDEN=1 pnpm e2e` | 84 passed, 2.4 min |

Free disk stayed at 4.5 GiB or more. Temporary files of this step: the scratch test, a directory under `/tmp` with the mutation script and copies, and the failure output of the e2e mutation under `app/test-results`; all removed.
