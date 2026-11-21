# r-cross-review

Start: 2026-11-21 01:48 UTC. End: 2026-11-21 01:59 UTC (date -u).

Cross-model review of `docs/decisions/0036-restyle-results.md`, the repository README, `app/README.md` and `docs/README.md` against the code, a new run of the tests, the contrast script and the screenshots. No source file of the app changed.

## Commands run in `app/` and their results

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm check:colours` | pass |
| `pnpm coverage` | 179 files, 1755 passed, 15 skipped, thresholds met |
| `AGIDE_HIDDEN=1 pnpm e2e` | 73 passed in 2.0 min |
| `pnpm parity` | parity ok; prints the warning about the missing `src/main/modules/inspect.js` |
| `node notes/scripts/token-contrast.mjs` (repository root) | Pairs below target: 0 |
| `pnpm visual-check --hidden --only browser` | every state written; the page shows under the approval bar inside the amber frame |

## What was checked

- The three images in `docs/images/` are byte-identical to the captures of the verification run that 0036 names. Each was opened: sample data only, a loopback address with a port. Their chunks are IHDR, iCCP (the generic Chromium colour profile), IDAT and IEND.
- Before and after captures opened side by side: pair layout, tree at 900 px, settings, new task dialog, inbox card, agents, usage, history, profiles, browser approval and live observation, dark session, the theme phase. Chrome heights, the rail width, dialog widths, the focus ring and the separators were measured from the capture pixels.
- `focus-order.json` of both runs.
- `NOTICE` against the license file of the installed `lucide-react` and against the license files and metadata of the two theme packages.
- A scan of every tracked and new text file for an employer name, a user directory path, an e-mail address and token patterns: only fake fixtures, the owner's name in the copyright line and in the "Decided by" lines of older records.
- The files, commands and tests that 0036 and the READMEs name exist; the removed files are gone; the colour-literal allowlist is empty; a grep for colour literals finds none under `src/renderer`.
- The colour values of the contrast script's checked pairs equal the values in the built-in Agide theme files.

## Corrections made

In 0036:

- The chrome saving: 54 px before and 38 px after, pane content about 20 px higher, where the record said about 50 px.
- The before column of the improvements table for profile identity, status, light and dark, dialogs, the browser tab and the usage pane: the before set already had coloured tiles with a badge, a dark terminal, right-aligned usage numbers with heat bars, and a page in the pair and approval captures.
- The theme phase: only the first `-session` capture shows the terminal; the later ones show the inbox pane, because a click on a tree row does not bring the surface tab in front of the Inbox tab.
- The blank page under the approval bar in the verification run is an intermittent capture; the new run shows the page.
- The image metadata statement, the second dialog capture with a temporary path, the test table (the inspector warning belongs to the parity run; the colour check is not in `pnpm check` or continuous integration), the coverage figures of the new run, the contrast section (the terminal table is reported, not checked, and holds values under 4.5 to 1).
- New deviation rows for the title bar tint and for `lucide-react@1.77.0` under `minimumReleaseAgeExclude`; new questions for the release age entry, the tree row and its tab, and the colour check in the gate.

In the READMEs: the setup card and the list of e2e specs in the module map of `app/README.md`, the settings button as a route to the profile settings, the note that `check:colours` is not part of `pnpm check`; this file in the list of `docs/README.md`. In `r-before.md`: a file count removed from the prose.

## Not resolved

- `lucide-react@1.77.0` stays excluded from pnpm's release age gate; the user decides.
- `pnpm check:colours` runs only by hand; adding it to `pnpm check` and to the workflow touches shared files and is left as a question.
- The `theme` phase of `scripts/lib/visual/phaseTheme.mjs` still writes inbox captures under `-session` names for every mode after the first.
- The before state of hover, press and menu highlight, the start error Notice and a ported theme applied to the UI have no capture in either set, so those rows of 0036 rest on code and tests.

What took long: opening the before and after captures in pairs. Temporary files: logs, two small scripts and the browser phase captures in a directory of the OS temporary directory, removed at the end.
