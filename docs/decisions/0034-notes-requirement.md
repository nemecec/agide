# 0034 Notes

Status: proposed (requirement stated by the user; weight and design await confirmation)
Date: 2026-11-18
Decided by: Neeme (idea); the design direction is an agent proposal
Adds: R27 notes (weight 2 proposed)
Extends: 0002 (surfaces), 0015 (composable UI), 0016 (tasks), 0033 (reference index)

## Context

The user wants Markdown or plain-text notes in Agide, next to tasks, reminders and the inbox. Tasks, reminders and an inbox are already requirements (R21, 0016, design 0021); the tasks pane is not built yet (0024).

## Decision

- R27 Notes. A note is a Markdown or plain-text document and a surface type (R12): a leaf in the tree under a project, a task or a session, or a folder's own note. Weight 2 is proposed.
  - Storage is plain files in the profile's data directory, one file per note, so a note stays readable and editable outside Agide and can sit in a git repository. A later option links a directory the user already has (a notes vault) as a notes folder of a project.
  - The editor shows source and rendered Markdown with the document model of R11 (an outline from the Markdown tree, structural diffs for agent edits). Plain text opens in the same editor without rendering.
  - Links: a note can reference tasks, pull requests, tickets and threads through the external reference index of 0033, and the reverse lookup shows the notes that mention a task. A line of the form "- [ ]" can become a task on request.
  - Search covers note text within the profile.
  - Quick capture: a shortcut and an inbox action create a note or a task from selected text or from an inbox item, attached to the item's task or project.
  - Agent tools on the app MCP server: note_create, note_read, note_append, note_search and note_list, scoped to the agent's folder like the other tools (parity applies). An agent edit appears as a diff the user accepts or rejects; append-only mode is a per-note setting. Notes can hold secrets, so the observation switch of R13 applies to a note surface like any other.
- Tasks, reminders and the inbox stay in 0016 and 0021. The notes editor also edits a task's description, so one Markdown editor serves both.
- Notion and Google Docs are external documents (0033). Notes are local files; the apps bring comments and changes of external documents into the inbox and do not copy the documents.

## Consequences

- A rough guess is 4 to 7 working days for the note surface, the editor with outline and diff, search, links through the reference index and the agent tools; low confidence. The editor choice (CodeMirror or Lexical, from 0020 and the libraries notes) is a design step.
- The tasks pane (R21) is still to be built; notes and tasks share the reference index and the editor, so they are best built in the same milestone.
- Open question for the user: should notes live only in the profile's data directory, or also in a directory the user chooses per project?
