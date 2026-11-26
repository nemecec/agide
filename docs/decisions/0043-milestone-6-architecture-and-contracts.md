# 0043 Milestone 6 architecture and contracts

Status: accepted (2026-11-26, with the user's answers and the amendments of section 12)
Date: 2026-11-26
Proposed by: spike agents (design run `r21-design`), reviewed by an agent that did not write it (`docs/measurements/review-r21-design.md`); decided by the user on 2026-11-26; the amendments of section 12 written by run `decisions-amend`
Inputs: 0003, 0005, 0006, 0013, 0015, 0016, 0021 (with the amendments of 0023, 0024, 0037 and 0040), 0022, 0024, 0026, 0028, 0029, 0030, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041, 0042, 0044 (the notes side of the access requests of section 4.10); the browser approvals in `app/src/main/modules/browser.ts` and `app/src/core/browser/siteTable.ts`, which section 4.10 follows; `probes/RESULTS.md`, `notes/probes-m2.md` (P11 to P15), `notes/probes-m6-r21.md` (P16, the MCP call wait, and P45, the `http` hook type; run in parallel with this record, see "Probe results"); the code in `app/src/core/inbox`, `app/src/core/mcp`, `app/src/core/session` (`hooks.ts`, `status.ts`, `types.ts`, `PtySessionService.ts`), `app/src/core/permissions` (`inspector.ts`, `inspectCommand.ts`, `launchContributor.ts`), `app/src/core/isolation/types.ts`, `app/src/core/commands/types.ts`, `app/src/main/modules/inbox.ts`, `app/src/main/desktop.ts`, `app/src/renderer/panes/InboxPane.tsx`, `app/src/renderer/panes/inbox/*`, `app/e2e/inbox.spec.ts`

## Context

Milestone 6 builds the parts of R21 (0016, design 0021) that milestone 2 left out, as 0039 and 0042 recommend: a tasks pane, `inbox_ask` with the MCP call wait of P16, the reminder parts of 0021 that are not built, and the `http` hook transport of 0030 recommendation 1, which brings approvals of hook requests from the inbox card and a mode source the agent cannot write. 0021 is still `proposed`; the build of milestone 2 followed it with the amendments of 0024, and 0037 and 0040 added stream-json approvals, swarm alerts and review items.

Milestones 3 to 5 each had a design record and then a contracts record. R21 already has its design (0021), so this record covers the design changes and the contracts of the remaining parts: it audits 0021 against the code, decides the scope, amends 0021 where the build or the probes require it, and fixes the contracts, the builder split, the tests and the security rules. The contracts step of the build writes the types and stubs named here into the code, as 0041 did.

The user answered the questions of section 11 on 2026-11-26 and asked for these changes: a reminder when a held hook approval goes back to the terminal (section 4.2), session summaries on the session's row in the tree and not in the inbox (sections 3 and 4.7), loopback for hooks in profiles with the CLI's Bash sandbox (sections 4.1 and 7), and one shared mechanism through which an agent that a lifted policy refuses can ask the user for access (section 4.10, used by the notes and mounts of 0044). Section 12 lists the answers and the amendments; the sections below already read as amended.

## Decision

### 1. Audit of 0021 against the code

Paths are relative to `app/src`. "Built" means code and tests exist; "partly" means part of the section exists; "not built" means nothing of it exists.

| 0021 section | State | What exists | What is missing, or differs from the design |
|---|---|---|---|
| 1 Item model | built | kinds, states, urgencies, resolutions, `textAuthor`, state machine in `core/inbox/types.ts`, `SqliteInboxService.ts`, `InMemoryInboxService.ts`, shared contract `inboxServiceContract.ts` | retention of done items (default 90 days) is not built; `high` urgency from an agent is always lowered, since no project policy exists |
| 2 Store and schema | partly | `inbox_items` with `folder_removed` and its trigger, `session_summaries` (inbox-owned, 0024) in `core/inbox/inboxMigrations.ts`; `tasks`, `schedules`, `schedule_runs` (module `tasks`); tree migration 2 (`description`, `description_updated_at`, `is_project`) in `core/tree/treeMigrations.ts`; subtree scoping and item moves on `tree.node_moved` (`main/modules/inbox.ts`) | `inbox_asks`, `inbox_views`, `inbox_policies` not created; session migration 2 replaced by the inbox-owned `session_summaries` table, which has no turn or transcript counters for staleness |
| 3 Sources: hooks | partly | `core/inbox/HookItemMapper.ts`: `Stop` (minimum turn, question mark, dedupe, anchor, background tasks), `StopFailure` (`alert` on `rate_limit`), `PermissionRequest` (with the inspector record of 0028 from `PreToolUse`), `PostToolUse` resolution and sandbox violations, `Notification` `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `auth_storage_failure`; `UserPromptSubmit` resolution that skips `<task-notification>`; hook approvals of stream-json sessions skipped (0037). `HOOK_EVENTS` in `core/session/hooks.ts` includes `StopFailure` | `SessionEnd` failures, `SubagentStop` items, the `Elicitation` hook, the interrupt line, unknown `Notification` types by policy are not mapped. The hook transport is `inbox-dir` only (`hookCommand` writes files into a directory the agent can write); `PtySessionService.launch` refuses any other delivery. Approval cards say "Allow or deny it in the session" (`ItemCard.tsx`) |
| 3 Sources: stream-json | partly | `can_use_tool` approvals of swarm agents answered from the card (`SwarmApprovalActions.tsx`, 0037); swarm failure and budget alerts; tasks agent cap and trust items (`tasks:agent_cap`, `tasks:trust`) | `task_notification` failures and error results of tree stream-json sessions are not mapped |
| 3 Sources: app | partly | review items (`review:*`, 0040), swarm alerts (`swarm`), usage alerts (`usage`), browser approvals (`browser:approval`), gate items (`gate:deny`, `gate:notify`, `gate:sandbox`), reminders (`reminder`, `schedule`) | outward-action drafts (with apps, 0033), project summary drafts, scheduled agent runs |
| 4 Agent tools | partly | `inbox_post` with rate limit and coalescing, plus `inbox_list` and `inbox_resolve` as tools (`core/inbox/inboxCommands.ts`), which 0021 did not name | `inbox_ask` and every delivery path; `mcpConfigFor` sets no `timeout` on the server entry (`core/mcp/mcpConfig.ts`); a tool call cannot learn that its HTTP request closed (`CommandContext` has only `caller`) |
| 5 Context layers | partly | project name and summary (`ItemContext.ts`, `inbox_set_project_summary`), session name, session summary storage (`inbox_set_session_summary`), card header in `ItemCard.tsx` | no generator for session summaries, no staleness, no refresh; no UI to edit the project summary (only the command); project summary drafts from agents |
| 6 User interface | partly | `agide/inbox` pane (`renderer/panes/InboxPane.tsx`): list ordered by urgency and time, Open and Done filter, keyboard up, down, `e`, `s`, `u`; detail card with expandable details, raw payload disclosure, snooze presets, seen after 1 second; a read-only terminal peek of the session (`SessionPeek.tsx`) | grouping by project; the pane ignores its `viewId` and `folderId` config, so every inbox shows everything; saved views; "Open inbox for this folder"; Enter to open; transcript peek at the anchor; back stack and "Back to message"; `MountOptions` peek mode on the surface interface; an "Open" action for an item URL (shown as text only) |
| 7 Tasks and reminders | partly | task and reminder store with the RRULE subset, zones and the daylight-saving rules, task due reminders in zone `UTC` (`SqliteTaskStore.ts`, `rrule.ts`, `zoned.ts`); commands `task_create`, `task_list`, `task_update`, `reminder_create`, `reminder_list`, `reminder_delete` as tools with folder scope and the agent limit of 20 reminders (`taskCommands.ts`); the persisted scheduler with catch-up and snooze wake (`Scheduler.ts`) | the tasks pane; any reminder UI; delete and reorder of tasks; editing and disabling a reminder through a command (`setScheduleEnabled` exists in the store only); wake from sleep through `powerMonitor`; agent-run schedules |
| 8 Noise control | partly | `inbox_post` rate, dedupe keys, notification rules and throttle (`InboxNotifier.ts`), auto-resolve on view (`ViewTracker.ts`) | per-project policies, quiet hours, a setting for the notification body (`showBody` exists without a setting) |
| 9 Untrusted text | built | `cleanText` at the store, React text nodes, the grep test `plainText.test.ts`, URLs http or https only, e2e test of literal text | "Open" for an agent URL into a browser surface of the item's folder |
| 10 Notifications, badge, registry | partly | `InboxNotifier`, `Desktop.notify` (quiet in hidden runs), badge and registry count from the profile module | a click on a notification focuses the window but does not open the item (the notifier passes no `onClick`); real notifications under Focus modes not checked |
| 11 Tests | partly | store contract, migrations, hook mapping tables, MCP tools, scheduler with a fake clock in Europe/Tallinn, untrusted text, e2e inbox spec, real-Claude inbox script (`scripts/e2e-real-claude-inbox.mjs`) | tests for everything above that is not built |
| 12 Slice and waits | as amended by 0024 | | see section 2 |

Differences that the code shows and that later records did not yet state:

- Every inbox command has `ui: false`, also those the renderer calls (`inbox_list`, `inbox_resolve`, `inbox_mark_seen`, `inbox_mark_unread`, `inbox_snooze`, `inbox_reopen`, `inbox_context`, `inbox_set_viewing`), so the parity check (0029) does not see the UI actions of the inbox. The task and reminder commands of `taskCommands.ts` have `ui: false` as well; the renderer does not call them yet. Since milestone 5 the convention is `ui: {}` plus `mcp: true` or an `mcpExempt` reason (0041).
- The session status machine (`core/session/status.ts`) and the hook item mapper read payload files from a directory the agent can write, so a forged file can change a session's status, resolve its items or open an approval card. 0030 recorded this for the mode only.
- The inspector's record (`agide_gate`) also travels through that directory, so a forged record can change the class label of an approval card or post `gate:deny` and `gate:notify` items (`HookItemMapper.gateDecided`).

### 2. Scope of milestone 6

Recommendation: milestone 6 builds the rows marked "milestone 6"; the rest waits, each for the reason given.

| Part | Milestone 6 | Waits for |
|---|---|---|
| `http` hook transport for every hook event except `SessionStart` and `SessionEnd`, all providers and every profile (with the CLI's Bash sandbox on, the launch adds `127.0.0.1` to its allowed hosts, section 4.1), `inbox-dir` kept as a fallback for one milestone (B7) and, beyond it, for Bash-sandbox profiles whose loopback switch is off | yes | |
| The app recomputes the inspector's record from the `PreToolUse` payload; no record file | yes | |
| Approvals of PTY `PermissionRequest` hooks from the inbox card (allow once, deny with an optional message) | yes | |
| A reminder (inbox item and notification) when a held approval goes back to the terminal dialog (section 4.2) | yes | |
| Access requests: an agent's call that a policy the user may lift refuses becomes an approval item with Allow once, for this session, always, or Deny (section 4.10); the broker, the card, the grants and the delivery | yes | the actions themselves come with notes and mounts (0044) |
| Mode source: the reported mode from authenticated hook requests, the monotone rule of section 4.3, the mode chip | yes | |
| Waiting state cleared after a refusal in the TUI, from the closed hook request | yes (P45: the CLI closes a held request at an Esc) | |
| `inbox_ask`, `inbox_ask_result`, answer delivery in PTY and stream-json sessions | yes | |
| Tasks pane, task delete and reorder, reminder editing, enabling and the reminder list in the pane | yes | |
| `powerMonitor` wake, retention, notification click to the item, Enter in the list | yes | |
| Saved views, the pane's folder scope, grouping by project, "Open inbox for this folder" | yes | |
| Project summary editing in the card | yes | |
| `SessionEnd` failure items, `SubagentStop` items for swarm agents and by policy, unknown `Notification` types by policy (off) | yes | |
| Session summaries by the small model, on request only, shown on the session's row in the tree (never as inbox items or in the card) | yes, last builder; can move to the next milestone without blocking anything | |
| Elicitation forms in the card (`Elicitation` hook that waits for the user) | no | P17 (a waiting `Elicitation` hook and URL mode) |
| Edit and allow (`updatedInput`) and "Always" (`updatedPermissions`) on hook approvals | no | apps (0033), where outward drafts multiply; the real check of `updatedPermissions` of 0039 |
| Agent-run schedules | no | one slot counter for the swarm manager and `task_start` (0042 item 4) |
| Per-project policies, quiet hours, notification body setting | no | after the milestone; the app default applies |
| Transcript peek at the anchor, back stack, `MountOptions` peek mode | no | the transcript viewer of 0009 as a surface; notes (0034) bring the editor surface, so the peek mode is designed once for both |
| Interrupt line read from the transcript | no | covered for approvals by the closed hook request; a transcript tail reader comes with the transcript surface |
| Mirror of the agent's own to-do list | no | 0009 agent nodes |
| Outward-action drafts, external reference index | no | apps (0033) |
| Notes as task descriptions | no | notes (0034): the task's `notes` field stays plain text; the notes run (record 0044) may give it the editor |
| Loopback for hooks allowed per port (`127.0.0.1:<port>` of the app's listener) under the CLI's Bash sandbox | no | a probe of the port form under the CLI's own sandbox (later hardening, section 4.1) |
| Browser approvals (0026, 0029) moved onto the access broker of section 4.10 | no | they work with their own question bar and `SiteGrants`; a move gains nothing for the user now |
| The `PreToolUse` inspector over `http`, which would let it run in the container (0030 recommendation 1) | no | a decision to make that one hook fail closed with `onFailure: "block"` (P45: a down receiver then blocks every call); the inspector stays a command hook and stays unavailable in the container |

### 3. Amendments to 0021

0021 is the confirmed direction for R21 with these amendments, in addition to those of 0024, 0037 and 0040:

| 0021 statement | Amendment | Reason |
|---|---|---|
| Section 4: the answer is typed into the PTY as "Answer to inbox question <askId>: <option id or the user's text>" | After the call returned, the app types only a fixed line made by the app, `Inbox answer ready for question <askId>. Read it with inbox_ask_result.`, and the agent reads the answer through the tool `inbox_ask_result`. Stream-json sessions get the same line as a user message. The answer itself reaches the agent only as a tool result or as `additionalContext` | No agent text (option ids included) is ever typed into a terminal. P16 showed that multi-line text can be typed (line feeds or a bracketed paste, then Enter), so the notice is chosen for the agent-text rule, not for line breaks |
| Section 4: `UserPromptSubmit` delivery needs a command hook that prints queued answers | With the `http` transport, the app's reply to the `UserPromptSubmit` request carries `hookSpecificOutput.additionalContext`; no printing command hook is added. `context` delivery is on for `http` sessions; an `inbox-dir` session keeps the answer for the next `idle` | The reply path exists once hooks post to the app; P45 showed an `additionalContext` reply reaching the model in `-p` and in the TUI (one run each) |
| Section 4: result `timeout` 5 seconds before the smaller of `timeoutSeconds` and the measured CLI limit | The server entry `timeout` is `(ASK_MAX_SECONDS + 60) * 1000` ms, which keeps a silent JSON call open that long in both paths (P16: 65, 130 and 310 s held with an entry of 600,000 ms; 60 s without it); the app returns `timeout` 5 seconds before `timeoutSeconds`. An interrupt reaches the server as `notifications/cancelled`, not as a closed connection (P16), and the ask's call becomes `closed` | P16 |
| Section 4: after 2 minutes the CLI moves a main-conversation call to a background task (documented) | Confirmed in the PTY (P16: `PostToolUse` at 120 s with a "moved to the background" result, `Stop`, then the answer as a `<task-notification>` turn); `-p` calls stay in the foreground. The app keeps the default: the session stays usable, the answer written to the open call still reaches the model, and delivery is `in_call`. `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` (verified to keep the call in the foreground) is not set | A waiting question should not block the terminal |
| Section 2: `inbox_asks` columns `delivery` and `call_state`; section 4: a fourth open ask answers `failed` | The ask id is the item id; `delivery` gains `read` (the agent called `inbox_ask_result`), and `typed` becomes `notice` (the fixed line was typed); `call_state` `cancelled` becomes `closed`; `wait` is stored; a fourth open ask answers `limit_reached`, the code of the swarm limits (0037) | Follows the first amendment; the server sees a cancel, not a closed request (P16) |
| Section 2: `inbox_views` | Built-in views ("All", "Needs me", "Done") are constants in code, not rows; the table holds the user's views only | Built-in views cannot be deleted or drift |
| Section 2: session migration 2 (`turns`, summary columns) | Stays in the inbox module (0024): `session_summaries` gains `turns_at` and `transcript_bytes_at`, and a table `session_activity` counts turns and transcript size per session | The session module keeps its migrations to itself |
| Section 3: `PermissionRequest` answered from the card waits for the `http` transport; the hook's timeout is set above the longest wait the app allows | The app waits at most `hooks.approvalWaitMinutes` (default 15), then replies with no decision, which returns the decision to the TUI dialog (P14), and posts a reminder that names the session and opens its terminal (section 4.2). The hook entry's `timeout` is that wait plus 60 seconds | No default allow or deny ever comes from the app; the user asked to be reminded to answer in the terminal (B5) |
| Section 3: the interrupt line resolves open approvals | For a `PermissionRequest` that waits for the app, the closing of the hook request without an answer from the app resolves the item `superseded` and clears `waiting` | Esc fires no `Stop` (P14); the CLI closes the held request at an Esc (P45) |
| Section 3: hooks reach the app through one transport | `SessionStart` and `SessionEnd` stay command hooks that write into the hook directory; every other event uses `http` | P45: an `http` `SessionStart` hook posted nothing; `SessionEnd` over `http` posted in the TUI and was not measured in `-p`, which the stream-json sessions use |
| Section 3 (amended by 0028): the inspector's record arrives in the `PreToolUse` payload file | With the `http` transport the command inspector only decides; the app computes the record from the `PreToolUse` payload it received over `http`, with the same `ToolCallInspector` and the gate policy it holds in memory | No record travels through a directory the agent can write |
| Section 5: session summaries generated when a card needs them | Generated on request only ("Summarize" in the session leaf's context menu, in the summary popover of the tree row and in the session header), with a daily cap of 50 | Real model calls run on the user's subscription; no call starts without a click |
| Section 5: the card header shows the session's summary; summaries are part of the inbox context layers | A summary is not an inbox item and not part of the card: it shows on the session's row in the tree (a mark after the title, the text in a tooltip and a popover, section 4.7). The card header shows the project (name and summary) and the session name; `inbox_context` no longer returns the session summary | A summary needs no input from the user (B6) |
| Section 4: agent tools are `inbox_post` and `inbox_ask` | Also `access_request_result` (section 4.10): a call that a policy the user may lift refuses raises an access request; a decision made after the call returned is announced with the delivery of `inbox_ask` | The user's rule that agents can ask for access to notes and files, not only meet a refusal |
| Section 6: the pane property `viewId` | The pane config is `{ viewId?: string; folderId?: string }`; `folderId` scopes the built-in views, and a stored view carries its own folder | The folder context menu opens a scoped pane without storing a view |
| Section 7: agent-run schedules | Waits (section 2) | |
| Section 8: a mode change reported by payloads | A reported mode may lower the stored mode of the next launch; it never stores a mode above the current launch's mode (section 4.3) | A forged payload cannot widen the next launch |
| Section 3: hooks reach the app in every session | Also in profiles with the CLI's Bash sandbox on: the launch adds `127.0.0.1` to the sandbox's allowed hosts while the profile setting `hooks.bashSandboxLoopback` is on (the default); with it off the profile keeps `inbox-dir` (section 4.1) | The user accepted the loopback risk (B8, section 7) |
| Section 10: a notification click opens the item | Built in this milestone through `inbox_open_item` | Not built in milestone 2 |

### 4. Contracts

#### 4.1 The `http` hook transport (`core/hooks`)

Every hook event of `HOOK_EVENTS` except `SessionStart` and `SessionEnd` posts its payload to the app; the list itself does not change. `SessionStart` (it ends `starting` and removes `mcp.json`) and `SessionEnd` stay command hooks that write into the hook directory, since an `http` `SessionStart` hook posted nothing in P45 and `SessionEnd` over `http` was measured in the TUI only; a forged file of either can only end `starting` early or post a `failure` item. The listener is the app MCP server's listener on 127.0.0.1 (0022): `POST /hooks/<sessionId>`, with its own per-session hook token, separate from the MCP token, so a hook credential cannot call tools and an MCP token cannot post hooks.

```ts
// core/hooks/types.ts
export type HookEventName = (typeof HOOK_EVENTS)[number];

/** One authenticated hook request. `payload` is the CLI's JSON; it is agent-influenced data. */
export interface HookRequest {
  readonly sessionId: SessionId;
  readonly event: HookEventName;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly receivedAt: string;
  /** Aborted when the CLI closes the request before the app replied (an Esc on the dialog or the entry `timeout`, P45). */
  readonly signal: AbortSignal;
}

/** What the app answers. `{}` means no decision and no output. */
export type HookReply =
  | Record<string, never>
  | { readonly hookSpecificOutput: { readonly hookEventName: 'UserPromptSubmit'; readonly additionalContext: string } }
  | {
      readonly hookSpecificOutput: {
        readonly hookEventName: 'PermissionRequest';
        readonly decision: { readonly behavior: 'allow' } | { readonly behavior: 'deny'; readonly message?: string };
      };
    };

/** Adds to the reply of one event; several contributors may answer `UserPromptSubmit`, their contexts are joined. */
export interface HookReplyContributor {
  readonly id: string;
  readonly events: readonly HookEventName[];
  reply(request: HookRequest): Promise<HookReply | undefined> | HookReply | undefined;
}

export interface HookGrant {
  readonly url: string;            // http://<host>:<port>/hooks/<sessionId>, as the environment sees it
  readonly token: string;          // 32 random bytes, hex; only in the 0600 settings file
}

export interface HookEndpoint {
  /** Issues or replaces the session's hook token. */
  grant(sessionId: SessionId, hostHeader?: string): HookGrant;
  revoke(sessionId: SessionId): void;
  /** Called for every accepted request, in arrival order per session, before any contributor replies. */
  subscribe(listener: (request: HookRequest) => void): Unsubscribe;
  addContributor(contributor: HookReplyContributor): Unsubscribe;
}

export const HOOK_PATH = /^\/hooks\/([^/?#]+)$/;
export const HOOK_BODY_MAX_BYTES = 1_000_000;
```

Rules every implementation keeps:

- The request guard of the MCP server applies unchanged: no `Origin`, a `Host` of the loopback names or the grant's host header, a bearer token compared in constant time. A wrong token gets 401 with no detail.
- `hook_event_name` in the payload must name an event of `HOOK_EVENTS`. The path and the token decide the session; `session_id` in the payload must equal it (the app launches with `--session-id` of the same id), else the request gets 400 and is dropped. A payload over the size limit gets 413 and is not passed on.
- Listeners see the requests of one session in arrival order, and a held reply never delays a later request: P45 saw `Notification`, and after an Enter `PostToolUse` and `Stop`, arrive while a `PermissionRequest` was still held. Requests that do not overlap arrive in the CLI's order of events; the file watcher of `HookInbox` had no such guarantee. A test with the fake CLI checks the order and the overlap.
- The app replies at once to every event except a `PermissionRequest` of a PTY session (section 4.2), and `UserPromptSubmit`, whose reply waits for its contributors at most 2 seconds.
- An app that is not running, a non-2xx status, a body that is not JSON or fails the CLI's schema, and a reply slower than the entry `timeout` are non-blocking hook errors: the session goes on without the hook's answer and the TUI dialog decides (P45). No entry sets `onFailure: "block"`, so a failed receiver never denies the user's work. The `PreToolUse` inspector stays a command hook, so the gate keeps failing closed.

Settings and launch:

- The hook entries are `{ "type": "http", "url": <grant.url>, "headers": { "Authorization": "Bearer <token>" }, "timeout": <seconds> }`, one per event; `timeout` is 30 seconds except `PermissionRequest` (approval wait plus 60 seconds; P45 held requests for 150 s in the TUI and 330 s in `-p`) and `UserPromptSubmit` (10 seconds). P45 measured the payloads of `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Notification` (TUI only), `Stop` and `SessionEnd` (TUI only); the mapper's fixtures are re-recorded from them. P45 held requests for 330 s at most, so the `PermissionRequest` entry of 960 s at the default wait is checked by the w-hooks real-CLI test.
- The token is a literal header value in the settings file `settings.json` of the session directory (0600), passed as `--settings <path>`; P45 showed the value then in no argument list. The inline JSON settings in the arguments (0024) end, since the arguments of every process are readable by the same user (`KERN_PROCARGS2`). No token goes into the environment: an `allowedEnvVars` header resolves, but the variable is inherited by the agent's own commands (P45, `printenv`).
- The settings file is removed after the first `SessionStart` arrives, as `mcp.json` is, if a w-hooks test against the real CLI shows that the CLI keeps its hooks after the file is gone; else it stays for the session's life (not probed).
- `IsolationProvider.capabilities.hookTransports` lists `http` for `local`, `srt` and `container` (the container reaches the host as `host.docker.internal` with the grant's host header, as the MCP endpoint does). Under `srt` the hook needs `allowLocalBinding`, which the provider already sets for the MCP endpoint (P45: refused without it, delivered with it). Under the CLI's own Bash sandbox (`sandbox.enabled`) the hook request to loopback is refused with a 403 unless `127.0.0.1` is in `sandbox.network.allowedDomains` (P45), and adding it opens loopback to the agent's sandboxed commands as well. The user accepted that (B8): for a Bash-sandbox session the launch writes `127.0.0.1` into `sandbox.network.allowedDomains` of the session's settings file while the profile setting `hooks.bashSandboxLoopback` is on (default on), and the session uses `http`. With the setting off, the profile's Bash-sandbox sessions keep `inbox-dir`: no approvals from the card, no mode source. Only the literal `127.0.0.1` is added (the hook URL uses it); `localhost` and `::1` are not. A session whose hooks cannot reach the app shows "no mode source" in its header. `hookDelivery` (implemented once in `core/isolation/HostEnvironment.ts`, and in `FakeProvider`) returns `{ kind: 'http', url, token, dir, loopbackInSandbox }` when the profile setting `hooks.transport` is `http` (default in milestone 6) and the session is not a Bash-sandbox session with `bashSandboxLoopback` off, and `inbox-dir` otherwise; the `http` variant of `HookDelivery` (`core/isolation/types.ts`) gains `dir`, the hook directory of the `SessionStart` and `SessionEnd` command hooks, and `loopbackInSandbox: boolean`, which the launch turns into the `allowedDomains` entry. `PtySessionService` accepts both; under `http` the `HookEndpoint` takes every event except those two, which `HookInbox` still reads.
- The Bash sandbox can also come from the user's own settings, which every launch loads (`--setting-sources user`). The launch reads `sandbox.enabled` from the settings the CLI will load and treats a session with it on as a Bash-sandbox session, under the same profile setting. Whether the CLI merges `allowedDomains` of the `--settings` file with the user's own list or replaces it is not verified; the w-hooks real-CLI test checks it, and if the file replaces the list, the launch copies the user's entries into the file before it adds `127.0.0.1`.
- The setting is visible per profile and per session. The profile's Permissions section (`PermissionsSection.tsx`) shows, while the Bash sandbox is on, a `Switch` "Let hooks reach Agide on 127.0.0.1" with a `Hint`: "Sandboxed commands of agents can then connect to every service on this Mac that listens on 127.0.0.1, not only Agide. Off: approvals from the inbox and the mode source do not work in this profile." The mode chip's popover in the session header names the hook transport of the session and, for a Bash-sandbox session with loopback, says "Loopback open to sandboxed commands".
- Later hardening: loopback per port, `127.0.0.1:<port>` of the app's listener in `allowedDomains`. srt accepted that form in the credential proxy probe (`notes/probes-m6-credential-proxy.md`); the CLI's own sandbox was not probed with it. When a probe shows it holds there, the launch writes the port form and the accepted risk of section 7 narrows to the app's own listener.
- The command inspector (`core/permissions/inspectCommand.ts`) writes no record file when the gate file has no `inboxDir`; the launch contributor leaves it out under `http`. The hook mapper gets the record from `GateRecorder.record(sessionId, payload)`, which runs `ToolCallInspector.inspect` over the payload and the session's `LaunchPolicy.gate`.

#### 4.2 Hook approvals from the card

```ts
// core/hooks/types.ts
export type HookApprovalState = 'waiting' | 'answered' | 'closed' | 'expired';

export interface HookApproval {
  readonly itemId: string;         // the approval item of the mapper (origin hook:PermissionRequest)
  readonly sessionId: SessionId;
  readonly toolName: string;
  readonly requestHash: string;    // requestHash(tool, input) of itemText.ts
  readonly state: HookApprovalState;
  readonly openedAt: string;
  readonly expiresAt: string;
}

export interface HookApprovalBroker extends HookReplyContributor {
  /** Answers a waiting approval. Refused when it is not `waiting`. */
  answer(itemId: string, decision: { behavior: 'allow' } | { behavior: 'deny'; message?: string }): HookApproval;
  get(itemId: string): HookApproval | undefined;
  subscribe(listener: (approval: HookApproval) => void): Unsubscribe;
}
```

- The broker holds the `PermissionRequest` request of a PTY session open until the user answers on the card, the request closes, or `hooks.approvalWaitMinutes` passes. At the limit it replies `{}` (no decision) and posts the reminder below: the TUI dialog decides (P14; P45 showed the dialog on screen during the hold, the tool running after an allow from the receiver with no key pressed, and the dialog staying after the entry `timeout` closed the request). Stream-json sessions keep `can_use_tool` (0037).
- The first answer wins (P14). The approval ends on the first of: the matching `PostToolUse`, `Stop`, the request's `signal` (the CLI closes the request at an Esc on the dialog and at the entry `timeout`, P45), and an answer from the card. An Enter in the terminal leaves the request open (P45: no close seen), so that case resolves on the `PostToolUse` that follows. The entry `timeout` is 60 seconds longer than the broker's own wait, so a close before the broker replied comes from the terminal. On a close without `PostToolUse` or `Stop` within 2 seconds (an Esc, which fires no `Stop`), the item resolves `superseded` and the session status leaves `waiting` for `idle`; this clears the waiting state that 0030 left open. A late answer from the card after an Enter is written to an open request that the CLI no longer reads and does nothing (P16 and P45: a late reply is harmless); the card hides its buttons once `PostToolUse` arrives.
- A deny carries an optional message of the user (at most 500 characters) that reaches the model; it is the user's text. No agent text becomes part of a reply.
- The card shows the raw tool input as today, the class label from the app's own record (section 4.1), and the buttons "Allow once" and "Deny" with a message field behind a Disclosure; "Open session to answer" stays as the secondary action.
- Approvals not held by the broker (an `inbox-dir` session, or a request that arrived when the app could not hold it) keep today's card.

Reminder when the decision goes back to the terminal (the user's addition to question 5):

- When `hooks.approvalWaitMinutes` passes, the broker replies `{}`, sets the approval `expired`, resolves its item `expired`, and posts one reminder item per session: kind `input`, urgency `high`, source `app`, origin `hooks:terminal_dialog`, `session_id` and `link_node_id` the session's leaf, `folder_id` the leaf's folder, dedupe key `hooks:terminal_dialog:<sessionId>`, `textAuthor: 'app'`, message "<session title>: a permission dialog waits in its terminal" (the title shortened to keep the 140 characters), details "<tool name>, <class label>. Agide stopped waiting after <n> minutes; answer the dialog in the session's terminal." and payload `{ sessionId, toolName, requestHash, approvalItemId, focusLink: true }`. A second expiry in the same session while the reminder is open updates it (the details name the latest tool) and posts no second item.
- The notifier shows a macOS notification for it as for any new `input` item. Its click runs `inbox_open_item`, which for an item whose payload has `focusLink: true` runs `ui_focus_node` on `link_node_id` (the session's terminal comes to the front) in place of opening the inbox. The card (`TerminalDialogReminder`) has the primary Button "Open terminal" (the same `ui_focus_node`) and the quiet "Done".
- The reminder resolves `done` on the first of these events of the session: the `PostToolUse` whose tool and input match `requestHash` (allowed in the terminal); a later `PreToolUse` or `PermissionRequest` (the dialog is gone); `UserPromptSubmit`, `Stop` or `StopFailure`; a `Notification` of type `idle_prompt`; `SessionEnd` or `session.exited`. The hook request itself ended when the broker replied, so no close signal follows. A refusal in the terminal (Esc) fires none of these events (P14), so after it the reminder stays open until the session's next event or the user's "Done"; the card says "Closes when the session goes on".
- Apart from the session title (a leaf title that an agent in the folder can rename, cleaned and shortened as data), agent text never enters the reminder: the tool name and the class label come from the app's record (section 4.1), the input stays on the expired approval's card.
- The notifier allows one notification per session per minute (`InboxNotifier`); the reminder is exempt from that limit (origin `hooks:terminal_dialog`, at most one per expiry), so an earlier notification of the session cannot swallow it. w-inbox-ui adds the exemption.

#### 4.3 Mode source

```ts
// core/session/types.ts additions
export interface ReportedMode {
  readonly mode: PermissionMode;
  readonly at: string;
  /** `http`: an authenticated hook request; payload files of `inbox-dir` are never a source. */
  readonly transport: 'http';
}
export interface SessionInfo {
  // ...existing fields
  readonly reportedMode?: ReportedMode;
}
export type SessionEvent =
  // ...existing events
  | { readonly type: 'session.mode_reported'; readonly sessionId: SessionId; readonly reported: ReportedMode; readonly launchMode: PermissionMode };

/** The index of a mode in `MODE_ORDER` (`core/permissions/modes.ts`), which has the same order; one is derived from the other. */
export const MODE_RANK: Readonly<Record<PermissionMode, number>> = { plan: 0, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 4 };
```

- The session takes `permission_mode` from every `http` hook payload that carries it (P45: `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse` and `Stop` carry it; `Notification` does not). The payload names the CLI's mode: P45 payloads report `default` for a launch with `--permission-mode manual` (`cliPermissionMode`); a value that is not a `PermissionMode` is ignored. A reported mode at or below the rank of the mode the session was launched with becomes the stored mode for the next launch, so a session that went to `plan` and back keeps its launch mode, and the next launch is never looser than the current one. A mode of higher rank than the launch mode is shown and never stored: the header shows "Mode acceptEdits, the session reports auto" and offers "Keep for next launch", which runs `session_set_mode`, a command of the user (`mcpExempt`: agents never choose their own permission mode). A reported `bypassPermissions` that the launch did not have posts an `alert` (urgency `high`).
- Payloads from `inbox-dir` never change the mode, as today.
- The rule holds without trusting the transport: a forged payload can at most lower the next launch's mode or change a label. The `http` transport removes the forgery that needed no secret (a file dropped into the hook directory); a same-user agent that reads the session's settings file can still post with the token (security table).

#### 4.4 `inbox_ask`

Schemas (zod, in `core/inbox/askCommands.ts`):

```ts
export const ASK_MIN_SECONDS = 30;
export const ASK_MAX_SECONDS = 3600;
export const ASK_OPEN_PER_SESSION = 3;
/** The server entry timeout the app writes for its MCP server, in milliseconds. */
export const APP_MCP_TIMEOUT_MS = (ASK_MAX_SECONDS + 60) * 1000;
/** The call returns `timeout` this long before the effective limit. */
export const ASK_RETURN_MARGIN_MS = 5000;

const askOption = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  label: z.string().min(1).max(60),
}).strict();

export const inboxAskInput = z.object({
  question: z.string().min(1).max(140),
  details: z.string().max(8000).optional(),
  options: z.array(askOption).max(6).default([]),
  allowFreeText: z.boolean().optional(),                 // default: true when there are no options
  timeoutSeconds: z.number().int().min(ASK_MIN_SECONDS).max(ASK_MAX_SECONDS).default(600),
  wait: z.boolean().default(true),
  link: link.optional(),                                 // the link schema of inbox_post
}).strict().refine((v) => new Set(v.options.map((o) => o.id)).size === v.options.length, 'option ids must differ')
  .refine((v) => v.options.length > 0 || v.allowFreeText !== false, 'a question needs options or free text');

export type InboxAskResult =
  | { status: 'answered'; askId: string; choice?: string; text?: string; answeredAt: string }
  | { status: 'timeout'; askId: string; note: string }      // the answer will be announced later
  | { status: 'queued'; askId: string; note: string }       // wait: false
  | { status: 'dismissed'; askId: string };

export const inboxAskResultInput = z.object({ askId: z.string().min(1).max(64) }).strict();
export type InboxAskResultValue =
  | InboxAskResult
  | { status: 'pending'; askId: string }
  | { status: 'cancelled'; askId: string };                 // the user withdrew the question
```

Store (inbox migration 2):

```sql
CREATE TABLE inbox_asks (
  item_id TEXT PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  options TEXT NOT NULL,
  allow_free_text INTEGER NOT NULL CHECK (allow_free_text IN (0, 1)),
  wait INTEGER NOT NULL CHECK (wait IN (0, 1)),
  timeout_at TEXT NOT NULL,
  call_state TEXT NOT NULL CHECK (call_state IN ('waiting', 'returned', 'timed_out', 'closed')),
  answer_choice TEXT,
  answer_text TEXT CHECK (answer_text IS NULL OR length(answer_text) <= 4000),
  answered_at TEXT,
  delivery TEXT NOT NULL DEFAULT 'none'
    CHECK (delivery IN ('none', 'in_call', 'queued', 'notice', 'stdin', 'context', 'read', 'failed')),
  delivered_at TEXT,
  CHECK (answered_at IS NULL OR answer_choice IS NOT NULL OR answer_text IS NOT NULL)
);
CREATE INDEX inbox_asks_by_session ON inbox_asks (session_id, delivery);
```

Service:

```ts
// core/inbox/askTypes.ts
export interface AskRecord {
  readonly askId: string;          // the item id
  readonly sessionId: SessionId;
  readonly options: readonly { id: string; label: string }[];
  readonly allowFreeText: boolean;
  readonly wait: boolean;
  readonly timeoutAt: string;
  readonly callState: 'waiting' | 'returned' | 'timed_out' | 'closed';
  readonly answer?: { choice?: string; text?: string; answeredAt: string };
  readonly delivery: 'none' | 'in_call' | 'queued' | 'notice' | 'stdin' | 'context' | 'read' | 'failed';
}

export interface AskService {
  /** Creates the `input` item and the row; resolves when answered, dismissed, timed out or the signal aborts. */
  ask(caller: Caller & { kind: 'mcp' }, input: z.output<typeof inboxAskInput>, signal: AbortSignal): Promise<InboxAskResult>;
  /** The user's answer from the card. `choice` must be an option id of the ask; `text` needs allowFreeText. */
  answer(askId: string, answer: { choice?: string; text?: string }): AskRecord;
  /** The answer for the asking session only; marks it `read`. */
  result(caller: Caller & { kind: 'mcp' }, askId: string): InboxAskResultValue;
  /** Queued answers of a session for a `UserPromptSubmit` reply; marks them `context`. */
  takeForContext(sessionId: SessionId): AskRecord[];
  /** Called when a session becomes idle or resumes: types the notice or writes the stdin message for answered, undelivered asks. */
  deliverPending(sessionId: SessionId): void;
  get(askId: string): AskRecord | undefined;
}
```

Delivery:

| Situation | PTY session | Stream-json session |
|---|---|---|
| The call is open (`wait: true`, before the effective limit) | the held tool result carries the answer; `in_call`. If the CLI moved the call to a background task (P16), the result reaches the model as a task notification | the held tool result; `in_call` |
| The call returned or closed, the session is `idle` | `sendText` of the fixed notice line; `notice`; the agent calls `inbox_ask_result`, which marks `read` | the notice as a user message on stdin; `stdin` |
| The session is `busy` or `waiting` | `queued`. A user prompt first (`http` sessions): the `UserPromptSubmit` reply carries `additionalContext` with the answer in a fixed frame (`context`; P45 showed the reply reaching the model); else the notice at the next `idle` | queued until the turn's `result`, then the stdin notice |
| The session exited | stored; delivered by `deliverPending` after a resume once `idle` | the same |

- The effective limit of an open call is `timeoutSeconds * 1000 - ASK_RETURN_MARGIN_MS`. The app's MCP entry sets `timeout: APP_MCP_TIMEOUT_MS`, which is the hard wall-clock limit of every call to the app server and also raises the idle window, so a silent JSON reply is held for the whole wait (P16). Without the entry a silent call ends at 60 s; progress notifications reset the idle window but never move the wall-clock limit (P16), so the server sends none.
- `CommandContext` gains `signal?: AbortSignal`. The CLI does not close the request of an interrupted call: it posts `notifications/cancelled` with the `requestId` of the pending `tools/call` on a new request of the same session (P16, after an interrupt in `-p`, an Esc in the TUI and a wall-clock timeout). Each request gets its own SDK server in the stateless app server, so the SDK's own cancellation does not see a notification that arrives on another request: `HttpAppMcpServer` reads the method of the body before the SDK, keeps the pending tool calls of each session by JSON-RPC id, and aborts a call's signal on a matching `notifications/cancelled` of the same session, on the close of its HTTP response, on `session.exited`, on revoke and on stop. `AskService.ask` then sets `call_state` `closed`; the item stays open for the user, and a later answer goes through the notice. The `_meta["claudecode/toolUseId"]` of the call is stored with the ask, so the card can link the transcript's `tool_use`.
- In the PTY a call still open at 120 s becomes a background task; the session turns `idle` while the call stays `waiting`, and `deliverPending` never types a notice for an ask whose call is `waiting`. The answer written to the open call arrives as a `<task-notification>` turn (P16), which the mapper already ignores as user input.
- The `additionalContext` frame is app text with the user's answer quoted: `The user answered your inbox question <askId>. Choice: <option id or none>. Text, quoted as data: """<user text>"""`. The option id is agent text limited to `[a-z0-9_-]`; the question and labels are never repeated in it.
- `inbox_ask_result` answers `not_found` for an ask of another session, as for an unknown id.
- At most `ASK_OPEN_PER_SESSION` open asks; another answers `limit_reached`. Answers are counted against no rate; asks count towards the `inbox_post` rate.
- The delivery of the table above is one planner (`NoticeDelivery`, `core/inbox/delivery/`), shared with the access requests of section 4.10. It takes a record id, the fixed notice line and the fixed context line, both made by the app from the record id, and reports `in_call`, `notice`, `stdin`, `context` or `failed`; it never takes agent text.

```ts
// core/inbox/delivery/types.ts
export interface Notice {
  readonly recordId: string;                      // ask id or access request id, an app id
  readonly sessionId: SessionId;
  readonly noticeLine: string;                    // typed into an idle PTY, or a stdin user message
  readonly contextLine: string;                   // UserPromptSubmit additionalContext
  onDelivered(delivery: 'notice' | 'stdin' | 'context' | 'failed'): void;
}
export interface NoticeDelivery {
  /** Queues the notice; delivers at once when the session is idle, else at the next idle, prompt or resume. */
  enqueue(notice: Notice): void;
  cancel(recordId: string): void;
}
```

- The card for an ask (`AskCardActions`): the question as the title, the details, one Button per option with its label as text (agent text, plain), a Field for free text when allowed (at most 4,000 characters), "Send" as primary, "Withdraw question" (resolves `dismissed`, the call returns `dismissed`). A sent answer shows the delivery state ("Waiting for the session to read it", "Read by the agent").

#### 4.5 Tasks and reminders

Service additions (`core/inbox/taskService.ts`):

```ts
export interface TaskService {
  // ...existing methods
  deleteTask(id: string): void;                         // its due reminder goes with it (ON DELETE CASCADE)
  /** Places the task before `beforeTaskId` (end when absent), optionally in another folder. Positions are renumbered. */
  moveTask(id: string, to: { folderId?: NodeId | null; beforeTaskId?: string }): Task;
  updateReminder(id: string, patch: ReminderPatch): Schedule;   // recomputes next_due_at
}
export interface ReminderPatch {
  readonly title?: string;
  readonly details?: string | null;
  readonly dtstart?: string;
  readonly tzid?: string;
  readonly rrule?: string | null;
  readonly catchUp?: CatchUp;
}
```

No migration of the `tasks` module is needed.

#### 4.6 Views, retention, wake and the notification click

```ts
// core/inbox/viewTypes.ts additions
export interface ViewFilter {
  readonly kinds?: readonly ItemKind[];
  readonly states?: readonly ItemState[];
  readonly minUrgency?: Urgency;
  readonly sources?: readonly ItemSource[];
  readonly text?: string;                               // case-insensitive substring of message and details
}
export interface InboxView {
  readonly id: string;
  readonly name: string;
  readonly folderId: NodeId | null;
  readonly filter: ViewFilter;
  readonly sort: 'urgency_then_time' | 'time' | 'project';
  readonly position: number;
  readonly builtin: boolean;
}
export const BUILTIN_VIEWS: readonly InboxView[];      // all, needs-me (input, approval, review; new and seen), done
```

```sql
-- inbox migration 2 (with inbox_asks above)
CREATE TABLE inbox_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  filter TEXT NOT NULL,
  sort TEXT NOT NULL DEFAULT 'urgency_then_time' CHECK (sort IN ('urgency_then_time', 'time', 'project')),
  position INTEGER NOT NULL
);
ALTER TABLE session_summaries ADD COLUMN turns_at INTEGER;
ALTER TABLE session_summaries ADD COLUMN transcript_bytes_at INTEGER;
CREATE TABLE session_activity (
  session_id TEXT PRIMARY KEY,
  turns INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  transcript_bytes INTEGER,
  updated_at TEXT NOT NULL
);
```

- The SQL of migration 2 (this section and section 4.4) was run against `node:sqlite` in Node 22 on top of migration 1 of the inbox and tasks modules: an answered row without an answer is refused, an ask goes with its item, and a view goes with its folder.
- `ItemQuery` gains `sources` and `text`; `InboxService` gains `purgeDone(olderThan: string): number`. The module runs it at start and every 24 hours with `inbox.retentionDays` (default 90).
- `Desktop` gains `onResume(listener): Unsubscribe` (Electron `powerMonitor` `resume`); the inbox module calls `scheduler.tick()` on it. `DesktopNotification.onClick` is set by the notifier to run `inbox_open_item`.
- `inbox_open_item { itemId }` emits the UI event `ui.inbox_open_item`; the layout opens the first inbox pane whose view contains the item (else a new pane on "All") and selects it. For an item whose payload has `focusLink: true` (the terminal-dialog reminder of section 4.2) it runs `ui_focus_node` on the item's `link_node_id` instead.
- An inbox pane scoped by `folderId` passes the folder to `inbox_list` (UI callers may pass any folder). The list groups rows by project (`ItemRow.projectName`, "No project" last) within the chosen sort.

#### 4.7 Session summaries (on request, on the session's row)

A summary needs no answer from the user, so it is never an inbox item and is not part of the inbox card (B6). It belongs to the session's row in the tree.

```ts
// core/summary/types.ts
export interface SummaryRequest { readonly sessionId: SessionId; readonly transcriptPath: string }
export interface SessionSummarizer {
  /** One run at a time per profile and per session; refused above the daily cap. */
  summarize(request: SummaryRequest): Promise<{ summary: string; model: string; generatedAt: string }>;
}
export interface SessionSummaryView {
  readonly sessionId: SessionId;
  readonly summary: string;            // model text: plain text only
  readonly model: string;
  readonly generatedAt: string;
  readonly stale: boolean;
}
export const SUMMARY_DAILY_CAP = 50;
export const SUMMARY_MAX_CHARS = 400;
export const SUMMARY_INPUT_MAX_CHARS = 20_000;
```

The process and its flags are those of 0021 section 5 (`claude -p`, `--model haiku`, `--max-budget-usd 0.05`, `--setting-sources user`, `--strict-mcp-config`, `--no-chrome`, `--tools ""`, `--no-session-persistence`, `--settings` with `disableAllHooks`, an empty temporary working directory, the profile's `CLAUDE_CONFIG_DIR`, the environment scrub), started through `HostTools` (0042) with an explicit environment. Staleness: at least 3 turns since `turns_at` or 50 kB since `transcript_bytes_at`. The builder's real-Claude script checks that a run leaves no transcript and no folder-trust entry.

- Storage stays in the `session_summaries` table of the inbox module's store (0024), with the columns of section 4.6; moving it would need a migration in two modules with no effect for the user. The generator and its commands live in `core/summary/`; the inbox card does not read the table.
- The tree: `SessionSummaryMark` after the title of a session leaf (rendered by `LeafDecorations`, next to `SessionDecorations`). With a summary it is a quiet `IconButton` with a summary glyph; a `Tooltip` shows the text and "<age>, by <model>"; a click opens a `Popover` with the text, the time, and the quiet Button "Refresh". A stale summary shows the glyph in `text.tertiary` and "out of date" in the tooltip. Without a summary nothing is drawn. A run in progress shows the spinning state of the glyph; a refused or failed run (the daily cap, an error) shows its reason as a `Hint` in the popover, never as an inbox item.
- Start: "Summarize" in the session leaf's context menu, "Refresh" in the popover, and the same action in the session header, all through `session_summarize`. Nothing summarizes on its own.
- `inbox_context` returns the project (name and summary) and the session name, no session summary; `ItemCard.tsx` drops its session summary line (c-m6, section 5).

#### 4.8 Commands and IPC

Every command below is in the registry; the renderer calls it through the existing `invoke` IPC. Rule: a command the renderer calls has `ui: {}` (or a menu binding) and is a tool, or states `mcpExempt` (0029, 0041); `pnpm parity` then lists it. Existing inbox and task commands move from `ui: false` to `ui: {}` where the renderer calls them.

| Command | UI | MCP tool | Folder scope for agents | Notes |
|---|---|---|---|---|
| `inbox_ask` | none | yes | the caller's folder and session from the grant | section 4.4 |
| `inbox_ask_result` | none | yes | own session's asks only | section 4.4 |
| `inbox_answer` | `{}` | exempt: only the user answers questions | | `{ itemId, choice?, text? }` |
| `hook_approval_answer` | `{}` | exempt: agents never answer permission requests | | `{ itemId, behavior, message? }` |
| `session_set_mode` | `{}` | exempt: agents never choose their own permission mode | | `{ sessionId, mode }`; `bypassPermissions` keeps the confirmation of 0028 |
| `inbox_mark_seen`, `inbox_mark_unread`, `inbox_snooze`, `inbox_reopen` | `{}` (was `false`) | exempt: they record what the user looked at or put off | | unchanged inputs |
| `inbox_list`, `inbox_resolve`, `inbox_post` | `{}` for list and resolve | yes (unchanged) | as today | |
| `inbox_context` | `{}` | exempt: the card's header for the user | | |
| `inbox_set_viewing` | `{}` (was `false`) | exempt: it records which session the user looks at | | unchanged input |
| `inbox_set_project_summary` | `{}` | exempt: an agent proposes a draft, the user decides (the draft item waits) | | |
| `inbox_views_list`, `inbox_view_save`, `inbox_view_delete` | `{}` | exempt: views arrange the user's own screen | | `inbox_view_save` takes `InboxView` without `builtin` |
| `inbox_open_item` | `{}` | exempt: it changes the user's screen | | for a `focusLink` item it focuses the linked node (section 4.6) |
| `session_summarize` | `{ menu: 'tree-node' }`, shown for session leaves | exempt: starts a model run on the user's subscription | | `{ sessionId }`; section 4.7 |
| `session_summary_get` | `{}` | exempt: the tree row's view for the user | | `{ sessionId }` → `SessionSummaryView` or none |
| `access_request_result` | none | yes | own session's requests only | `{ requestId, waitSeconds? }` (0 to `access.waitSeconds`, default 0); section 4.10 |
| `access_decide` | `{}` | exempt: only the user answers an agent's access request | | `{ requestId, decision, message?, expectedRevision?, expectedSha256? }`; section 4.10 |
| `access_grants_list` | `{}` | exempt: the user's view of what sessions may do | | `{ sessionId? }` |
| `access_grant_revoke` | `{}` | exempt: only the user changes grants | | `{ sessionId, action, targetId }` |
| `task_create`, `task_list`, `task_update` | `{}` (was `false`) | yes (unchanged) | as today | |
| `task_delete` | `{}` | yes | agents delete only tasks they own (`owner_session_id`) | |
| `task_move` | `{}` | yes | both folders within the caller's scope | `{ taskId, folderId?, beforeTaskId? }` |
| `reminder_create`, `reminder_list`, `reminder_delete` | `{}` (was `false`) | yes (unchanged) | as today | |
| `reminder_update` | `{}` | yes | the reminder's folder | `{ reminderId, ...ReminderPatch }` |
| `reminder_set_enabled` | `{}` | yes | the reminder's folder | `{ reminderId, enabled }` |

Events on the app bus that cross IPC: `inbox.item_changed`, `inbox.unread_changed` (existing), `inbox.ask_changed { askId, callState, delivery }`, `hooks.approval_changed { itemId, state }`, `session.mode_reported`, `tasks.changed { folderId }`, `inbox.views_changed`, `ui.inbox_open_item { itemId }`, `session.summary_changed { sessionId }`, `access.request_changed { requestId, state, callState, delivery }`, `access.grants_changed { sessionId }`.

#### 4.9 User interface

Every component uses the tokens and the components of 0035 (`app/src/renderer/ui`); no colour literal (`pnpm check:colours`).

| Component | Where | Built from | Notes |
|---|---|---|---|
| `TasksPane` (`agide/tasks`, config `{ folderId?: string }`, input: the selected folder) | `renderer/panes/tasks/` | Toolbar (New task, New reminder, filter SegmentedControl Open / Done), EmptyState | lists tasks of the folder subtree by `position`, grouped Open, In progress, Blocked; Done and Cancelled under a Disclosure |
| `TaskRow` | same | Checkbox (done), title in `type.body`, Chip for the due time (`warning` when past, `info` otherwise), agent owner shown as the `bot` icon with a Tooltip, link IconButton | keyboard: Enter edits, Space toggles done, Delete asks, Alt+Up and Alt+Down move |
| `TaskDialog` | same | Dialog 480, Field (title, notes textarea, due date and time, external URL), Select (state) | external URL shown as text, "Open" through the browser surface |
| `ReminderList`, `ReminderDialog` | same | Table (title, next due, repeat, enabled Switch); Dialog 480 with Field, Select (zone; repeat presets: none, daily, weekdays, weekly on the start day, monthly on the start date, custom), Field for a custom RRULE with the error line of 0035, RadioGroup for catch-up | the preview line "Next: <date>, then <date>" from `occurrences` |
| `AskCardActions` | `renderer/panes/inbox/` | Button per option, Field, Button primary "Send", quiet "Withdraw question", Hint for the delivery state | rendered by `ItemCard` for `origin` `mcp:inbox_ask` |
| `HookApprovalActions` | same | Button primary "Allow once", Button "Deny", Disclosure with a Field for the deny message, Hint with the wait left | rendered by `ItemCard` for held approvals; replaces the "answer in the session" Notice for them |
| `InboxViewBar` | same | Tabs of the views, Menu "Save view…", Dialog for name and filter (Checkbox per kind and state, Select for urgency, Field for text) | |
| `ProjectSummaryEditor` | same | quiet Button "Edit", Field textarea, Button "Save" | |
| `TerminalDialogReminder` | same | Button primary "Open terminal", quiet Button "Done", Hint "Closes when the session goes on" | rendered by `ItemCard` for `origin` `hooks:terminal_dialog` (section 4.2) |
| `AccessRequestActions` | same | title line (app text), a detail block (target title and path in `type.small`, control and bidirectional characters escaped as in the review views of 0040), for a change or a write a unified diff in a `pre` with added lines on `success.bg` and removed lines on `danger.bg`, Button primary "Allow once", Button "Allow for this session", Button "Allow always for this note" or "… for this mount" with a Hint naming the setting it changes, Button "Deny" with a Disclosure holding a Field for the message, Hint with the wait left or "The agent's call ended; it is told when you decide", quiet Button "Open note" or "Open file" | rendered by `ItemCard` for `origin` `access:request`; only the offered scopes are shown (section 4.10) |
| `AccessGrantsChip` | `renderer/panes/session/`, rendered in the session bar of `TerminalPane.tsx` | Chip "Access: <n>" while the session holds grants, Popover with a Table (action, target title, since) and a quiet Button "Revoke" per row | section 4.10 |
| `SessionSummaryMark` | `renderer/panes/tree/` | quiet IconButton with the summary glyph, Tooltip (text, age, model), Popover with the text, Hint with the time or the refusal, quiet Button "Refresh" | rendered by `LeafDecorations` for session leaves (section 4.7) |
| `ModeChip` | `renderer/panes/TerminalPane.tsx` header | Chip (`info` for the launch mode; `warning` when the reported mode differs), Popover with "Keep for next launch", the hook transport of the session and, under the Bash sandbox with loopback, "Loopback open to sandboxed commands" | |
| Loopback row | `renderer/panes/settings/PermissionsSection.tsx` | Switch "Let hooks reach Agide on 127.0.0.1", Hint with the risk text of section 4.1 | shown while the profile's Bash sandbox is on |

#### 4.10 Access requests

The user's rule (2026-11-26): an agent can ask for permission to read or change notes and files, and the user can give it, in place of a flat refusal. One mechanism serves every such case. It follows the pieces that exist: the browser approvals of 0026 and 0029 (a call that waits for an inbox item with Deny, Allow once, for the session and always, `SiteGrants` in memory, dismissing the item denies, pending requests end when the session exits), the wait and the late delivery of `inbox_ask` (section 4.4), and the folder scope and parity rule of 0029.

Which refusals become a request, and which stay refusals:

| Policy | Becomes | Owner |
|---|---|---|
| A note read (`note_read`) while the note's observation is `off`; `note_search` leaves such notes out and raises nothing, since a search names no note | request `note.read` | notes (0044) |
| A note change (`note_append`, `note_edit`) while the note's `agentWrites` is `review` (the default) | request `note.change`; the change is a proposal and the card shows its diff | notes |
| A note removal: `ui_remove_node` from an agent on a subtree that holds note leaves | request `note.remove` | notes, through the removal guard of `ui_remove_node` |
| A mount listing or read (`mount_list_dir`, `mount_read`) while the mount's agent access is `off` (the default) | request `mount.read` | mounts (0044) |
| A write to a mounted file (`mount_write`), always | request `mount.write`; the card shows the diff | mounts |
| A target outside the caller's folder scope | refusal: `not_found` for an unknown id and `out_of_scope` for a target in another folder, as `ui_*` commands answer (`requireInScope`); no item is posted | |
| The path guard of mounts: absolute, `escapes`, `leaves_mount`, `missing`, `not_regular`, `changed`, `hard_link`, `too_large`, `binary`; refused roots, the app root, credential locations (`checkDenyRead`), protected paths | refusal; these rules protect files outside the mount and the main process, which reads what an agent's sandbox may deny | |
| A hidden path while the mount's "Show hidden files" is off | refusal; hidden names are where secrets live (`.env`, `.git`), and the switch is the user's | |
| A note whose `agentWrites` is `none` | refusal; it is the user's standing "not allowed" for that note | |
| A `note_edit` on an `off` note by a session without read access (no session grant for `note.read` and no read of the note that the user allowed for this session, 0044 section 4.4) | refusal with "Read the note first; note_read asks the user": an edit's errors would tell the agent what the note holds, so the read request comes first | notes |
| The open and rate limits below, and a session's quiet deny | refusal (`limit_reached`, `refused`) | |

Types (`core/access/types.ts`):

```ts
export const ACCESS_ACTIONS = ['note.read', 'note.change', 'note.remove', 'mount.read', 'mount.write'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type AccessScope = 'once' | 'session' | 'always';
export type AccessDecision = { readonly allow: AccessScope } | { readonly deny: true; readonly message?: string };
export type AccessDenyReason = 'user' | 'stale' | 'conflict' | 'scope' | 'failed';

export interface AccessTarget {
  readonly kind: 'note' | 'mount';
  readonly id: string;                 // note id or mount id
  readonly nodeId: NodeId;             // its leaf: folder scope, the item's link
}

/** What the card shows. Everything but the action comes from the agent, a note or a file: plain text only. */
export interface AccessDetail {
  readonly targetTitle: string;
  readonly path?: string;              // a mount path, relative to the root
  readonly items?: readonly string[];  // the note titles of a removal
  readonly diff?: { readonly before: string; readonly after: string; readonly revision?: number; readonly sha256?: string | null };
}

export interface AccessRequestRecord {
  readonly requestId: string;          // the inbox item id
  readonly sessionId: SessionId;
  readonly action: AccessAction;
  readonly target: AccessTarget;
  readonly input: Readonly<Record<string, unknown>>;   // the tool input that raised it; agent text
  readonly offered: readonly AccessScope[];
  readonly state: 'pending' | 'allowed' | 'denied' | 'expired' | 'withdrawn';
  readonly scope?: AccessScope;
  readonly reason?: AccessDenyReason;
  readonly message?: string;           // the user's text with a deny, at most 500 characters
  readonly performed: boolean;         // the action ran after the allow
  readonly callState: 'waiting' | 'returned' | 'closed';
  readonly delivery: 'none' | 'in_call' | 'notice' | 'stdin' | 'context' | 'read' | 'failed';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
}

/** Registered once per action by the module that owns the target. */
export interface AccessActionHandler<R = unknown> {
  readonly action: AccessAction;
  /** The scopes the card offers for this target now. */
  offered(target: AccessTarget, sessionId: SessionId): readonly AccessScope[];
  /** The card's detail; computed at request time and again before an allow is applied. */
  detail(request: AccessRequestRecord): Promise<AccessDetail>;
  /** Runs the action for the requesting session after an allow. Checks the folder scope and every refusal again. */
  perform(request: AccessRequestRecord, expected: { readonly revision?: number; readonly sha256?: string | null }): Promise<R>;
  /** `always`: changes the target's own setting through the owner's UI command, as the user would. */
  applyAlways?(target: AccessTarget): void;
  /** A deny, an expiry or a withdrawal; for example rejects the pending proposals. */
  ended?(request: AccessRequestRecord): void;
}

export type AccessCheck = 'allow' | 'quiet_deny' | 'ask';

export interface AccessGrant {
  readonly sessionId: SessionId;
  readonly action: AccessAction;
  readonly target: AccessTarget;
  readonly effect: 'allow' | 'deny';
  readonly requestId: string;
  readonly createdAt: string;
}

/** What a tool returns when its call raised a request. When the action ran, the tool returns its own result. */
export type AccessCallResult =
  | { readonly access: 'pending'; readonly requestId: string; readonly note: string }
  | { readonly access: 'denied'; readonly requestId: string; readonly reason: AccessDenyReason; readonly message?: string };

export type AccessResultValue =
  | { readonly requestId: string; readonly state: 'pending' | 'expired' | 'withdrawn' }
  | { readonly requestId: string; readonly state: 'allowed'; readonly scope: AccessScope; readonly result?: unknown }
  | { readonly requestId: string; readonly state: 'denied'; readonly reason: AccessDenyReason; readonly message?: string };

export interface AccessBroker {
  register(handler: AccessActionHandler): Unsubscribe;
  /** A session grant allows; a quiet deny refuses without an item; else the owner raises a request. */
  check(sessionId: SessionId, action: AccessAction, target: AccessTarget): AccessCheck;
  /** Raises or joins a request, posts the item, waits until a decision, `access.waitSeconds` or the call's signal. */
  request<R>(caller: Caller & { kind: 'mcp' }, action: AccessAction, target: AccessTarget,
             input: Record<string, unknown>, signal: AbortSignal): Promise<R | AccessCallResult>;
  /** The user's decision (UI only). `expected` is the revision or file hash the card's diff was shown against. */
  decide(requestId: string, decision: AccessDecision, expected?: { revision?: number; sha256?: string | null }): Promise<AccessRequestRecord>;
  /** For the asking session only; waits up to `waitSeconds` for a decision. Runs an allowed read once, here. */
  result(caller: Caller & { kind: 'mcp' }, requestId: string, waitSeconds: number, signal: AbortSignal): Promise<AccessResultValue>;
  grants(sessionId?: SessionId): readonly AccessGrant[];
  revoke(grant: { sessionId: SessionId; action: AccessAction; targetId: string }): void;
  get(requestId: string): AccessRequestRecord | undefined;
  subscribe(listener: (record: AccessRequestRecord) => void): Unsubscribe;
}

export const ACCESS_OPEN_PER_SESSION = 5;
export const ACCESS_REQUESTS_PER_WINDOW = 20;            // per session and 10 minutes
export const ACCESS_MESSAGE_MAX_CHARS = 500;
```

Store (module `access`, migration 1, after `inbox`; checked against `node:sqlite` in Node 22 by run `decisions-amend`: an allow without a scope, a deny reason or message on an allowed request and an unknown action are refused, and a request goes with its item):

```sql
CREATE TABLE access_requests (
  item_id TEXT PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,   -- the request id is the item id
  session_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('note.read', 'note.change', 'note.remove', 'mount.read', 'mount.write')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('note', 'mount')),
  target_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  input TEXT NOT NULL CHECK (json_valid(input)),
  offered TEXT NOT NULL CHECK (json_valid(offered)),
  call_state TEXT NOT NULL CHECK (call_state IN ('waiting', 'returned', 'closed')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'allowed', 'denied', 'expired', 'withdrawn')),
  scope TEXT CHECK (scope IS NULL OR scope IN ('once', 'session', 'always')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('user', 'stale', 'conflict', 'scope', 'failed')),
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  performed INTEGER NOT NULL DEFAULT 0 CHECK (performed IN (0, 1)),
  delivery TEXT NOT NULL DEFAULT 'none' CHECK (delivery IN ('none', 'in_call', 'notice', 'stdin', 'context', 'read', 'failed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((state = 'allowed') = (scope IS NOT NULL)),
  CHECK (state = 'denied' OR reason IS NULL),
  CHECK (state = 'denied' OR message IS NULL)
);
CREATE INDEX access_requests_open ON access_requests (session_id, action, target_id, state);
```

Grants live in memory (`AccessGrants`, as `SiteGrants` of the browser): a session grant (allow, or the quiet deny below) ends at `session.exited`, when the session is removed, at "Revoke", and when the app quits; a resumed session starts without grants. "Always" is not a grant: it changes the target's own setting (section "Scopes" below), where the user sees and reverses it.

Flow of one call:

1. The owner's tool handler checks the caller's folder scope and every refusal of the table first; a refusal answers a `CommandError` as today.
2. Where the target's own setting allows the action, it runs. Else the owner calls `check`: `allow` (a session grant) runs the action; `quiet_deny` answers `refused` with the app text "The user denied this request for the rest of the session; ask in the conversation if you need it"; `ask` calls `request`.
3. `request` joins the session's open request for the same action and target (for `note.change` the new proposal joins the open item), else checks the limits (at most `ACCESS_OPEN_PER_SESSION` open requests, `ACCESS_REQUESTS_PER_WINDOW` new requests per 10 minutes; `limit_reached` beyond) and posts the item: kind `approval`, urgency `high`, source `app`, origin `access:request`, `session_id`, `folder_id` the leaf's folder, `link_node_id` the target's leaf, dedupe key `access:<sessionId>:<action>:<targetId>`, `textAuthor: 'app'`, message "<session title> asks to read a note" (or "to change a note", "to remove notes", "to list and read files of a mount", "to write a file in a mount"), shortened to 140 characters, payload `{ requestId, action, targetKind, targetId }`. The message holds no note title and no path, since an agent can choose both and the message is app text that also forms the notification body; the target's title, the path and the diff appear only in the card's detail block (`AccessDetail`), as data. The session title is a leaf title that an agent in the folder can rename, so it is cleaned and shortened as every item message is (`cleanText`).
4. The call waits up to `access.waitSeconds` (default 115: the browser approvals wait 115 s, and a PTY call open at 120 s moves to a background task, P16) or until its `signal` aborts (`notifications/cancelled`, a closed response, `session.exited`; section 4.4), whichever comes first.
5. A decision while the call waits: an allow runs `perform` and the tool returns its own result (`in_call`); a deny runs `ended` and returns `{ access: 'denied', reason: 'user', message? }`, the message being the user's text.
6. No decision in time: the tool returns `{ access: 'pending', requestId, note }` with the app note "The user has not decided yet. You will be told; read the decision with access_request_result." The call state becomes `returned` (or `closed` on an abort); the item stays open.
7. A decision after the call ended: changes, writes and removals run `perform` at the decision, since the user approved the change the card showed; a read runs at the agent's first `access_request_result` after the allow, with every check again, and only once. The decision is announced through `NoticeDelivery` (section 4.4) with the fixed lines `Access request <requestId> was decided. Read it with access_request_result.` (typed into an idle PTY, or a stdin user message) and `Your access request <requestId> was decided. Read the result with access_request_result.` (`additionalContext`); neither carries agent text or content.
8. End: a pending read or removal expires (`expired`, item `superseded`) at `session.exited`; a pending change or write stays open, since the user may still take the change, and its outcome waits for a resume. Every pending request expires after `access.requestHours` (default 24). Dismissing the item is a deny without a message, as for browser approvals. A target removed while a request waits ends it `withdrawn`.
9. Quiet deny: a denied `note.read`, `mount.read` or `note.remove` refuses later requests of the same session for the same action and target, without an item, until the session ends. A change or a write is never quieted, since each carries new content.

Scopes:

| Action | Once | For this session | Always for this target |
|---|---|---|---|
| `note.read` | this read | reads of this note by this session | sets the note's observation to `on-demand` (`note_set_observation`) |
| `note.change` | the changes the card shows | these and later changes of this session to this note are applied at once, each as a revision by the agent | sets the note's `agentWrites` to `apply` (`note_set_agent_writes`) |
| `note.remove` | this removal | not offered | not offered |
| `mount.read` | this listing or read | listings and reads of this mount by this session | sets the mount's agent access to `read` (`mount_set_agent_access`) |
| `mount.write` | this write | writes of this session to files of this mount, offered only while the mount is read-write; the grant ends when the user switches the mount to read-only | not offered: agents keep no standing write right (decision C4 of 0044) |

Rules:

- Only MCP callers raise requests; the user's own commands are never asked about.
- The CLI's own permission flow (the mode, the ask rules of 0028, the inspector) decides whether a tool call starts at all; an access request is the app's second gate on its own data. Neither answers for the other, and under `bypassPermissions` requests still ask.
- `perform` checks the folder scope and every refusal again at the time it runs; a target moved out of the caller's folder ends the request `denied` with reason `scope`. A change whose base no longer applies ends `denied` with reason `stale`, a write whose file hash differs with `conflict` (0044 sections 4.6 and 4.9).
- `access_decide` and the grant commands are UI only (`mcpExempt`); the parity test asserts that no agent can answer or widen its own request. `access_request_result` answers `not_found` for a request of another session, as for an unknown id.
- `access_decide` carries the revision or file hash the card's diff was shown against; when the target moved on, the decide answers `refused` and the card shows the new diff.
- Milestone 6 builds the broker, the store, the grants, the delivery, the commands, the card and the chip, tested with a fake handler; the handlers themselves come with notes and mounts (0044). The browser approvals keep their own path (section 2).

Settings (`ProfileSettings.access`): `waitSeconds` 115 (0 to 600), `requestHours` 24.

### 5. Builder tasks

| Step | Slice | Owns | Must not edit |
|---|---|---|---|
| c-m6 (contracts) | The types and stubs of section 4: `core/hooks/types.ts`, `core/hooks/index.ts`, `core/inbox/askTypes.ts`, `core/inbox/askCommands.ts` (schemas and registration with handlers that answer "not built yet"), `core/inbox/viewTypes.ts`, `core/inbox/inboxMigrations.ts` (migration 2), `core/inbox/taskService.ts`, `core/inbox/delivery/types.ts` (`NoticeDelivery`, with an in-memory implementation), `core/summary/types.ts`, `core/access/types.ts`, `core/access/accessCommands.ts` (schemas and registration, handlers "not built yet"), `core/access/accessMigrations.ts` (module `access`, migration 1), `core/access/InMemoryAccessBroker.ts` and the contract suite `accessBrokerContract.ts`, `core/inbox/ItemContext.ts` (no session summary in `inbox_context`), `core/profile/types.ts` and `core/profile/schemas.ts` (`hooks.bashSandboxLoopback`, `access`), `core/session/types.ts` (`ReportedMode`, `MODE_RANK`, the event), `core/commands/types.ts` (`CommandContext.signal`), `core/isolation/types.ts` (`dir` and `loopbackInSandbox` on the `http` variant of `HookDelivery`), `core/mcp/HttpAppMcpServer.ts` (the pending calls by JSON-RPC id, the signal aborted on `notifications/cancelled` of the same session, a closed response, revoke and stop, with its tests), `core/mcp/mcpConfig.ts` (`timeout`), `core/events/index.ts`, `core/blocks/firstParty.ts` (`agide/tasks`), `main/context.ts` (`Desktop.onResume`), `main/modules.ts` and `main/modules/hooks.ts` (the `hooks` module in the order below, with an in-memory endpoint behind a factory), `main/modules/inbox.ts` (wiring of every service through factories that the builders fill), `main/modules/access.ts` (the `access` module with the in-memory broker behind a factory), the fake CLI `core/inbox/fixtures/fake-claude-hooks.mjs` (posting `http` hook entries and returning their replies, and a step that calls an MCP tool and waits), `renderer/panes/paneComponents.tsx`, `renderer/panes/inbox/ItemCard.tsx` (calls the stubs `AskCardActions`, `HookApprovalActions`, `TerminalDialogReminder`, `AccessRequestActions`, `ProjectSummaryEditor` and `ItemCardExtras`, the kind-independent slot that 0044 fills with "Capture as note"; drops the session summary line), the stub `renderer/panes/inbox/ItemCardExtras.tsx` (renders nothing), `renderer/panes/tree/leafDecorations.tsx` (calls the stub `SessionSummaryMark` for session leaves), `renderer/panes/TerminalPane.tsx` (calls the stub `AccessGrantsChip` in the header), the stub `renderer/panes/tasks/TaskNoteLinks.tsx` (renders nothing; 0044's i-notes fills it), the stub files of the other components these files call, at the paths of the builders that fill them (`renderer/panes/session/AccessGrantsChip.tsx`, `renderer/panes/tree/SessionSummaryMark.tsx`, `renderer/panes/inbox/AccessRequestActions.tsx`, `TerminalDialogReminder.tsx` and the others; each renders nothing), the in-memory `AskService` and the contract suites `askServiceContract.ts` and `hookEndpointContract.ts`, `docs/parity.md` | everything else |
| w-access | `core/access/**` except the contract files: `SqliteAccessBroker` (store, limits, joins, waits, expiry, the quiet deny), `AccessGrants`, the handlers of `access_request_result`, `access_decide`, `access_grants_list` and `access_grant_revoke`, the notices through `NoticeDelivery`; `main/modules/access.ts` (the real broker, after c-m6); `renderer/panes/inbox/AccessRequestActions.tsx`, `renderer/panes/session/AccessGrantsChip.tsx`; `e2e/accessRequests.spec.ts` with a fake action registered by a test hook | other modules, the contract files |
| w-hooks | `core/hooks/**` except the contract files: `HttpHookEndpoint`, `GateRecorder`, `httpHookSettings`; the hook route in `core/mcp/requestGuard.ts` and `HttpAppMcpServer.ts` (after c-m6); `core/session/hooks.ts`, `launchArgs.ts` (settings file), `PtySessionService.ts` (both deliveries); `hookDelivery` in `core/isolation/HostEnvironment.ts` and `FakeProvider.ts`, capabilities in `core/isolation/{Local,Srt,Container,Fake}Provider.ts`; `main/modules/hooks.ts` (the real endpoint) and the endpoint's wiring into the session service in `main/modules/session.ts`; `core/permissions/inspectCommand.ts` and `launchContributor.ts` (no record file under `http`); the `127.0.0.1` entry of `sandbox.network.allowedDomains` for Bash-sandbox sessions under `hooks.bashSandboxLoopback` (in the session's settings file, `core/permissions/policyBuilder.ts`), and the loopback row in `renderer/panes/settings/PermissionsSection.tsx`; their tests | other modules, the contract files |
| w-approvals | `core/hooks/approvals/**` (`HookApprovalBroker`, the terminal-dialog reminder and its resolution), `core/hooks/mode/**` (the mode rule), `core/inbox/HookItemMapper.ts` with its tests (held approvals, close signal, `SessionEnd`, `SubagentStop`, unknown types by policy, record from `GateRecorder`), `core/session/status.ts` (the close signal), the `session_set_mode` and `hook_approval_answer` handlers in `main/modules/session.ts`, the broker's registration in `main/modules/hooks.ts` (after w-hooks), `renderer/panes/inbox/HookApprovalActions.tsx`, `renderer/panes/inbox/TerminalDialogReminder.tsx`, the `ModeChip` in `renderer/panes/TerminalPane.tsx`, `e2e/hookApprovals.spec.ts` | other modules, the contract files |
| w-ask | `core/inbox/ask/**` (`SqliteAskService`), `core/inbox/delivery/**` except `types.ts` (the delivery planner that asks and access requests share), the handlers of `inbox_ask`, `inbox_ask_result`, `inbox_answer` in `askCommands.ts` (below the contract part), `renderer/panes/inbox/AskCardActions.tsx`, `e2e/inboxAsk.spec.ts`, `scripts/e2e-real-claude-ask.mjs` | other modules, the contract files |
| w-tasks-ui | `core/inbox/SqliteTaskStore.ts`, `core/inbox/taskCommands.ts`, `renderer/panes/tasks/**`, `e2e/tasksPane.spec.ts`, the `tasks` phase of `scripts/visual-check.mjs` and `scripts/lib/visual/` | other modules, the contract files |
| w-inbox-ui | `core/inbox/views/**`, `core/inbox/inboxCommands.ts`, `SqliteInboxService.ts` and `InMemoryInboxService.ts` (`purgeDone`, the new query fields), `InboxNotifier.ts` (`onClick`, the throttle exemption of the terminal-dialog reminder), `renderer/panes/InboxPane.tsx`, `renderer/panes/inbox/{useInbox.ts,format.ts,InboxViewBar.tsx,ProjectSummaryEditor.tsx}`, the folder menu entry in `renderer/panes/tree/`, `main/desktop.ts` (`onResume`), additions to `e2e/inbox.spec.ts` | other modules, the contract files |
| w-summary (last, can move) | `core/summary/**` except `types.ts` (the generator, the staleness counters, the `session_summarize` and `session_summary_get` handlers), `renderer/panes/tree/SessionSummaryMark.tsx`, the "Summarize" action in the session bar of `renderer/panes/TerminalPane.tsx` (after w-approvals' `ModeChip` there), `scripts/e2e-real-claude-summary.mjs` | other modules, the contract files |

Order:

1. c-m6, then its review. It starts after the last hardening pass of the confined check (the ninth, which the user's answer A1 of 2026-11-26 added) and its review end, since that pass edits `core/isolation`, `core/review` and `main/modules/session.ts`.
2. w-hooks, w-access, w-ask, w-tasks-ui and w-inbox-ui in parallel; each gets a review when it finishes. w-ask builds against the in-memory endpoint and the fake CLI of c-m6; its `UserPromptSubmit` path is a `HookReplyContributor` that w-hooks' endpoint calls. w-access builds against the in-memory `NoticeDelivery` of c-m6 and a fake action handler; the integration wires w-ask's planner. Of the parallel builders only w-hooks edits `main/modules/session.ts`, and w-approvals edits it after w-hooks.
3. w-approvals after w-hooks (it needs the held requests and the record), with its review; w-summary beside it, and after w-approvals for `TerminalPane.tsx`.
4. Integration: the real module graph, the parity table (`docs/parity.md`), the mutation targets of section 6 in `scripts/mutation-checks.mjs`, the real-Claude scripts, then the combined review, the verification and the fix steps until a review finds no major (0042 recommendation).

The notes and mounts work of 0044 follows: its contracts step c-notes starts after c-m6 (both edit `main/context.ts`, `core/events/index.ts`, `docs/parity.md`), its builders use the in-memory broker of c-m6, and its integration i-notes waits for w-access (the real broker) and w-tasks-ui (the `TaskNoteLinks` call in the tasks pane).

Module initialization order: `hooks` becomes a module after `mcp` and before `session` (it registers its route on the MCP server and gives the session module the endpoint); the inbox module stays after session and receives the endpoint, the broker and the `GateRecorder` through its deps; `access` follows `inbox` (its items and its store's reference) and is handed to the modules that register actions (notes and mounts of 0044, which come last); the rest of the order of 0041 is unchanged.

### 6. Test plan

- **Contract suites** (`pnpm test`): `describeAskServiceContract` (in memory now; SQLite by w-ask), `describeHookEndpointContract` (in memory now; HTTP by w-hooks) and `describeAccessBrokerContract` (in memory now; SQLite by w-access, with a fake action handler): a request joins the open one of the same session, action and target; the open and window limits; an allow in the call returns the handler's result; a deny returns `denied` with the user's message; the wait ends with `pending` at `waitSeconds` (fake clock) and `closed` on abort; a later allow of a change runs `perform` at the decision, a later allow of a read runs it at the first `result` and only once; the session grant allows the next call without an item and ends at `session.exited` and at revoke; "always" calls `applyAlways` and adds no grant; the quiet deny for reads and removals and none for changes and writes; dismissing the item denies; expiry after `requestHours`; reads and removals expire at session exit while changes stay; `result` of another session answers `not_found`; `perform` refusing with `scope`, `stale` and `conflict`; `decide` with an `expected` revision that moved on answers `refused`. The inbox store contract grows by `purgeDone`, `sources` and `text`.
- **Unit, reminder and loopback**: the terminal-dialog reminder posted once per session at the expiry (fake clock), updated by a second expiry, resolved by each event of section 4.2 and not by an unrelated `PostToolUse`, and notified although the session notified within the minute before; `inbox_open_item` of a `focusLink` item focuses the linked node; the `127.0.0.1` entry written for a Bash-sandbox session with the setting on, absent with it off (and the session then on `inbox-dir`), absent for a session without the Bash sandbox; the user's own `sandbox.enabled` detected from the settings the CLI loads. Summaries: `inbox_context` holds no session summary, no summary run posts an inbox item, the daily cap, the stale mark.
- **Unit**: the hook route (path, token, wrong session, `Origin`, `Host`, size, unknown event, arrival order, the reply wait of `UserPromptSubmit`); the settings file holds the token and the arguments hold none (a test reads the argument list); `GateRecorder` against the inspector table; the broker (answer, first answer wins, close, expiry reply `{}`, no answer after close); the mode rule over every pair of `MODE_RANK`, `inbox-dir` ignored, the `bypassPermissions` alert; `inbox_ask` (schema errors, scope of `link.nodeId`, the open-ask limit, answered in the call, `timeout` before the effective limit with a fake clock, `closed` on abort, `dismissed`, `queued`, `inbox_ask_result` of another session answers `not_found`, each delivery row of section 4.4 with a fake session service, the context frame); task delete, move and renumbering, reminder update with a new `next_due_at`, enable and disable; `purgeDone` keeps open items and asks of open items; the scheduler ticks on resume; the notifier sets `onClick`; views filter and sort; migration 2 over a milestone 5 database file.
- **Real module graph** (`main/modules/*.test.ts`): the parity table has no missing row; an agent session lists `inbox_ask`, `inbox_ask_result` and `access_request_result` and not the exempt commands (`access_decide`, the grant commands, `session_summarize`).
- **e2e with hidden windows** (`AGIDE_HIDDEN=1`, fake `claude`): a held `PermissionRequest` answered Allow and Deny from the card reaches the fake CLI's hook reply; a terminal answer first leaves the card without buttons; an ask answered in the call, an ask answered after `wait: false` with the notice typed into the fake PTY and read through the tool, an answer queued while busy delivered as context; the tasks pane (create, due chip, done, reorder, delete, reminder dialog with a preset and a custom RRULE error); saved views and a folder-scoped pane; a notification click (the quiet desktop's recorded `onClick`) opens the item; agent text in an ask (option labels with markup, ANSI, bidi overrides) shows literally; a held approval left to expire (a lowered wait) posts the reminder, whose "Open terminal" focuses the session, and the fake CLI's next `PostToolUse` resolves it; an access request of the fake action answered with each scope from the card, the session grant shown in the header chip and revoked there, and a decision after the call returned announced by the notice typed into the fake PTY; a session row in the tree shows the summary mark after "Summarize" (a fake summarizer) and the inbox card shows no summary.
- **Mutation targets** (`scripts/mutation-checks.mjs`): the hook token check dropped; the hook path session ignored in favour of `session_id` of the payload; a held approval answered after `closed`; the expiry reply turned into an allow; a reported higher mode stored; `inbox-dir` payloads accepted as a mode source; the typed notice built from agent text; `inbox_ask_result` without the session check; the open-ask limit; the `signal` not passed; `notifications/cancelled` of another session aborting a call; `notifications/cancelled` ignored; `task_delete` of another session's task by an agent; the agent schedule limit; retention deleting open items; the reminder not posted at the expiry; `access_decide` callable by a session; a session grant of one session honoured for another; a session grant surviving `session.exited`; an allowed read after the call returned run twice; `perform` without the second scope check; "always" adding a grant without changing the target's setting; the quiet deny applied to changes; the notice of an access decision built from agent text; `access_request_result` without the session check; the open-request limit; `127.0.0.1` written with `bashSandboxLoopback` off; a summary posted as an inbox item.
- **Real Claude** (scripts outside `pnpm test`, the rules of the task brief): `scripts/e2e-real-claude-ask.mjs` (a PTY session and a stream-json session each ask with options; the script answers through `inbox_answer` once in the call and once after `wait: false`; the session receives the answer), a held `PermissionRequest` answered from the card in a PTY session (in the same script), a PTY session with the CLI's Bash sandbox on and the loopback entry whose `PermissionRequest` reaches the app and whose mode is reported (in the same script; it also shows whether `allowedDomains` of the settings file merges with the user's list), `scripts/e2e-real-claude-summary.mjs`. Haiku, `--max-budget-usd 0.25` per call, at most 3 processes, a few cents in total.

### 7. Security

| Threat | Rule | Test |
|---|---|---|
| Agent-written text (questions, details, option labels, tool inputs, summaries) carries markup, links, escape sequences or bidi overrides | plain text only: React text nodes, `cleanText` at the store, length limits in zod and SQL; the grep test extends to `renderer/panes/tasks`, the new card components and `renderer/panes/tree/SessionSummaryMark.tsx` | e2e literal text test; `plainText.test.ts` roots |
| Answer delivery types agent text into a terminal | only the fixed notice line made by the app with the app's item id is typed; answers travel as tool results or `additionalContext`; the option id in the context frame is limited to `[a-z0-9_-]` | unit test of the notice; mutation "notice from agent text" |
| An option button starts an action | an option returns its id to the asking session and does nothing else (0021 section 9) | unit test of `answer` |
| A forged hook payload changes status, items or the mode (file dropped into the hook directory) | with `http`, only requests with the session's hook token count; `inbox-dir` payloads never change the mode | route tests; mutation "token check dropped" |
| A same-user agent reads the settings file and posts forged hooks with the token (it can reach the listener wherever the CLI can: under `srt` the same `allowLocalBinding` serves both, P45) | the mode rule only lowers; the payload's `session_id` must match the token's session; the inspector decides in the CLI, the app's record is recomputed from the payload, so a forged record cannot relabel a call; a forged `PermissionRequest` opens a card whose answer goes back to the forger only; the settings file is removed after start if the probe allows; the limit of 0013 stands (an agent that runs as the user can also open the app database) | mode rule tests; the setup pane text of 0024 |
| The hook token leaks through `ps` or the environment | the token is only in the 0600 settings file; arguments and environment hold none (an `allowedEnvVars` variable reaches the agent's commands, P45) | unit test over the argument list and the environment |
| Opening loopback for hooks under the CLI's Bash sandbox lets sandboxed commands reach every local service | accepted by the user (B8) for profiles with `hooks.bashSandboxLoopback` on, the default: the launch adds `127.0.0.1` to `sandbox.network.allowedDomains`; the setting is shown per profile with the risk text and per session in the mode chip; off keeps `inbox-dir`; per-port loopback is the later hardening (section 4.1). Accepted risk, concretely: a sandboxed command of the agent can open a TCP connection to any port on 127.0.0.1 (through the sandbox's network proxy at least; whether a direct connect is also let through was not measured), so it reaches every service that listens there, not only the app. That includes databases and caches that trust local callers without a password, development servers and their admin endpoints, the debugging port of a browser or an Electron app started with remote debugging (control of that browser and its signed-in sessions), a Docker daemon that listens on TCP, local model servers, and every SSH tunnel and `kubectl port-forward` the user has open, which carry the connection on to a remote database or cluster with the user's rights. A local forward proxy on loopback lets sandboxed commands reach hosts outside the profile's allow list. The app's own MCP and hook listeners stay behind their tokens. The same exposure exists without the Bash sandbox (an unsandboxed command reaches loopback anyway) and under `srt` with `allowLocalBinding` (0029, 0040 section 6); the Bash sandbox profile loses its loopback protection only | unit test of the entry per profile setting and per session; the real-CLI script's Bash-sandbox case |
| An agent answers, widens or reuses its own access request | `access_decide` and the grant commands are `mcpExempt`; a grant is keyed by session, action and target and ends with the session; "always" goes through the owner's UI command, which an agent cannot call; an allowed read runs once | parity test; contract suite; mutations |
| An access request lifts a hard limit (a path outside the mount, a hidden file, a credential location, another folder) | the owner checks every refusal of section 4.10 before it raises a request and again in `perform`; those refusals never raise one | owner tests (0044); mutation "`perform` without the second check" |
| An access request's card shows agent text as the app's | the message and the title line are fixed app text with the session title (cleaned) and no target title or path; target titles, paths and diffs appear only in the detail block, as plain text with control and bidirectional characters escaped; nothing renders as Markdown or HTML | e2e literal text test |
| An agent floods the inbox with access requests | joins per session, action and target; at most 5 open and 20 new per 10 minutes per session; the quiet deny for repeated reads and removals | contract suite |
| The decision notice types agent text into a terminal | the notice and context lines hold the app's request id only | unit test; mutation |
| A summary (model text made from a transcript the agent wrote) carries markup, links or escape sequences into the tree | plain text in the tooltip and the popover, at most 400 characters; never an inbox item or a notification (B6) | the grep test covers `renderer/panes/tree/SessionSummaryMark.tsx`; unit test that no summary posts an item |
| A failed receiver blocks or grants | no entry sets `onFailure: "block"`; a failure leaves the decision to the TUI dialog and the command inspector (P45: default fail open, confirmed) | unit test of the generated entries |
| A hook token calls MCP tools, or an MCP token posts hooks | separate tokens and routes | route tests |
| A browser page or another local process posts to the hook route | `Origin` refused, `Host` checked, bearer token | route tests (as for MCP) |
| An agent answers its own permission request or question | `hook_approval_answer` and `inbox_answer` are exempt from MCP; the parity test asserts they are not tools | module test |
| The app answers an approval without the user | the only replies are the user's answer and `{}` at the limit; no default allow or deny | mutation "expiry becomes allow" |
| An ask floods the inbox or keeps calls open | at most 3 open asks per session; asks count towards the post rate; the effective limit ends each call | unit tests |
| `inbox_ask_result` reads another session's answer | the ask's session must be the caller's session | unit test; mutation |
| An agent deletes or moves the user's tasks | agents delete only their own tasks; moves stay within the caller's folder scope | unit tests; mutation |
| A summary run gets tools, writes transcripts or trust entries | no tools, no session persistence, hooks off, empty directory, explicit environment through `HostTools`; checked by the real script | `e2e-real-claude-summary.mjs` |

### 8. Estimates

In 0005 units (working days for one engineer plus agents), low to medium confidence:

| Part | Days as proposed | Days after the user's decisions | What changed |
|---|---|---|---|
| c-m6 contracts | 0.5 | 0.75 | the access types, migration, in-memory broker and contract suite; `NoticeDelivery`; the slots `ItemCardExtras`, `SessionSummaryMark`, `AccessGrantsChip`, `TaskNoteLinks` |
| w-hooks | 1.5 to 2 | 1.75 to 2.25 | the loopback entry for Bash-sandbox sessions, the profile row, the real-CLI check of the `allowedDomains` merge |
| w-approvals | 1 to 1.5 | 1.25 to 1.75 | the terminal-dialog reminder and its resolution |
| w-access | | 1.5 to 2 | new: the access broker, grants, card, chip, commands, e2e |
| w-ask | 1.5 to 2 | 1.5 to 2 | the delivery planner becomes shared; no new work |
| w-tasks-ui | 1.5 to 2 | 1.5 to 2 | |
| w-inbox-ui | 1 to 1.5 | 1 to 1.5 | |
| w-summary | 0.5 to 1 | 0.5 to 1 | the mark on the tree row in place of the card line |
| Total | 7.5 to 10.5 | 9.75 to 13.25 | |

Without the access requests, which serve the notes and mounts of 0044 as much as R21, the R21 part is 8.25 to 11.25 days; the remainder of the R21 estimate was 6 to 11 (10 to 15 days in 0016 and 0021, of which 0024 judged about 4 built), so R21 grows by the reminder and the loopback work. At the milestone 5 rate (about 77 build minutes per estimated day, 0042) the milestone is about 750 to 1,020 summed agent minutes for the build steps (was 580 to 810); at the milestone 4 rate (about 32), about 310 to 420 (was 240 to 340).

### 9. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The CLI's `http` hook behaviour changes in a later release (P45 shows already that `SessionStart` posts nothing over `http` and that the Bash sandbox gates loopback, both against the documentation) | approvals from the card or the close signal stop working | the P45 script is re-run on each CLI upgrade with the mapper fixtures; `inbox-dir` stays as a fallback per profile; `PostToolUse` and `Stop` resolve approvals without the close signal |
| The CLI rereads `--settings` and the removed file drops the hooks | hooks stop after start | keep the file when the probe shows it; the token stays in a 0600 file either way |
| The MCP call limits change, or a background task loses the result when the session ends (P16 shows the background task; its end with the session is documented, not measured) | answers in the call fail | the notice path delivers every answer that the call did not; asks are closed on `session.exited` |
| The model does not call `inbox_ask_result` after the notice | answers not read | the notice names the tool and the id; the real script checks Haiku; the card shows "not read yet" |
| Builders of w-hooks and the hardening pass edit the same files | conflicts | w-hooks starts after the pass ends (order step 1) |
| The user's own settings turn the Bash sandbox on for an `http` session | without the loopback entry every hook to loopback asks for `SandboxNetworkAccess` (P45 in `-p`; the TUI dialog for it was not seen) or fails open with a 403 | the launch reads `sandbox.enabled` from the settings the CLI loads and treats the session as a Bash-sandbox session: the loopback entry with the profile's setting on, `inbox-dir` with it off (section 4.1) |
| The `allowedDomains` of the session's settings file replaces the user's own list in place of adding to it | the user's allowed hosts stop working in Bash-sandbox sessions, or the loopback entry is lost | the w-hooks real-CLI test shows which; the launch copies the user's entries into the file when the file replaces them |
| Loopback stays open to sandboxed commands in every Bash-sandbox profile (B8) | an agent's command reaches local services, tunnels and port forwards (section 7) | the switch per profile with the risk text; per-port loopback as soon as a probe shows the CLI's sandbox honours `127.0.0.1:<port>` |
| Access requests turn into noise (an agent asks for every note it meets) | the user stops reading the inbox | joins per target, limits per session, the quiet deny for reads and removals, "Allow always" in one click, and a default observation of `on-demand` (0044) |
| An agent does not call `access_request_result` after the notice | a granted read is never used | the notice names the tool and the id; the pending result says so; changes and writes apply at the decision without the agent |
| UI scope grows (tasks pane, dialogs, views) | the milestone runs long | w-summary and the views can move to the next milestone without blocking the rest |
| Contracts in `main/modules/inbox.ts` wire services that do not exist yet | a stub reaches the e2e run | factories with in-memory implementations behind them until each builder lands |

### 10. Probe results

`notes/probes-m6-r21.md` (P16 and P45, CLI 2.1.332, macOS, one run per case unless the notes say otherwise) is complete; the decisions above cite it. What it settled and what stays open:

| Decision | Probe result | State |
|---|---|---|
| App MCP entry `timeout` and the effective limit of `inbox_ask` (section 4.4) | P16: a silent JSON call ends at 60 s without the entry; an entry `timeout` of 600,000 ms held 65, 130 and 310 s calls in `-p` and 150 s in the PTY; the entry `timeout` is a hard wall-clock limit that progress does not move; the idle window (300 s) applies to an open SSE stream without progress. The review of this record ran one more `-p` case on 2.1.332: an entry `timeout` of 3,660,000 ms held a silent JSON call of 620 s to its answer | settled: `APP_MCP_TIMEOUT_MS` = 3,660,000, JSON replies, no progress; calls longer than 620 s were not run |
| How the app learns that a call ended (section 4.4) | P16: an interrupt, an Esc and a wall-clock timeout send `notifications/cancelled` with the request id on a new request; after an interrupt or an Esc the original connection stays open (a wall-clock timeout above 60 s closed it together with the cancel); a late reply is harmless | settled: the signal follows `notifications/cancelled`; the connection close is a secondary signal |
| Move to a background task (section 3, section 4.4) | P16: PTY calls move at 120 s and the answer arrives as a `<task-notification>` turn; `-p` calls never move; `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` keeps the call in the foreground | settled: keep the default move |
| Multi-line text in the TUI (section 3) | P16: line feeds then Enter, or a bracketed paste then Enter, submit one multi-line prompt | settled; the notice line makes it unused by `inbox_ask` |
| Hook approvals from the card (section 4.2) | P45: a held `PermissionRequest` replied with `allow` runs the tool with the dialog on screen and no key; `deny` with a message reaches the model as the tool error; holds of 150 s (TUI) and 330 s (`-p`) worked | settled up to 330 s; a hold of the default 15 minutes is open (a w-hooks test against the real CLI) |
| Close signal (section 4.2) | P45: the CLI closes the held request at an Esc and at the entry `timeout` (the dialog stays); an Enter left the request open | settled: Esc and timeout close; Enter resolves through `PostToolUse` |
| Failure of the receiver (section 4.1) | P45: refused connection, 500, plain text, invalid JSON and a slow reply are non-blocking; `onFailure: "block"` turns them into a deny | settled: no `onFailure` |
| Token placement (section 4.1) | P45: a literal header in a settings file passed by path shows in no argument list; an `allowedEnvVars` variable reaches the agent's commands | settled: literal header in the 0600 file |
| Hooks under a sandbox (section 4.1) | P45: under `srt` delivered with `allowLocalBinding` only; under the CLI's Bash sandbox refused (403) unless `127.0.0.1` is allowed | settled; for Bash-sandbox profiles the user allowed `127.0.0.1` (B8, section 4.1); the port form under the CLI's own sandbox is not probed |
| `SessionStart` and `SessionEnd` over `http` (section 4.1) | P45: an `http` `SessionStart` posted nothing; `SessionEnd` posted in the TUI about 1.7 s after `/exit` and was not measured in `-p` | settled: both stay command hooks |
| `additionalContext` in the `UserPromptSubmit` reply (section 4.4) | P45: the model repeated a word given only in the reply's `additionalContext`, in `-p` and in the TUI | settled: `context` delivery is on for `http` sessions |
| Removing the settings file after start (section 4.1) | not measured | open: a w-hooks test against the real CLI |
| The CLI closing open MCP or hook requests at exit; the 600 s default of an `http` hook held to its end; `SubagentStop`, `Elicitation`, `PostToolUseFailure` payloads; the container provider; Linux | not measured (the notes' "Not verified") | open; the app closes asks on `session.exited` itself and sets every hook `timeout` explicitly |

### 11. Questions for the user

The user answered these questions on 2026-11-26 (the decision page numbered them B1 to B8); section 12 holds the answers. They stay here as asked.

1. Do you confirm 0021 as the R21 design with the amendments of 0024, 0037, 0040 and section 3 of this record? Recommendation: yes, and set 0021 to accepted after the milestone 6 results.
2. Scope: agent-run schedules, elicitation forms, edit-and-allow and per-project policies wait (section 2). Recommendation: keep them out of milestone 6; run P17 before the elicitation forms.
3. After a question's call has returned, the app types only "Inbox answer ready for question <id>. Read it with inbox_ask_result." and the agent fetches the answer. Recommendation: yes; it never types agent text or multi-line text into a terminal.
4. A mode reported by a session may lower the mode of its next launch but never raise it; you raise it from the session header. Recommendation: yes.
5. Hook approvals from the card wait at most 15 minutes, then the decision returns to the terminal dialog (no automatic allow or deny). Recommendation: yes, with the minutes as a setting.
6. Session summaries by Haiku on request only, at most 50 a day, on your subscription. Recommendation: build it as the last step; it can move to the next milestone.
7. The `http` hook transport becomes the default for every provider, with the file transport kept as a fallback for one milestone, and for the Bash-sandbox sessions of question 8 as long as they need it. Recommendation: yes. Status: answered yes; with the answer to question 8 the file transport serves a Bash-sandbox profile only when its loopback switch is off.
8. Under the Bash sandbox of the CLI, a hook reaches the app only when `127.0.0.1` is an allowed host, which also lets the agent's sandboxed commands reach every local service (P45). Should profiles with the Bash sandbox on keep the file transport (no approvals from the card, no mode source), or allow loopback? Recommendation: keep the file transport for them until a port-limited allowance exists. Status: answered on 2026-11-26 against the recommendation: allow loopback (section 12, B8); section 4.1 and section 7 carry the change.

### 12. Decisions of the user

The user answered on a decision page on 2026-11-26. The page also asked about the hardening of the confined check (A1): the user chose one more fix round and one commit for everything, so c-m6 starts after that ninth pass (section 5).

| Question | Answer | Differs from the recommendation |
|---|---|---|
| B1: confirm 0021 with the amendments | confirmed with the listed changes | no |
| B2: leave agent-run schedules, elicitation forms, edit-and-allow and per-project policies out | left out | no |
| B3: after a call ended, type one fixed line and let the agent fetch the answer with `inbox_ask_result` | yes | no |
| B4: a reported mode may only lower the next launch's mode | yes | no |
| B5: hold a hook approval 15 minutes, then hand the decision back to the terminal | yes, with a reminder to answer in that terminal | no, with an addition (amendment 1) |
| B6: session summaries as the last step, may slip | yes, but on the session's row in the tree, not in the inbox | no, with a change (amendment 2) |
| B7: the `http` hook transport as the default for every launch, files as the fallback for one milestone | yes | no |
| B8: profiles with the CLI's Bash sandbox: keep the file transport or allow `127.0.0.1` | allow `127.0.0.1` | yes: the recommendation was to keep the file transport |

Amendments, each a decision of this record:

1. Reminder when a held approval goes back to the terminal (B5). The user: "the decision can go back to the terminal but I should have a reminder that I should open that terminal and answer the question there." At the end of the wait the app posts one `input` item per session with a notification; it names the session, says that a permission dialog waits in its terminal, and opens that terminal on a click; it resolves when the session goes on (section 4.2). Reason: a decision handed back silently is easy to miss, and the session stalls until the user answers.
2. Session summaries on the tree row (B6). The user: "what's the use of having that in the inbox? It does not need my input. It could be some sort of indicator in the tree, close to the session (or on the session somehow)." Summaries are never inbox items and not part of the card or its header; a mark on the session's row shows them, generated on request by the small model with the cap of 50 a day, built last (sections 3, 4.7, 4.9). Reason: the inbox holds what needs the user.
3. Loopback for hooks under the CLI's Bash sandbox (B8). The launch adds `127.0.0.1` to the sandbox's allowed hosts for such profiles, so hooks, approvals from the card and the mode source work there; the setting is visible and can be turned off per profile; the accepted risk is stated in section 7; per-port loopback is the later hardening (sections 2, 3, 4.1, 7, 9, 10). Reason: the user's choice; approvals from the card in every profile.
4. Access requests (the user's principle: "agents should have the ability to ask for permission to mutate notes and files and whatnot. Not just plain deny but user can give access."). One mechanism: a call that a policy the user may lift refuses raises an approval item with Allow once, for this session, always for this target, or Deny with a message; the call waits up to 115 s and then returns a request id; a later decision is announced as `inbox_ask` answers are; hard limits stay refusals (section 4.10, builder w-access, tests, security rows). It lives here because this milestone owns approvals and the delivery of `inbox_ask`; 0044 registers the note and mount actions. Reason: the user's principle, with one card, one grant model and one delivery for every such case.

Other changes that follow: c-m6 starts after the ninth hardening pass (A1); c-m6 adds the kind-independent card slot and the task-notes slot that 0044 section 4.15 asked for, so 0044's integration edits no file of this record's builders.

### 13. Open questions for the user

**Decided 2026-11-27 (record 0046).** An independent agent decided the open questions below while the user was away; the decisions and the text changes that follow from them are in `0046-decisions-while-the-user-was-away.md`, which the user reviews. The contract step applies those changes to this record.


1. Per-port loopback: should the w-hooks real-CLI test also try `127.0.0.1:<port>` of the app's listener in the CLI's own sandbox (a few cents), and the launch write that narrower form from the start if it works? Recommendation: yes; it would shrink the accepted risk of B8 to the app's own listener at no cost to the user.
2. "Allow for this session" ends when the session's process exits, so a resumed session asks again. Recommendation: yes; a grant that outlives the process would need its own store and an end the user can see, and asking again once after a resume is cheap.
3. A target setting that refuses every agent request without an item (a "never ask" per note or mount) beyond the per-session quiet deny: now or later? Recommendation: later, if the quiet deny and the limits prove too noisy in use.

## Consequences

- R21 is complete after milestone 6 except the parts that wait for P17, the apps milestone, the slot counter and the transcript surface (section 2).
- The access broker of section 4.10 is the one place where an agent asks for access that a policy the user may lift denies; 0044 registers its note and mount actions on it, and later owners (apps of 0033) can do the same.
- Profiles with the CLI's Bash sandbox open `127.0.0.1` to sandboxed commands by default (B8); the per-profile switch turns it off.
- The hook path changes for every session: hooks post to the app's listener, the settings move into a 0600 file, and the inspector's record comes from the app. `HookInbox` stays for the `inbox-dir` fallback and for the `SessionStart` and `SessionEnd` command hooks.
- `CommandContext` gains `signal`, a contract change under 0013 and 0029 that the contracts step applies; `docs/parity.md` gains the exempt rows of section 4.8 and the inbox and task commands with UI bindings.
- 0021 is amended as section 3 lists; 0022's hook transport rules hold with the settings file of section 4.1; 0028's inspector record moves into the app under `http`; 0030's open items "mode reported by payloads", "hook approvals answered only in the TUI" and "`inbox_ask`" close when the milestone passes.
- Not verified: the rows of section 10 marked open; the `http` hook type in the container and under `srt` with a real app (P45 used a probe receiver); Electron's `powerMonitor` `resume` after a real sleep; real notifications under Focus modes; that Haiku reads an answer through `inbox_ask_result` after the notice; whether the CLI merges `allowedDomains` of the settings file with the user's own list; whether a sandboxed command reaches loopback by a direct connect or only through the sandbox's proxy once `127.0.0.1` is allowed; the port form under the CLI's own sandbox; whether the CLI's own sandbox, like srt in the credential proxy probe (`notes/probes-m6-credential-proxy.md`: `localhost` names passed with no loopback entry, the IP literal only with `127.0.0.1:<port>`), already lets `localhost` names through, in which case the Bash sandbox held less loopback protection than section 7 assumes; that Haiku calls `access_request_result` after the access notice; whether a `PreToolUse` of a parallel tool call of the same turn can arrive while a permission dialog still waits, which would close the terminal-dialog reminder early.
