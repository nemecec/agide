# Notes and mounts probes P50 to P53

Date: 2026-11-26. macOS (Darwin 27, Apple silicon, APFS, case-insensitive volume), Node 22.22.3 (libuv 1.51.0, SQLite 3.51.3) and Electron 45.3.3 (its Node 24.22.3, libuv 1.52.1, SQLite 3.54.1). Electron ran as Node (`ELECTRON_RUN_AS_NODE=1`) for every probe and as a main process (a main script without a window) for P50. No model was started. Every directory lived under `/tmp/agide-notes-design/` and was removed by the probe that made it. The machine was shared and busy (load average about 17 on 8 cores), so the times are indicative.

P45 to P49 are left to the R21 design run, which wrote its own probes (P16 and P45) at the same time.

## Question

0034 asks for live mounts (a directory or a file on disk shown in the tree and updated when files change), safe paths (real paths, no symlinks that leave the mount, limits on size), and search over notes. These probes measure what the macOS side gives the app's main process without extra packages: `fs.watch` with `recursive: true` (FSEvents), path resolution, and FTS5 in the `node:sqlite` driver that the app already uses.

## Scripts and evidence

`probes/out/` is not tracked.

| Script | Content | Evidence |
|---|---|---|
| `p_notes_lib.mjs` | runtime facts, temporary directories, an event log, CPU and memory helpers | |
| `p50_watch_events.mjs` | the events of one recursive watcher for each file operation a mount sees, and a watcher on a single file and on its parent | `p50_watch_events_{node,electron-node,electron-main}.json` |
| `p51_watch_scale.mjs` | 20000 files in 200 directories: scan, memory, CPU, a burst of 2000 changes, a burst of 5000 new files, a trailing debounce of 100 ms, one watcher per directory, ten recursive watchers | `p51_watch_scale_{node,electron-node}.json` |
| `p52_paths.mjs` | real paths, symlinks, hard links, FIFOs, devices, case and Unicode spellings, `O_NOFOLLOW`, a parent swapped for a link, atomic writes over links, large files, text and binary | `p52_paths_{node,electron-node}.json` |
| `p53_sqlite_fts.mjs` | FTS5 with `unicode61` and `trigram`, triggers, ranking, snippets, query syntax, cost for 2000 notes of 2.3 KB | `p53_sqlite_fts_{node,electron-node}.json` |

Run: `node probes/p50_watch_events.mjs`; for Electron as Node, `ELECTRON_RUN_AS_NODE=1 app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron probes/<script>`; for the Electron main process, the same binary without the variable and with `p50_watch_events.mjs` as the main script.

## P50 events of a recursive watcher

One `fs.watch(root, { recursive: true })`, 600 ms after each step. Filenames are relative to the root, with `/` between directories. The runtimes agree apart from the event type.

| Step | Events (filename) | Notes |
|---|---|---|
| create `a.md` | `a.md` | first event 9 to 12 ms after the call; 6 to 28 ms for the other single steps, once 104 ms |
| append to `a.md` | `a.md` | |
| atomic save (write `.a.md.tmp`, rename over `a.md`) | `.a.md.tmp`, `a.md`, `a.md` | the temporary name appears |
| backup save (rename to `a.md~`, write `a.md`, unlink `a.md~`) | `a.md`, `a.md`, `a.md~` (one run of Electron as Node: five events) | |
| rename `a.md` to `b.md` | `a.md`, `b.md` | old and new name, no pairing |
| `mkdir sub` and a file in it | `sub`, `sub/c.md` | |
| `mkdir -p d1/d2/d3` and a file | each directory, then the file | |
| move `sub/c.md` out of the mount | `sub/c.md` | same as a delete |
| move a file in from outside | `c-in.md` | same as a create |
| symlink `link-out` to a directory outside | `link-out` | |
| write to the outside directory, and through `link-out/new.md` | none | links are not followed |
| symlink inside the mount | `b-link.md` | |
| `chmod`, `utimes` | `b.md` | metadata changes are reported |
| hidden directory and file | `.hidden`, `.hidden/x.md` | hidden names are reported |
| 200 appends to one file | one or two events | coalesced |
| 300 new files in a new directory | the directory and every file (301) | |
| `rm -r` of two trees | every removed file and directory | |
| rename the mount root | `mount` (the root's own name) | then silence: writes in the moved directory give no event |
| a new directory at the old root path, and a file in it | `mount`, `new-root.md` | the watcher follows the path, not the directory |
| remove the root | `mount` | the watcher stays open with no error |

Event type: plain Node and Electron as Node reported `rename` for every step, appends included. The Electron main process reported `change` for `chmod`, `utimes` and the burst of appends and `rename` for the rest. The type is not usable; only the filename is.

Single file. A watcher on the file itself reported the first append (`change`) and the atomic save (`rename`), and then nothing for later appends, a second atomic save or the unlink (every runtime): it stays on the replaced inode. A non-recursive watcher on the parent directory reported the temporary name, the file name after the atomic save, and the append after it.

## P51 cost at 20000 files

| Measure | Node 22 | Electron 45 as Node |
|---|---|---|
| full listing (`readdir` recursive with types), 20200 entries | 26 to 44 ms | 35 to 40 ms |
| `lstat` of every entry | 68 to 86 ms | 57 to 65 ms |
| `fs.watch` recursive setup | 0 to 4 ms | 1 ms |
| RSS with the watcher, change against no watcher | no measurable change (about 51 to 57 MB in total) | no measurable change (about 72 to 76 MB) |
| open descriptors (`/dev/fd`) | unchanged | unchanged |
| CPU while idle, 3 s | 0 ms | 0 ms |
| ten recursive watchers, idle CPU 3 s | 0 to 16 ms | 0 ms |
| 201 non-recursive watchers, setup | 8 to 21 ms | 8 to 15 ms |
| burst of 2000 appends to 2000 files: write time | 110 to 150 ms | 99 to 110 ms |
| events delivered for the 2000 files (design run; review runs) | 2000, 2000, 1991; 2000, 2000 | 1987, 1936, 1910; 1997, 2000 |
| first and last event after the burst started | 149 and 197 ms | 111 and 155 ms |
| CPU for the burst and its settling | about 120 ms | about 120 ms |
| batches of a 100 ms trailing debounce | 1 | 1 |
| 5000 new files in a new directory: events | 5001 | 5001 to 5002 |

The burst lost up to about 0.5 % of the files in plain Node and up to about 4.5 % in Electron as Node: the files changed and no event named them. The evidence files keep only the last run per runtime: `p51_watch_scale_node.json` and `p51_watch_scale_electron-node.json` (1991 and 1910 events); `p51_watch_scale_node_rerun.json` is a byte copy of the Node file, not a separate run, and the other counts of the design run have no evidence file. The review ran P51 again per runtime from a copy of the scripts (evidence not kept in the repository): the counts after the semicolon, with the same setup, descriptor, memory and idle figures. Bursts of new files lost nothing. The per-directory watchers report names relative to their own directory, so their batches cannot be told apart by name alone (the "unique names" figure of that run counts collisions and is not a loss).

## P52 paths

The rule under test: reject an absolute or lexically escaping path, resolve the rest with `fs.realpathSync.native`, require the result to be the real root or below it, and require a regular file or a directory. Node 22 and Electron as Node gave the same results.

| Case | Result |
|---|---|
| root given as `/tmp/...` | the real root is `/private/tmp/...`; comparisons must use the real root |
| file, file in a subdirectory | allowed |
| symlink to a file or a directory outside, a link chain that ends outside | refused (`leaves the mount`) |
| symlink to a file inside, a path through a linked directory inside | allowed; the result names the target |
| dangling link | refused (`ENOENT`) |
| link to `/dev/zero` | refused (`leaves the mount`) |
| FIFO inside the mount | refused (not a regular file); an open without `O_NONBLOCK` would block |
| hard link to a file outside | allowed: it is a file of the mount by name; `nlink` 2 is the only sign |
| `../outside/...`, `sub/../../...`, `/etc/hosts` | refused before any file system call |
| `A.MD` for `a.md` | allowed; `realpathSync.native` returns the spelling on disk (`a.md`), `realpathSync` returns the spelling given (`A.MD`) |
| NFC and NFD spellings of `café.md` | both resolve; the directory listing returns the stored spelling (NFD) |
| `open` with `O_NOFOLLOW` on a link | `ELOOP` |
| `open` with `O_NOFOLLOW` through a linked parent directory | opens: only the last component is checked |
| a directory checked, then swapped for a link to the outside before the open | a plain open reads the outside file; the checked open (resolve, `open` with `O_NOFOLLOW` and `O_NONBLOCK`, `fstat`, resolve again, compare device and inode) refuses. In this probe the swap came before the checked open started, so its own first resolve refused it. A review check placed the swap between the resolve and the open: the open followed the swapped parent and read the outside file, and the second resolve refused (`leaves the mount`); with the directory swapped back before the second resolve, the device and inode comparison refused. The content must therefore be used only after the comparison |
| the parent swapped for a link between the check and an atomic write (review check) | the temporary file and the `rename` follow the swapped parent, and the outside file is replaced; Node has no `openat` or `renameat` to prevent it |
| atomic write (temporary file with `O_CREAT`, `O_EXCL` and `O_NOFOLLOW`, then `rename`) onto a link to the outside | the link is replaced by a regular file; the outside file is unchanged |
| `O_EXCL` create where a link already stands | `EEXIST` |
| read 1 MB, 10 MB, 50 MB as UTF-8 | 1, 11 and 102 ms; `stat` under 0.1 ms; a line count over 50 MB 8 ms |
| text or binary from the first 8 KB | a NUL byte gives binary; Latin-1 bytes fail a strict UTF-8 decode; UTF-8 with Estonian and Japanese text passes |

## P53 FTS5 in `node:sqlite`

| Question | Node 22 (SQLite 3.51.3) | Electron 45 (SQLite 3.54.1) |
|---|---|---|
| `ENABLE_FTS5` in the compile options | yes | yes |
| `unicode61 remove_diacritics 2`, `trigram` | both available | both available |
| index 2000 notes of 2.3 KB (one transaction, triggers on an external-content table) | 96 ms | 122 ms |
| `trigram` table for the same notes | 171 ms | 165 ms |
| queries (word, `AND`, prefix `activ*`, phrase, column filter) with `bm25` and `snippet`, 20 rows | 0.1 to 6 ms | 0.1 to 6.4 ms |
| `ohtu` finds `õhtu` (diacritics folded) | yes | yes |
| update and delete through the triggers, `integrity-check` | correct, ok | correct, ok |
| user text with an unbalanced quote passed as the query | `unterminated string` error | same |
| each word quoted (`"word"`, inner quotes doubled) | no error | no error |
| database pages for both tables and the notes, in memory | 6206 pages of 4 KB | same |

## Design effects

1. One recursive `fs.watch` per mounted directory in the main process is enough for a vault of 20000 files: setup is immediate, idle cost is nil, and it works the same in Electron's main process. No watcher package is needed.
2. The event type is ignored. Each filename in a debounced batch (100 ms trailing, 500 ms at most) is checked with `lstat`, and every parent directory named in the batch is listed again and compared with the cached listing, because bursts lose events (P51). A full reconcile of the loaded directories runs on window focus, on wake and on a timer; it costs well under 0.1 s per 20000 entries.
3. A mounted single file and a file-backed note are watched through their parent directory with a name filter; a watcher on the file itself stops after the first atomic save.
4. An event that names the root's own name means "check the root": a moved or removed root shows the missing state. Since the watcher follows the path, the root's device and inode are compared before a recreated directory is shown again.
5. Symlinks are never followed by the watcher, so content behind a link is neither watched nor shown; links that leave the mount are listed as such and refused on open.
6. Every read goes through the checked open (real path inside the real root, regular file, `O_NOFOLLOW` and `O_NONBLOCK`, `fstat`, device and inode compared after a second resolve). Every write is a temporary file made with `O_EXCL` and `O_NOFOLLOW` in the target directory, then `rename`; a parent swapped for a link between the check and the `rename` is not prevented, only detected by a check after it. Identity keys use `realpathSync.native`.
7. Search uses FTS5 `unicode61 remove_diacritics 2` in the profile store; user text is quoted word by word before it reaches `MATCH`. `trigram` (substring search) is available but larger; it waits until a need appears.

## Not verified

- Network volumes (SMB, NFS), iCloud Drive placeholders, external disks that are ejected, and FAT or case-sensitive APFS volumes.
- Event loss with more than one watcher in the same process under load, and FSEvents history replay after sleep (the app does not use `sinceWhen`).
- Memory and CPU in the Electron main process at 20000 files (P51 ran as Node; P50 showed the same event behaviour in the main process).
- How editors other than the patterns of P50 save (VS Code, vim with `backupcopy`, JetBrains safe write, Obsidian).
- FTS5 cost and database size at 20000 notes or for indexing mounted files.
