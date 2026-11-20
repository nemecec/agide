# 0034 Notes and mounts

Status: proposed (requirement stated by the user; weight and design await confirmation)
Date: 2026-11-18
Decided by: Neeme (idea and the inline, file and mount refinements; inline by default with a suggestion to save large notes to a file); the design direction is an agent proposal
Adds: R27 notes and mounts (weight 2 proposed)
Extends: 0002 (surfaces), 0015 (composable UI), 0016 (tasks), 0033 (reference index)

## Context

The user wants Markdown or plain-text notes in Agide, next to tasks, reminders and the inbox. A note can be a small inline note stored in SQLite or backed by a file, and a person can start with an inline note and later save it to a file. A person can also mount a file or a directory into the tree, and a mount is live: changes on disk show up in Agide. Tasks, reminders and an inbox are already requirements (R21, 0016, design 0021); the tasks pane is not built yet (0024).

## Decision

- R27 Notes and mounts. Weight 2 is proposed.
- Notes. A note is a Markdown or plain-text document and a surface type (R12): a leaf in the tree under a project, a task or a session, or a folder's own note.
  - Two storages behind one editor. Every note starts inline (decided by the user on 2026-11-18): an inline note is a row in the profile's SQLite store and is created in a moment from any node. When a note has grown large enough, the app suggests saving it to a file. The size that triggers the suggestion is a setting (a length in characters, with a default of about one printed page); the suggestion appears once per note as a quiet banner in the editor with "Save to file" and "Not now", and "Not now" silences it for that note. A file note is backed by a Markdown or plain-text file. "Save to file" writes an inline note to a path the user picks (the dialog opens in a notes directory in the profile's data directory) and the note becomes file-backed with its links and history kept; "Make inline" imports a file note back into the store. The editor, the links, the search and the agent tools do not depend on the storage.
  - The editor shows source and rendered Markdown with the document model of R11 (an outline from the Markdown tree, structural diffs for agent edits). Plain text opens in the same editor without rendering. The editor also edits a task's description.
  - Links: a note can reference tasks, pull requests, tickets, threads and pages through the external reference index of 0033, and the reverse lookup shows the notes that mention a task. A line of the form "- [ ]" can become a task on request.
  - Search covers inline and file notes within the profile.
  - Quick capture: a shortcut and an inbox action create a note or a task from selected text or from an inbox item, attached to the item's task or project.
  - Agent tools on the app MCP server: note_create, note_read, note_append, note_search and note_list, scoped to the agent's folder like the other tools (parity applies). An agent edit appears as a diff the user accepts or rejects; append-only mode is a per-note setting. Notes can hold secrets, so the observation switch of R13 applies to a note surface like any other.
- Mounts. A mount is a tree node that points at a file or a directory on disk.
  - A mounted directory shows its contents under the node, loaded lazily; a mounted file is a leaf. Files open in an editor suited to their type: Markdown and text in the notes editor, other types in a viewer or the system's default application. A mounted notes directory (a notes vault) is the same thing.
  - Live. The app watches the mounted path (recursive for directories, debounced) and updates the tree and open editors when files are added, changed, renamed or removed. A change on disk to a file with unsaved edits asks: reload, keep mine, or compare. A removed or renamed mount root shows a missing state with a re-link action.
  - Safety. A mount is read-only or read-write, chosen when it is created. Paths are resolved to real paths; symlinks that leave the mount are not followed; hidden files, `.gitignore` entries and very large files or directories are filtered or limited by settings. An agent reaches mounted files only through scoped tools and only for mounts inside its folder; agent access to a mount is a per-mount switch that is off by default, like the observation switch.
  - A mount also serves as context attachment (R2): a mounted file can be attached to a message without copying it.
- Tasks, reminders and the inbox stay in 0016 and 0021. Notion and Google Docs are external documents (0033): the apps bring their comments and changes into the inbox and do not copy the documents.

## Consequences

- A rough guess is 8 to 12 working days for the note surface with both storages and the conversions, the editor with outline and diff, search, links through the reference index, the agent tools, and mounts with the watcher, the conflict handling and the safety rules; low confidence. The editor choice (CodeMirror or Lexical, from 0020 and the libraries notes) is a design step.
- Mounts add a node kind to the tree contract (0013): the tree needs nodes whose children come from the file system and are not stored. The tree store keeps the mount definition; the contents are read live.
- The tasks pane (R21) is still to be built; notes and tasks share the reference index and the editor, so they are best built in the same milestone.
- Settled by the user: notes start inline and the app suggests a file when a note grows large. Open question for the user: whether a mount starts read-only (the default assumed here) or read-write.
