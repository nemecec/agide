# 0043 Milestone 6 architecture and contracts

Status: proposed
Date: 2026-11-26
Proposed by: spike agents (design run `r21-design`), pending an independent review and the user's confirmation
Inputs: 0003, 0005, 0006, 0013, 0015, 0016, 0021 (with the amendments of 0023, 0024, 0037 and 0040), 0022, 0024, 0028, 0029, 0030, 0033, 0034, 0035, 0036, 0038, 0039, 0040, 0041, 0042; `probes/RESULTS.md`, `notes/probes-m2.md` (P11 to P15), `notes/probes-m6-r21.md` (P16, the MCP call wait, and P45, the `http` hook type; run in parallel with this record, see "Probe results"); the code in `app/src/core/inbox`, `app/src/core/mcp`, `app/src/core/session` (`hooks.ts`, `status.ts`, `types.ts`, `PtySessionService.ts`), `app/src/core/permissions` (`inspector.ts`, `inspectCommand.ts`, `launchContributor.ts`), `app/src/core/isolation/types.ts`, `app/src/core/commands/types.ts`, `app/src/main/modules/inbox.ts`, `app/src/main/desktop.ts`, `app/src/renderer/panes/InboxPane.tsx`, `app/src/renderer/panes/inbox/*`, `app/e2e/inbox.spec.ts`

## Context

Milestone 6 builds the parts of R21 (0016, design 0021) that milestone 2 left out, as 0039 and 0042 recommend: a tasks pane, `inbox_ask` with the MCP call wait of P16, the reminder parts of 0021 that are not built, and the `http` hook transport of 0030 recommendation 1, which brings approvals of hook requests from the inbox card and a mode source the agent cannot write. 0021 is still `proposed`; the build of milestone 2 followed it with the amendments of 0024, and 0037 and 0040 added stream-json approvals, swarm alerts and review items.

Milestones 3 to 5 each had a design record and then a contracts record. R21 already has its design (0021), so this record covers the design changes and the contracts of the remaining parts: it audits 0021 against the code, decides the scope, amends 0021 where the build or the probes require it, and fixes the contracts, the builder split, the tests and the security rules. The contracts step of the build writes the types and stubs named here into the code, as 0041 did.

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
| `http` hook transport for every hook event except `SessionStart` and `SessionEnd`, all providers, `inbox-dir` kept as a fallback | yes | |
| The app recomputes the inspector's record from the `PreToolUse` payload; no record file | yes | |
| Approvals of PTY `PermissionRequest` hooks from the inbox card (allow once, deny with an optional message) | yes | |
| Mode source: the reported mode from authenticated hook requests, the monotone rule of section 4.3, the mode chip | yes | |
| Waiting state cleared after a refusal in the TUI, from the closed hook request | yes (P45: the CLI closes a held request at an Esc) | |
| `inbox_ask`, `inbox_ask_result`, answer delivery in PTY and stream-json sessions | yes | |
| Tasks pane, task delete and reorder, reminder editing, enabling and the reminder list in the pane | yes | |
| `powerMonitor` wake, retention, notification click to the item, Enter in the list | yes | |
| Saved views, the pane's folder scope, grouping by project, "Open inbox for this folder" | yes | |
| Project summary editing in the card | yes | |
| `SessionEnd` failure items, `SubagentStop` items for swarm agents and by policy, unknown `Notification` types by policy (off) | yes | |
| Session summaries by the small model, on request only | yes, last builder; can move to the next milestone without blocking anything | |
| Elicitation forms in the card (`Elicitation` hook that waits for the user) | no | P17 (a waiting `Elicitation` hook and URL mode) |
| Edit and allow (`updatedInput`) and "Always" (`updatedPermissions`) on hook approvals | no | apps (0033), where outward drafts multiply; the real check of `updatedPermissions` of 0039 |
| Agent-run schedules | no | one slot counter for the swarm manager and `task_start` (0042 item 4) |
| Per-project policies, quiet hours, notification body setting | no | after the milestone; the app default applies |
| Transcript peek at the anchor, back stack, `MountOptions` peek mode | no | the transcript viewer of 0009 as a surface; notes (0034) bring the editor surface, so the peek mode is designed once for both |
| Interrupt line read from the transcript | no | covered for approvals by the closed hook request; a transcript tail reader comes with the transcript surface |
| Mirror of the agent's own to-do list | no | 0009 agent nodes |
| Outward-action drafts, external reference index | no | apps (0033) |
| Notes as task descriptions | no | notes (0034): the task's `notes` field stays plain text; the notes run (record 0044) may give it the editor |
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
| Section 3: `PermissionRequest` answered from the card waits for the `http` transport; the hook's timeout is set above the longest wait the app allows | The app waits at most `hooks.approvalWaitMinutes` (default 15), then replies with no decision, which returns the decision to the TUI dialog (P14). The hook entry's `timeout` is that wait plus 60 seconds | No default allow or deny ever comes from the app |
| Section 3: the interrupt line resolves open approvals | For a `PermissionRequest` that waits for the app, the closing of the hook request without an answer from the app resolves the item `superseded` and clears `waiting` | Esc fires no `Stop` (P14); the CLI closes the held request at an Esc (P45) |
| Section 3: hooks reach the app through one transport | `SessionStart` and `SessionEnd` stay command hooks that write into the hook directory; every other event uses `http` | P45: an `http` `SessionStart` hook posted nothing; `SessionEnd` over `http` posted in the TUI and was not measured in `-p`, which the stream-json sessions use |
| Section 3 (amended by 0028): the inspector's record arrives in the `PreToolUse` payload file | With the `http` transport the command inspector only decides; the app computes the record from the `PreToolUse` payload it received over `http`, with the same `ToolCallInspector` and the gate policy it holds in memory | No record travels through a directory the agent can write |
| Section 5: session summaries generated when a card needs them | Generated on request only (a "Summarize" button in the card and the session header), with a daily cap of 50 | Real model calls run on the user's subscription; no call starts without a click |
| Section 6: the pane property `viewId` | The pane config is `{ viewId?: string; folderId?: string }`; `folderId` scopes the built-in views, and a stored view carries its own folder | The folder context menu opens a scoped pane without storing a view |
| Section 7: agent-run schedules | Waits (section 2) | |
| Section 8: a mode change reported by payloads | A reported mode may lower the stored mode of the next launch; it never stores a mode above the current launch's mode (section 4.3) | A forged payload cannot widen the next launch |
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
- `IsolationProvider.capabilities.hookTransports` lists `http` for `local`, `srt` and `container` (the container reaches the host as `host.docker.internal` with the grant's host header, as the MCP endpoint does). Under `srt` the hook needs `allowLocalBinding`, which the provider already sets for the MCP endpoint (P45: refused without it, delivered with it). Under the CLI's own Bash sandbox (`sandbox.enabled`) the hook request to loopback is refused with a 403 unless `127.0.0.1` is in `sandbox.network.allowedDomains` (P45), and adding it opens loopback to the agent's sandboxed commands as well; profiles with the Bash sandbox on keep `inbox-dir` (question 8). A session whose hooks cannot reach the app shows "no mode source" in its header. `hookDelivery` (implemented once in `core/isolation/HostEnvironment.ts`, and in `FakeProvider`) returns `{ kind: 'http', url, token, dir }` when the profile setting `hooks.transport` is `http` (default in milestone 6) and `inbox-dir` otherwise; the `http` variant of `HookDelivery` (`core/isolation/types.ts`) gains `dir`, the hook directory of the `SessionStart` and `SessionEnd` command hooks. `PtySessionService` accepts both; under `http` the `HookEndpoint` takes every event except those two, which `HookInbox` still reads.
- The Bash sandbox can also come from the user's own settings, which every launch loads (`--setting-sources user`). The launch reads `sandbox.enabled` from the settings the CLI will load and treats a session with it on as a Bash-sandbox session.
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

- The broker holds the `PermissionRequest` request of a PTY session open until the user answers on the card, the request closes, or `hooks.approvalWaitMinutes` passes. At the limit it replies `{}` (no decision): the TUI dialog decides (P14; P45 showed the dialog on screen during the hold, the tool running after an allow from the receiver with no key pressed, and the dialog staying after the entry `timeout` closed the request). Stream-json sessions keep `can_use_tool` (0037).
- The first answer wins (P14). The approval ends on the first of: the matching `PostToolUse`, `Stop`, the request's `signal` (the CLI closes the request at an Esc on the dialog and at the entry `timeout`, P45), and an answer from the card. An Enter in the terminal leaves the request open (P45: no close seen), so that case resolves on the `PostToolUse` that follows. The entry `timeout` is 60 seconds longer than the broker's own wait, so a close before the broker replied comes from the terminal. On a close without `PostToolUse` or `Stop` within 2 seconds (an Esc, which fires no `Stop`), the item resolves `superseded` and the session status leaves `waiting` for `idle`; this clears the waiting state that 0030 left open. A late answer from the card after an Enter is written to an open request that the CLI no longer reads and does nothing (P16 and P45: a late reply is harmless); the card hides its buttons once `PostToolUse` arrives.
- A deny carries an optional message of the user (at most 500 characters) that reaches the model; it is the user's text. No agent text becomes part of a reply.
- The card shows the raw tool input as today, the class label from the app's own record (section 4.1), and the buttons "Allow once" and "Deny" with a message field behind a Disclosure; "Open session to answer" stays as the secondary action.
- Approvals not held by the broker (an `inbox-dir` session, or a request that arrived when the app could not hold it) keep today's card.

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
- `inbox_open_item { itemId }` emits the UI event `ui.inbox_open_item`; the layout opens the first inbox pane whose view contains the item (else a new pane on "All") and selects it.
- An inbox pane scoped by `folderId` passes the folder to `inbox_list` (UI callers may pass any folder). The list groups rows by project (`ItemRow.projectName`, "No project" last) within the chosen sort.

#### 4.7 Session summaries (on request)

```ts
// core/inbox/summary/types.ts
export interface SummaryRequest { readonly sessionId: SessionId; readonly transcriptPath: string }
export interface SessionSummarizer {
  /** One run at a time per profile and per session; refused above the daily cap. */
  summarize(request: SummaryRequest): Promise<{ summary: string; model: string; generatedAt: string }>;
}
export const SUMMARY_DAILY_CAP = 50;
export const SUMMARY_MAX_CHARS = 400;
export const SUMMARY_INPUT_MAX_CHARS = 20_000;
```

The process and its flags are those of 0021 section 5 (`claude -p`, `--model haiku`, `--max-budget-usd 0.05`, `--setting-sources user`, `--strict-mcp-config`, `--no-chrome`, `--tools ""`, `--no-session-persistence`, `--settings` with `disableAllHooks`, an empty temporary working directory, the profile's `CLAUDE_CONFIG_DIR`, the environment scrub), started through `HostTools` (0042) with an explicit environment. Staleness: at least 3 turns since `turns_at` or 50 kB since `transcript_bytes_at`. The builder's real-Claude script checks that a run leaves no transcript and no folder-trust entry.

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
| `inbox_open_item` | `{}` | exempt: it changes the user's screen | | |
| `inbox_session_summarize` | `{}` | exempt: starts a model run on the user's subscription | | `{ sessionId }` |
| `task_create`, `task_list`, `task_update` | `{}` (was `false`) | yes (unchanged) | as today | |
| `task_delete` | `{}` | yes | agents delete only tasks they own (`owner_session_id`) | |
| `task_move` | `{}` | yes | both folders within the caller's scope | `{ taskId, folderId?, beforeTaskId? }` |
| `reminder_create`, `reminder_list`, `reminder_delete` | `{}` (was `false`) | yes (unchanged) | as today | |
| `reminder_update` | `{}` | yes | the reminder's folder | `{ reminderId, ...ReminderPatch }` |
| `reminder_set_enabled` | `{}` | yes | the reminder's folder | `{ reminderId, enabled }` |

Events on the app bus that cross IPC: `inbox.item_changed`, `inbox.unread_changed` (existing), `inbox.ask_changed { askId, callState, delivery }`, `hooks.approval_changed { itemId, state }`, `session.mode_reported`, `tasks.changed { folderId }`, `inbox.views_changed`, `ui.inbox_open_item { itemId }`.

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
| `SessionSummaryLine` | same | text in `type.small`, Hint with the time, quiet Button "Summarize" with the loading state | |
| `ProjectSummaryEditor` | same | quiet Button "Edit", Field textarea, Button "Save" | |
| `ModeChip` | `renderer/panes/TerminalPane.tsx` header | Chip (`info` for the launch mode; `warning` when the reported mode differs), Popover with "Keep for next launch" | |

### 5. Builder tasks

| Step | Slice | Owns | Must not edit |
|---|---|---|---|
| c-m6 (contracts) | The types and stubs of section 4: `core/hooks/types.ts`, `core/hooks/index.ts`, `core/inbox/askTypes.ts`, `core/inbox/askCommands.ts` (schemas and registration with handlers that answer "not built yet"), `core/inbox/viewTypes.ts`, `core/inbox/inboxMigrations.ts` (migration 2), `core/inbox/taskService.ts`, `core/inbox/summary/types.ts`, `core/session/types.ts` (`ReportedMode`, `MODE_RANK`, the event), `core/commands/types.ts` (`CommandContext.signal`), `core/isolation/types.ts` (`dir` on the `http` variant of `HookDelivery`), `core/mcp/HttpAppMcpServer.ts` (the pending calls by JSON-RPC id, the signal aborted on `notifications/cancelled` of the same session, a closed response, revoke and stop, with its tests), `core/mcp/mcpConfig.ts` (`timeout`), `core/events/index.ts`, `core/blocks/firstParty.ts` (`agide/tasks`), `main/context.ts` (`Desktop.onResume`), `main/modules.ts` and `main/modules/hooks.ts` (the `hooks` module in the order below, with an in-memory endpoint behind a factory), `main/modules/inbox.ts` (wiring of every service through factories that the builders fill), the fake CLI `core/inbox/fixtures/fake-claude-hooks.mjs` (posting `http` hook entries and returning their replies, and a step that calls an MCP tool and waits), `renderer/panes/paneComponents.tsx`, `renderer/panes/inbox/ItemCard.tsx` (calls the stubs `AskCardActions`, `HookApprovalActions`, `SessionSummaryLine`, `ProjectSummaryEditor`), the in-memory `AskService` and the contract suites `askServiceContract.ts` and `hookEndpointContract.ts`, `docs/parity.md` | everything else |
| w-hooks | `core/hooks/**` except the contract files: `HttpHookEndpoint`, `GateRecorder`, `httpHookSettings`; the hook route in `core/mcp/requestGuard.ts` and `HttpAppMcpServer.ts` (after c-m6); `core/session/hooks.ts`, `launchArgs.ts` (settings file), `PtySessionService.ts` (both deliveries); `hookDelivery` in `core/isolation/HostEnvironment.ts` and `FakeProvider.ts`, capabilities in `core/isolation/{Local,Srt,Container,Fake}Provider.ts`; `main/modules/hooks.ts` (the real endpoint) and the endpoint's wiring into the session service in `main/modules/session.ts`; `core/permissions/inspectCommand.ts` and `launchContributor.ts` (no record file under `http`); their tests | other modules, the contract files |
| w-approvals | `core/hooks/approvals/**` (`HookApprovalBroker`), `core/hooks/mode/**` (the mode rule), `core/inbox/HookItemMapper.ts` with its tests (held approvals, close signal, `SessionEnd`, `SubagentStop`, unknown types by policy, record from `GateRecorder`), `core/session/status.ts` (the close signal), the `session_set_mode` and `hook_approval_answer` handlers in `main/modules/session.ts`, the broker's registration in `main/modules/hooks.ts` (after w-hooks), `renderer/panes/inbox/HookApprovalActions.tsx`, the `ModeChip` in `renderer/panes/TerminalPane.tsx`, `e2e/hookApprovals.spec.ts` | other modules, the contract files |
| w-ask | `core/inbox/ask/**` (`SqliteAskService`, the delivery planner), the handlers of `inbox_ask`, `inbox_ask_result`, `inbox_answer` in `askCommands.ts` (below the contract part), `renderer/panes/inbox/AskCardActions.tsx`, `e2e/inboxAsk.spec.ts`, `scripts/e2e-real-claude-ask.mjs` | other modules, the contract files |
| w-tasks-ui | `core/inbox/SqliteTaskStore.ts`, `core/inbox/taskCommands.ts`, `renderer/panes/tasks/**`, `e2e/tasksPane.spec.ts`, the `tasks` phase of `scripts/visual-check.mjs` and `scripts/lib/visual/` | other modules, the contract files |
| w-inbox-ui | `core/inbox/views/**`, `core/inbox/inboxCommands.ts`, `SqliteInboxService.ts` and `InMemoryInboxService.ts` (`purgeDone`, the new query fields), `InboxNotifier.ts`, `renderer/panes/InboxPane.tsx`, `renderer/panes/inbox/{useInbox.ts,format.ts,InboxViewBar.tsx,ProjectSummaryEditor.tsx}`, the folder menu entry in `renderer/panes/tree/`, `main/desktop.ts` (`onResume`), additions to `e2e/inbox.spec.ts` | other modules, the contract files |
| w-summary (last, can move) | `core/inbox/summary/**` except `types.ts`, `renderer/panes/inbox/SessionSummaryLine.tsx`, `scripts/e2e-real-claude-summary.mjs` | other modules, the contract files |

Order:

1. c-m6, then its review. It starts after the eighth hardening pass of the confined check ends, since that pass edits `core/isolation` and `main/modules/session.ts`.
2. w-hooks, w-ask, w-tasks-ui and w-inbox-ui in parallel; each gets a review when it finishes. w-ask builds against the in-memory endpoint and the fake CLI of c-m6; its `UserPromptSubmit` path is a `HookReplyContributor` that w-hooks' endpoint calls. Of the parallel builders only w-hooks edits `main/modules/session.ts`, and w-approvals edits it after w-hooks.
3. w-approvals after w-hooks (it needs the held requests and the record), with its review; w-summary beside it.
4. Integration: the real module graph, the parity table (`docs/parity.md`), the mutation targets of section 6 in `scripts/mutation-checks.mjs`, the real-Claude scripts, then the combined review, the verification and the fix steps until a review finds no major (0042 recommendation).

Module initialization order: `hooks` becomes a module after `mcp` and before `session` (it registers its route on the MCP server and gives the session module the endpoint); the inbox module stays after session and receives the endpoint, the broker and the `GateRecorder` through its deps; the rest of the order of 0041 is unchanged.

### 6. Test plan

- **Contract suites** (`pnpm test`): `describeAskServiceContract` (in memory now; SQLite by w-ask) and `describeHookEndpointContract` (in memory now; HTTP by w-hooks). The inbox store contract grows by `purgeDone`, `sources` and `text`.
- **Unit**: the hook route (path, token, wrong session, `Origin`, `Host`, size, unknown event, arrival order, the reply wait of `UserPromptSubmit`); the settings file holds the token and the arguments hold none (a test reads the argument list); `GateRecorder` against the inspector table; the broker (answer, first answer wins, close, expiry reply `{}`, no answer after close); the mode rule over every pair of `MODE_RANK`, `inbox-dir` ignored, the `bypassPermissions` alert; `inbox_ask` (schema errors, scope of `link.nodeId`, the open-ask limit, answered in the call, `timeout` before the effective limit with a fake clock, `closed` on abort, `dismissed`, `queued`, `inbox_ask_result` of another session answers `not_found`, each delivery row of section 4.4 with a fake session service, the context frame); task delete, move and renumbering, reminder update with a new `next_due_at`, enable and disable; `purgeDone` keeps open items and asks of open items; the scheduler ticks on resume; the notifier sets `onClick`; views filter and sort; migration 2 over a milestone 5 database file.
- **Real module graph** (`main/modules/*.test.ts`): the parity table has no missing row; an agent session lists `inbox_ask` and `inbox_ask_result` and not the exempt commands.
- **e2e with hidden windows** (`AGIDE_HIDDEN=1`, fake `claude`): a held `PermissionRequest` answered Allow and Deny from the card reaches the fake CLI's hook reply; a terminal answer first leaves the card without buttons; an ask answered in the call, an ask answered after `wait: false` with the notice typed into the fake PTY and read through the tool, an answer queued while busy delivered as context; the tasks pane (create, due chip, done, reorder, delete, reminder dialog with a preset and a custom RRULE error); saved views and a folder-scoped pane; a notification click (the quiet desktop's recorded `onClick`) opens the item; agent text in an ask (option labels with markup, ANSI, bidi overrides) shows literally.
- **Mutation targets** (`scripts/mutation-checks.mjs`): the hook token check dropped; the hook path session ignored in favour of `session_id` of the payload; a held approval answered after `closed`; the expiry reply turned into an allow; a reported higher mode stored; `inbox-dir` payloads accepted as a mode source; the typed notice built from agent text; `inbox_ask_result` without the session check; the open-ask limit; the `signal` not passed; `notifications/cancelled` of another session aborting a call; `notifications/cancelled` ignored; `task_delete` of another session's task by an agent; the agent schedule limit; retention deleting open items.
- **Real Claude** (scripts outside `pnpm test`, the rules of the task brief): `scripts/e2e-real-claude-ask.mjs` (a PTY session and a stream-json session each ask with options; the script answers through `inbox_answer` once in the call and once after `wait: false`; the session receives the answer), a held `PermissionRequest` answered from the card in a PTY session (in the same script), `scripts/e2e-real-claude-summary.mjs`. Haiku, `--max-budget-usd 0.25` per call, at most 3 processes, a few cents in total.

### 7. Security

| Threat | Rule | Test |
|---|---|---|
| Agent-written text (questions, details, option labels, tool inputs, summaries) carries markup, links, escape sequences or bidi overrides | plain text only: React text nodes, `cleanText` at the store, length limits in zod and SQL; the grep test extends to `renderer/panes/tasks` and the new card components | e2e literal text test; `plainText.test.ts` roots |
| Answer delivery types agent text into a terminal | only the fixed notice line made by the app with the app's item id is typed; answers travel as tool results or `additionalContext`; the option id in the context frame is limited to `[a-z0-9_-]` | unit test of the notice; mutation "notice from agent text" |
| An option button starts an action | an option returns its id to the asking session and does nothing else (0021 section 9) | unit test of `answer` |
| A forged hook payload changes status, items or the mode (file dropped into the hook directory) | with `http`, only requests with the session's hook token count; `inbox-dir` payloads never change the mode | route tests; mutation "token check dropped" |
| A same-user agent reads the settings file and posts forged hooks with the token (it can reach the listener wherever the CLI can: under `srt` the same `allowLocalBinding` serves both, P45) | the mode rule only lowers; the payload's `session_id` must match the token's session; the inspector decides in the CLI, the app's record is recomputed from the payload, so a forged record cannot relabel a call; a forged `PermissionRequest` opens a card whose answer goes back to the forger only; the settings file is removed after start if the probe allows; the limit of 0013 stands (an agent that runs as the user can also open the app database) | mode rule tests; the setup pane text of 0024 |
| The hook token leaks through `ps` or the environment | the token is only in the 0600 settings file; arguments and environment hold none (an `allowedEnvVars` variable reaches the agent's commands, P45) | unit test over the argument list and the environment |
| Opening loopback for hooks under the Bash sandbox lets sandboxed commands reach every local service | profiles with `sandbox.enabled` keep `inbox-dir` until a port-limited allowance exists (question 8) | unit test of the transport choice per profile |
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

| Part | Days |
|---|---|
| c-m6 contracts | 0.5 |
| w-hooks | 1.5 to 2 |
| w-approvals | 1 to 1.5 |
| w-ask | 1.5 to 2 |
| w-tasks-ui | 1.5 to 2 |
| w-inbox-ui | 1 to 1.5 |
| w-summary | 0.5 to 1 |
| Total | 7.5 to 10.5 |

This fits the remainder of the R21 estimate (10 to 15 days in 0016 and 0021, of which 0024 judged about 4 built). At the milestone 5 rate (about 77 build minutes per estimated day, 0042) that is about 580 to 810 summed agent minutes for the build steps; at the milestone 4 rate (about 32), about 240 to 340.

### 9. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The CLI's `http` hook behaviour changes in a later release (P45 shows already that `SessionStart` posts nothing over `http` and that the Bash sandbox gates loopback, both against the documentation) | approvals from the card or the close signal stop working | the P45 script is re-run on each CLI upgrade with the mapper fixtures; `inbox-dir` stays as a fallback per profile; `PostToolUse` and `Stop` resolve approvals without the close signal |
| The CLI rereads `--settings` and the removed file drops the hooks | hooks stop after start | keep the file when the probe shows it; the token stays in a 0600 file either way |
| The MCP call limits change, or a background task loses the result when the session ends (P16 shows the background task; its end with the session is documented, not measured) | answers in the call fail | the notice path delivers every answer that the call did not; asks are closed on `session.exited` |
| The model does not call `inbox_ask_result` after the notice | answers not read | the notice names the tool and the id; the real script checks Haiku; the card shows "not read yet" |
| Builders of w-hooks and the hardening pass edit the same files | conflicts | w-hooks starts after the pass ends (order step 1) |
| The user's own settings turn the Bash sandbox on for an `http` session | every hook to loopback asks for `SandboxNetworkAccess` (P45 in `-p`; the TUI dialog for it was not seen) or fails open with a 403 | the launch reads `sandbox.enabled` from the settings the CLI loads and keeps `inbox-dir` for such a session (section 4.1) |
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
| Hooks under a sandbox (section 4.1) | P45: under `srt` delivered with `allowLocalBinding` only; under the CLI's Bash sandbox refused (403) unless `127.0.0.1` is allowed | settled; question 8 for Bash-sandbox profiles |
| `SessionStart` and `SessionEnd` over `http` (section 4.1) | P45: an `http` `SessionStart` posted nothing; `SessionEnd` posted in the TUI about 1.7 s after `/exit` and was not measured in `-p` | settled: both stay command hooks |
| `additionalContext` in the `UserPromptSubmit` reply (section 4.4) | P45: the model repeated a word given only in the reply's `additionalContext`, in `-p` and in the TUI | settled: `context` delivery is on for `http` sessions |
| Removing the settings file after start (section 4.1) | not measured | open: a w-hooks test against the real CLI |
| The CLI closing open MCP or hook requests at exit; the 600 s default of an `http` hook held to its end; `SubagentStop`, `Elicitation`, `PostToolUseFailure` payloads; the container provider; Linux | not measured (the notes' "Not verified") | open; the app closes asks on `session.exited` itself and sets every hook `timeout` explicitly |

### 11. Questions for the user

1. Do you confirm 0021 as the R21 design with the amendments of 0024, 0037, 0040 and section 3 of this record? Recommendation: yes, and set 0021 to accepted after the milestone 6 results.
2. Scope: agent-run schedules, elicitation forms, edit-and-allow and per-project policies wait (section 2). Recommendation: keep them out of milestone 6; run P17 before the elicitation forms.
3. After a question's call has returned, the app types only "Inbox answer ready for question <id>. Read it with inbox_ask_result." and the agent fetches the answer. Recommendation: yes; it never types agent text or multi-line text into a terminal.
4. A mode reported by a session may lower the mode of its next launch but never raise it; you raise it from the session header. Recommendation: yes.
5. Hook approvals from the card wait at most 15 minutes, then the decision returns to the terminal dialog (no automatic allow or deny). Recommendation: yes, with the minutes as a setting.
6. Session summaries by Haiku on request only, at most 50 a day, on your subscription. Recommendation: build it as the last step; it can move to the next milestone.
7. The `http` hook transport becomes the default for every provider, with the file transport kept as a fallback for one milestone, and for the Bash-sandbox sessions of question 8 as long as they need it. Recommendation: yes.
8. Under the Bash sandbox of the CLI, a hook reaches the app only when `127.0.0.1` is an allowed host, which also lets the agent's sandboxed commands reach every local service (P45). Should profiles with the Bash sandbox on keep the file transport (no approvals from the card, no mode source), or allow loopback? Recommendation: keep the file transport for them until a port-limited allowance exists.

## Consequences

- R21 is complete after milestone 6 except the parts that wait for P17, the apps milestone, the slot counter and the transcript surface (section 2).
- The hook path changes for every session: hooks post to the app's listener, the settings move into a 0600 file, and the inspector's record comes from the app. `HookInbox` stays for the `inbox-dir` fallback and for the `SessionStart` and `SessionEnd` command hooks.
- `CommandContext` gains `signal`, a contract change under 0013 and 0029 that the contracts step applies; `docs/parity.md` gains the exempt rows of section 4.8 and the inbox and task commands with UI bindings.
- 0021 is amended as section 3 lists; 0022's hook transport rules hold with the settings file of section 4.1; 0028's inspector record moves into the app under `http`; 0030's open items "mode reported by payloads", "hook approvals answered only in the TUI" and "`inbox_ask`" close when the milestone passes.
- Not verified: the rows of section 10 marked open; the `http` hook type in the container and under `srt` with a real app (P45 used a probe receiver); Electron's `powerMonitor` `resume` after a real sleep; real notifications under Focus modes; that Haiku reads an answer through `inbox_ask_result` after the notice.
