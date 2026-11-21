# integrate-a

Start: 2026-11-20T23:44:55Z
End: 2026-11-20T23:54:48Z

## What was built

The work of w-tokens (step 1 of 0035) and w-ui (step 2) is one state:

- Token names: every `var(--agide-*)` read in `src/renderer` is defined by the theme store for Agide Light, Agide Dark and System, in light, dark and increased contrast. The only name with no definition was `--agide-badge-ring` in `ui/Badge.css`; it is a local setting of the badge, so it is now `--ui-badge-ring`, still falling back to `surface.window`.
- A new unit test, `src/core/theme/tokenUsage.test.ts`, covers the token set row of 0035 8.3 that was missing: no stylesheet or component reads an `--agide-*` name that no built-in theme defines. A mutation (restoring the old badge name) makes it fail.
- Duplicate definitions: the `ui/` stylesheets and `settings.css` and `task.css` read tokens with literal fallbacks written before the token store existed. The fallbacks repeated the values of `scale.ts` and are removed; the store writes the tokens to `:root` before the first render.
- `styles.css`: the `--bg-alt` alias and `.btn-danger` are removed, as nothing reads them after `trustBanner.css` went. `.btn-primary` and `.chip` stay because `ItemCard.tsx`, `ApprovalBar.tsx` and `TerminalPane.tsx` use them (step 4).
- Dock: `--dv-overlay-z-index` reads `z.dock-overlay` (10, as in 0035 1.3) in place of 999, so dock overlays sit below menus and dialogs in `#agide-overlays`.
- `ui/Menu.test.ts`: the Enter case failed once under load in a full coverage run, because the next key went out before focus reached the menu. The test now waits for focus inside the menu and checks the highlighted entry before Enter.
- Old markup: no dialog or menu outside `ui/` uses the classes of the deleted `dialogs.css` and `trustBanner.css`. Native `<select>` elements remain in `LayoutHost.tsx` and `AgentHistoryPane.tsx`; they belong to steps 3 and 4.
- The colour-literal allowlist did not need a change: the check passes, and every listed file still holds a literal.

## Visual check

`pnpm visual-check --hidden` into `agide-restyle-stage-a` under the temporary directory: every phase passed. Opened: new task dialog, new session dialog (dark, System light, increased contrast light), profile settings, the tree context menu over a browser view and the browser tab menu. Dialogs, fields, selects, checkboxes, disclosure, buttons and menus render with the tokens; the destructive entries are set apart in the danger colour; the increased contrast focus ring is wider and darker. Nothing visibly broken was found.

## Results

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm check:colours` | pass |
| `pnpm coverage` | first run: one failure in `ui/Menu.test.ts` (fixed); two more runs after the fix: pass |
| `pnpm build` | pass |
| `pnpm e2e` (hidden) | pass, all tests |
| `pnpm parity` | pass, `docs/parity.md` unchanged |

## Not done

- No change to 0035: no value or rule of the record changed.
- The independent visual review of 8.2 and a before set were not run.
- Temporary files under `/tmp/integrate-a` and two lists next to it could not be removed (deletion was denied).
