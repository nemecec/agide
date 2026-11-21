# f-capture-5: review findings on the fourth capture pass

Start: 2026-11-21T13:22:16Z. End: 2026-11-21T13:29:32Z.

## Findings and handling

| Finding | Handling | Test |
| --- | --- | --- |
| Two-step bypass of the binding check | `requireScopesInFolder` skips a binding only when the current instance has the same type and an equal binding. `inputNamesNode` counts every input as naming a node when the pane type is not registered or is `agide/placeholder`. | `layout.test.ts` (modules) "a type change that keeps a binding": add of `acme/ghost` and `agide/placeholder` bound to a foreign node is refused; the type change of a user-written instance to a surface host is refused; an unrelated patch is accepted |
| Badge mounted during the capture; badge presence and width showed | `maskScript` sets `data-capture-scoped-mask` on the document element for a scoped caller and the capture removes it afterwards. `layout.css` fills each `[data-capture-scoped]` below that root. `TitleBar` always renders a slot of fixed size with the attribute and puts the badge inside it, so a badge that appears later is covered and neither count nor presence shows. | `windowCapture.test.ts` mask script, late element, capture and unmask tests; `TitleBar.test.ts` slot tests |
| `f-capture-3.md` described a filter that no longer exists and held fourth-pass work | Sentence rewritten; the badge and plan meter bullets point to the later passes. | |
| Test of changed bindings used an unknown id, an undeclared text input and had no type change case | Refusal added for a change from a node of the folder to a node of another folder; the text case says in its message that no pane type declares a `node.*` key on `label`; type change cases added. No pane type declares a non-node context key on an input. | `layout.test.ts` (modules) |
| Overlay test left `HTMLImageElement.prototype.decode` set | The test saves the original and an `afterEach` restores it (jsdom has no `decode`, so a spy cannot attach). | `windowCapture.test.ts` |

## Mutation checks

Each file was restored from a copy and compared with `cmp`.

| Mutation | Tests that failed |
| --- | --- |
| equality skip ignores the type | the two type change tests |
| unknown pane type does not count as naming a node | the two add tests |
| placeholder does not count as naming a node | the placeholder add test |
| root attribute not set by `maskScript` | script, late element and capture tests |
| root attribute not removed after the capture | the capture test |
| `data-capture-scoped` removed from the slot | both slot tests |
| slot rendered only when unread | the zero unread slot test |
