# notes-design

Start: 2026-11-26T12:55:16Z (date -u). End: 2026-11-26T13:25:00Z (date -u).

## Built

- `docs/decisions/0044-notes-and-mounts-architecture-and-contracts.md` (proposed): the audit of 0034 against the code, the first slice and what waits, the amendments to 0034, the contracts (module layout, the `notes` and `mounts` migrations, types, the `note` and `mount` surface types, commands with the parity rule, the MCP tool schemas, proposals, file-backed notes, the watcher, the mount safety rules, search and links, the editor with the tokens, settings, the observation log, module order, the interface needed from 0043), the builder tasks, the test plan, the security table, estimates, risks and the questions.
- Probes P50 to P53 (node only, no model): `probes/p_notes_lib.mjs`, `probes/p50_watch_events.mjs`, `probes/p51_watch_scale.mjs`, `probes/p52_paths.mjs`, `probes/p53_sqlite_fts.mjs`; results in `notes/probes-m6-notes.md` and a section of `probes/RESULTS.md`; evidence in `probes/out/p50_*` to `p53_*` (not tracked).
- One row for 0044 in `docs/README.md`.

## Account

- Inputs read: 0034, 0033, 0015, 0016, parts of 0021, 0026 (observation), 0035 (tokens), 0040 (security table form), 0041, 0043 (drafted by the R21 run at the same time; read at the end, the alignment is section 4.15 of 0044), `notes/greenfield-and-libraries.md` (editor and Markdown libraries); the code of the tree store and migrations, the surface types, the command registry and scope, the task commands and migrations, the browser surface type and observation service, the store, the main context and module order, the surface pane, the tree model and the agent rows.
- Checks run: the probes under Node 22.22.3 and Electron 45.3.3 as Node (P50 also as an Electron main script without a window); P51 three times per runtime for the event loss; the SQL of 0044 section 4.2 against `node:sqlite` in memory with stand-in `tree_nodes` and `inbox_items` (a temporary script under `/tmp/agide-notes-design/`, removed).
- Longest step: the first Electron main run of P50 hung, since a top-level `await app.whenReady()` in an ESM main script never returns (Electron emits `ready` after the main module loaded); the process was ended and the script chains the promise.
- Probe numbers: P45 to P49 are left to the R21 run, which took P16 and P45 at the same time.
- No app code changed, no test suite or build run, no git command that changes the tree, no model calls.
- Disk: 13 GiB free at the start, 12 GiB at the end. `/tmp/agide-notes-design/` is removed; nothing is left there.
- Not finished: no independent review from inside this run; the record is `proposed` and waits for the review and the user's answers. The CodeMirror and mdast versions are named by package only; the contracts step chooses exact versions.
