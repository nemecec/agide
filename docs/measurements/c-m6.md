# Milestone 6 contracts (c-m6)

Start: 2026-11-28T11:59:24Z
End: 2026-11-28T12:46:40Z

## Work

The contract step c-m6 of record 0043: the types, stubs, in-memory implementations and contract suites of sections 4.1 to 4.10, the seams that the builders fill, and the text changes that 0046 lists for 0043.

- Record text: 0043 carries the changes of 0046 (the form of the loopback entry and its real-CLI checks, the text that depends on the form, the session-grant rule and its mutation target, the removal digest, the closed questions), an amendment of the builder table where files moved, and a section of notes where the code differs from the types. 0046 has a line under its list that says which items were applied.
- Hooks: `core/hooks` has the types, the settings (`transport`, `approvalWaitMinutes`, `bashSandboxLoopback`), the in-memory endpoint with the rules of the route, the commands `hook_approval_answer` and `session_set_mode` (handlers answer `not_built`) and the contract suite `describeHookEndpointContract`.
- Ask: `askTypes.ts`, `askCommands.ts` (schemas, `inbox_ask`, `inbox_ask_result`, `inbox_answer`), the in-memory `AskService` and `describeAskServiceContract`; the shared `NoticeDelivery` planner with an in-memory implementation and a scripted session port.
- Access: `core/access` has the types, settings, migration 1 of module `access`, the commands, the in-memory broker and `describeAccessBrokerContract`.
- Inbox: migration 2 (asks, views, summary counters, session activity), `viewTypes.ts` with the built-in views, `viewCommands.ts`, `ItemContext` without a session summary, the `ui` bindings and `mcpExempt` reasons of the existing inbox and task commands, `TaskService` additions with `not_built` stubs in the store, and the new task commands.
- Summary, profile, session, isolation: `core/summary` types and commands, the `hooks`, `access` and `inbox` sections of the profile settings, `ReportedMode`, `MODE_RANK` and the `session.mode_reported` event, `dir` and `loopbackInSandbox` on the `http` hook delivery.
- MCP: `CommandContext.signal`, `CommandRegistry.invoke` and `callTool` pass it on; `HttpAppMcpServer` keeps the pending calls by JSON-RPC id and aborts on `notifications/cancelled` of the same session, a closed response, `revoke`, `abortCalls` and `stop`; the app's server entry carries `timeout`.
- Modules: `hooks` after `mcp`, `ask` and `access` after `inbox`, with the in-memory implementations behind factories (`createHookEndpoint`, `createAskService`, `createNoticeDelivery`, `createAccessBroker`); `Desktop.onResume` is optional.
- Fake CLI: `fake-claude-hooks.mjs` posts `http` hook entries and prints the replies, closes a held request on `/abort`, calls an MCP tool and waits on `/mcp`, and posts `notifications/cancelled` on `/mcp-cancel`.
- Renderer: stubs that render nothing (`AskCardActions`, `HookApprovalActions`, `TerminalDialogReminder`, `AccessRequestActions`, `ProjectSummaryEditor`, `ItemCardExtras`, `AccessGrantsChip`, `SessionSummaryMark`, `TaskNoteLinks`) and a placeholder `TasksPane` with the pane type `agide/tasks`; `ItemCard` drops its session summary line.
- Docs: `docs/parity.md` and `docs/blocks.md` regenerated.

## Files outside the row that were touched

| File | Change | Reason |
|---|---|---|
| `core/inbox/inboxCommands.ts` | `ui: {}` and `mcpExempt` reasons; `postLink` exported | section 4.8 asks for the bindings; the ask schema reuses the link |
| `core/inbox/taskCommands.ts` | `ui: {}`; the new commands with `not_built` handlers | section 4.8 |
| `core/inbox/SqliteTaskStore.ts` | `not_built` stubs for the new `TaskService` methods | the interface gained them |
| `core/commands/CommandRegistry.ts`, `core/mcp/tools.ts` | an optional `signal` argument | `CommandContext.signal` has to reach the command |
| `core/commands/index.ts`, new `core/commands/notBuilt.ts` | the `not_built` helper | handlers of unbuilt commands |
| `core/mcp/types.ts` | `abortCalls` on `AppMcpServer` | session exit aborts calls |
| `core/isolation/FakeProvider.ts` | `dir` and `loopbackInSandbox` in the `http` delivery | the type gained them |
| `vitest.config.ts` | the new contract suites join the coverage exclusions, as the other contract files are | contract files are not production code |
| `e2e/inbox.spec.ts`, `renderer/panes/InboxPane.test.ts`, `core/inbox/inboxCommands.test.ts`, `main/modules/m3Modules.test.ts` | follow the removed summary line and the new services | amendment of section 3 |

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` of the new and touched areas | pass |
| `pnpm coverage` | 299 test files pass; src/core lines 97.44 against the threshold 97 |
| CI-like coverage (directory with a `node` symlink only, no srt and no Docker on the path) | 299 test files pass; src/core lines 97.45, statements 94.92, branches 87.27, functions 95.82 |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |
| `pnpm parity` | ok, `docs/parity.md` written |
| `pnpm check:colours` | no literal outside the allowlist |

The first CI-like run failed a case of the access contract: it chose the open request to decide on by list position, and requests of equal age have no fixed order. The suite now names the request by session, action and target. Repeated runs of the new suites then passed.

## Mutation entries (`node scripts/mutation-checks.mjs 'm6 '`)

| Area | Entries | Killed |
|---|---|---|
| access broker (joins, limits, window, grants, quiet deny, expiry, session exit, result, notices, scopes) | 26 | 26 |
| ask service | 9 | 9 |
| hook endpoint and hook settings | 11 | 11 |
| MCP server cancellation and the server entry | 8 | 8 |
| notice delivery | 3 | 3 |
| mode rank | 1 | 1 |

An entry survived first (a guard in `addGrant` that the check in `deny` made redundant); the guard was removed and the entry now targets the check in `deny`, which a test kills. The entry for `access_decide` as an agent tool is killed by the module test.

## What took long

- The access broker: its rules (joins, limits, grants, the ways a call ends, the delivery after a call returned, expiry, session exit) and a contract suite that holds a later SQLite broker to the same behaviour.
- Fake timers with promises in the contract suites: each case flushes microtasks explicitly, and an abort has to be observed before a held request is awaited.
- The decision order inside `decide`: a perform that refuses ends the request `denied` and a dismissed item must not break an allow in flight.

## Not done

- No real-Claude run: nothing in this step needs one; the checks of the loopback entry, the hold of the default wait and the removal of the settings file stay with the w-hooks real-CLI test.
- The inbox store contract does not yet cover `purgeDone`, `sources` and `text`; they belong to w-inbox-ui with the store.
- `GateRecorder`, the hook route, the settings file, every SQLite implementation and every handler behind `not_built` are the builders' work.
- Not run: `pnpm e2e` under a visible window, and the visual check of the tasks placeholder.

## Cleanup

The temporary directory `/tmp/agide-c-m6` (logs and the `node` symlink for the CI-like run) was removed at the end.

## Fix step after the review (c-m6-fix)

Start: 2026-11-28T13:11:56Z
End: about 2026-11-28T13:32Z (approximate: no `date -u` reading was taken at the end; the last log of the step is from 13:31Z and the review of this step began at 13:33:03Z)

The fixes for the findings of `review-c-m6.md`, applied to the same uncommitted working tree.

### What changed

| Finding | Fix |
|---|---|
| Section 4.1 of 0043 lost the `GateRecorder` bullet | The bullet is back after the bullet on the form of the entry; `GateRecorder` is a type in `core/hooks/types.ts` and section 14 says who implements and who calls it |
| Seams that need another builder's file | `hook_approval_answer` and `session_set_mode` register from `main/modules/session.ts` again (the session module has the session service; the hooks module keeps the endpoint and starts before session as in section 5). The handlers of views and summaries are the factory files `core/inbox/views/createViewHandlers.ts` and `core/summary/createSummaryHandlers.ts`, called from `main/modules/inbox.ts` with the database, events, inbox, tree, sessions and the view tracker. The ask module is its own file, `main/modules/ask.ts`. The amendment table of section 5 and section 14 say which builder fills which seam |
| Item 2 of 0046 not applied to section 4.9 | The mode chip row, the loopback row and the unit-test line of section 6 follow the form written |
| Comments that say the opposite of the contract | `SessionInfo.reportedMode` and `HookDelivery.loopbackInSandbox` now match sections 4.3 and 4.1 |
| `toolUseId` stored by section 4.4 and kept nowhere | Column `inbox_asks.tool_use_id`, `AskRecord.toolUseId`, `InboxAskInput.toolUseId`, `CommandContext.toolUseId`; the MCP server reads `_meta["claudecode/toolUseId"]` (short plain identifiers only) and `CommandRegistry.invoke` and `callTool` pass it on |
| `AskError` and `AccessError` codes outside `CommandErrorCode` | Section 14 gives the mapping the handlers of w-ask and w-access use |
| Counts in prose | Removed from this report, from section 5 and section 14 of 0043, and from the comment of `delivery/types.ts` |

### Behaviour fixed on the way

- Concurrent `access_request_result` calls on an allowed read shared no run: the second returned `allowed` without the content while the first still ran. The in-memory broker now keeps the run (`performing`) and the second call waits for it.
- A call that waited when its target was removed got `denied` with reason `failed` while the record said `withdrawn`. The call now gets reason `stale`, with the message of the removal; the record and `access_request_result` say `withdrawn`.

### Tests added

| Where | Case |
|---|---|
| `accessBrokerContract.ts` (`loseProcess` in the harness) | no quiet deny for a read, a removal or a mount read when the process of the session is gone and the broker was not told |
| `accessBrokerContract.ts` (`hold` on the fake handler) | concurrent results of an allowed read share one run and both carry the content |
| `accessBrokerContract.ts` | a waiting call whose target is removed returns `denied` with reason `stale`; the record says `withdrawn` |
| `askServiceContract.ts` | an answered ask whose call has not returned is not announced by `deliverPending` (the delivery run happens inside the resolve event of the item, between the stored answer and the return of the call); the tool use id is kept with the ask |
| `hookEndpointContract.ts` | every 401 has the same body, which names neither the cause, the session nor the token; the first non-empty reply of several `PermissionRequest` contributors wins |
| `m6Modules.test.ts` | the endpoint of the hooks module refuses a wrong token and passes an accepted request to the listener |
| `askDelivery.test.ts` (new) | the notice delivery of the ask module types a line into an idle PTY session and the fake CLI echoes it after the Enter; it writes the line as a user message to an idle stream-json session |
| `HttpAppMcpServer.test.ts` | the tool use id reaches the command; it is left out without `_meta` and for text that is not a short plain identifier |
| `inboxMigrations.test.ts` | the column `tool_use_id` |

The existing check of `InMemoryAccessBroker.test.ts` for a quiet deny without a process stays; the shared contract now holds every implementation to the rule.

### Mutation checks

`node scripts/mutation-checks.mjs 'm6 '` ran every entry of the contract step and the new ones: all killed, none skipped. The entry "an allowed read runs twice" follows the moved code. New entries: a second result that does not wait for the run of the first, concurrent results that each run the read, a removed target that tells a waiting call `failed`, an answered ask whose call waits that is announced, a tool use id that is not kept, an empty reply that ends a `PermissionRequest`, a 401 that names its cause, a module endpoint that takes a wrong token, the hook commands not registered, a tool use id that is not passed to the command, any text taken as a tool use id, and the ask module's delivery that types nothing into a PTY or writes nothing to a stream session.

Scratch mutations ran against the contract suites alone (`-t` on the contract title) and were restored with `cmp`: the liveness check dropped from the quiet deny (the contract cases for it fail) and `callState !== 'waiting'` dropped from `deliverPending` (the new ask case fails).

### Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm coverage` | 300 test files pass (one skipped); src/core lines 97.44 against the threshold 97, statements 94.93, branches 87.29, functions 95.85 |
| CI-like coverage (directory with a `node` symlink only) | the same files pass; src/core lines 97.44, statements 94.94, branches 87.29, functions 95.90 |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |
| `pnpm parity` | ok; `docs/parity.md` is byte for byte the same as before, since no command id moved; `docs/blocks.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| `node --check scripts/mutation-checks.mjs` | ok |

### What took long

The seams: choosing where `session_set_mode` and `hook_approval_answer` register so that each builder's files stay its own, while keeping the module order of section 5. The tests for the delivery of the ask module: a stream-json session reports idle only through its `SessionStart` hook, so the test runs the hook commands of the launch settings as the CLI does.

### Not done

- The ask handler of w-ask has to copy `ctx.toolUseId` into the input; nothing reads it yet.
- No real-Claude run, no visible-window e2e.
- The mapping of `AskError` and `AccessError` to command errors is written in section 14 and left to the handlers of w-ask and w-access.

### Cleanup

The temporary directory of the fix step holds logs, the `node` symlink of the CI-like run and copies of the mutated files. Its removal was denied by the permission system and is left to the coordinator.

## Second fix step (c-m6-fix2)

Start: 2026-11-28T13:49:48Z
End: 2026-11-28T14:09:04Z

The findings of the review of the first fix step, applied to the same uncommitted working tree.

### What changed

| Finding | Fix |
|---|---|
| Nothing passed the hook endpoint to the session and ask modules | `main/modules.ts` passes `hooks` in the deps of the session, inbox and ask modules, typed in each module's deps. The ask module registers `createNoticeContributor` (the `UserPromptSubmit` context of the shared notice planner) on the endpoint from its deps and removes it on dispose. 0043 sections 5 and 14 name which builder edits which module file; no module file is edited by two builders of one step |
| `SummaryHandlerDeps` had no profile | `profile: ProfileService` is in `SummaryHandlerDeps` and `main/modules/inbox.ts` passes it. The view handlers need no settings. The purge schedule of `purgeDone` is in `main/modules/inbox.ts`; the builder table now gives it to w-inbox-ui, the only builder of step 2 that edits that file |
| Counts in prose of this report and of section 14 | Rephrased |
| w-hooks row named the `127.0.0.1` entry; doubled blank line in section 13 | The row says the loopback entry in the port or host form; the blank line is gone. The row also says that the run of `describeHookEndpointContract` of w-hooks posts over a socket |
| End time of the first fix step | Marked approximate: no `date -u` reading was taken at its end |

### Tests added

| Where | Case |
|---|---|
| `askServiceContract.ts` | a delivery run at every inbox event, ask event and microtask turn between the stored answer and the return of the call types nothing; an implementation that marks the call returned before it settles it fails |
| `m6ModuleGraph.test.ts` (new) | the session, inbox and ask modules receive the endpoint of the hooks module; the contributor of the ask module answers a `UserPromptSubmit` of a session with the notices queued for that session only, does not repeat a taken notice, and is gone after close; the view and summary handler factories get the services, the database and the profile |

The 401 body case of the hook endpoint contract constrains the in-memory endpoint only through a mutation that adds a body; its value comes with `HttpHookEndpoint`, which runs the contract over a socket (recorded in the w-hooks row).

### Mutation checks

`node scripts/mutation-checks.mjs 'm6 '` ran every entry: all killed, none skipped. New entries: a call marked returned before it settles, no endpoint in the deps of the session, inbox or ask module, no contributor registered, a contributor for another event, a contributor that takes the notices of every session, a contributor that stays after dispose, summary handlers without the profile. The entry for a call marked returned early was also run alone on a scratch copy: the older resolved-event case passes and the new case fails. The scratch copy was restored and compared with `cmp`.

### Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| tests of `src/main`, `core/inbox`, `core/hooks`, `core/summary`, `core/access` | 50 files, 611 tests pass |
| `pnpm coverage` | 301 test files pass (one skipped); src/core lines 97.44 against the threshold 97, statements 94.93, branches 87.29, functions 95.88 |
| CI-like coverage (directory with a `node` symlink only) | the same files pass; src/core lines 97.44, statements 94.93, branches 87.30, functions 95.85 |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | the first run: 85 pass and one failure, the keyboard rename case of `tree.spec.ts` (31 s timeout) while other jobs ran on the machine; that spec alone passed, and a second full run passed with 86 |
| `pnpm parity` | ok; `docs/parity.md` and `docs/blocks.md` are byte for byte the same as before |
| `pnpm check:colours` | no literal outside the allowlist |
| `node --check scripts/mutation-checks.mjs` | ok |

### What took long

The e2e runs (about three minutes each) and the wait on them. The wiring itself is small: the mutant for the notice contributor that takes the wrong session survived once because the test used the same session id as the mutant; the test now prompts as another session.

### Not done

- No real-Claude run, no visible-window e2e.
- The hook endpoint contract over a socket belongs to w-hooks.
- The ask contributor is the in-memory planner's context path; w-ask replaces the planner and keeps the contributor.

### Cleanup

The temporary directory of this step (`/tmp/agide-c-m6-fix2`) held logs, the `node` symlink and scratch copies; it is removed at the end.

## Open items after the second fix review

The ask contract case that checks delivery after an answer now also delivers once right after `answer` returns. A mutation entry for a deferred settle that keeps the in-call delivery in the returned record is not added yet; the builder of the ask service adds it with the real service.
