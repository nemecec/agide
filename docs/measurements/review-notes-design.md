# review:notes-design

Start: 2026-11-26T13:26:06Z (date -u). End: 2026-11-26T13:40:00Z (date -u).

## Built

An independent review of record 0044, `notes/probes-m6-notes.md`, the probe scripts P50 to P53 and the new section of `probes/RESULTS.md`, with corrections made in place in those files. No new record, no app code.

## Account

- Read: 0044, 0034, the task-side parts of 0043 (sections 4.6, 4.8, 4.9, 5), the parity rule in 0013, the tool sets in 0041, the rates in 0042, the tokens in 0035; the code of the tree commands and migrations, the surface types and catalog, `createLeaf.ts`, `TreePane.tsx`, `ItemCard.tsx`, the command types and scope, the inbox and task migrations, the store, the observation service and `isBareOrigin`, `BrowserTools.observe`, the session module's deny paths, `main/context.ts`.
- Probes run again from a copy of the scripts under a temporary directory of this review: P50 (Node), P51 (Node and Electron as Node, again per runtime), P52 (Node), P53 (Node and Electron as Node). The results hold: the event type is unusable, links are not followed, a single-file watcher goes silent after an atomic save, setup is immediate with no extra descriptors or idle CPU; burst loss occurred in one Electron run (1997 of 2000) and not in the others, smaller than the design run's figures, so the re-list and reconcile stay.
- Extra checks (node only): the SQL of 0044 section 4.2 on `node:sqlite` with stand-in tables (cascade from a folder empties `notes` and `notes_fts`; `VACUUM` did not renumber rowids; the added `item` link kind is accepted); the checked open with the swap placed between the resolve and the open (refused by the second resolve, and by the device and inode comparison when swapped back); the atomic write with the parent swapped before the `rename` (the outside file was replaced).
- Found and fixed in the record: the audit's "no `shell` use in `main`"; the observation writer that already exists and refuses non-web origins; `surfaces_observe` serving browser tabs only; agents able to remove note leaves through `ui_remove_node` (a removal guard added); `off` note titles visible through `ui_list_tree`; `agide:item` links that the `note_links` check refused; the 140-character inbox message; the default notes directory inside a refused root; hidden files reachable through a visible link; hard links read by the unsandboxed main process; directory listings during a swap; the write race; mount rows rendered by `TreePane.tsx`, not by `leafDecorations.tsx`; the unowned task and session slots; the shared `main/desktop.ts` and `scripts/visual-check.mjs`; the parity rule's source record.
- Found in the probe notes: the P51 "three runs" have one evidence file per runtime, and `p51_watch_scale_node_rerun.json` is a byte copy of the Node file.
- Longest step: the machine hit its process limit during the review (fork failures in the shell), so several reads went through the file reader.
- Not run: the app's tests or build, a real Electron main process at 20000 files, real Claude.
- Disk: 12 GiB free at the start.
