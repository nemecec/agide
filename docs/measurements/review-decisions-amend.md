# review:decisions-amend

Start: 2026-11-26T19:32:35Z
End: 2026-11-26T19:43:00Z

Independent review of the amendments of run `decisions-amend` to 0043, 0044 and 0045 (the user's answers of 2026-11-26), the rows of `docs/README.md` and the P57 sections of `notes/probes-m6-notes.md` and `probes/RESULTS.md`. Verdict: accept with changes.

## What was checked

- The decision tables against the user's answers (B1 to B8, C1 to C7, D1 to D6, A1), including the answers that differ from the recommendation (B8, C2) and the additions to B5, B6, C4 and C6.
- The three records for sentences the decisions make wrong: the file transport for Bash-sandbox profiles, summaries in the inbox or the card header, `note_edit` waiting, a removal guard that refuses, fixed watcher timings, statuses, estimates (the sums and the minute conversions were recomputed), the builder tables and their order.
- The access request mechanism against the code: `requireInScope` and `Caller` (`core/commands`), the browser approvals (`main/modules/browser.ts`: a wait of 115 s, the dismissed item as a deny, `SiteGrants`), `inbox_resolve` (agents resolve only their own `mcp:inbox_post` items, so they cannot resolve an access item), the item kinds, sources and `textAuthor` (`core/inbox/types.ts`), the notifier (`InboxNotifier.ts`: one notification per session per minute, body is the item message), the renderer files the builders name (`TerminalPane.tsx`, `session/SessionHeader.tsx`, `tree/leafDecorations.tsx`), the CLI sandbox settings (`core/permissions/policyBuilder.ts`), and the probe notes P16, P45 (`notes/probes-m6-r21.md`) and the credential proxy notes.
- The SQL of `access_requests` (0043) and the changed notes tables (0044) against `node:sqlite` in Node 22: an allow without a scope and an allowed request with a message are refused, a denied request with reason `stale` and no scope is accepted, an edit proposal is accepted, `append_only` is refused, and a proposal's item reference becomes NULL when the item goes.
- The P57 script, copied from the notes and run once (Node 22): count 5.5 ms and walk 3.8 ms at 1,010 entries, count 96 ms and walk 68 ms at 20,200, a single change after 11.5 to 12 ms (median), bursts of 100 named within 53 to 58 ms, no loss. A second small script fed bursts into the debounce of each tier: 30 ms with 150 ms as the latest run gave 2 to 3 batches for 100 and for 2,000 new files; 250 ms with 2 s gave 2 batches for 2,000; no event lost.
- Hygiene: no employer or person names, no absolute user paths, no e-mail addresses, no secret-shaped literals, none of the banned words in the changed files.

## Changes made

- 0043 section 4.10: an out-of-scope target answers `out_of_scope` (and an unknown one `not_found`), as `requireInScope` does; the record said it answered as an unknown id. Same fix in the security table of 0044.
- 0043 section 4.10 and 0044 section 4.4: read access for `note_edit` also counts a read that the user allowed once in the session; without it an agent whose read was allowed once could never edit an `off` note. Tests in 0044 extended.
- 0043 section 4.10: the item message of an access request no longer holds the note title or the mount path, which an agent chooses, since the message is app text and the notification body; titles, paths and diffs stay in the card's detail block. The security row follows.
- 0043 and 0044: a session write grant on a mount ends when the user switches the mount to read-only (scopes table, section 4.6, tests, mutation).
- 0043 section 4.8: `access_request_result.waitSeconds` bounded by `access.waitSeconds`, default 0.
- 0043 section 4.2: the terminal-dialog reminder is exempt from the notifier's per-session limit (w-inbox-ui adds it, with a unit test); the sentence "agent text never enters the reminder" now names the session title as the exception.
- 0043 section 5: w-summary's file was `session/SessionHeader.tsx` "after w-approvals' ModeChip", but the ModeChip is in `TerminalPane.tsx`; w-summary now adds its action to the session bar of `TerminalPane.tsx` after w-approvals. c-m6 names the stub files of the components it calls; the UI table places `AccessGrantsChip` in `renderer/panes/session/`.
- 0043 section 2: the `inbox-dir` fallback is kept for one milestone (B7) and beyond it for Bash-sandbox profiles with the loopback switch off.
- 0043 Consequences: two items added to "Not verified" (a parallel tool call closing the reminder early; whether the CLI's own sandbox already passes `localhost` names, as srt did).
- 0044 section 10: the review's P57 run and the batch check.
- 0043 and 0044 context paragraphs: counts removed.

## Not resolved here (outside this run's files)

- `notes/probes-m6-r21.md` (P45 design effects) still says that 0043 keeps the file transport for profiles with the CLI's own sandbox.
- `docs/README.md` outside the rows: the probe paragraph names P50 to P53 without P57, and the amendments paragraph does not list 0043 for 0021 or 0044 for 0034.
- `/tmp/agide-amend/` of the amending run.
