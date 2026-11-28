# 0046 Decisions made while the user was away

Status: decided by an agent, awaiting the user's review
Date: 2026-11-27
Decided by: an independent agent (Claude Fable at high effort), asked by the coordinator while the user was away; none of these decisions is the user's yet
Amends: 0043 (section 13), 0044 (section 13)

## Context

The user left the machine for a while and asked that a decision which would normally go to them be discussed with another agent and recorded here for review. Limits that stay in force: no outward or irreversible action, one extra fix pass at most when a review finds a major, and no change of a decision the user already made. The user's own answers of 2026-11-26 are in the Decisions sections of 0043, 0044 and 0045.

This record holds the decisions about the six open sub-questions at the end of 0043 and 0044, the changes to those records that follow from them, findings that the consultation raised outside the six questions, and the points the user should look at first. The consulting agent read the records, the probe notes and the code, and edited nothing.

## Decisions

| # | Record | Question | Decision | Differs from the coordinator's recommendation |
|---|---|---|---|---|
| 1 | 0043 | Test the narrower loopback entry `127.0.0.1:<port>` under the CLI's own Bash sandbox, and use it if it works | Yes, with a stricter meaning of "works" (below) | No |
| 2 | 0043 | "Allow for this session" ends when the session's process exits | Yes | No |
| 3 | 0043, 0044 | A "never ask" setting for notes and mounts | Later; the trigger is the same target denied in several sessions, read from `access_requests` | No |
| 4 | 0044 | An allowed agent write into a read-only mount | The app performs a single write; the mount stays read-only; the card shows the exact diff and says so | No |
| 5 | 0044 | "Allow for this session" on note changes applies later changes without a card | Yes, on the condition that every applied agent change first stores a revision of the text it replaces | No (adds a condition) |
| 6 | 0044 | A trash for notes removed on an agent's request | No trash view in the first slice, but an agent-requested removal keeps a recovery copy for 30 days | Yes |

### 1. Loopback entry with a port

The port form counts as working only when all three hold, tested against the real Claude Code in the build step of the hooks (a few cents):

- The hook arrives with only `127.0.0.1:<port>` in the allow list and no sandbox network prompt appears.
- A sandboxed Bash command cannot reach a second probe listener on another loopback port, through the sandbox proxy and by a direct connect.
- With an empty allow list the same command to `localhost:<other port>` is refused too. If it is not refused, the protection described in the security table of 0043 is overstated in either form.

The launch writes `127.0.0.1:<port>` when all three pass and `127.0.0.1` otherwise. The choice is made once at build time from the test result, with no probe at run time. The listener port is chosen at app start and every launch writes a new settings file, so a stale port cannot persist. The port case joins the probe script that runs on each Claude Code upgrade. Risk: the port form is silently read as host-wide, or a later release changes it and hooks fail open; the second check and the upgrade script contain it.

### 2. Session grants end with the process

A grant ends at `session.exited`, as the browser site grants do; a resume keeps the session id on a new process, so the rule is simple to hold. A gap in the record: a pending note change or mount write stays open after the session exits, and a "for this session" decision on it would create a grant with no process running, which would then pass into the resumed process. Rule added: no session grant and no quiet deny is created for a session without a running process; a card of an exited session offers Once and Always only, and a `session` decision for it is refused.

### 3. No "never ask" setting yet

`agentWrites: none` is already the never-ask for note changes, the default observation is on demand, and reads and removals are quieted per session, so the open noise is small. Adding the setting later is a new column with a default. Mount writes are the first candidate, because a write is never quieted and a persistent agent can raise up to 20 write cards in 10 minutes; the limits and the deny message contain it.

### 4. Single write into a read-only mount

Mounts start read-only and the user chose that an agent may ask to write, so refusing in read-only mounts would make the request a flat denial in the default state. Refusing would also push the user to switch the whole mount to read-write, which opens the user's editor writes and the session write grants. A single write costs one approval per attempt. Consequence: the parent-swap race recorded in 0044 sections 4.9, 7 and 9 now also applies to an agent's allowed write into a read-only mount, and "read-only" no longer means that the app never writes there. Contained by one card per write with the path and diff, the hash check, the checks before and after the rename, hidden names refused, the observation log, and no session scope in a read-only mount. The card says that the mount is read-only and that the app performs this one write.

### 5. Session grants on note changes

The scope is limited to one note, one session and one process life; the `none` setting is checked before the grant, and the grants chip revokes it. The gap: a grant given on a small append also covers edits that delete text, and the revert from history has a hole, because under `apply` or a session grant the revision of the replaced text is not stated. Rule added: every applied agent change, under a request, `apply` or a session grant, first writes a revision of the text it replaces when the current text is not already the latest revision. The session button of the card says that later changes of this session to this note, edits included, apply without a card.

### 6. Recovery copy for agent-requested removals

Revisions, proposals and links cascade with the note, so a removed inline note is gone for good (a file note's file stays). The card shows titles only, and an agent can set titles through the tree rename tool, so an irreversible action would be approved on text the requester controls. Safe default decided: on an allowed `note.remove`, the app stores the last text, title, folder and session of each removed inline note for 30 days (a setting), restorable as a new note from the resolved request's card (UI only). The card lists per note the size, who created it and the last change time, and says that the copy is kept for 30 days. `access_decide` for a removal carries what the card showed (ids, titles, revisions) and answers `refused` with a refreshed card when any of it changed. Estimate: 0.25 to 0.5 day in the notes builder and the card. The user's own removals keep today's behaviour until the user decides on a trash.

## Changes still to apply to the records

These follow from the decisions and belong in the contract step of each record. The builder brief of c-m6 and c-notes must apply them first; the text of 0043 and 0044 is not changed yet beyond a pointer to this record.

0043:
1. Section 4.1, the later-hardening bullet and the `hookDelivery` bullet: the real-CLI test of the hooks builder runs the three checks of decision 1, the launch writes the port form or the host form from the result, and the result is recorded in section 10. Section 6 (real Claude) and the mutation for the `127.0.0.1` entry follow the form written.
2. Section 4.1 (the setting hint), section 4.9 (the mode chip text), section 7 (the loopback row) and section 9: make the text depend on the form written. With the port form the sentence "every service on this Mac that listens on 127.0.0.1" is false.
3. Section 4.10, the grants paragraph and step 8: add the rule of decision 2, and add the mutation target "a session grant added after `session.exited`" to section 6.
4. Section 4.10, `AccessDetail` and the rule for `access_decide`: for `note.remove` the decision carries a digest of the listed notes (ids, titles, revisions) and a difference answers `refused`; the item lines are built from app facts (size, creator, last change), with the title as data.
5. Section 13: close questions 1 and 2 as decided; question 3 stays later, with the trigger of decision 3.

0044:
6. Section 4.2 (revision rule) and section 4.6 (the `apply` row and the session-grant sentence): the revision rule of decision 5, and a contract case that user text typed after the last typing revision is recoverable after an agent change under a session grant.
7. Section 4.6, card text: the session button of a note-change card says that later changes, edits included, apply without a card; the mount-write card in a `read` mount says that the mount is read-only and that the app performs this one write.
8. Section 12 (C7 row and amendment 3), section 7 (the parent-swap row) and section 9: state that the accepted race covers an agent's single allowed write in a read-only mount, pending the user's confirmation, and drop "mounts start read-only" as a mitigation for agent writes.
9. Section 4.2 (last bullet), section 4.4 (removal paragraph), section 7 (the row about rewriting or deleting a note) and section 13 question 3: replace "their history goes with them" with the recovery copy, the restore action, the card facts and the changed-since check of decision 6; add the table to notes migration 1 and the setting to section 4.12; add contract cases (restore, prune after 30 days, a rename between card and decision answers `refused`).
10. Section 13: close questions 1 and 2 as accepted and question 3 as decided by decision 6.

Applied by the contracts step c-m6 on 2026-11-28: items 1 to 5 (the changes to 0043). Items 6 to 10 (0044) wait for c-notes.

## Findings outside the six questions

- The wording of question C7 ("the write race of read-write mounts") is narrower than what sections 4.9, 7 and 9 of 0044 accept, which includes an agent's single allowed write in a read-only mount (decision 4). The user should confirm the wider scope.
- The user's own removal of a note leaf has no confirmation. The tree pane asks only when the node has children, so Cmd+Backspace on a note leaf removes the note and its whole history without a prompt or undo. A confirm that names the notes, for any user removal that holds note leaves, is recommended; whether to add a trash is the user's decision.
- With agent access to a mount set to `off`, the access request of 0043 section 4.10 answers every path-guard refusal (missing, not a regular file, hard link, too large, binary, hidden) before the access check, so an agent without read access can learn which paths exist by whether a call is refused or raises a request. Severity is low (names and sizes only). Suggested rule: while access is `off` and the session holds no read grant, only the lexical checks (absolute, escapes, a hidden component in the requested path) run before the request, and the file system checks run for the card and in the second check. This needs a design pass in the contract step, including what the card shows for a missing path.

## For the user to review first

1. Decision 6: the 30-day retention of a recovery copy, where restore lives, and whether the user's own removals should get a trash.
2. The wider scope of the accepted write race (decision 4 and the finding on C7).
3. A confirm on the user's own removal of note leaves.
4. The design pass for the existence oracle with mount access off.
5. A separate matter in the sandbox hardening of the confined check: the ninth pass (together with the uncommitted eighth) fixed both majors of the eighth review, but its review found one major and six minors, so it is not committed. The registry of agent-writable directories grows without bound and each program start costs more with every row, and a session opened in the home directory excludes the sandbox tools for the life of the profile database. A tenth, narrow pass with a fresh review is recommended; the findings and the plan are in the status notes of the coordinator and in `docs/measurements/check-clone-fix.md`.
