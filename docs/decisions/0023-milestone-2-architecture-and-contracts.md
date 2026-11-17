# 0023 Milestone 2 architecture and contracts

Status: accepted
Date: 2026-11-17
Decided by: spike agents
Inputs: 0013, 0014, 0015 (R20), 0016 (R21), 0017 (R22), 0018 (R23), 0020, 0021, 0022; `notes/probes-m2.md`, `probes/RESULTS.md`; the milestone 1 code in `app/`

## Context

0020 (blocks and layout), 0021 (inbox and tasks) and 0022 (profiles and isolation) are reviewed designs, each with a first milestone 2 slice. The probes P11 to P15 ran against the CLI 2.1.326; their results changed the hook mapping of 0021, which was updated with this record (verification column, waits table and consequences).

The builders w-profiles, w-provider, w-layout and w-inbox work next, in parallel. As in milestone 1 (0013), they need the contracts fixed first and files that do not overlap. This record states the slices they build, the modules and contracts that now exist in the code, who owns which file, the module initialization order, the test strategy, and the choices made while writing the contracts.

## Decision

### Slices

| Builder | Slice | From |
|---|---|---|
| w-profiles | File `ProfileStore` and `ProfileRegistry` (atomic 0600 writes, watch plus poll, validation, staleness), the milestone 1 migration, `profileEnv` with the `isolated` tool mode, profile resolution from `--profile` before `ready`, `userData` and `sessionData` per profile, the single-instance lock with `additionalData`, `openProfile`, window title and colour strip, the dock badge, the switcher rail, the creation dialog and the setup pane, `profile_list`, `profile_open` and `profile_create` with `mcp: false` and a reason, probe E1, the e2e test with profiles side by side | 0022 section 8 items 1 to 4 and 8 |
| w-provider | Session launch through `IsolationProvider`: `PtySessionService` spawns `AgentEnvironment.ptyCommand`, attaches the pid, ends sessions through `terminate`; `buildLaunchArgs` takes the settings and MCP file paths; the session module writes `mcp.json` and `settings.json` through `writeSessionFile` (0600 in a 0700 directory) and releases them on exit and close; a test that no spawned argument holds a token; probes C2 and C3 as scripts | 0022 section 8 items 5 to 7 |
| w-layout | dockview check, `LayoutEngine` adapter, layout files with watcher, atomic writes and the invalid-file rule, migrations, structural diff, JSON Patch, revision history and undo, the shared context store, `App.tsx` as a layout host, `agide/tree`, `agide/surface-host` and `agide/placeholder` components, the layout switcher, the tools `blocks_list`, `layout_get`, `layout_validate`, `layout_apply`, `layout_undo`, `ui_open_to_side` and `ui_capture_window` (with the image result in the MCP tool mapping), `docs/blocks.md` and its out-of-date test | 0020, first slice |
| w-inbox | SQLite inbox store and tasks module with the migrations of 0021 section 2, hook mapping (`Stop`, `StopFailure`, `Notification` including `elicitation_dialog`, `PermissionRequest`, and the resolving rules of `PostToolUse`, `UserPromptSubmit` without `<task-notification>` prompts, and the interrupt line), `inbox_post` with rate limit and coalescing, the inbox pane with list and detail card, auto-resolve on view, macOS notifications with the throttle, tasks, reminders with the RRULE subset, the persisted scheduler with catch-up and snooze | 0021 section 12, as updated after P13 to P15 |

What waits is listed in 0020 ("Waits"), 0021 (section 12) and 0022 (section 8, "Waits"). These items moved: approving from the card now waits only for the `http` hook transport (P14 passed), and form-mode elicitation answers wait for that transport and the `Elicitation` hook in the app's hook list (P15 passed).

### Modules

```
src/core
  profile     types, zod schemas, path layout, ProfileStore and ProfileRegistry contracts, in-memory
              implementations, registry liveness, profileEnv (stub for the isolated mode)
  isolation   IsolationProvider and AgentEnvironment, LocalProvider (milestone 1 launch behaviour plus
              0600 session files), FakeProvider, SessionFiles, the provider contract
  blocks      block manifest schema with the closed permission set, layout document schema with JSON Pointer
              issues, shared context keys, version ranges, the first-party manifest, the Session and Pair
              presets, BlockRegistry and its in-memory implementation and contract, LayoutService
  inbox       item, task and schedule types, the item schema, text cleaning, InboxService, its in-memory
              implementation and contract
  events      AppEvent gains ProfileEvent, BlocksEvent and InboxEvent
src/main
  context.ts  ModuleContext gains `profile?` (ResolvedProfile) and `desktop?` (Desktop); Services gains
              profile, layout and inbox
  desktop.ts  Electron notifications and dock badge behind Desktop; quiet in hidden runs
  modules/    profile.ts, layout.ts, inbox.ts (stubs over the in-memory implementations)
src/renderer/panes
  paneTypes.ts       PaneProps, the host contract of a pane component
  paneComponents.tsx first-party pane type id to component
  InboxPane.tsx, ProfileRail.tsx (stubs)
```

A builder may add folders under `src/core` for its slice, for example `core/layout` and `core/context` for the layout runtime. The test that keeps `src/core` free of Electron covers them.

### Contracts

Profile (`core/profile/types.ts`, `schemas.ts`, `paths.ts`):

- `ProfileDefinition` (id, name, colour, creation time) crosses profiles; `ProfileSettings` (Claude configuration location, tool credential mode, isolation provider, badge switches) is read and changed only by the owning process. Every type in 0022 section 1 is in the code with a zod schema.
- `ProfileStore`: `list`, `get`, `create` (id from the name, made unique; an explicit taken id throws `exists`), `readSettings`, `updateSettings` and `updateDefinition` for the own profile only (`not_owner` otherwise). New profiles get their own Claude directory and `isolated` tools; the default profile gets the CLI default login and `inherit`.
- `ProfileRegistry`: one object per process. `publish({ unread? })` writes the own entry, `withdraw` removes it, `statuses()` lists `{ profileId, running, unread? }` sorted by id, `subscribe` reports changes. An entry is running when its pid is alive and it is younger than 90 seconds. Readers never delete another entry. `registryEntrySchema` refuses fields outside the 0022 entry, such as a name.
- `profilePaths(root, id)` and `rootPaths(root)` fix the file layout of 0022, including `data/sessions` for session files and `data/session-events` for hook inboxes.
- `profileEnv(base, settings, paths)` is the one place that builds a session's environment. It removes Claude credential variables and sets `CLAUDE_CONFIG_DIR` only for a profile with its own directory. For `isolated` tools it keeps only an allow list of process, locale, terminal, proxy and certificate variables and points the tool location variables into the profile.
- `ProfileService` (module service): `id`, `definition()`, `settings()`, `store`, `registry`.
- Event: `profile.statuses_changed` with the statuses.

Isolation (`core/isolation/types.ts`): the interface of 0022 section 5, with one addition: `AgentEnvironment.attach(sessionId, pid)`. The session service calls it after node-pty spawned the command, so `terminate` can reach the process for providers that run it on the host. `LocalProvider.ptyCommand` returns what milestone 1 spawns: the `claude` binary, the launch arguments, the working directory, and `claudeEnv` over the profile environment with `CLAUDE_CONFIG_DIR` from the profile. Its capabilities are `host-user`, network `none`, login `host-keychain`, hook transport `inbox-dir`, transcripts `host-files`. `SessionFiles` writes `<root>/<sessionId>/<name>` through a temporary name and a rename, with modes 0700 and 0600, and refuses a session id that is not a plain name.

Blocks (`core/blocks/manifest.ts`, `layout.ts`, `context.ts`, `types.ts`):

- `blockManifestSchema` follows 0020 section 2: pane types `<block id>/<local id>` with the block's own prefix, emitted event types under `ext.<block id in snake case>.`, permission ids from the closed set of section 8, `entry` required for code panes and refused for others.
- `layoutDocumentSchema` at `schemaVersion` 1 follows 0020 section 4. Every instance is placed exactly once, every placed pane has an instance, and `active` is in its tab group. `validateLayout` returns every issue with a JSON Pointer. `engineState` holds `engine`, `engineVersion`, `arrangementHash` and `state`.
- `BlockRegistry`: `register(manifest, origin)` validates without running code and refuses an invalid manifest, a taken block id or pane type, and the block id `agide` from any origin but `first-party`; `resolve(instance)` returns the pane type or a placeholder reason (`missing`, `disabled`, `version`). Version ranges are `*`, an exact version, or a caret range.
- The first-party block `agide` lists `agide/tree`, `agide/surface-host`, `agide/placeholder`, `agide/inbox` and `agide/profile-rail`. The presets "Session" and "Pair" validate and resolve against it.
- `LayoutService` (module service): `blocks`, `get(layoutId)`, `list()`.
- Events: `blocks.changed`, `layout.applied`, `context.changed`.

Inbox (`core/inbox/types.ts`):

- `InboxItem` mirrors the `inbox_items` row of 0021 section 2 in camel case, plus `folderRemoved`.
- `InboxService` is synchronous, like the tree, and throws `InboxError` (`not_found`, `invalid`, `invalid_transition`) without changing anything. `post` creates or coalesces through `dedupeKey`; `markSeen`, `markUnread`, `snooze`, `wakeDue`, `resolve`, `reopen` follow the state table of 0021 section 1; `resolveByDedupeKey`, `resolveSessionItems` (by kinds and origins) and `moveSessionItems` serve the hook mapping; `unreadCount` counts state `new` with urgency `normal` or `high`. The store cleans text: escape sequences, control characters and Unicode format characters are removed, and line and paragraph separators become line feeds, and the message is one line of at most 140 characters after cleaning.
- When a folder is removed from the tree, its items move to the top level with `folderRemoved` set. The in-memory store listens to `tree.subtree_removed`; the SQLite store adds a `folder_removed` column and a `BEFORE DELETE` trigger on `tree_nodes` that sets it before the foreign key action sets `folder_id` to NULL. This settles the open point of the 0021 review.
- `Task`, `Schedule` and the run outcome are types only. w-inbox adds a `TaskService` with its own shared contract in `core/inbox`.
- Events: `inbox.item_changed` (`created`, `coalesced`, `updated`, `resolved`) and `inbox.unread_changed` when the count changes.

Main process:

- `ModuleContext.profile` is the profile resolved before `ready`. Without it, the profile module runs one in-memory `default` profile on `dataDir`; the stub adopts a `CLAUDE_CONFIG_DIR` from the environment as that profile's directory, as the 0022 migration does, so the login does not change.
- `ModuleContext.desktop` gives modules `notify` and `setBadgeCount`. `src/main/desktop.ts` implements it with Electron; in hidden runs (`AGIDE_HIDDEN=1`) it shows nothing and records notifications in a global list that e2e tests read with `app.evaluate`.
- The unread count reaches the profile through the bus: the profile module subscribes to `inbox.unread_changed` and publishes the count when `shareUnread` is on. The inbox module and the profile module do not depend on each other for it. The inbox module emits its count once at init, so the registry and the badge are right after a restart.
- The dock badge belongs to w-profiles (the `showBadge` switch is a profile setting); notifications belong to w-inbox.

Renderer: a pane component receives `PaneProps` (`instanceId`, `config`, `inputs`). `PANE_COMPONENTS` maps first-party pane type ids to components and already holds `InboxPane` and `ProfileRail`, so the inbox and profile builders edit only their own component files. The stubs read only bus events through the existing `window.api`.

### Order of module initialization

1. profile (no dependencies): store, registry, own entry.
2. tree.
3. mcp (tree): registers the built-in commands. The session module starts the listener during its own init, because it needs the port to grant sessions.
4. session (tree, mcp, profile): the provider is chosen from `profile.settings().isolation`.
5. layout (tree): block registry, presets, later the layout files.
6. inbox (tree, sessions, profile): item store, hook mapping on `session.hook` events, tasks and scheduler. Its tables refer to `tree_nodes`.
7. `mcp.start()` once more after every module registered its tools.

Dispose runs in reverse order. The SQLite tables of the tasks module live in the inbox module's init, after the inbox tables, as 0021 section 2 requires.

### Ownership

| Builder | Owns | Must not edit |
|---|---|---|
| w-profiles | `src/core/profile/**` except the contract files below, `src/main/modules/profile.ts`, `src/main/index.ts` (profile resolution, lock, second instance, title), `src/main/window.ts` (title and colour strip), `src/renderer/panes/ProfileRail.tsx` and new files for the creation dialog and setup pane, `profile_*` commands, `e2e/profiles.spec.ts`, probe script E1 | other modules, the contract files |
| w-provider | `src/core/isolation/**` except the contract files, `src/core/session/**` except `hooks.ts`, `src/main/modules/session.ts`, `src/core/mcp/mcpConfig.ts`, probe scripts C2 and C3 | other modules, the contract files |
| w-layout | `src/core/blocks/**` except the contract files, new `src/core/layout/**` and `src/core/context/**`, `src/main/modules/layout.ts`, `src/renderer/App.tsx`, `src/renderer/layout/**`, `src/renderer/panes/paneComponents.tsx` and the tree, surface-host and placeholder pane components, `src/core/mcp/tools.ts` (image result), layout and capture commands, `docs/blocks.md`, layout e2e tests | other modules, the contract files |
| w-inbox | `src/core/inbox/**` except the contract files, `src/core/session/hooks.ts` (hook list and the printing `UserPromptSubmit` command), `src/main/modules/inbox.ts`, `src/renderer/panes/InboxPane.tsx` and new inbox and task pane files, `inbox_*`, `task_*` and `reminder_*` commands, inbox e2e tests | other modules, the contract files |

Contract files belong to this step and change only through the integration step: each `types.ts` named above, `core/blocks/manifest.ts`, `core/blocks/layout.ts`, `core/blocks/context.ts`, `core/profile/schemas.ts`, `core/profile/paths.ts`, the `*Contract.ts` files, `core/events/index.ts`, `main/context.ts`, `main/modules.ts`, `main/desktop.ts`, `renderer/panes/paneTypes.ts`, `package.json`, the lockfile and the configs. A builder records a needed contract change in its measurement file. `docs/parity.md` is regenerated by `pnpm parity` in the integration step; each builder runs it locally to see its own commands.

Shared seams that need care:

- w-provider changes how `buildLaunchArgs` passes `--settings` (a file path); w-inbox changes what `hookSettings` returns (hook list, the printing command). `hookSettings(inboxDir)` keeps its signature, so both can work at once.
- w-inbox adds `StopFailure` to the hook list only after a real-Claude run shows that 2.1.326 accepts it in `--settings`; an unknown hook name could make the CLI refuse the settings. P15 showed the `Elicitation` hook in `--settings`.

Dependencies: none were added in this step. w-layout adds `dockview-react` and w-inbox may add `rrule`, each with `pnpm add` once; a builder whose lockfile moved runs `pnpm install`. Neither package has install scripts, so `allowBuilds` does not change.

### Test strategy

- `pnpm test`: Vitest in plain Node over `src/core` and `src/main`. Each interface has a shared contract suite: `describeProfileStoreContract`, `describeProfileRegistryContract`, `describeIsolationProviderContract`, `describeBlockRegistryContract`, `describeInboxServiceContract`. The in-memory implementations, `LocalProvider` and `FakeProvider` run them now; the file store and registry, the SQLite inbox and any later provider must run the same suite. The registry suite takes a controlled clock and pid table (`TestLiveness`); the inbox suite takes a clock and creates its tree, so the SQLite inbox runs on the SQLite tree of the same database.
- `src/main/modules/m2Modules.test.ts` runs the stubs in the real module graph through `startAppModules`.
- `pnpm e2e` stays as in 0013. New e2e tests read recorded notifications through `app.evaluate` and use a temporary `AGIDE_ROOT` once w-profiles adds it.
- Real-Claude scripts (C2, C3, the layout script of 0020, the inbox script of 0021) follow 0013: Haiku, `--max-budget-usd 0.25` where `-p` allows it, an empty temporary directory, `--setting-sources user`, `--strict-mcp-config` unless a connector is the point, the `probes/lib.mjs` scrub that keeps `CLAUDE_CONFIG_DIR`. Fresh directories raise the folder-trust dialog (`notes/probes-m2.md`); scripts answer it as `probes/m2_lib.py` does and list the trust entries they leave.
- Reviews after the builders run mutations on: the registry staleness rule and the id-equals-file-name check, the 0600 and 0700 modes and the token-free arguments, the reserved block id and the closed permission set, the dedupe index and the plain-text rule.

### Choices

- `core/profile` (singular) holds what 0022 calls `core/profiles`. The layout schema is in `core/blocks/layout.ts`, not in a separate `core/layout`, because the agent tools and the registry both need it and the slice's runtime can live next to it.
- `ProfileRegistry` combines the writer and the reader of 0022 into one object per process; the file implementation can still keep them as separate classes behind it.
- `AgentEnvironment.attach` is added to 0022's interface (above).
- The registry entry omits `unread` until the inbox reports a count; the inbox stub reports its count at init, and the rail shows no badge for a profile without a count.
- Modules reach Electron only through `Desktop`, so the profile and inbox modules stay testable without Electron.

## Consequences

- The builders can work in disjoint files. The shared seams are the hook settings (above) and the contract files.
- 0021 is updated: the hook table, the waits table and the consequences now reflect P13, P14 and P15. 0022's interface gains `attach`. 0013's contract list grows by the files named under Ownership.
- The stubs run in the app today: an in-memory profile with its registry entry, the first-party block registry with the presets, an in-memory inbox whose count reaches the registry. Nothing renders them yet; `App.tsx` is unchanged until w-layout makes it a layout host.
- Not verified: `Desktop` with real macOS notifications and the dock badge (the hidden e2e runs record only); `StopFailure` in `--settings` on 2.1.326; the `BEFORE DELETE` trigger together with the foreign key action in the SQLite build inside Electron 45. In `node:sqlite` of Node 22 (SQLite 3.51) a check in this step showed the trigger marking the items of a deleted folder and of its deleted child before `folder_id` became NULL.

## Amendments after review

Contract changes:

- `AgentEnvironment.removeSessionFile(sessionId, name)` is added. The session service calls it for `mcp.json` on the first `SessionStart` of a launch, since the CLI has read the config by then; a resume writes the file again. `LocalProvider` removes every session directory when it is constructed, so files left by a crash do not outlive the next start.
- `PtySessionServiceOptions.onLaunchFailed(session)` runs when a launch fails, for create and resume. The session module revokes that session's MCP grant there. The shared pending-grant set is gone.
- `PtySessionServiceOptions.denyPaths` becomes `permissions.deny` rules for Read and Edit in the `--settings` JSON. The session module passes the app root. The rules cover the CLI's file tools; a shell command is not covered, and the local provider cannot stop an agent that runs as the user from reading the app root through the shell.
- `defaultSessionCwd(folderId)` returns `AGIDE_SESSION_CWD`, else `Agide/<folderId>` below the home directory (created 0700). A session whose working directory lies inside the app root is refused. The home directory is no longer the default.
- `ProfilePaths.login` (`data/login`) is the empty working directory of the login terminal; `profile_setup_status` creates it and returns it as `loginDirectory`, and reports `agentAccess: 'host-user'` for the local provider.
- `SqliteInboxService.holdEvents()` keeps inbox events back during the scheduler's transaction; `release` reports them after the commit and `discard` drops them after a rollback. `nextWake()` gives the earliest snooze end, which the scheduler timer includes.
- `parseRRule` refuses more than 48 occurrences a day from BYHOUR and BYMINUTE. `occurrences(dtstart, tzid, rule, from)` starts at the period before `from` for rules without COUNT, so the cost of a tick does not grow with the age of the rule.
- Task reminders store the due instant, truncated to the minute, with zone `UTC`, so a due time in the repeated autumn hour fires at the task's instant. `updateTask` runs in one transaction and keeps the reminder when the due time did not change. Enabling a schedule sets its next due time to the first occurrence after now.
- `LayoutManager.undoTarget` gives the document an undo would apply; `layout_undo` from an MCP caller checks its scopes like `layout_apply`. While the layout file on disk is invalid, a change stays in memory with a warning at `/file`, and the next valid file replaces it.
- The migration takes over a stale lock by renaming it, builds in `profiles.migrating.<pid>` and moves the browser `Partitions` directory with the default profile.

Decisions and limits:

- A layout file written straight to `<profile data>/layouts/` is adopted without a scope check. The local provider cannot enforce folder scope against an agent that can write files as the user.
- An isolated profile uses the profile's ssh config for git only. Plain `ssh` and `scp` run by an agent still read the default keys and config of the user. The setup pane says so.
- The permission rule syntax for absolute paths and its effect on a real session are not checked against a CLI run. Real sessions start with the rules in their settings (the real-Claude scripts pass).
- `--settings` stays inline JSON in the `claude` arguments. It holds the hook commands with the hook inbox path and the deny rules, and no token. The `settings.json` session file of the slices table is not written; `SessionFiles` accepts the name for the `http` hook transport, which is not built. The probe scripts C2 and C3 of the w-provider slice are not written; the real-Claude inbox script shows the `--mcp-config` path half of C2.
- Two "Not verified" items under Consequences are settled: 2.1.326 accepts `StopFailure` in `--settings` (a `claude -p` run of w-inbox; the hook was not seen firing), and the `BEFORE DELETE` trigger marks the item of a removed folder inside Electron 45 (`e2e/inbox.spec.ts`).
