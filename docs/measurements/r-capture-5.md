# r-capture-5: review of the fifth capture pass

Start: 2026-11-21T13:29:57Z. End: 2026-11-21T13:38:48Z.

Scope: the hunks listed in the fifth pass report (`commands.ts`, `windowCapture.ts`, `TitleBar.tsx`, `TitleBar.css`, `layout.css`, their tests, the README layout paragraph, `f-capture-3.md`, `f-capture-4.md`, `f-capture-5.md`). No product code or test was changed.

## Binding checks

A scratch unit test (removed afterwards) ran these agent sequences through `layout_apply` and `layout_undo`. Each was refused with `out_of_scope` unless noted:

- a binding on an undeclared input of the surface host, then a `move` of it to `node` (the first step is accepted, the second refused)
- an `agide/inbox` instance bound by value to a node of another folder (accepted), then its type replaced by `agide/surface-host`, and the whole instance replaced
- a replace of `/instances/main/bindings`, of `/instances/main`, and a whole document with the foreign binding
- a copy of the user's foreign-bound instance to a new id; the type of that instance changed to an unknown type
- the type of a user-written inbox instance with a foreign binding changed to a surface host; an undo to a user revision that holds the foreign binding, with and without `toRevision`

An unrelated patch is accepted while the user's layout holds a foreign binding.

## Mutations

Each file was copied before and compared with `cmp` after; the hashes match the start.

| Mutation | Result |
| --- | --- |
| equality skip without the type check | both type change tests fail |
| unknown type does not count as naming a node | the `acme/ghost` add test fails |
| placeholder does not count as naming a node | the placeholder add test fails |
| skip every binding name the current instance holds | four layout tests fail |
| `maskScript` does not set the root attribute | script, late element and capture tests fail |
| `unmaskScript` does not remove the root attribute | the capture test fails |
| root attribute removed on success only, not when the capture throws | no test fails |
| slot without `data-capture-scoped` | both slot tests fail |
| slot rendered only when unread | the zero unread test fails |
| CSS rule of the scoped mask removed | no unit test fails |

## Pixels of the masked badge slot

A scratch Playwright test (removed afterwards) set the root attribute, put a badge of each count in the slot and compared a capture of the inbox button with one of the empty slot (device pixels):

| Badge | Differing pixels | Rows below the slot |
| --- | --- | --- |
| 9 | 14 | 2 |
| 42 | 41 | 2 |
| 99+ | 49 | 2 |

The difference is the 2 px ring of the badge (`box-shadow` in the window surface colour), drawn below the slot over the inbox icon; its width follows the count. With `[data-capture-scoped-mask] [data-capture-scoped] > * { visibility: hidden; }` added, every count gives 0 differing pixels.

## Commands

| Command | Result |
| --- | --- |
| `AGIDE_HIDDEN=1 pnpm e2e` | 84 passed |
| `pnpm typecheck` | no errors |
| `AGIDE_HIDDEN=1 pnpm coverage` | 218 files, 2255 passed, 15 skipped, 92.2 % lines |
| `pnpm check:colours` | no colour literal outside the allowlist |
