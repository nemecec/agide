# v-capture

Start: 2026-11-18T06:25:38Z (first script run). End: 2026-11-18T06:43:27Z.

Work: wrote `app/scripts/visual-check.mjs` with `pnpm visual-check`, a fake claude (`app/scripts/lib/visual/fakeClaude.mjs`), a harness, seed data, an MCP client and one module per group of states. Ran it against the built app on temporary data directories with the fake claude, the fake gh from the task tests and a local test page. Opened the screenshots, wrote `notes/onscreen-check.md` and saved `docs/images/agide-overview.png` from the pair layout capture (generic names only; no paths, names or addresses besides the loopback port).

Results: the final run completed every phase in about three minutes. The app capture and the renderer screenshot work; macOS `screencapture` is refused. Free disk stayed above 5 GiB.

Not removed: earlier run directories of the script and two debug directories named `agide-visual-*` in the OS temporary directory (a delete of them was denied). The script removes its own data directories at the end of each run.
