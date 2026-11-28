# review:editor-design

Start: 2026-11-28T13:06:29Z (date -u). End: 2026-11-28T13:19:04Z (date -u).

Independent review of record 0047 (editor and human review GUI), the Monaco amendment of 0044, the probes P70 to P77 (`probes/p70_monaco_build.mjs`, `probes/p70_monaco_src/`, `probes/p71_monaco_run.mjs`, `probes/p71_monaco_main.cjs`), `notes/probes-m8-editor.md`, the section of `probes/RESULTS.md` and `docs/measurements/editor-design.md`. Verdict: accept with changes.

## What was checked

- The audit table of 0047 against the code: `renderer/panes/review` (`HunkView`, `FileView`, `useDwell` with its ratio and `IntersectionObserver`, `reviewApi`), `core/review` (`CommentRecord` in `schemas.ts`, `review_comments` in migration 1, `sendBack` in `InMemoryReviewManager.ts` with "Comments on lines" and the single quoted line, `callerView.ts`, `commands.ts`), `untrustedBlock` and `quotedValue`, `cleanText`, the renderer CSP in `index.html`, `electron.vite.config.ts` (no `minify`, no `worker` settings), `windowPolicy.ts`, `AGENT_RUN_STATES`, `CommandErrorCode`, `GitMerger`. The table holds.
- The Monaco option names of section 5.2 in the 0.57.0 typings: every one exists. The release dates from the registry: `monaco-editor` 0.57.0 on 2026-09-24 and 0.58.0 on 2026-11-23; `shiki` and `@shikijs/monaco` 4.6.0 on 2026-11-02.
- The probes, rerun with the same scripts in a scratch project under `/tmp/agide-editor-review/` with the same exact versions: P70 every variant unminified and minified (the same sizes to the byte), P71 startup (baseline, core and core minified, three runs each), models and leaks (one run each), P72 diff (three runs). Numbers in `notes/probes-m8-editor.md`, section "Review rerun". An extra scan of the minified core output found no `eval` or `Function(` call and no remote module URL.
- Two checks of my own with the same runner (scripts outside the repository): the size with every Monarch language registered (5.43 MB minified against 5.08 MB) and keys typed in a view zone with key codes on the synthetic events.
- The migration SQL of 0047 section 5.9 on `node:sqlite` after review migration 1 as the code has it, with comments in both states, on a superseded changeset and without a file row.
- The licence of the codicon font: Monaco 0.57.0's `ThirdPartyNotices.txt` does not mention it; the `vscode-codicons` repository's README licenses its content under CC BY 4.0 and its code under MIT.
- The builder split against the files that use the comment contract today (a search for `CommentRecord`, `comments`, `review_comment`, `putComment`, `markSent` under `app/src`, `app/e2e`, `app/scripts`).
- 0044: every mention of CodeMirror, `@codemirror`, merge view and the dependencies.
- Hygiene: banned words, employer and person names, absolute user paths, e-mail addresses in every file of the run (none found).

## Findings and changes

| Finding | Change |
|---|---|
| P72's check "keys dispatched in the zone leave the model alone" cannot fail: the diff editor is read-only and the synthetic events carry no key code. With key codes, J and K bound on the editor fired from a zone's `textarea` (also in the read-only diff editor) with the default prevented, and Backspace or Delete edited a writable model. A `keydown` stop on the zone node fixes it | 0047 sections 5.7 and 5.8 (the stop in `ViewZoneHost`), section 7 (unit, e2e, mutation), section 10 (a risk row); the notes' P72 row, effect 6 and a "Review rerun" section |
| The migration stored the legacy marker as the integer 1 while the type says `legacy: true` | `json('true')` in the SQL; checked: `json_type` is `true` |
| Comments on superseded changesets migrated as current drafts; with threads carried across changesets, a later send-back could have sent them with line numbers of an old checkpoint | the migration sets `outdated` for them; section 5.12 sends only threads anchored in the changeset sent back; a mutation target |
| The level CHECK accepted a file or line thread with a file index and no path | the CHECK compares the level with each column separately; checked: such rows are refused, changeset and file threads accepted |
| `replies` in `reportOutcomeInputSchema` would flow into the claim (`claimSchema` extends it), which `callerView.ts` hands to session callers as JSON | section 5.13 and the amendment row: the claim omits `replies`; a mutation target |
| Session callers see comments today; 0047 leaves threads out for them without saying it changes this | the amendment row of 0040 section 11.3 says so |
| A user edit saved in the worktree after a capture is not in the changeset that Accept merges (`GitMerger` merges the checkpoint commit) and was not addressed | section 5.6: a header notice and a confirmation that names the files; question 3 and a risk row |
| The c-editor row removes `review_comment` and changes `ChangesetDetail.comments`, but its file list left out the files that must change to compile (`SqliteChangesetStore.ts`, `callerView.ts`, `main/modules/review.ts`, the review pane files that read comments, `reviewTestApi.ts`, `e2e/reviewBackend.ts`) and `docs/parity.md`, `docs/blocks.md` | c-editor owns the smallest edits in those files; `monaco-editor` comes from c-notes (0044 section 4.11) and c-editor checks it; the visual phases name `scripts/lib/visual/`; `scripts/mutation-checks.mjs` (with the `HunkView` entry) goes to i-editor |
| The example send-back showed `source="diff"` and `source="reviewer"`, which `untrustedBlock` does not produce (its source is always `swarm-agent`); `cleanText` drops format characters from the code context | the example and the rule match the helper; a sentence on `cleanText` |
| Seen marks in inline mode named "both editors' visible ranges", but inline mode draws removed lines as zones of the modified editor | the rule names which editor draws which lines |
| The codicon licence was said to come from `ThirdPartyNotices.txt`, which does not list it | section 2 and the risk row: CC BY 4.0 attribution in `NOTICE` (c-editor) |
| Section 5.2 registers every Monarch language, while the 5.1 MB figure is for the languages P70 registered | 5.4 MB with all of them, in section 5.2 and the risk row |
| 0044: question 1 still asked for CodeMirror 6 without a note; the consequences still gave 10 to 13.25 days; the minutes after the amendment were missing | a note on question 1, 9.5 to 12.75 days in the consequences, the minutes, and two rows in section 14 |

## Not resolved

- `probes/RESULTS.md`, row P72, says "typed keys leave the model alone". This review may not edit that file; the row should read: "keys typed in a zone reach the editor's keybindings unless the zone stops their propagation (review rerun, `notes/probes-m8-editor.md`)".
- `docs/README.md` has no row for `notes/probes-m8-editor.md` in its notes list (outside the rows this review may edit).
- A comment whose file row is missing is dropped by the migration's join; no code path creates one today, so it stays as designed with the count reported by the contracts step.

## Not checked

- Real key and pointer input, IME and screen readers (hidden windows only; the key check used synthetic events with key codes).
- The renderer under `electron-vite dev`; Monaco 0.58.0; P73 to P75 (themes, Markdown, Monarch against shiki) were not rerun.
- The send-back format and replies with a real model; the lexical symbol rule (designed only).
- The estimates beyond their arithmetic.

## Housekeeping

- Disk: 5.2 GiB free at the start and the end; the scratch directory grew to about 230 MB with the build outputs (pnpm reused the store).
- No app code changed; no test suite, build or e2e of the app run; no git command that changes the tree; no model started.
- Not removed: `/tmp/agide-editor-review/` (the scratch project with `node_modules`, the build outputs, results and the check scripts under `checks/`). The permission system denied the removal; it is left for the coordinator. `/tmp/agide-editor-design/` belongs to the design run and was not touched.
