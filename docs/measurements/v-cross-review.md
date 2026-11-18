# v-cross-review

Start: 2026-11-18T08:35:43Z. End: 2026-11-18T08:54:00Z.

Work: cross-model review of `docs/decisions/0031-on-screen-check-results.md`, `notes/onscreen-check.md` and the README changes against the code, the gates and the screenshots of the verification run (`$TMPDIR/agide-visual-X9aLLz/shots`). Opened the overview image and the after screenshots listed in 0031 under "Verification", compared files by checksum, and cropped a few areas of the capture run and the fix run to compare before and after.

| Command | Result |
| --- | --- |
| pnpm typecheck | pass, before and after the changes |
| pnpm coverage | run 1 pass; runs 2 and 3 one timeout each in `appModules.test.ts` (grant revoked when the session closes); run 4 pass. The file passed alone three times. |
| pnpm build | pass |
| pnpm e2e (hidden) | pass, full suite, before and after the changes |
| pnpm parity | parity ok, with the warning about the inspector script; `docs/parity.md` unchanged |
| pnpm visual-check --hidden --only focus | pass |
| pnpm visual-check --hidden --only focus,empty --out `<directory>` | pass; the run directory is created under the given directory |

Findings and changes:

- The dock tab focus ring was in the computed style and not in the image: the tab strip clips an outline drawn outside a tab, and the dock-tab focus shots of the fix and verification runs are byte-identical to shots without it. `src/renderer/styles.css` now draws the ring inside the tab; the new shots show it on "Surface host" and "Tree".
- `--out` was documented in the record, the app README and the script header and not read by the script. `scripts/visual-check.mjs` and `scripts/lib/visual/harness.mjs` now use it.
- A comment in `src/main/browser/capture.ts` said that the native view sits below the DOM layers on screen. Native views draw above the DOM; the renderer hides them behind stills while a dialog, menu or popover is open. The comment says that now.
- A test name in `src/renderer/panes/inbox/format.test.ts` used a word from the style list; renamed.
- Record and notes: the fix table said "a colour per kind" (approval and failure share red), "profile name in the settings heading" (a temporary profile reads "(temporary profile)"), "unit tests only" for R-29 (no new test) and "not captured again" for R-07, R-20 and R-21 (the fix run captured them; the fix step did not open them). The review's correction of V-17 was wrong: the title element of the test page is "Sample page". The `inspect.js` warning comes from the parity script loading the source tree; the built app has the script. The consequence "closed" for the open item of 0030 is now "narrowed". Counts in prose removed. Run times, the remaining capture gaps of the verification run and a cross-review column in the verification table added.
- No employer name, user path, e-mail address or token in the modified and untracked files; the overview PNG has only image data chunks and shows generic names and a loopback address.

Not resolved: no screen pixels were seen (hidden windows only in this step; screen recording stays refused for the terminal host), so the stacking of native views on the real screen is still inferred. The timeouts in `pnpm coverage` were not investigated; the machine ran other work at the time (load averages above 20).

Windows: every app instance ran hidden and none remained afterwards. Temporary files: removed the log and crop directory and the first focus run; kept `$TMPDIR/agide-visual-eJpbF6/shots` (empty and focus phases after the changes, under 1 MiB) for comparison.

Free disk: 6.2 GiB at the start, 4.0 GiB at the end. The runs of this step left no large files; other work on the machine used disk at the same time.
