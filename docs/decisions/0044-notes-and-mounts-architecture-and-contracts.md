# 0044 Notes and mounts: architecture and contracts

Status: accepted (2026-11-26, with the user's answers and the amendments of section 12; the editor amended on 2026-11-28 by the user's decision for Monaco, section 14 and record 0047)
Date: 2026-11-26
Proposed by: spike agents (design run `notes-design`), reviewed by an agent that did not write it (`docs/measurements/review-notes-design.md`); decided by the user on 2026-11-26; the amendments of section 12 written by run `decisions-amend`
Inputs: 0002, 0003, 0005, 0006, 0013, 0015, 0016, 0020, 0021, 0022, 0026, 0029, 0033, 0034, 0035, 0036, 0041, 0042, 0043 (drafted in parallel, read at the end and aligned; its access requests of section 4.10 after the user's decisions); `notes/probes-m6-notes.md` (P50 to P53, design run; P57, run `decisions-amend`), `notes/greenfield-and-libraries.md`; the code in `app/src/core/tree`, `app/src/core/surfaces`, `app/src/core/commands` (`types.ts`, `scope.ts`, `treeCommands.ts`, `surfaceCommands.ts`, `parity.ts`), `app/src/core/inbox` (`inboxMigrations.ts`, `taskCommands.ts`, `SqliteTaskStore.ts`), `app/src/core/browser` (`surfaceType.ts`, `InMemoryObservationService.ts`), `app/src/core/store/Store.ts`, `app/src/main/context.ts`, `app/src/main/modules.ts`, `app/src/renderer/panes` (`SurfacePane.tsx`, `tree/*`, `treeModel.ts`, `tree/AgentRows.tsx`), `app/src/renderer/ui`

## Context

0034 adds R27: Markdown and plain-text notes that start inline in the profile store and move to a file on request, an editor with source and rendered Markdown, links, search, agent tools with a diff the user accepts, and live mounts of files and directories that start read-only. The user decided on 2026-11-18 that every note starts inline and that a mount starts read-only. 0034 left the editor library, the tree contract for mount children and the build split to a design step.

This record is that step in the form of 0041 and 0043: an audit of what exists, the first slice, the amendments to 0034, the contracts (types, tables, the surface types, commands with the parity rule, the MCP tool schemas, the editor component with the tokens), the safety rules for mounts, the builder tasks with disjoint files, the tests, the security table, estimates in the units of 0005, risks and questions. The probes P50 to P53 of this run measured the macOS side with Node and Electron's Node. The contracts step of the build writes the types and stubs named here into the code, as 0041 did.

R21 runs in the same milestone (0043). This record defines the notes side of every task-side seam and lists the interface it needs from 0043 in section 4.15.

The user answered the questions of section 11 on 2026-11-26 and changed the design: agents may edit existing text in the first slice (`note_edit`, next to `note_append`); every refusal the user may lift becomes an access request (0043 section 4.10), also a note removal and a read or write of a mounted file; agent access to mounts stays read-only and off by default, with requests for reads and for single writes; and the mount watcher adapts to the size of the mount. Section 12 lists the answers and the amendments; the sections below already read as amended.

## Decision

### 1. Audit: what exists and what 0034 needs

Paths are relative to `app/src`.

| 0034 needs | Exists | Missing |
|---|---|---|
| A note as a surface type and a tree leaf | `SurfaceType` with `create`, `serialize`, `restore`, `mount`, `observe`, `tools`, `actions` (`core/surfaces/types.ts`); `SurfaceTypeRegistry`; leaves carry `surfaceType` and `surfaceId` (`core/tree/types.ts`); `SURFACE_ICONS.note` (a sticky-note glyph) in `renderer/ui/icons.ts`; `SurfacePane.tsx` shows an empty state for unknown types | a `note` surface type, its store and its view |
| Inline notes in the profile store | `node:sqlite` store with per-module migrations (`core/store/Store.ts`); the `tasks.notes` column (plain text, at most 8,000 characters) | a notes table, revisions, proposals, links, a search index |
| File-backed notes, save to file, make inline | nothing; no file dialog in `main`; `shell` is used only for `openExternal` (`main/window.ts`, `main/browser/ElectronViews.ts`) | the dialog, atomic writes, a watcher for the file |
| Editor with source and rendered Markdown, outline, structural diff (R11) | no editor, no Markdown parser, no diff view; 0021 section 9 renders all agent text as plain text and a test greps for `dangerouslySetInnerHTML` | the editor, the rendered view, the outline, the merge view, new dependencies |
| Links to tasks, pull requests, tickets, threads, pages through the reference index of 0033 | tasks with `external_url` and `link_node_id`; no `external_refs` table (0043 section 2 defers the index to apps) | note links and the reverse lookup |
| "- [ ]" becomes a task | `task_create` (UI and MCP, folder scope) in `core/inbox/taskCommands.ts` | the editor action |
| Search over inline and file notes | FTS5 is compiled into `node:sqlite` of Node 22 and Electron 45 (P53) | the index and the query builder |
| Quick capture from selected text or an inbox item | inbox items with folder and link (`inbox_items`); `ItemCard.tsx` renders kind-specific actions (`ReviewCardActions`, `SwarmApprovalActions`; 0043 adds `AskCardActions` and `HookApprovalActions`) | a capture action on the card; a shortcut source for selected text |
| Agent tools `note_create`, `note_read`, `note_append`, `note_search`, `note_list` with folder scope | command registry with `mcp`, `mcpExempt`, `toolSets`, `requireInScope` (`core/commands/scope.ts`), `docs/parity.md` | the commands |
| Agent edits as a diff the user accepts; append-only mode per note | inbox `approval` items with payloads and card stubs | proposals, the accept path through the access request of 0043 section 4.10, the merge view |
| Observation switch (R13) on a note | `ObserveMode` and `ObserveSpec` on surface types; the browser keeps the mode per tab and writes `observation_log` through `ObservationService.record` (`core/browser/SqliteBrowserStore.ts`), which accepts only a web origin (`isBareOrigin` in `core/browser/origin.ts`); `surfaces_observe` serves browser tabs only (`BrowserTools.observe` answers `failed` for other leaves) | a note's mode, the refusal in the tools, an origin value for app surfaces in the log |
| A mount as a tree node with children from the file system | leaves only under folders (`parent_not_folder`); agent nodes under a session leaf are rows drawn from a data source and not stored (`renderer/panes/tree/AgentRows.tsx`, rendered by `renderer/panes/TreePane.tsx`; 0027 section 3) | the `mount` surface type, the rows, the listing service |
| Agents limited to appends | `ui_remove_node`, `ui_rename_node` and `ui_move_node` are MCP tools for any node in the caller's folder (`core/commands/treeCommands.ts`), so an agent can remove a note leaf, and the cascade would remove the note and its revisions | a removal guard for note leaves that turns an agent's removal into an access request (section 4.4) |
| Live updates with debounce | nothing; `fsevents` is only a dependency of the dev tools | the watcher, adaptive to the mount's size (P50, P51, P57) |
| Unsaved edits against a change on disk: reload, keep mine, compare | nothing | the conflict banner and the compare view |
| Missing or renamed mount root with re-link | nothing | the root check (P50) |
| Real paths, symlinks that leave the mount, hidden files, size limits | the host tool rules of 0041 (`core/isolation/hostTools.ts`) for programs only | the path guard (P52) |
| Read-write toggle, agent access per mount off by default | nothing | the mount settings and their commands |
| A mounted file as a context attachment (R2) | no composer for Claude sessions | waits for a composer |
| Tokens and components for the UI | tokens of 0035 as `--agide-*` variables; `Banner`, `Toolbar`, `SegmentedControl`, `Menu`, `Popover`, `Switch`, `Dialog`, `IconButton`, `Chip`, `Badge`, `Hint`, `EmptyState`, `Table`, `Tooltip` in `renderer/ui` | the editor theme from the tokens |

### 2. Scope of the first slice

| Part | First slice | Waits for |
|---|---|---|
| Inline notes: create from a folder's menu, the tree's add menu and `note_create`; title from the first heading or "Untitled note"; autosave | yes | |
| The editor: Monaco source view with Markdown highlighting (0047), rendered view, split view, outline from the Markdown tree, plain text without rendering | yes | |
| The "Save to file" suggestion at the size setting, once per note, with "Not now" | yes | |
| File-backed notes: "Save to file" (dialog in the profile's notes directory), "Make inline", watch of the file, conflict banner with reload, keep mine and compare | yes | |
| Revisions kept across both storages | yes | |
| `note_create`, `note_read`, `note_append`, `note_edit`, `note_search`, `note_list` with folder scope, the observation switch and access requests (0043 section 4.10) | yes | |
| Agent appends and edits as proposals with a diff against a base revision, decided through the access request (Allow once, for this session, always, Deny) and in the merge view; the per-note setting `agentWrites`: `apply`, `review`, `none` | yes | |
| An agent's removal of a note leaf as an access request | yes | |
| Note links to tasks, notes and tree nodes (`agide:` links), plain URLs, the reverse lookup "notes that mention this" | yes | |
| "Make task" on a "- [ ]" line (creates the task, links the line) | yes | |
| "Capture as note" on an inbox card | yes, if 0043 gives the card slot (section 4.15) | |
| Search over notes (FTS5) with a search field in the notes view and `note_search` | yes | |
| Read-only mounts of a directory or a file with the adaptive watcher (section 4.8), lazy listing, the missing state and re-link | yes | |
| The read-write toggle, writes by the user from the editor | yes | |
| Agent read access to mounts (`mount_list`, `mount_list_dir`, `mount_read`), a per-mount switch off by default; a refused agent can ask (access request) | yes | |
| Agent writes to mounted files (`mount_write`), each one an access request with a diff, applied by the app's checked write | yes | |
| Path safety rules of section 4.9 | yes | |
| Deletes and renames of mounted files by agents | no | the write path in use |
| A standing agent write right on a mount | no | the user's answer C4 keeps agent access read-only; writes go by request |
| URL links mapped through the reference index (`external_refs`) | no | apps (0033, as 0043 section 2 decides) |
| Two-way sync of a "- [ ]" line and its task state | no | the tasks pane of 0043 in use |
| The notes editor as the task description editor | no | `tasks.notes` stays plain text in 0043; the slot of section 4.15 |
| Notes shown under a task or a session in the tree | no | a tree contract change; in the slice a note links to them and the task pane or session row shows the link |
| A folder's own note | no | the folder header of the layout |
| Quick capture from text selected in a terminal or a browser tab | no | selection sources in the terminal and browser surfaces |
| Search over mounted files | no | question 5 (an index per mount, off by default) |
| `.gitignore` filtering in mounts | no | a matcher or `git check-ignore` through `HostTools` |
| Opening other file types in their default application | no | a rule for executable types; the slice offers "Reveal in Finder" |
| A mounted file as a context attachment (R2) | no | a composer for Claude sessions |
| Substring search (`trigram`) | no | a need shown in use (P53: larger index) |

### 3. Amendments to 0034

| 0034 statement | Amendment | Reason |
|---|---|---|
| "Mounts add a node kind to the tree contract (0013): the tree needs nodes whose children come from the file system" | A mount is a leaf of surface type `mount`; its entries are rows drawn under the leaf from the mounts service, as agent rows are drawn under a session leaf (0027 section 3). `TreeNode`, the tree store, `ui_*` commands and the MCP folder scope stay unchanged | The tree keeps one contract; entries are never stored, so a vault of 20000 files never enters `tree_nodes` |
| A note is "a leaf in the tree under a project, a task or a session, or a folder's own note" | In the slice a note leaf lives in a folder. Its attachment to a task or a session is a link (`note_links`), shown in the task pane and on the session row. Leaves under leaves and a folder's own note wait | Tasks are rows of `tasks`, not tree nodes, and leaves cannot have children (`parent_not_folder`) |
| "Links ... through the external reference index of 0033" | Notes keep their own `note_links` (task, note, node, inbox item, URL). URL links map through `external_refs` when apps build it | 0043 defers the index to apps |
| "An agent edit appears as a diff the user accepts or rejects; append-only mode is a per-note setting" | Agents append (`note_append`) and edit existing text (`note_edit`) in the first slice. Every change is a proposal with a diff against a base revision. The per-note setting `agentWrites` decides: `apply` (changes apply at once as revisions by the agent), `review` (default: each change is an access request whose card shows the diff, 0043 section 4.10) or `none` (not allowed; refused without an item). The append-only mode becomes `apply` | The user's answer C2: editing existing text now, with the choice of applied at once, asked about, or not allowed |
| "agents never delete notes" (0034's guard) | An agent's removal of a subtree with note leaves is an access request (`note.remove`, Allow once or Deny); nothing is removed without the user's decision | The user's answer C6: the guard stays in the sense that the user decides |
| "The editor choice (CodeMirror or Lexical)" | Monaco for the source view and for the proposal and compare views (Monaco's diff editor); mdast for the outline, links, task lines and the rendered view (question 1, amended on 2026-11-28, section 14) | Section 4.11; the user's decision for one editor in the app (0047) |
| "The app watches the mounted path (recursive for directories, debounced)" | One recursive `fs.watch` per mounted directory in the main process; the event type is ignored; each batch lists its parent directories again; a mounted file is watched through its parent directory. The timings adapt to the mount's entry count (section 4.8): up to `liveMaxEntries` (1,000) a short debounce and a full walk every 30 s; above it a longer debounce with batching and rarer reconciles. A reconcile also runs on focus and on wake | P50 and P51: event types are unreliable, bursts lose a few percent of the events, a watcher on a file stops after an atomic save. P57: a full walk of 1,000 entries costs about 3 ms. The user expects small mounts and asked for near real time below about 1,000 files |
| "A removed or renamed mount root shows a missing state with a re-link action" | Kept; also a root whose device and inode differ from the stored ones is `moved` and needs the user's confirmation | P50: the watcher follows the path, so a directory recreated at the path would otherwise appear as the mount |
| "Files open in an editor suited to their type ... other types in a viewer or the system's default application" | Markdown and text open in the notes editor; other types show a metadata view with "Reveal in Finder". The default application waits | `shell.openPath` on an `.app`, `.command` or `.terminal` file runs it |
| "hidden files, `.gitignore` entries and very large files or directories are filtered or limited by settings" | Hidden names and a fixed list (`.git`, `node_modules`, `.DS_Store`) are hidden unless "Show hidden files" is on; `.gitignore` waits; the size and entry limits of section 4.12 | P52, P51 |
| "Search covers inline and file notes within the profile" | Kept; mounted files wait (question 5) | Indexing a vault reads every file |
| "the dialog opens in a notes directory in the profile's data directory" | Kept: `<profile data directory>/notes`. The confined agents' sandbox denies reads of the app root (0042), so a file note kept there is reached by agents only through the note tools | Notes and their files stay under the observation switch |
| "'Make inline' imports a file note back into the store" | The file stays on disk unchanged and is no longer watched | No silent deletion of a user's file |
| "The size that triggers the suggestion is a setting ... about one printed page" | Default 3,000 characters | |

### 4. Contracts

#### 4.1 Module layout

```
src/core
  notes        types.ts        Note, NoteSummary, NoteText, NoteProposal, NoteChange, NoteLink, NoteHit, NoteError, NoteService,
                               NoteEvent, NoteCaller, CreateNoteInput, SaveResult, ChangeResult
               schemas.ts      zod inputs of the commands (section 4.4) and the MCP tools (section 4.5)
               commands.ts     NOTE_COMMAND_INPUTS, registerNoteCommands (handlers answer "not built yet")
               notesMigrations.ts   module `notes`, migration 1 (section 4.2)
               settings.ts     NotesSettings and defaults (section 4.12)
               markdown.ts     MarkdownFacts: headings, links, task lines, from mdast (the contract of the parser)
               query.ts        ftsQuery(text): the word-by-word quoting of P53
               edits.ts        applyChanges(text, changes) and the rebase rule of section 4.6 (pure)
               InMemoryNoteService.ts, noteServiceContract.ts, notes.test.ts
  mounts       types.ts        Mount, MountEntry, MountRoot, Refusal, PathGuard, MountService, MountEvent, MountError, WatchTier
               schemas.ts, commands.ts (MOUNT_COMMAND_INPUTS, registerMountCommands)
               mountsMigrations.ts  module `mounts`, migration 1 (section 4.2)
               refusedRoots.ts the roots a mount may not have (section 4.9)
               watchTiers.ts   tierFor(count, current, settings) and the timings of each tier (pure, section 4.8)
               InMemoryMountService.ts, mountServiceContract.ts, mounts.test.ts
  surfaces     types.ts gains SURFACE_NOTE = 'note' and SURFACE_MOUNT = 'mount'
  tree         surfaceCatalog.ts gains both types (labels "Note" and "Mount"); neither is agent-creatable through ui_create_leaf
  commands     treeCommands.ts: TreeCommandDeps gains an optional removalGuard, which may raise an access request (section 4.4)
  access       the AccessBroker of 0043 section 4.10; notes and mounts register their handlers on it (no file of this record)
  browser      origin.ts: the fixed origins of app surfaces for the observation log (section 4.13)
  events       AppEvent gains NoteEvent and MountEvent
  profile      ProfileSettings.notes
src/main
  context.ts   Services gains notes and mounts; Desktop gains chooseSavePath, chooseMountPath, revealInFinder
  modules.ts   notes and mounts initialized last (section 4.14)
  modules/     notes.ts, mounts.ts (stubs that migrate and register)
src/renderer
  panes/notes/   NotePane.tsx, NoteEditor.tsx, MarkdownView.tsx, Outline.tsx, ProposalView.tsx, ConflictBanner.tsx
                 (stubs; the editor, the diff view and the theme come from renderer/editor of 0047);
                 SurfacePane renders NotePane for `note`
  panes/mounts/  MountRows.tsx, MountFileView.tsx, MountSettings.tsx (stubs); TreePane renders MountRows under a `mount` leaf as it renders AgentRows
  panes/inbox/   CaptureNoteAction.tsx (stub), rendered through ItemCardExtras, the slot that 0043's c-m6 adds
  ui/icons.ts    SURFACE_ICONS.mount and the glyphs of the mount rows
```

`src/core/notes` and `src/core/mounts` stay free of Electron (the existing test covers them). The file system access of mounts and file notes lives in `core` behind interfaces (`NoteFiles`, `MountFs`) with Node implementations, so the contract suites run against a temporary directory.

#### 4.2 Tables and migrations

Module `notes`, migration 1, applied after `tree` and `inbox` (proposals refer to `inbox_items`; the item of a proposal is its access request, 0043 section 4.10). Checked against `node:sqlite` in the design run: each constraint refuses and accepts as stated, and removing a folder removes its notes, revisions, proposals, links and index rows. Run `decisions-amend` checked the changed columns (`agent_writes`, the `edit` kind, `changes`, `stale`) the same way: an edit without changes, an edit with text, an edit with more than 20 changes and the old value `append_only` are refused, and a proposal loses its item reference when the item goes.

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,                                   -- also the leaf's surface_id
  node_id TEXT NOT NULL UNIQUE REFERENCES tree_nodes(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  format TEXT NOT NULL CHECK (format IN ('markdown', 'text')),
  storage TEXT NOT NULL CHECK (storage IN ('inline', 'file')),
  body TEXT CHECK (body IS NULL OR length(body) <= 1000000),
  file_path TEXT,                                        -- real path (realpathSync.native)
  file_sha256 TEXT,
  file_size INTEGER,
  file_mtime_ms INTEGER,
  file_state TEXT CHECK (file_state IS NULL OR file_state IN ('ok', 'changed', 'missing', 'refused')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  observe TEXT NOT NULL CHECK (observe IN ('off', 'on-demand')),
  agent_writes TEXT NOT NULL DEFAULT 'review' CHECK (agent_writes IN ('apply', 'review', 'none')),
  suggest_file TEXT NOT NULL DEFAULT 'pending' CHECK (suggest_file IN ('pending', 'shown', 'dismissed')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  created_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((storage = 'inline') = (body IS NOT NULL)),
  CHECK ((storage = 'file') = (file_path IS NOT NULL AND file_sha256 IS NOT NULL AND file_size IS NOT NULL
                               AND file_mtime_ms IS NOT NULL AND file_state IS NOT NULL)),
  CHECK ((created_by = 'agent') = (created_session_id IS NOT NULL))
);
CREATE TABLE note_revisions (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  body TEXT NOT NULL CHECK (length(body) <= 1000000),
  author TEXT NOT NULL CHECK (author IN ('user', 'agent', 'disk')),
  session_id TEXT,
  proposal_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, revision),
  CHECK ((author = 'agent') = (session_id IS NOT NULL))
);
CREATE TABLE note_proposals (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('append', 'edit')),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 1),
  text TEXT CHECK (text IS NULL OR length(text) BETWEEN 1 AND 20000),              -- append
  changes TEXT CHECK (changes IS NULL OR (json_valid(changes) AND json_array_length(changes) BETWEEN 1 AND 20)),  -- edit
  session_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'rejected', 'withdrawn', 'stale')),
  applied_revision INTEGER,
  item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,  -- the access request's item; NULL when applied at once
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((kind = 'append') = (text IS NOT NULL)),
  CHECK ((kind = 'edit') = (changes IS NOT NULL)),
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((state = 'accepted') = (applied_revision IS NOT NULL))
);
CREATE INDEX note_proposals_open ON note_proposals (note_id, state);
CREATE TABLE note_links (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('task', 'note', 'node', 'item', 'url')),
  target TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 2048),
  line INTEGER NOT NULL CHECK (line >= 1),
  task_line INTEGER NOT NULL DEFAULT 0 CHECK (task_line IN (0, 1)),
  PRIMARY KEY (note_id, ordinal)
);
CREATE INDEX note_links_by_target ON note_links (target_kind, target);
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = OLD.rowid;
END;
```

- The note's folder is the parent of its leaf. Moving the leaf moves the note's scope; no folder column can drift.
- `notes.title` and the leaf's title are the same text: the service sets both on create and on a title change from the first heading, and follows a rename of the leaf (`ui_rename_node`, also by an agent) into `notes.title` and the index. Leaf titles are visible to agents through `ui_list_tree` and `surfaces_list` whatever the note's `observe` is.
- `notes_fts` rows are keyed by the implicit `rowid` of `notes`. SQLite documents that `VACUUM` may renumber the implicit rowid of a table without an `INTEGER PRIMARY KEY`; the app runs no `VACUUM`, and a later one rebuilds the index (a review check on Node 22 saw no renumbering after deletes and `VACUUM`).
- `notes_fts` is a plain FTS5 table keyed by `notes.rowid`, written by the service: a file note's body is on disk, so triggers on `notes.body` cannot index it. The text indexed for a file note is the file's text up to the inline size limit.
- A revision is written when an agent change is applied (an accepted proposal, or a change under `apply` or a session grant, each with author `agent`, the session and the proposal id), before a proposal is accepted (the text it replaces), at "Save to file", "Make inline" and a reload from disk, and at most once per 10 minutes of the user's typing. Every applied agent change is a proposal row too (`accepted`, `item_id` NULL when it applied at once), so the history names each agent change. Revisions older than `revisionDays` are removed at start, except the latest of each note.
- Removing a note leaf removes the note and its history; the file of a file note stays on disk. Open proposals end `withdrawn` and their access requests `withdrawn`.

Module `mounts`, migration 1, applied after `tree`:

```sql
CREATE TABLE mounts (
  id TEXT PRIMARY KEY,                                   -- also the leaf's surface_id
  node_id TEXT NOT NULL UNIQUE REFERENCES tree_nodes(id) ON DELETE CASCADE,
  given_path TEXT NOT NULL CHECK (length(given_path) BETWEEN 1 AND 4096),
  real_path TEXT NOT NULL CHECK (substr(real_path, 1, 1) = '/'),
  kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
  root_device INTEGER NOT NULL,
  root_inode INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read' CHECK (mode IN ('read', 'read_write')),
  agent_access TEXT NOT NULL DEFAULT 'off' CHECK (agent_access IN ('off', 'read')),
  show_hidden INTEGER NOT NULL DEFAULT 0 CHECK (show_hidden IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'missing', 'moved', 'refused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX mounts_by_real_path ON mounts (real_path);
```

`agent_access` has no write value: agents hold no standing write right on a mount (the user's answer C4); each agent write is an access request (section 4.6). Mount entries, the entry count and the watch tier are never stored; the count is taken again at start.

#### 4.3 Types

```ts
// core/notes/types.ts
export type NoteFormat = 'markdown' | 'text';
export type NoteStorage = 'inline' | 'file';
export type NoteObserve = 'off' | 'on-demand';
/** apply: agent changes apply at once; review: each is an access request with a diff; none: refused. */
export type AgentWrites = 'apply' | 'review' | 'none';
export type FileState = 'ok' | 'changed' | 'missing' | 'refused';
export type NoteAuthor = { readonly kind: 'user' } | { readonly kind: 'agent'; readonly sessionId: string };

export interface Note {
  readonly id: string;
  readonly nodeId: NodeId;
  readonly title: string;
  readonly format: NoteFormat;
  readonly storage: NoteStorage;
  readonly revision: number;
  readonly chars: number;
  readonly observe: NoteObserve;
  readonly agentWrites: AgentWrites;
  readonly suggestFile: 'pending' | 'shown' | 'dismissed';
  readonly createdBy: NoteAuthor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file?: { readonly path: string; readonly sha256: string; readonly size: number; readonly mtimeMs: number; readonly state: FileState };
  readonly pendingProposals: number;
}

export interface NoteText {
  readonly note: Note;
  readonly text: string;      // the requested range
  readonly offset: number;
  readonly totalChars: number;
  readonly truncated: boolean;
}

export interface CreateNoteInput {
  readonly folderId: NodeId;
  readonly title?: string;
  readonly format?: NoteFormat;
  readonly body?: string;
  readonly index?: number;
}

export type SaveResult =
  | { readonly status: 'saved'; readonly note: Note }
  | { readonly status: 'conflict'; readonly current: Note };                 // expectedRevision or the file hash differed

/** One replacement of `note_edit`: `oldText` must occur exactly once in the text it applies to. */
export interface TextChange { readonly oldText: string; readonly newText: string }

/** An agent's change. Agent text: untrusted. */
export type NoteChange =
  | { readonly kind: 'append'; readonly text: string }
  | { readonly kind: 'edit'; readonly baseRevision: number; readonly changes: readonly TextChange[] };

export type ChangeResult =
  | { readonly status: 'applied'; readonly revision: number; readonly proposalId: string }
  | { readonly status: 'proposed'; readonly proposalId: string };

/** The outcome of applying a change to the current text (section 4.6). */
export type RebaseResult =
  | { readonly ok: true; readonly text: string; readonly rebased: boolean }
  | { readonly ok: false; readonly reason: 'not_found' | 'ambiguous' | 'overlap'; readonly change: number };

export interface NoteProposal {
  readonly id: string;
  readonly noteId: string;
  readonly change: NoteChange;
  readonly baseRevision: number;
  readonly sessionId: string;
  readonly state: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'stale';
  readonly appliedRevision?: number;
  readonly requestId?: string;   // the access request (the inbox item) while it is open
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface NoteLink {
  readonly targetKind: 'task' | 'note' | 'node' | 'item' | 'url';
  readonly target: string;
  readonly line: number;
  readonly taskLine: boolean;
}

export interface NoteHit {
  readonly noteId: string;
  readonly nodeId: NodeId;
  readonly title: string;
  readonly snippet: string;   // marked with the delimiters of section 4.10
  readonly rank: number;
}

/** Who calls the service. The commands derive it from `Caller`; an MCP caller carries its folder and session. */
export type NoteCaller = { readonly kind: 'ui' } | { readonly kind: 'agent'; readonly sessionId: string; readonly folderId: NodeId };

/** `CommandErrorCode` has no `conflict`: a command answers a `conflict` as `refused` with the current revision in the message. */
export type NoteErrorCode = 'not_found' | 'out_of_scope' | 'refused' | 'limit_reached' | 'conflict' | 'invalid_input' | 'failed';
export class NoteError extends Error { constructor(readonly code: NoteErrorCode, message: string) { super(message); } }

export interface NoteService {
  create(input: CreateNoteInput, caller: NoteCaller): Note;
  get(id: string): Note | undefined;
  read(id: string, range: { offset?: number; maxChars?: number }, caller: NoteCaller): NoteText;
  save(id: string, text: string, expectedRevision: number): SaveResult;                     // UI only
  /**
   * An agent's append or edit. `how` comes from the command: `apply` under `agentWrites: apply` or a session grant
   * (0043 section 4.10), `propose` under `review`. Validates an edit against its base revision; never asks the user itself.
   */
  change(id: string, change: NoteChange, caller: NoteCaller & { kind: 'agent' }, how: 'apply' | 'propose'): ChangeResult;
  /** The current text with the proposal applied, and whether it had to be rebased; the card's and the merge view's diff. */
  preview(proposalId: string): { readonly revision: number; readonly before: string; readonly after: RebaseResult };
  proposals(noteId: string): NoteProposal[];
  /** Accept or reject proposals (UI, or the access broker after the user's decision). Accept rebases or ends `stale`. */
  decide(proposalIds: readonly string[], decision: 'accept' | 'reject', expectedRevision: number): Note;
  /** The access broker's `note.remove` after an allow: removes the leaves through the tree service. */
  removeLeaves(nodeIds: readonly NodeId[], caller: NoteCaller & { kind: 'agent' }): void;
  saveToFile(id: string, path: string, overwrite: boolean): Promise<Note>;                   // UI only
  makeInline(id: string): Promise<Note>;                                                     // UI only
  reloadFromDisk(id: string): Promise<Note>;                                                 // UI only
  setObserve(id: string, mode: NoteObserve): Note;                                           // UI only
  setAgentWrites(id: string, mode: AgentWrites): Note;                                       // UI only
  setFormat(id: string, format: NoteFormat): Note;                                           // UI only
  dismissSuggestion(id: string): Note;                                                       // UI only
  list(scope: { folderId: NodeId | null }, caller: NoteCaller): Note[];
  search(query: string, scope: { folderId: NodeId | null; limit?: number }, caller: NoteCaller): NoteHit[];
  links(noteId: string): NoteLink[];
  backlinks(target: { kind: NoteLink['targetKind']; target: string }, caller: NoteCaller): Note[];
  revisions(noteId: string): { revision: number; author: NoteAuthor | { kind: 'disk' }; createdAt: string }[];
  revisionText(noteId: string, revision: number): string;
  subscribe(listener: (event: NoteEvent) => void): Unsubscribe;
}

export type NoteEvent =
  | { readonly type: 'note.changed'; readonly noteId: string; readonly revision: number; readonly by: 'user' | 'agent' | 'disk' }
  | { readonly type: 'note.meta_changed'; readonly noteId: string }
  | { readonly type: 'note.proposal_changed'; readonly noteId: string; readonly proposalId: string; readonly state: NoteProposal['state'] }
  | { readonly type: 'note.file_state'; readonly noteId: string; readonly state: FileState };
```

```ts
// core/mounts/types.ts
export type MountMode = 'read' | 'read_write';
export type MountState = 'ok' | 'missing' | 'moved' | 'refused';

export interface Mount {
  readonly id: string;
  readonly nodeId: NodeId;
  readonly title: string;
  readonly givenPath: string;
  readonly realPath: string;
  readonly kind: 'file' | 'directory';
  readonly mode: MountMode;
  readonly agentAccess: 'off' | 'read';
  readonly showHidden: boolean;
  readonly state: MountState;
  /** Followed at runtime, not stored (section 4.8). `undefined` until the first walk ended. */
  readonly entryCount?: number;
  readonly watchTier: WatchTier;
}

export type WatchTier = 'live' | 'relaxed';

/** The timings of one tier; both come from `ProfileSettings.notes.mounts.watch` (section 4.12). */
export interface TierTimings {
  readonly debounceMs: number;          // trailing quiet time before a batch runs
  readonly maxWaitMs: number;           // a batch runs at the latest this long after its first event
  readonly reconcileSeconds: number;    // re-list of the cached directories
  readonly walkSeconds: number;         // a full walk: the entry count, and every directory compared with its cache
}

/** A path relative to the mount root, POSIX separators, as the directory listing spells it; '' is the root. */
export type MountPath = string;

export interface MountEntry {
  readonly name: string;
  readonly path: MountPath;
  readonly type: 'file' | 'directory' | 'link' | 'other';
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly hidden: boolean;
  /** For links: where the real path lies. `outside` and `dangling` are shown and never opened. */
  readonly link?: 'inside' | 'outside' | 'dangling';
  readonly opensAs?: 'markdown' | 'text' | 'other';
}

export type Refusal =
  | 'absolute' | 'escapes' | 'leaves_mount' | 'missing' | 'not_regular' | 'too_large' | 'changed' | 'hidden' | 'hard_link' | 'binary' | 'read_only';
// `agent_access_off` is no refusal: an agent read of a mount with access off raises an access request (section 4.6).

export interface PathGuard {
  /** Lexical check, then realpathSync.native, then containment in the real root, then the file type (section 4.9). */
  resolve(root: MountRoot, path: MountPath): { ok: true; real: string; kind: 'file' | 'directory' } | { ok: false; reason: Refusal };
  /** The checked open of P52: O_NOFOLLOW and O_NONBLOCK, fstat, resolve again, compare device and inode, then read up to maxBytes from the descriptor. */
  readText(root: MountRoot, path: MountPath, maxBytes: number): Promise<{ ok: true; text: string; sha256: string; size: number; mtimeMs: number } | { ok: false; reason: Refusal }>;
  /** Temporary file with O_CREAT, O_EXCL and O_NOFOLLOW in the target's real directory, mode copied, then rename. */
  writeText(root: MountRoot, path: MountPath, text: string, expectedSha256: string | null): Promise<{ ok: true; sha256: string } | { ok: false; reason: Refusal | 'conflict' }>;
}

export interface MountRoot { readonly realPath: string; readonly device: number; readonly inode: number; readonly showHidden: boolean }

export interface MountService {
  create(input: { parentId: NodeId; path: string; title?: string }): Promise<Mount>;           // UI only
  get(id: string): Mount | undefined;
  list(scope: { folderId: NodeId | null }, caller: NoteCaller): Mount[];
  listDir(id: string, path: MountPath, caller: NoteCaller): Promise<{ entries: MountEntry[]; truncated: boolean }>;
  readFile(id: string, path: MountPath, range: { offset?: number; maxChars?: number }, caller: NoteCaller): Promise<{ text: string; sha256: string; totalChars: number; truncated: boolean }>;
  writeFile(id: string, path: MountPath, text: string, expectedSha256: string): Promise<{ sha256: string }>;  // UI only, mode read_write
  /** An agent's write after the user's allow (the `mount.write` handler); any mode; `null` creates a new file. */
  writeForAgent(id: string, path: MountPath, text: string, expectedSha256: string | null, caller: NoteCaller & { kind: 'agent' }): Promise<{ sha256: string }>;
  /** The card's diff of a requested write: the current text and its hash, read through the checked open. */
  previewWrite(id: string, path: MountPath, text: string): Promise<{ before: string; sha256: string | null; after: string }>;
  setMode(id: string, mode: MountMode): Mount;                                                 // UI only
  setAgentAccess(id: string, access: 'off' | 'read'): Mount;                                   // UI only
  setShowHidden(id: string, show: boolean): Mount;                                             // UI only
  relink(id: string, path: string): Promise<Mount>;                                            // UI only; also confirms `moved`
  reveal(id: string, path: MountPath): void;                                                   // UI only; Finder
  subscribe(listener: (event: MountEvent) => void): Unsubscribe;
  dispose(): void;
}

export type MountEvent =
  | { readonly type: 'mount.entries_changed'; readonly mountId: string; readonly directories: readonly MountPath[] }
  | { readonly type: 'mount.file_changed'; readonly mountId: string; readonly path: MountPath }
  | { readonly type: 'mount.state_changed'; readonly mountId: string; readonly state: MountState }
  | { readonly type: 'mount.settings_changed'; readonly mountId: string }
  | { readonly type: 'mount.tier_changed'; readonly mountId: string; readonly tier: WatchTier; readonly entryCount: number };
```

#### 4.4 Surface types, tree and commands

Surface types. `note` (`SURFACE_NOTE`) and `mount` (`SURFACE_MOUNT`) are registered by their modules. Both are created by their owners together with the leaf (`note_create`, `mount_create`), so neither joins `AGENT_CREATABLE_SURFACE_TYPES`; `ui_create_leaf` with either type is routed by the renderer to the owner's command (`createLeaf.ts`). The `note` type's `observe` is `{ modes: ['off', 'on-demand'], defaultMode: settings.defaultObserve }`, its snapshot `text` returns the note text through the same limits as `note_read`, `summary` returns the title and size. The `mount` type has `observe` `{ modes: ['off', 'on-demand'], defaultMode: 'off' }`, which mirrors `agentAccess` (`on-demand` is `read`). `surfaces_observe` serves browser tabs only today (`BrowserTools.observe`); in the slice agents read notes and mounts through `note_read` and `mount_read`, and `surfaces_observe` keeps answering `failed` for both. Dispatching it by surface type through `SurfaceTypeRegistry` waits.

Tree commands on note leaves. `ui_remove_node` from an MCP caller on a subtree that holds `note` leaves raises an access request `note.remove` (0043 section 4.10) in place of removing: nothing is removed without the user's decision (the user's answer C6). c-notes adds an optional `removalGuard(nodeIds, caller, signal): Promise<'proceed' | AccessCallResult>` to `TreeCommandDeps`; the notes module fills it. The card lists the titles of the notes in the subtree (data) and says that their history goes with them; it offers Allow once and Deny. An allow in the call lets `ui_remove_node` go on and remove the subtree; an allow after the call returned removes it at the decision through `NoteService.removeLeaves`, which checks again that every node still lies in the caller's folder and that the subtree holds no note added since the request (a new note ends the request `stale`). A deny returns `{ access: 'denied' }` with the user's message and quiets further removal requests of that session for those notes. A subtree without note leaves is removed as today. Renames and moves of note and mount leaves by agents stay allowed inside the caller's folder, as for every leaf; a rename changes the note's title (section 4.2).

Commands. The renderer calls every command through `invoke`. Rule of 0013 (`mcpExempt`, `checkParity`) as 0043 section 4.8 restates it: a command the renderer calls has a UI binding and is a tool, or states `mcpExempt`; `pnpm parity` lists it.

| Command | UI | MCP tool | Folder scope for agents | Notes |
|---|---|---|---|---|
| `note_create` | `{ menu: 'tree-node', accelerator: 'CmdOrCtrl+Alt+N' }` | yes | `folderId` in the caller's folder; default the caller's folder | section 4.5 |
| `note_read` | `{}` | yes | the note's leaf in the caller's folder; `observe` `off` raises a `note.read` request | section 4.5 |
| `note_append` | none | yes | the note's leaf in the caller's folder; `agentWrites` `none` refuses, `review` raises a `note.change` request | section 4.5 |
| `note_edit` | none | yes | as `note_append`; the caller must hold read access to the note (observation `on-demand`, a session grant for `note.read`, or a read of the note that the user allowed once for this session: the notes module remembers each such read until the session ends), else `refused` with "Read the note first; note_read asks the user" | section 4.5 |
| `note_search` | `{}` | yes | results within the caller's folder, `off` notes left out (no request: a search names no note) | section 4.5 |
| `note_list` | `{}` | yes | the caller's folder; `off` notes listed with their title (the leaf title is visible through `ui_list_tree` in any case) and without text | section 4.5 |
| `note_save` | `{}` | exempt: agents change notes through `note_append` and `note_edit`, which the user reviews | | `{ noteId, text, expectedRevision }` |
| `note_decide_proposal` | `{}` | exempt: only the user accepts or rejects an agent's change | | `{ proposalIds, decision, expectedRevision }`; the merge view's per-proposal decision; the card's decision goes through `access_decide` (0043) |
| `note_save_to_file` | `{ menu: 'tree-node' }` | exempt: the user picks a path in a dialog | | `{ noteId }`; main opens the dialog |
| `note_make_inline` | `{ menu: 'tree-node' }` | exempt: storage is the user's choice | | `{ noteId }` |
| `note_reload_from_disk` | `{}` | exempt: answers a conflict on the user's screen | | `{ noteId }` |
| `note_set_observation` | `{ menu: 'tree-node' }` | exempt: an agent cannot widen its own view (as `ui_set_observation`) | | `{ noteId, mode }` |
| `note_set_agent_writes` | `{ menu: 'tree-node' }` | exempt: an agent cannot widen its own write rights | | `{ noteId, mode }` |
| `note_set_format` | `{}` | exempt: a view setting of the user | | `{ noteId, format }` |
| `note_dismiss_suggestion` | `{}` | exempt: a view setting of the user | | `{ noteId }` |
| `note_revisions`, `note_revision_text` | `{}` | exempt: history view for the user; agents read the current text | | |
| `note_backlinks` | `{}` | yes | results within the caller's folder | `{ targetKind, target }` |
| `note_make_task` | `{}` | exempt: the editor action; agents call `task_create` | | `{ noteId, line, expectedRevision }`: calls `task_create` in the note's folder and rewrites the line as `- [ ] [title](agide:task/<id>)` |
| `note_capture_item` | `{}` | exempt: the user's capture from the inbox card | | `{ itemId }`: a note in the item's folder with the message and details quoted and an `agide:item/<id>` line |
| `mount_create` | `{ menu: 'tree-node' }` | exempt: an agent cannot add paths of the user's disk to the tree | | `{ parentId }`; main opens the folder or file dialog |
| `mount_set_mode` | `{ menu: 'tree-node' }` | exempt: an agent cannot make a mount writable | | `{ mountId, mode }` |
| `mount_set_agent_access` | `{ menu: 'tree-node' }` | exempt: an agent cannot widen its own view | | `{ mountId, access }` |
| `mount_set_show_hidden` | `{ menu: 'tree-node' }` | exempt: it widens what agents with access can read | | |
| `mount_relink` | `{ menu: 'tree-node' }` | exempt: the user picks the new path | | `{ mountId }` |
| `mount_reveal` | `{}` | exempt: it changes the user's screen | | `{ mountId, path }` |
| `mount_write_file` | `{}` | exempt: the user's editor; agents write through `mount_write`, which the user decides | | `{ mountId, path, text, expectedSha256 }`; refused unless `read_write` |
| `mount_list` | `{}` | yes | the caller's folder; mounts with access `off` listed with their title and `access: 'off'`, without entries, so an agent can ask (the leaf title is visible through `ui_list_tree` in any case) | |
| `mount_list_dir` | `{}` | yes | mount in the caller's folder; access `off` raises a `mount.read` request | `{ mountId, path? }` |
| `mount_read` | `{}` | yes | as `mount_list_dir` | `{ mountId, path, offset?, maxChars? }` |
| `mount_write` | none | yes | mount in the caller's folder; always a `mount.write` request unless the session holds a write grant for the mount | `{ mountId, path, text, expectedSha256 }`; section 4.5 |

Main-only parts (not commands): the save and open dialogs and Finder go through `Desktop` (`chooseSavePath(defaultDir, defaultName)`, `chooseMountPath(kind)`, `revealInFinder(path)`), so the modules stay testable without Electron. The renderer never sends a path the user typed to these commands; the dialog result stays in main.

Events on the app bus that cross IPC: `note.changed`, `note.meta_changed`, `note.proposal_changed`, `note.file_state`, `mount.entries_changed`, `mount.file_changed`, `mount.state_changed`, `mount.settings_changed`, `mount.tier_changed`. None carries note text or file content; the renderer reads through the commands.

#### 4.5 MCP tool schemas

Tools are on the `app` server, tool set `default` and `worker` (0041), scoped by the caller's folder. Every text a tool returns is data: the result carries `"untrusted": true` for text an agent or a file wrote, and the tool descriptions say so.

```ts
note_create:  { title?: string (1..200), body?: string (..20000), format?: 'markdown' | 'text', folderId?: string }
  -> { noteId, nodeId, revision }
  // the note starts inline, created_by agent; agentWrites 'review', observe from the setting
note_read:    { noteId: string, offset?: int >= 0, maxChars?: int 1..40000 (default 20000) }
  -> { noteId, title, format, storage, revision, offset, totalChars, truncated, text, untrusted: true }
     | AccessCallResult
  // observe off: a `note.read` access request (0043 section 4.10); a file note in state missing or refused answers
  // `failed` with the state
note_append:  { noteId: string, text: string (1..20000) }
  -> { status: 'applied', revision, proposalId } | AccessCallResult
  // apply (or a session grant): applied at once; review: a proposal and a `note.change` request, `applied` when the
  // user allows in the call; none: `refused`
note_edit:    { noteId: string, baseRevision: int >= 1,
                changes: [{ oldText: string (1..20000), newText: string (0..20000) }] (1..20) }
  -> { status: 'applied', revision, proposalId, rebased: boolean } | AccessCallResult
  // each oldText must occur exactly once in the text of baseRevision, and no two changes may overlap, else
  // `invalid_input` naming the change by index; a baseRevision older than the kept revisions answers `refused`
  // with the current revision; under apply a base that no longer applies (section 4.6) answers `refused` with
  // the current revision; under review the same check runs at the decision and a failure is `denied` with `stale`;
  // the caller needs read access to the note (section 4.4)
note_search:  { query: string (1..200), folderId?: string, limit?: int 1..50 (default 20) }
  -> { hits: [{ noteId, title, snippet, rank }], untrusted: true }
note_list:    { folderId?: string, limit?: int 1..200 (default 100), cursor?: string }
  -> { notes: [{ noteId, nodeId, title, format, storage, chars, updatedAt, observe, agentWrites, pendingProposals }], next?: string }
note_backlinks: { targetKind: 'task' | 'note' | 'node' | 'item' | 'url', target: string } -> { notes: [{ noteId, title }] }
mount_list:   { folderId?: string } -> { mounts: [{ mountId, title, kind, mode, access: 'off' | 'read' }] }
mount_list_dir: { mountId: string, path?: string } -> { entries: MountEntry[], truncated } | AccessCallResult
mount_read:   { mountId: string, path: string, offset?: int >= 0, maxChars?: int 1..40000 }
  -> { path, sha256, totalChars, truncated, text, untrusted: true } | AccessCallResult
mount_write:  { mountId: string, path: string, text: string (..1000000), expectedSha256: string (64 hex) | null }
  -> { status: 'written', path, sha256 } | AccessCallResult
  // always a `mount.write` request unless the session holds a write grant for the mount; null creates a new file
  // (refused when a file exists); a hash that differs at the time of the write ends the request `denied` with
  // `conflict`; every refusal of section 4.9 holds; the file must be text (UTF-8, no NUL) within maxFileBytes
access_request_result: see 0043 section 4.10
```

`AccessCallResult` is `{ access: 'pending', requestId, note }` or `{ access: 'denied', requestId, reason, message? }` (0043 section 4.10); the tool descriptions say that a call may wait up to `access.waitSeconds` for the user and then return `pending`.

Limits per session: `note_create` 20 per 10 minutes; `note_append` and `note_edit` together 30 per 10 minutes; `mount_write` 20 per 10 minutes; pending proposals 10 per note and session (`limit_reached` beyond); the access request limits of 0043 section 4.10. A tool result stays under 40,000 characters (the 10,000-token rule of 0006).

Errors use the codes of `CommandError`: `not_found` for an unknown id, `out_of_scope` for a note or mount outside the folder, `refused` for `agentWrites` `none`, a stale revision, a session's quiet deny and the path refusals of section 4.9, `limit_reached` for the limits, `invalid_input` for schema errors and edits that do not fit their base. `observe` off and mount access off are no errors: they raise requests. An unknown note and a note in another folder answer as `ui_*` commands do (`requireInScope`).

#### 4.6 Agent changes, proposals and access requests

Every agent change to a note is a proposal row: an append (text added at the end) or an edit (a list of `oldText` to `newText` replacements against a base revision). The note's `agentWrites` decides what happens to it (the user's answer C2):

| `agentWrites` | The call | The card |
|---|---|---|
| `apply` | applies at once as a revision by the agent (proposal `accepted`, no item); the editor marks the changed ranges with the agent mark until the user has seen them; undo through the revisions | none |
| `review` (default) | stores the proposal (`pending`) and raises or joins the session's `note.change` access request for the note; waits as 0043 section 4.10 says | the access request: the diff of every pending proposal of the request against the current text; Allow once, for this session, always (sets `apply`), Deny |
| `none` | `refused` ("Agent changes are off for this note"), no proposal, no item | none |

A session grant for `note.change` on the note (from "Allow for this session") makes the call behave as under `apply` for that session.

The access request for a note change:

- One open request per session and note: later changes of the session join it, and the card lists them in order. The item carries `payload { requestId, action: 'note.change', targetKind: 'note', targetId, proposalIds }`. The card's diff is the result of applying every listed proposal in order to the current text (`preview`), computed when the card opens and again before an allow is applied; `access_decide` carries the revision the diff was shown against, and a note that moved on since answers `refused` and the card refreshes.
- Allow once accepts the listed proposals; for this session also grants later changes; always also sets `agentWrites` to `apply` through `note_set_agent_writes`; Deny rejects them, with the user's message for the agent. The note pane's merge view (`ProposalView`) offers accept and reject per proposal; when no proposal of the request is pending, the request ends `allowed` (scope `once`) if any was accepted, else `denied`.
- Revisions: before the first accepted proposal is applied, a revision with the current text is written; each accepted proposal writes a revision with author `agent`, the session and the proposal id.

Rebase (`edits.ts`, pure):

- An append always applies: it goes after the current end with one newline between.
- An edit applies to the text of its base revision when the note is still at that revision. When the note moved on, each `oldText` must occur exactly once in the current text, and the matched ranges must not overlap; then the edit applies to the current text (`rebased: true`) and the card shows the diff against the current text. Otherwise the proposal ends `stale`: under `review` the request ends `denied` with reason `stale` and the current revision in the result, under `apply` the call answers `refused` with the current revision. The agent reads the note again and proposes anew.
- Proposals of one request apply in order; a proposal that no longer applies after an earlier one is `stale` alone, and the others go on.

Other rules:

- The editor rebases a remote change onto unsaved local edits when it touches no line the user changed (an append always qualifies); any other remote change while the buffer has unsaved edits shows the conflict banner.
- A file note: every applied change writes the file through the atomic write of section 4.7.
- The proposal text and the diff render in the source view only, never as rendered Markdown, until accepted.
- No command lets an agent accept, reject, change `agentWrites`, change `observe` or save a note; a removal of note leaves goes through the `note.remove` request (section 4.4).

Access requests of notes and mounts, registered on the broker of 0043 section 4.10 by the notes and mounts modules:

| Action | Raised by | Offered scopes | `perform` | `applyAlways` |
|---|---|---|---|---|
| `note.read` | `note_read` of a note with observation `off` | once, session, always | the read with the original range | `note_set_observation` to `on-demand` |
| `note.change` | `note_append`, `note_edit` under `review` | once, session, always | `decide(proposalIds, 'accept', revision)` | `note_set_agent_writes` to `apply` |
| `note.remove` | `ui_remove_node` on a subtree with note leaves | once | `removeLeaves` | none |
| `mount.read` | `mount_list_dir`, `mount_read` while agent access is `off` | once, session, always | the listing or the read with the original input, through the path guard | `mount_set_agent_access` to `read` |
| `mount.write` | `mount_write`, always | once; session only while the mount is `read_write` | `writeForAgent` with the agent's `expectedSha256` | none: agents hold no standing write right (C4) |

Agent writes to mounted files (the user's answer C4 and the read-write switch):

- The mount's read-write switch stays the user's: it governs the user's own editor, and no agent request changes it.
- In a `read_write` mount a write request offers Allow once and Allow for this session (later writes of the session to files of this mount apply at once, each still through the checked write and listed in the session's grants). Switching the mount to read-only ends every session write grant on it.
- In a `read` mount a write request offers Allow once only: the app performs that one write through the checked write of section 4.9, and the mount stays read-only for the user's editor and for every later request. Question 1 of section 13 asks whether such single writes into a read-only mount should be allowed at all.
- The card shows the path (data, escaped) and the diff of the current file (read through the checked open at the time the card opens, and again before the write) against the agent's text; a new file shows its whole text. The write uses the agent's `expectedSha256`: when the file changed since the agent read it, the request ends `denied` with reason `conflict`, and the user's own unsaved buffer of that file is never overwritten (the editor's conflict banner applies).
- Deletes and renames of mounted files by agents wait (section 2).

#### 4.7 File-backed notes

- "Save to file": main opens the save dialog in `<profile data directory>/notes` with the title as file name (`.md` or `.txt`). The service resolves the chosen directory to its real path, refuses a target inside a refused root (section 4.9), writes a temporary file with `O_CREAT`, `O_EXCL` and `O_NOFOLLOW` in that directory and renames it to the target. An existing target was confirmed by the dialog's own overwrite question; the service replaces it in the same way. The note keeps its id, revisions, links and proposals; `body` becomes `NULL`, the file fields are set, the index row keeps the text.
- Saving a file note compares the file's SHA-256, size and modification time with the stored ones first; a difference is a conflict (the editor's banner). A file with more than one hard link is replaced like any other (the link to the other name ends, P52); the editor says so once.
- Watch: one non-recursive watcher per distinct parent directory of file notes, filtered by name (P50). A change reads the file through the checked read, updates the hash, the index and `revision` with author `disk` when the text differs, and emits `note.changed`. A missing file sets `missing`; a path that now leaves its directory through a link, or is no longer a regular file, sets `refused`. Both show a banner with "Locate…" (the open dialog) and "Make inline from last text".
- "Make inline": the text becomes `body`, the watcher stops, the file stays.
- The notes directory is created with mode 0700 on first use.

#### 4.8 Mount watcher and listing

- Create: main opens the folder or file dialog; the service resolves the real path with `realpathSync.native`, refuses the roots of section 4.9, stores the given and real path with the device and inode, and creates the leaf with the base name as title.
- Listing is lazy: `mount_list_dir` resolves the directory through the path guard, takes its device and inode, lists it with `readdir` and `lstat` per entry, resolves it again and discards the listing (`changed`) when the real path or the identity differs, so a directory swapped for a link during the listing does not show the names of the outside directory. It sorts directories first then names (locale compare), hides hidden names unless `showHidden`, and stops at `maxEntriesPerDirectory` with `truncated`. The renderer keeps the expanded directories and asks again on `mount.entries_changed`.
- One recursive `fs.watch` per mounted directory in the main process (P50, P51: no extra descriptors, no idle CPU, setup in about 1 ms at 20000 files). The callback ignores the event type and queues the filename. While "Show hidden files" is off, names below a hidden component are dropped from the queue.
- A batch lists again each parent directory it names that the service has cached, compares names, types, sizes and modification times with the cache, and emits one `mount.entries_changed` with the directories that differ and one `mount.file_changed` per changed file that an editor has open. A batch over `rescanEventThreshold` events lists every cached directory again. A batch also adds to the entry count the entries its re-lists gained and subtracts those they lost.

Adaptive watching (the user: "less files are more real-time and with more than 1000 files, the monitoring is less real-time"). The watcher is the same in both tiers; the tier sets the timings:

| | `live` tier: up to `liveMaxEntries` (1,000) entries | `relaxed` tier: more entries |
|---|---|---|
| Debounce (trailing) | 30 ms | 250 ms |
| A batch runs at the latest | 150 ms after its first event | 2,000 ms after its first event |
| Re-list of the cached directories (reconcile) | every 30 s | every 5 minutes |
| Full walk (the entry count, and every directory compared with its cache, cached or not) | every 30 s, together with the reconcile | every 30 minutes |
| On window focus and on wake (`Desktop.onResume` of 0043) | full walk | reconcile |

- Why these numbers (P57, `notes/probes-m6-notes.md`): a single change reaches the watcher after about 13 ms (median; 95th percentile 15 to 23 ms), and the events of a burst of 100 new files arrive within about 55 to 65 ms of its start, so a 30 ms trailing window gathers a burst into few batches and shows a change about 45 to 60 ms after it happened; 150 ms caps the delay under a stream of events. A full walk costs about 2 to 4 ms of CPU at 1,000 entries, so a walk every 30 s is about 0.01 % of one core. At 20,000 entries a walk costs about 55 ms and the count at mount time about 75 ms, so the relaxed tier walks rarely and batches longer (P51: a 100 ms window already held a burst of 2,000 changes in one batch).
- The entry count is measured at mount time by a walk (asynchronous, directory by directory, stopping at `maxScanEntries`; it does not enter linked directories, nor the fixed hidden list while hidden files are off) and followed as it changes: each batch adds and subtracts what its re-lists show, and each full walk sets it again. Until the first walk ends the mount runs in the `relaxed` tier.
- The tier changes with hysteresis: `live` becomes `relaxed` when the count passes `liveMaxEntries`, and `relaxed` becomes `live` when it falls below 90 % of it, so a mount near the limit does not switch at every batch. A change emits `mount.tier_changed`; the mount settings popover shows "<n> entries, updates within a moment" or "<n> entries, updates every few seconds".
- The thresholds and the timings are settings (section 4.12). The hard limits (`maxEntriesPerDirectory`, `maxScanEntries`) and the reconcile for lost events stay in both tiers, because bursts lose events (P51).
- Root: an event that names the root's own base name, or a failing listing of the root, checks the root. Gone: state `missing`. Present with another device or inode, or resolving to another real path: state `moved`, no entries shown until the user confirms with "Re-link" (P50: the watcher follows the path).
- A mounted file is watched through its parent directory with a name filter (P50).
- Open mounted files: the editor holds the text and its SHA-256; `mount.file_changed` reloads silently when the buffer is clean and shows the conflict banner when it is not.
- Linked directories are listed as `link` entries and never entered; FSEvents does not report changes behind a link (P50).

#### 4.9 Mount safety rules

| Rule | How |
|---|---|
| Real paths | The root is stored as the real path of `realpathSync.native` (`/tmp` is `/private/tmp`; the case on disk is returned, P52). Every comparison uses real paths and the separator: a path is inside when it equals the real root or starts with the real root followed by `/` |
| Relative paths only | A tool or renderer path is relative, POSIX, without `..` after normalization and not absolute; otherwise `escapes` or `absolute` before any file system call |
| Symlinks that leave the mount | The real path of the target must be inside the real root; a link whose target lies outside, a chain that ends outside, a dangling link and a link to a device are listed as `link` entries with `outside` or `dangling` and refused on open (`leaves_mount`, `missing`). Links inside the mount open as their target |
| The swap between check and open | `readText` opens with `O_NOFOLLOW` and `O_NONBLOCK`, `fstat`s the descriptor, resolves the path again and compares device and inode; any difference is `changed`, and the content is read from the descriptor only after the comparison. `O_NOFOLLOW` checks only the last component, so the open itself does follow a parent swapped for a link; the second resolve and the comparison refuse it (P52, and a review check with the swap placed between the resolve and the open, and swapped back before the second resolve) |
| File types | Only regular files open and only directories list; FIFOs, sockets and devices are `other` entries and refused (`not_regular`); `O_NONBLOCK` keeps a FIFO from blocking |
| Writes | From the user's editor in a `read_write` mount, and from an agent's `mount_write` once the user allowed it (in any mode; section 4.6). Both use the same checked write: a temporary file made with `O_CREAT`, `O_EXCL` and `O_NOFOLLOW` in the target's real directory, the old mode copied, then `rename`, which replaces a link in the last component and never writes through it (P52); `expectedSha256` must match the file on disk. Node has no `openat` or `renameat`, so a parent directory swapped for a link between the check and the `rename` moves the write outside the mount (review check: the outside file was replaced). The guard therefore `fstat`s the temporary file, resolves its directory again right before the `rename`, and after the `rename` resolves the target and compares its inode with the temporary file's; a difference is reported as an error with both paths. This narrows the window and reports the case; it does not close it (section 7) |
| Hidden files | Names that start with `.` and the fixed list `.git`, `node_modules`, `.DS_Store` are hidden unless "Show hidden files" is on. The rule applies to every component of the requested path and to every component of its real path below the real root, so a visible link inside the mount that points at `.env` is hidden as well; `mount_read` of a hidden path answers `hidden` while it is off |
| Hard links | A regular file with more than one link can be a second name of a file outside the mount (P52: `nlink` is the only sign). The user's editor opens it with a notice; `mount_read` refuses it (`hard_link`), since the main process reads files that an agent's sandbox may deny |
| Size | Files over `maxFileBytes` (5 MB) do not open in the editor and are refused to agents (`too_large`); text is decided from the first 8 KB (no NUL byte, valid UTF-8, P52), other files show the metadata view (`binary`) |
| Entries | `maxEntriesPerDirectory` (5,000) per listing with `truncated`; a reconcile stops at `maxScanEntries` (200,000) and marks the mount "partly watched" |
| Refused roots | `/` and the user's home directory itself; the app root (every profile's data, tools and Claude directories and the registry), the logs and crash dump directories, the Claude configuration of the default login, and the credential locations of `checkDenyRead` (0041, 0042), each with everything inside it; and any root that contains one of them. Every comparison uses real paths. A re-link follows the same list. A file note's target follows it too, with one exception: the profile's own notes directory (section 4.7), which lies inside the app root, holds file notes and is never a mount root |
| Read-write toggle | One action on the mount (menu, settings popover, `mount_set_mode`), applied at once, reversible; the tree row shows a Chip "read-write" while it is on |
| Agent access | Read-only and off by default, per mount (C4); `mount_list_dir` and `mount_read` for mounts in the caller's folder with access `read`, or after an allowed `mount.read` request; `mount_write` only after an allowed `mount.write` request; every refusal of this table stays a refusal and raises no request; each read and write is written to the observation log |
| What the mount does not govern | An agent's own `Read`, `Grep` and `Bash` tools reach whatever its sandbox and permission rules allow, mount or not; the mount's switch governs the app's tools only. The mount settings popover says so |
| Names | File names render escaped (control and bidirectional characters, as in the review views of 0040); no name from a mount becomes a command argument without the user's click |

#### 4.10 Search and links

- `ftsQuery(text)` splits user or agent text on white space, doubles inner quotes and quotes each word (P53: an unbalanced quote is a syntax error); a trailing `*` on a word of at least 2 letters stays a prefix query. The words are joined with `AND`. The search field offers no other syntax in the slice.
- Results: `bm25` order, `snippet(notes_fts, 1, '\u0002', '\u0003', '…', 12)`; the renderer turns the delimiters into highlighted text spans, never into markup. Scope is checked in the service with `tree.isWithin` on each hit's leaf, and `off` notes are left out for agents.
- The index is written in the same transaction as the note's text (inline) or after the file read (file notes).
- Links come from the mdast of each saved revision (`markdown.ts`): `agide:task/<id>`, `agide:note/<id>`, `agide:node/<id>` and `agide:item/<id>` links, and `http` and `https` URLs, each with its line; a list item with a checkbox whose text holds an `agide:task` link is a task line. `note_links` is replaced on each save.
- The rendered view opens an `agide:` link in the app (the node, the task in the tasks pane, the item) and an `http` or `https` link in a browser surface of the note's folder (0021 section 9); other schemes show as text.
- "Link to…" in the editor opens a picker of tasks, notes and nodes of the profile and inserts `[title](agide:task/<id>)`.

#### 4.11 Editor component and tokens

Dependencies (exact versions at least two weeks old, chosen by the contracts step with the lockfile): `monaco-editor` 0.57.0 (0047 section 5.2: loaded on first use, the editor contributions without the language services, Monarch highlighting; shared with the file editor and the review), `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`. No `@codemirror/*` package (amended 2026-11-28, section 14). No HTML renderer, no `remark-html`, no `rehype`.

| Component | Where | Built from | Notes |
|---|---|---|---|
| `NotePane` | `renderer/panes/notes/` | `Toolbar` (title, `SegmentedControl` Source, Split, Preview; `IconButton` Outline; `IconButton` observation eye with `Tooltip`; `Menu` with Save to file, Make inline, Agent writes, Format, Revisions, Reveal in Finder for file notes), `Badge` for pending proposals | rendered by `SurfacePane` for `note`; props `{ node, mode: 'edit' \| 'read' \| 'peek' }`; `peek` takes no focus (the peek mode 0043 leaves to notes) |
| `NoteEditor` | same | `CodeEditor` of 0047 (Monaco) with the Monarch `markdown` language for Markdown and `plaintext` for text; word wrap on, line numbers off; Monaco's find widget; the options of 0047 section 5.2 (no link detection, control characters and Unicode highlighting shown, no context menu) | value, `onChange`, `readOnly`; autosave 1 s after the last keystroke through `note_save`; Cmd+S saves at once; an applied agent change enters the model with `pushEditOperations` and the agent mark (0047 section 5.6) |
| `MarkdownView` | same | mdast to React elements | headings, paragraphs, emphasis, lists with checkboxes (read-only), quotes, code blocks in `surface.inset` without highlighting, tables, thematic breaks; raw HTML nodes render as text; images render as their alt text and URL, never fetched; links as in section 4.10; no `dangerouslySetInnerHTML` (the grep test of 0021 extends to `renderer/panes/notes` and `renderer/panes/mounts`) |
| `Outline` | same | list of headings in `type.small`, the current one in `selection` | click scrolls the source and the preview |
| `SuggestFileBanner` | same | `Banner` (info) with `Button` "Save to file" and quiet `Button` "Not now" | once per note when `chars` passes `suggestFileAtChars` |
| `ConflictBanner` | same | `Banner` (warning) with "Reload", "Keep mine", "Compare" | "Compare" opens `DiffView` of 0047 side by side (disk or the other writer on the left, the buffer on the right) |
| `ProposalView` | same | `DiffView` of 0047 (Monaco's diff editor), inline, read-only, word wrap, of the current text against the text with the pending proposals applied (`preview`); a list of the proposals beside it, where selecting one shows its own diff and "All" shows them together; `Button` "Accept", "Reject" per proposal, "Accept all", "Reject all"; a `Chip` "rebased" on a proposal that applies to a newer revision and a `Chip` "out of date" (`warning`) on a `stale` one | proposal text in the source font only; author line "Proposed by <session title>" in `text.secondary`; decisions here go through `note_decide_proposal`, and the open access request ends when none is pending (section 4.6) |
| `FileStateBanner` | same | `Banner` (danger for `refused`, warning for `missing`) with "Locate…", "Make inline from last text" | |
| `MountRows` | `renderer/panes/mounts/` | tree rows in the density of 0035 section 3.5, `Icon` per entry type, a link-out glyph with `Tooltip` "Points outside the mount" | drawn under a `mount` leaf like `AgentRows`; expand loads `mount_list_dir`; a `Chip` "read-write" on the leaf when on; the missing and moved states as a row with `Button` "Re-link" |
| `MountSettings` | same | `Popover` with `Switch` Read-write, `Switch` Agents can read, `Switch` Show hidden files, `Hint` "Agents' own file tools are governed by their sandbox, not by this switch", `Hint` "Agents can ask you to read or write here; you decide each time", a line with the entry count and the watch tier (section 4.8) | |
| `MountFileView` | same | `NotePane` in `read` mode for read mounts and in `edit` mode for read-write mounts, for Markdown and text files; other text files (code) open in the file pane of 0047 section 5.5 with the language from the file name; a metadata `Table` with "Reveal in Finder" for other types | |
| `CaptureNoteAction` | `renderer/panes/inbox/` | quiet `Button` "Capture as note" | rendered by `ItemCardExtras`, the slot of 0043's c-m6 |
| Note and mount access cards | none of this record | the `AccessRequestActions` card of 0043 section 4.9 shows the diff, the path and the titles from the handlers' `detail` | "Open note" opens `ProposalView`; "Open file" opens `MountFileView` |

Editor theme: the Monaco theme bridge of 0047 section 5.3 builds it from the resolved tokens of 0035 (Monaco refuses CSS variables, P73); the app's own marks use the CSS variables; no colour literal (`pnpm check:colours`). The note editor's parts take these tokens:

| Editor part | Token |
|---|---|
| background | `surface.content` |
| text | `text.primary`, `font.mono`, `type.body` size and line height for the source; `font.ui` and `type.body` for the rendered view |
| gutter and line numbers (off by default) | `text.tertiary` on `surface.content` |
| selection | `selection` (focused), `selection.inactive` |
| cursor | `accent.text` |
| active line | `surface.hover` |
| headings in the source | `font.weight.semibold` |
| links | `text.link` |
| code spans and blocks | `surface.inset` |
| search match | `warning.bg` |
| inserted text in the proposal and compare views | `success.bg`, removed `danger.bg` |
| agent-changed range (applied at once under `apply` or a session grant) | a left mark in `info.fg` |
| focus | `focus.ring` at `focus.width` |

#### 4.12 Settings

`ProfileSettings.notes`:

| Setting | Default |
|---|---|
| `suggestFileAtChars` | 3,000 |
| `defaultObserve` | `on-demand` (question 3, answered so) |
| `defaultAgentWrites` | `review` |
| `revisionDays` | 90 |
| `typingRevisionMinutes` | 10 |
| `mounts.maxFileBytes` | 5 MB |
| `mounts.maxEntriesPerDirectory` | 5,000 |
| `mounts.maxScanEntries` | 200,000 |
| `mounts.rescanEventThreshold` | 1,000 |
| `mounts.watch.liveMaxEntries` | 1,000 (back to `live` below 90 % of it) |
| `mounts.watch.live` (`debounceMs`, `maxWaitMs`, `reconcileSeconds`, `walkSeconds`) | 30, 150, 30, 30 |
| `mounts.watch.relaxed` (`debounceMs`, `maxWaitMs`, `reconcileSeconds`, `walkSeconds`) | 250, 2,000, 300, 1,800 |

The schema bounds the timings (debounce 10 to 5,000 ms, the latest run at least the debounce, reconcile and walk 10 s to 1 hour) so a setting cannot turn the watcher into a busy loop.

#### 4.13 Observation log

`note_read`, `note_search` hits, `mount_list_dir`, `mount_read` and `mount_write` write entries to `observation_log` (0026 section 6) with the tool, the node, the size and the outcome (`ok`, `requested`, `allowed`, `denied`, `error`); no content. A read that an access request allowed is logged with the request id. The browser module owns the table and already has the writer, `ObservationService.record`; it refuses any `origin` that is not a web origin (`isBareOrigin`), and `new URL('agide://notes').origin` is `'null'`. The contracts step lets `record` accept the fixed values `app:notes` and `app:mounts` as the origin of app surfaces (`core/browser/origin.ts` or the check in `record`, with a test), and the notes and mounts modules receive the `ObservationService` through their deps.

#### 4.14 Order of module initialization

The modules of 0041 and 0043 keep their order. `notes` (tree, profile, inbox, access, mcp, browser for the log writer) and then `mounts` (tree, profile, access, mcp, browser) come last, before the final `mcp.start()`; each registers its access actions on the broker of 0043 at start. Dispose runs in reverse, so watchers close before the store, and the handlers are unregistered before the broker goes.

#### 4.15 Interface needed from 0043

0043 was drafted in parallel and amended with this record after the user's decisions. It keeps `tasks.notes` as plain text and defers the external reference index and notes as task descriptions (0043 section 2). These are the points the notes side needs:

| Need | From 0043 | Used for |
|---|---|---|
| The access broker: `AccessBroker`, `AccessActionHandler`, `AccessCallResult`, the `access_request_result` tool, the card, the grants, the delivery of decisions | 0043 section 4.10; contracts in c-m6, the real broker in w-access | every request of section 4.6 |
| A slot in `ItemCard` for kind-independent actions | the `ItemCardExtras` stub of c-m6, rendered for every item; i-notes fills `renderer/panes/inbox/ItemCardExtras.tsx` and edits no line of `ItemCard.tsx` | `CaptureNoteAction` |
| A slot in the tasks pane's `TaskRow` and `TaskDialog` for linked notes | the `TaskNoteLinks` stub of c-m6 (`renderer/panes/tasks/TaskNoteLinks.tsx`, `{ taskId }`), called by w-tasks-ui; i-notes fills the stub with the notes component of w-editor | "Notes that mention this task" through `note_backlinks` |
| A description editor slot in `TaskDialog` | the Field textarea behind a `TaskDescriptionEditor` component with `{ value, onChange }` | the notes editor later (section 2); no change in the slice |
| `task_create` returns the task with its id, and `task_update` sets the state | exists (`taskCommands.ts`) | "Make task" |
| A focus action for a task by id | `tasks_focus { taskId }` or the pane's selection in the shared context; 0043 as drafted has neither, so until one exists the link focuses the task's folder with the existing `ui_focus_node` | `agide:task/<id>` links |
| `Desktop.onResume` | section 4.6 of 0043 | the mount reconcile on wake |

### 5. Builder tasks

| Step | Slice | Owns | Must not edit |
|---|---|---|---|
| c-notes (contracts) | the types, schemas, migrations, settings, in-memory services and contract suites of section 4; `SURFACE_NOTE`, `SURFACE_MOUNT`; command registration with handlers that answer "not built yet"; `Services`, `Desktop` additions; module stubs; renderer stubs and the `SurfacePane` and tree-row hook points; the origin rule of `ObservationService.record` for app surfaces (section 4.13); the removal guard of `ui_remove_node` with its access request seam (section 4.4); the pure `edits.ts` and `watchTiers.ts` with their tests (the rebase rule and the tier choice are contracts); the dependencies of section 4.11 with the lockfile; `docs/parity.md` | `core/notes/{types,schemas,commands,notesMigrations,settings,markdown,query,edits}.ts`, `InMemoryNoteService.ts`, `noteServiceContract.ts`; `core/mounts/{types,schemas,commands,mountsMigrations,refusedRoots,watchTiers}.ts`, `InMemoryMountService.ts`, `mountServiceContract.ts`; `core/surfaces/types.ts`, `core/tree/surfaceCatalog.ts`, `core/commands/treeCommands.ts` (the guard, with its test), `core/events/index.ts`, `core/profile/types.ts`, `core/profile/schemas.ts`, `core/browser/origin.ts` (with its test); `main/context.ts`, `main/modules.ts`, `main/modules/{notes,mounts}.ts` stubs; `renderer/panes/SurfacePane.tsx`, `renderer/panes/TreePane.tsx` (the `MountRows` call beside `AgentRows`), `renderer/panes/tree/createLeaf.ts`, `renderer/panes/tree/leafDecorations.tsx`, the stubs under `renderer/panes/notes/` and `renderer/panes/mounts/`, `renderer/ui/icons.ts`; `package.json`, lockfile | other modules |
| w-notes | `SqliteNoteService` (store, revisions, proposals of both kinds, the rebase at decision, links, the index), `NoteFiles` (save to file, make inline, reload, the parent-directory watcher), the mdast extraction of `markdown.ts` behind its contract, the command handlers with `note_edit`, the access handlers `note.read`, `note.change` and `note.remove` registered on the broker (against the in-memory broker of 0043's c-m6), the removal guard's notes check, the module | `core/notes/**` except the contract files; `main/modules/notes.ts` and its test | the contract files, `core/mounts/**`, `renderer/**` |
| w-mounts | `NodePathGuard`, `MountWatcher` with the tiers, the entry count and the hysteresis, `SqliteMountService`, the listing and reconcile, the root checks, the command handlers with `mount_write`, the access handlers `mount.read` and `mount.write`, the module, the `Desktop` dialog and Finder implementations | `core/mounts/**` except the contract files; `main/modules/mounts.ts` and its test; `main/desktop.ts` (dialogs, Finder), after 0043's w-inbox-ui has finished its `onResume` change there | the contract files, `core/notes/**`, `renderer/**` |
| w-editor | the note pane, the note editor and the proposal and compare views on the `CodeEditor` and `DiffView` of 0047's w-monaco (amended 2026-11-28; the editor host and the theme bridge are w-monaco's), rendered view, outline, banners, the rebased and out-of-date marks, the agent mark; mount rows, settings with the tier line, and file view; the capture action; the task note links; the e2e specs and the `notes` phase of `pnpm visual-check` | `renderer/panes/notes/**` (with the task note links component), `renderer/panes/mounts/**`, `renderer/panes/inbox/CaptureNoteAction.tsx`, `e2e/notes.spec.ts`, `e2e/mounts.spec.ts`, the `notes` phase of `scripts/visual-check.mjs` (0043's w-tasks-ui adds its `tasks` phase to the same file; the second to finish rebases) | `core/**`, `main/**`, `renderer/editor/**` (0047), the contract files |
| i-notes (integration) | wiring with the real access broker, the 0043 slots, the note links on the session row, the parity table, the real module graph test, the real-Claude script | `main/modules.ts` (order only), `renderer/panes/inbox/ItemCardExtras.tsx` and `renderer/panes/tasks/TaskNoteLinks.tsx` (the stubs of 0043's c-m6), the note link count in `renderer/panes/tree/SessionDecorations.tsx`, `scripts/e2e-real-notes.mjs` | builder files except for a fix the review asks for |

Order, aligned with 0043 section 5:

1. 0043's c-m6 (with the access contracts and the slots) and its review.
2. c-notes, reviewed by another agent; it starts after c-m6, since both edit `main/context.ts`, `core/events/index.ts` and `docs/parity.md`, and 0043 changes the module order in `main/modules.ts`. It may run beside 0043's builders of step 2, whose files it does not touch.
3. w-notes, w-mounts and w-editor in parallel against the in-memory services, the contract suites and the in-memory access broker of c-m6.
4. i-notes after the three, after 0043's w-access (the real broker) and w-tasks-ui (the `TaskNoteLinks` call), and after 0043's w-inbox-ui for `main/desktop.ts`.

Each step's work is reviewed by an agent that did not write it (0003); a finding goes back to the owner of the file. The real-Claude script runs last.

### 6. Test plan

- **Contract suites** (`pnpm test`): `describeNoteServiceContract` (in memory now; SQLite by w-notes): create from UI and agent, folder from the leaf, read ranges and truncation, save with revision check, conflict, append and edit under each `agentWrites` mode (applied, proposed, refused), an edit whose `oldText` occurs twice or not at all (`invalid_input`), overlapping changes, an edit on an `off` note without read access (`refused`) and the same edit after a read that the user allowed once in that session (accepted), proposal accept onto a newer revision (an append always, an edit rebased when each `oldText` is still unique, `stale` when not), one stale proposal among others of the same request, reject, the revisions written for each applied change, request coalescing per session and note, limits, `observe` off raising a `note.read` request (with the in-memory broker), list of `off` notes without text, search scope, the title following a leaf rename, `ui_remove_node` by an agent raising a `note.remove` request for a subtree with a note and removing nothing until an allow, a note added to the subtree while the request waits (`stale`), backlinks, revisions and their retention, leaf removal ending open proposals `withdrawn`. `describeMountServiceContract` (in memory now; Node file system by w-mounts, on temporary directories under the test's own directory): listing order and hidden names, truncation, read and write rules, every refusal of section 4.9 raising no request, access off raising a `mount.read` request, an agent write raising a `mount.write` request with the offered scopes of section 4.6 in a `read` and a `read_write` mount, the mount's mode unchanged by an allowed write, a session write grant ended by the switch to read-only, a write with a stale hash (`conflict`), a new file with `null` where a file exists, settings, root states.
- **Rebase and tiers** (pure): `applyChanges` and the rebase over a table of bases, current texts and changes (unique, missing, twice, overlapping, adjacent, empty `newText`, Unicode); `tierFor` over counts around `liveMaxEntries` with the hysteresis, and the timings of each tier from the settings with their bounds.
- **Unit**: the path guard over every case of P52 (links out and in, chains, dangling, `/dev/zero`, FIFO with a test timeout, hard link, `..`, absolute, case and NFC and NFD spellings, `/tmp` against `/private/tmp`, the parent swapped for a link between the check and the open with a hook in the guard, and swapped back before the second resolve; a visible link inside the mount to a hidden file; `mount_read` of a file with two links; a directory swapped for a link during a listing); the atomic write onto a link and onto a hard link, and with the parent swapped before the `rename` (reported as an error); `ftsQuery` with quotes, stars, empty text and Unicode; mdast link and task-line extraction; the watcher with a fake `fs.watch` and a fake clock that drops events (the reconcile finds them, within 30 s in the `live` tier and 5 minutes in the `relaxed` tier), floods events (one full re-list), names the root (state check), batches with the debounce and the latest run of each tier, follows the entry count through batches and walks, and switches tiers with the hysteresis, and with real FSEvents in an integration test that creates, saves atomically, renames, removes and moves the root; the single-file watch through the parent after two atomic saves; the refused roots against a profile layout; the migrations on `node:sqlite` (the checks of section 4.2).
- **MCP** (`core/mcp` harness): the tools listed for `default` and `worker` (`note_edit` and `mount_write` among them) and not for `reviewer`; folder scope and `out_of_scope` for each tool; `observe` off and mount access off answering `pending` after the wait (a lowered `access.waitSeconds`) and the tool's own result after an allow; every refusal of section 4.9 answering a refusal and posting no item; the limits; no exempt command is a tool (parity).
- **Real module graph** (`main/modules/*.test.ts`): both modules migrate after the others and register their access actions on the broker, the parity table has no missing row, a session's tool list.
- **e2e with hidden windows** (`AGIDE_HIDDEN=1`): create a note, type, autosave, reload the app and see the text; the suggestion banner at a lowered threshold and "Not now"; save to file with the dialog answered by a test hook of `Desktop`, then an external edit of the file shows the banner when the buffer is dirty and reloads when clean; make inline; an agent append and an agent edit through the fake CLI's `/tool` step appear as one access request with the diff, answered Allow once and Deny from the card, and per proposal in the merge view; "Allow always" sets the note to `apply` and the next change applies with the agent mark; an edit after the user changed the same line shows "out of date"; an agent's removal of a note waits for the card and removes nothing on Deny; the rendered view of a note with HTML, an image and a `javascript:` link shows text only and makes no request; mount a temporary directory, expand, create a file outside the app and see it appear, rename the root and see the missing state, re-link; a link to the outside is marked and does not open; the read-write switch and a save; an agent's `mount_read` with access off answered from the card, and an agent's `mount_write` into a read-only mount allowed once (the file changes, the mount stays read-only); a mount of about 1,500 files shows the `relaxed` tier and switches to `live` after files are removed; "Make task" on a "- [ ]" line creates a task.
- **Mutation targets** (`scripts/mutation-checks.mjs`): the containment check dropped or turned into a prefix check without the separator; `O_NOFOLLOW` or the device and inode comparison dropped; the regular-file check dropped; the write path opening the target directly; the refused roots ignored; `observe` off ignored by `note_read` or `note_search`; the folder scope dropped from `note_search`; a `review` append or edit applied without a decision; an edit applied to the current text without the uniqueness check of the rebase; a `stale` proposal applied; `note_edit` allowed on an `off` note without read access; accept without the revision check; `ftsQuery` without quoting; the parent re-list of a batch dropped; the single-file watch placed on the file; mount access off ignored by `mount_read` (read without a request); a `mount.write` performed without a decision; a session write grant offered in a read-only mount, or kept after the switch to read-only; an allowed write changing the mount's mode; a path refusal turned into a request; hidden paths readable while hidden; the hidden check applied to the requested name only; the removal guard dropped (a note removed without a request); the `live` tier kept above `liveMaxEntries`; the reconcile dropped in the `relaxed` tier.
- **Real Claude** (`scripts/e2e-real-notes.mjs`, outside `pnpm test`): one Haiku session in an empty temporary folder with the app MCP server, `--max-budget-usd 0.25`, `--setting-sources user`, `--strict-mcp-config` with the app server only, the environment scrub of `probes/lib.mjs`; it calls `note_list`, `note_read`, `note_append` and `note_edit` (proposals, which the script allows once and denies through `access_decide`), `note_search`, a read of an `off` note (an access request that the script leaves past the wait, then allows, and the session reads the result with `access_request_result` after the notice) and `mount_read` before and after the access switch. A few cents.

### 7. Security

| Threat | Rule | Test |
|---|---|---|
| An agent reads a note that holds secrets | per-note `observe`; an `off` note is read only after the user allows an access request that names the note, and is left out of search and snippets; titles stay visible as leaf titles (`ui_list_tree`), so a secret never belongs in a title; the switch is a UI command only; reads are logged with the request id | MCP tests; mutation "observe off ignored" |
| An agent rewrites or deletes a note | agent writes are `note_append` and `note_edit`; under `review` (the default) each is a proposal that applies only after the user's decision on the card or in the merge view; `apply` is the user's own setting, and every applied change is a revision the user can go back to; there is no agent save or setting command; an agent's removal of a subtree with a note leaf is a request that removes nothing until the user allows it | parity test; contract suite; mutations "change applied without a decision" and "removal guard dropped" |
| An edit lands on other text than the agent saw | an edit names its base revision; it applies to a newer text only when each `oldText` is still unique there, else `stale`; the card shows the diff against the current text and `access_decide` carries the revision it showed | contract suite; mutations "rebase without the uniqueness check", "stale applied" |
| An agent probes the text of an `off` note through the errors of `note_edit` | `note_edit` needs read access to the note before any validation | contract suite; mutation |
| A stale card or view accepts a change onto other text | `expectedRevision` on accept and save | contract suite; mutation |
| An agent's access request lifts a hard limit of a mount | path, hidden, hard link, size, type and root refusals of section 4.9 are checked before a request and again in `perform`, and never raise one | contract suite; mutation "path refusal turned into a request" |
| An agent writes a mounted file | only through a `mount.write` request whose card shows the path and the diff; the write is the app's checked write with the agent's `expectedSha256`; no standing write right (C4); in a read-only mount only single writes, and the mount's mode never changes | contract suite; e2e; mutations "write without a decision", "session grant in a read-only mount", "write changes the mode" |
| Agent text in a note runs or loads something when rendered | mdast to React elements only; raw HTML as text; images not fetched; only `agide:`, `http` and `https` links act, and web links open in a browser surface of the folder; proposals render as source until accepted | e2e literal test; grep test for `dangerouslySetInnerHTML` |
| Agent text in a note acts inside the source editor (amended 2026-11-28: Monaco) | Monaco models are plain text; link detection off and links routed through the app (`registerLinkOpener`); no hover or markdown providers of the app, no `command:` links; control characters and confusable or invisible Unicode shown; Monaco's context menu off; the CSP without `'unsafe-eval'` or `'wasm-unsafe-eval'`, workers from the app's own files only (0047 sections 5.2 and 8, P77) | e2e of 0047 (a note with a `command:` and a `javascript:` link and bidirectional controls: nothing acts, the characters are marked, no request leaves `file:`) |
| Note or file text read by an agent carries instructions | tool results mark the text `untrusted`; the tool descriptions say it is data | MCP test of the field |
| An agent reaches files outside its folder through a mount | mount tools only for mounts in the caller's folder, reads with access on (off by default) or after an allowed request; paths relative and guarded; a mount of another folder answers `out_of_scope` as `ui_*` commands do (`requireInScope`) and raises no request | MCP tests |
| A link in a mount leads outside it | real-path containment; links outside are listed and refused | unit (P52 cases); mutation |
| A directory is swapped for a link between check and open | `O_NOFOLLOW` and `O_NONBLOCK` open, `fstat`, second resolve, device and inode compared | unit with the swap hook; mutation |
| A FIFO or device in a mount blocks or floods the app | regular files only; `O_NONBLOCK`; size limits | unit with a FIFO |
| A save in a read-write mount writes through a link to a file outside | temporary file with `O_EXCL` and `O_NOFOLLOW`, then `rename`, which replaces the link | unit; mutation "write opens the target" |
| A parent directory of a mount is swapped for a link to the outside between the check and the `rename` of a save (the user's, or an agent's allowed write) | not closed: Node has no `openat` or `renameat`; the guard resolves again before the `rename` and compares the inode after it, and reports a write that landed outside. It needs a program that can write inside the mount and wins the race; mounts start read-only, and agent writes run only after the user's decision. The user accepted this race (C7) | unit with the swap hook; residual risk (section 9) |
| An agent makes a hard link to a file its sandbox denies inside a mount and reads it through `mount_read`, which runs in the unsandboxed main process | `mount_read` refuses files with more than one link (`hard_link`); whether the sandbox lets an agent create such a link is not verified | unit |
| A visible link inside a mount points at a hidden file such as `.env` | the hidden rule covers the real path below the real root | unit |
| A huge file or directory stalls the app | `maxFileBytes`, `maxEntriesPerDirectory`, `maxScanEntries`, lazy listing, the asynchronous count walk, the `relaxed` tier above `liveMaxEntries`, the rescan threshold, and bounds on the timing settings | unit with a flood; e2e at 20000 files (P51 sizes) |
| An agent floods the inbox with requests for notes and mounts | the limits and joins of 0043 section 4.10; one open change request per session and note; the quiet deny for reads and removals | contract suite |
| The user mounts the app's own data or credentials, exposing them to agents with mount access | refused roots (section 4.9) for mounts, file note targets and re-links | unit against a profile layout; mutation |
| An agent uses its own file tools on a mounted path or a file note outside the notes directory | not a boundary of the mount: the agent's sandbox (`denyRead` of the app root and credentials, 0042) and the permission gate decide; the notes directory lies under the app root; the settings popover and the save dialog say so | e2e of the hint text; existing sandbox tests |
| A mounted root is deleted and a directory or link put in its place | device and inode stored; `moved` needs the user's re-link; the real path is checked again | unit; integration with real FSEvents |
| An external program edits a file note while the user types | hash, size and time compared before each write; conflict banner | e2e |
| Search text breaks the FTS query or reads other folders | word-by-word quoting; scope checked per hit | unit; mutation |
| Names from a mount spoof the UI | escaped rendering of control and bidirectional characters | renderer test |
| An agent floods notes or proposals | rate limits per session, pending limit per note, size limits, request coalescing | contract suite |
| Opening a mounted file starts a program | no default-application opening in the slice; "Reveal in Finder" only | e2e: no `shell.openPath` call (the `Desktop` fake records calls) |

### 8. Estimates

In 0005 units (working days for one engineer plus agents), low confidence:

| Part | Days as proposed | Days after the user's decisions | What changed |
|---|---|---|---|
| c-notes contracts | 0.5 to 1 | 0.75 to 1 | `note_edit` and `mount_write` schemas, the proposal kinds, the pure `edits.ts` and `watchTiers.ts` with tests, the async removal guard |
| w-notes | 2 to 2.5 | 2.5 to 3.25 | edit proposals, the rebase at decision, the access handlers of notes, the removal request |
| w-mounts | 1.5 to 2 | 2 to 2.75 | the adaptive watcher (tiers, count, hysteresis), agent writes through requests, the mount access handlers |
| w-editor | 2.5 to 3.5 | 3 to 4 | the proposal view for edits (rebased and out-of-date marks), the agent mark for applied changes, the tier line, more e2e |
| i-notes, reviews and their fixes, the real-Claude script | 1.5 to 2 | 1.75 to 2.25 | the real broker and the requests in the real-Claude script |
| First slice | 8 to 11 | 10 to 13.25 | |
| What waits (section 2) | 4 to 6 (with `note_edit` and agent writes to mounts) | 2.5 to 4 (the reference index links, two-way task lines, the task description editor, notes under tasks and sessions, capture from selections, mount search, `.gitignore`, context attachment, deletes and renames of mounted files by agents) | `note_edit` and agent writes moved into the slice |
| R27 in total | 12 to 17 | 12.5 to 17.25 | |

Amended 2026-11-28 (section 14): with Monaco the editor host, its workers and the theme bridge are 0047's w-monaco (counted there), so w-editor here is 2.5 to 3.5 days in place of 3 to 4, and the first slice of this record 9.5 to 12.75 days in place of 10 to 13.25 (about 730 to 980 summed agent minutes at the milestone 5 rate and 300 to 410 at the milestone 4 rate).

0034 guessed 8 to 12 days for all of R27; the editor (new dependencies, a rendered view without HTML, the merge view) and the mount safety rules are the larger parts. The access broker itself is counted in 0043 (w-access, 1.5 to 2 days). At the milestone 5 rate (about 77 build minutes per estimated day, 0042) the first slice is about 770 to 1,020 summed agent minutes (was 620 to 850); at the milestone 4 rate (about 32), about 320 to 420 (was 260 to 350).

### 9. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Monaco's size and its load on first use (amended 2026-11-28; was the CodeMirror maintainer risk and the risk of a second editor for R9, both gone with the user's decision for one editor) | a slower first open of the note pane | loaded on first use and shared with the file editor and the review; about 5.1 MB minified with its workers, about 0.25 s from the first open to a tokenized render (0047, P70 and P71); the editor sits behind `NoteEditor`'s props |
| Monaco is a code editor, not a prose editor | a plainer writing feel for notes than a Markdown editor | word wrap, no line numbers, the rendered and split views of this record; a note-specific feel is a later request |
| The rendered view differs from other Markdown tools (GFM details, HTML in notes) | user surprise | mdast with GFM; HTML shown as text by design; round-trip tests with the user's own notes before the slice ends |
| FSEvents loses events in bursts (P51) | a stale listing | parent re-list per batch, reconcile on focus, wake and timer in both tiers; a full walk every 30 s in the `live` tier |
| A mount near `liveMaxEntries` switches tiers often, or a burst of new files pushes a small mount into the `relaxed` tier | timings that change under the user | hysteresis (back to `live` below 90 %); the tier line in the settings popover; the thresholds are settings |
| The `live` tier's walk every 30 s costs more than P57 measured (a slow or network volume, a busy machine) | CPU and disk work while idle | the walk is asynchronous; a walk that takes longer than a tenth of its interval moves the mount to the `relaxed` tier until the next count (w-mounts) |
| A parent swapped for a link during a save in a mount, by the user or by an agent's allowed write (section 4.9) | the text replaces a file outside the mount | checks before and after the `rename` report it; read-only by default; agent writes only after the user's decision; a native `renameat` would close it and is not in Node; accepted by the user (C7) |
| Agents ask for access often and the inbox fills with requests | the user stops reading the inbox | `on-demand` observation by default (C3), joins per note and session, the quiet deny, "Allow always" in one click, and the limits of 0043 section 4.10 |
| An edit proposal goes stale while it waits for the user | the agent's work is lost | the card shows "out of date" and the agent gets `stale` with the current revision, so it proposes again on the new text |
| Network volumes, iCloud Drive and external disks behave differently | missing updates or errors | not verified (P50 to P53 used APFS); the mount shows "partly watched" when a listing fails |
| The editor's autosave and an external editor write the same file note | lost text | hash check before each write; conflict banner; revisions |
| 0043 and this record both edit the shared contract files | merge conflicts | c-notes runs after c-m6 (section 5); the slots of section 4.15 are agreed in the review of both records |
| The scope grows into a notes app (backlinks graph, templates, daily notes) | the milestone runs long | section 2 lists what waits; question 5 keeps mount search out |
| Bundle size of the new dependencies | slower start of the renderer | the notes pane loads its editor lazily on first open |

### 10. Probe results

`notes/probes-m6-notes.md` holds P50 to P53 with the evidence files; `probes/RESULTS.md` has the summary. The independent review ran P50, P51 (Node and Electron as Node), P52 and P53 again and got the same results; its burst runs lost between none and 3 of 2000 events, so the loss is real and varies, and the re-list and reconcile stay. The design takes from them: one recursive watcher per mounted directory with the event type ignored, the parent re-list and the reconcile (P50, P51); watching a single file through its parent (P50); the root's identity check (P50); the checked open and the atomic write (P52); `realpathSync.native` for identity (P52); FTS5 `unicode61 remove_diacritics 2` with quoted words (P53).

P57 (run `decisions-amend`, Node 22 twice and Electron 45 as Node once, no model) measured what the adaptive watcher of section 4.8 needs, on trees of 200, 1,000, 5,000 and 20,000 files in directories of 100:

| Entries | Count at mount time | Full walk (`readdir` with types and `lstat` per entry) | Re-list of one directory of 100 | Single change to first event, median (95th percentile) | 100 new files: first and last event |
|---|---|---|---|---|---|
| about 200 | 1.2 to 1.6 ms | 0.7 to 0.9 ms | 0.2 to 0.3 ms | 13 ms (15 to 19 ms) | 9 to 30 ms and 54 to 59 ms |
| about 1,000 | 3.2 to 4.2 ms | 2.0 to 2.8 ms | 0.2 ms | 13 ms (15 to 19 ms) | 7 to 11 ms and 56 to 57 ms |
| about 5,000 | 16 to 21 ms | 14 to 15 ms | 0.2 to 0.3 ms | 12 to 14 ms (15 to 16 ms) | 10 to 29 ms and 56 to 60 ms |
| about 20,000 | 71 to 79 ms | 52 to 57 ms | 0.2 ms | 12 to 14 ms (13 to 23 ms) | 7 to 31 ms and 54 to 65 ms |

The walk's CPU time is close to its wall time (2 to 4 ms at 1,000 entries, 52 to 57 ms at 20,000); no run lost an event of the 40 single changes or of the bursts of 100; one single change in one run took 160 ms. The event latency does not depend on the size of the mount; the walk and the count grow with it, which is what the tiers follow.

The review of the amendments (run `review:decisions-amend`, Node 22, `docs/measurements/review-decisions-amend.md`) ran the P57 script once more (the same orders of size: a full walk of 3.8 ms at 1,000 entries and 68 ms at 20,000, a single change after 12 ms median) and fed bursts into the debounce of each tier: at 30 ms with 150 ms as the latest run, bursts of 100 and of 2,000 new files formed 2 to 3 batches; at 250 ms with 2 s, a burst of 2,000 formed 2; no run lost an event.

Not verified: network and cloud volumes, the main process at 20000 files (P51 and P57 ran as Node; P50 showed the same events in the main process), other editors' save patterns, FTS at 20000 notes, the tiers under a busy main process.

### 11. Questions for the user

1. Editor: CodeMirror 6 with its merge view, and mdast for the outline, links and the rendered view, as new dependencies at exact versions. Recommendation: yes; R9's code editor decides separately and may later bring Monaco. (As asked on 2026-11-26; the answer was amended on 2026-11-28 to Monaco, section 14.)
2. Agent writes: in the first slice agents only append (`note_append`), as a proposal you accept unless the note is in append-only mode; a `note_edit` tool for other changes waits. Recommendation: yes; add `note_edit` after the slice has been in use.
3. Default observation for new notes: `on-demand` (agents in the note's folder can read it) or `off` (you switch each note on). Recommendation: `on-demand`, with a profile setting for the default and the switch on the note's toolbar.
4. Agent access to mounts in the first slice: read only, per mount, off by default; agent writes to mounted files wait. Recommendation: yes.
5. Search over mounted files (a per-mount "index for search" switch, off by default; it reads every Markdown and text file under the size limit): first slice or later? Recommendation: later, after the slice shows how vaults are used.

The user answered these questions on 2026-11-26 (the decision page numbered them C1 to C5 and added C6 and C7); section 12 holds the answers. They stay here as asked.

### 12. Decisions of the user

| Question | Answer | Differs from the recommendation |
|---|---|---|
| C1: CodeMirror 6 and mdast as new dependencies | yes | no |
| C2: agents only append in the first slice; `note_edit` later | agents may also edit existing text now: `note_edit` in the first slice | yes: the recommendation was append only (amendment 1) |
| C3: default observation of new notes | `on-demand` | no |
| C4: agent access to mounts read-only, per mount, off by default | yes, and a refused agent can ask for a read, and ask to write | no, with an addition (amendment 3) |
| C5: search over mounted files | later | no |
| C6 (added on the page): keep the guard that agents cannot delete notes | yes, as a decision of the user: an agent's removal is an access request, never a flat refusal and never a removal without the user | no, with a change (amendment 4) |
| C7 (added on the page): accept the write race of read-write mounts (section 4.9) | accepted | no |
| C1 amended on 2026-11-28 by the user: "Monaco for everything" | Monaco in place of CodeMirror 6 for the note source view and the proposal and compare views; mdast stays for the outline, links, task lines and the rendered view (section 14, record 0047) | yes: the answer of 2026-11-26 was CodeMirror 6 |

Amendments, each a decision of this record:

1. `note_edit` in the first slice (C2), next to `note_append`, both through the proposal and diff flow: an edit is a list of replacements against a base revision; it applies to a newer text only when each replaced text is still unique there, else it is `stale`; the per-note setting `agentWrites` decides whether agent changes apply at once (`apply`), are asked about (`review`, the default) or are not allowed (`none`); `append_only` is gone (sections 2, 3, 4.2, 4.3, 4.5, 4.6, 4.11, 6, 7, 8). Reason: the user's answer.
2. Access requests for notes and mounts (the user's principle that agents can ask and the user can give access; the mechanism is 0043 section 4.10). A read of an `off` note, a change under `review`, a removal of notes, a read of a mount with access off and every write to a mounted file become requests with Allow once, for this session, always (where offered) and Deny; the hard limits of section 4.9 and the folder scope stay refusals (sections 2, 4.4, 4.5, 4.6, 4.9, 4.13, 6, 7). Reason: one card and one grant model for every case the user may lift.
3. Agent access to mounts (C4): the standing setting stays read-only and off by default; a refused agent can ask to read; an agent can ask to write a file, always per request; the mount's read-write switch stays the user's: in a read-write mount a write can be allowed once or for the session, in a read-only mount only once, and an allowed write never changes the mount's mode (section 4.6). Reason: the user's switch governs the user's editor; a single write the user saw as a diff is the user's own act. Question 1 of section 13 asks whether single writes into read-only mounts should be allowed at all.
4. Removal of notes by agents (C6): an access request with Allow once and Deny; nothing is removed without the user's decision (section 4.4). Reason: the user's answer.
5. Adaptive mount watching (the user: "I do not expect the folders to have thousands of files. So maybe we can adapt the monitoring logic - less files are more real-time and with more than 1000 files, the monitoring is less real-time."). Mounts of up to `liveMaxEntries` (1,000) entries get a 30 ms debounce, a batch at the latest after 150 ms and a full walk every 30 s; larger mounts get 250 ms, 2 s, a reconcile every 5 minutes and a walk every 30 minutes; the count is measured at mount time and followed; thresholds and timings are settings; the hard limits and the lost-event reconcile stay (sections 3, 4.3, 4.8, 4.12; probe P57). Reason: the user's expectation of small mounts, and P57's costs.

Other changes that follow: the slots of section 4.15 come from 0043's c-m6, so i-notes edits no file of 0043's builders; the builder order is aligned with 0043 section 5.

### 13. Open questions for the user

**Decided 2026-11-27 (record 0046).** An independent agent decided the open questions below while the user was away; the decisions and the text changes that follow from them are in `0046-decisions-while-the-user-was-away.md`, which the user reviews. The contract step applies those changes to this record.


1. A granted write into a read-only mount: should the app perform such single writes (the mount stays read-only, each write is one card with its diff), or refuse agent writes into read-only mounts until you switch the mount to read-write? Recommendation: perform single writes; the card shows exactly what changes and the read-only switch keeps governing your own editor and every other request.
2. "Allow for this session" on a note change applies the session's later changes to that note without a card (with the agent mark and a revision each). Recommendation: yes; it is what the scope means, and the revisions undo it. The alternative is to keep showing each change and only skip the click.
3. A removal of notes by an agent removes their history with them (as a removal by you does). Should removed notes go to a trash for some days first? Recommendation: not in the first slice; the card says that the history goes with the note, and a trash fits better when the user's own removals get one too.

### 14. Amendment of 2026-11-28: Monaco (record 0047)

The user decided on 2026-11-28 that Monaco is the one editor of the app ("Monaco for everything"), which amends the answer to C1. Record 0047 designs the editor host, the file editor and the review GUI; this record changes where it named CodeMirror 6:

| Place | Was | Now |
|---|---|---|
| Section 2, the editor row | CodeMirror 6 source view | Monaco source view |
| Section 3, the editor choice | CodeMirror 6 for source and the merge view | Monaco for the source, proposal and compare views; mdast stays for the outline, links, task lines and the rendered Markdown view |
| Section 4.1, `panes/notes` | `editorTheme.ts` in the notes folder | no theme file there; the editor, the diff view and the theme bridge come from `renderer/editor` of 0047 |
| Section 4.11, dependencies | the `@codemirror/*` packages | `monaco-editor` 0.57.0, exact, loaded on first use (0047 section 5.2); the mdast packages unchanged |
| Section 4.11, `NoteEditor` | CodeMirror 6 with `lang-markdown` and its search panel | 0047's `CodeEditor` with Monarch Markdown, word wrap, no line numbers, Monaco's find widget, applied agent changes through `pushEditOperations` with the agent mark |
| Section 4.11, the merge view for agent proposals (`ProposalView`) | `@codemirror/merge` unified view | 0047's `DiffView` (Monaco's diff editor) inline, with a list of the proposals to accept or reject one by one or together; "merge view" elsewhere in this record means this view |
| Section 4.11, compare from `ConflictBanner` | `ProposalView` in compare mode | `DiffView` side by side |
| Section 4.11, `MountFileView` | the note pane for every text file | the note pane for Markdown and text; code files in 0047's file pane |
| Section 4.11, editor theme | `editorTheme.ts` through CSS variables | 0047's theme bridge from resolved token values (Monaco refuses CSS variables); the token table here unchanged |
| Section 5, w-editor | the editor and theme built in the row | built on 0047's w-monaco, after it; `renderer/editor/**` is not w-editor's |
| Section 7, security | the rendered view's rules | plus a row for the source editor: plain-text models, links off and routed, no command links, control and confusable characters shown, the context menu off, the CSP unchanged in its script rules |
| Section 8, estimates | w-editor 3 to 4 days; first slice 10 to 13.25 | w-editor 2.5 to 3.5; first slice 9.5 to 12.75; the editor host in 0047 |
| Section 9, risks | the CodeMirror maintainer risk; a second editor if R9 picks Monaco | Monaco's size and load on first use; Monaco as a prose editor |
| Section 11, question 1 | as asked | a note that the answer was amended |
| Section 12 | | the row for C1 amended |
| Consequences | a slice of 10 to 13.25 days | 9.5 to 12.75 days |

Everything else stands: the tables, the commands and tools, proposals and the rebase rule, access requests, file notes, mounts and their safety rules, search and links. The pending changes of 0046 to this record (its items 6 to 10) are not touched by this amendment.

## Consequences

- R27 becomes buildable in a slice of 9.5 to 12.75 days (with the Monaco amendment of section 14; 10 to 13.25 before it) after the R21 work of 0043, with the contracts step after 0043's.
- Every agent action on notes and mounts that the user may permit goes through the access broker of 0043; the hard limits of section 4.9 never do.
- The tree contract of 0013 does not change: mounts are leaves with drawn rows. `SurfacePane` and the tree row gain branches for `note` and `mount`.
- New dependencies (section 4.11) enter `package.json` and the lockfile through the contracts step.
- `docs/parity.md` gains the note and mount rows of section 4.4; `docs/blocks.md` is unchanged (both are surface types, not panes).
- 0034 is amended as section 3 lists. 0021 section 9's plain-text rule holds for inbox and task text; note text has its own rendered view under the rules of section 4.11. 0026's observation log gains entries from notes and mounts, with fixed origins for app surfaces. `ui_remove_node` gains a removal guard for note leaves that raises an access request. 0043's c-m6 adds the slots of section 4.15.
- Not verified: everything section 10 lists; the mdast versions and their bundle size (Monaco's size and load were measured in 0047, P70 and P71); the rendered view against real notes; the `Desktop` dialogs under `AGIDE_HIDDEN=1` (the e2e answers them through a test hook); the real-Claude script, which runs after the build; that Haiku uses `note_edit` replacements that are unique in the note, and reads the note again after a `stale` result.
