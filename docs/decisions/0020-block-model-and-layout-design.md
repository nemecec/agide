# 0020 Block model and layout: design

Status: proposed
Date: 2026-11-17
Decided by: spike agents, pending user confirmation
Inputs: 0004, 0006, 0010, 0012, 0013, 0014, 0015 (R20), 0016 (R21), 0017 (R22), 0018 (R23), 0019 (R24), `notes/blocks-prior-art.md`, `app/src/core/commands/types.ts`, `app/src/core/events/EventBus.ts`, `app/src/core/surfaces/types.ts`

## Context

R20 (0015) asks for a UI that users assemble from defined building blocks, with agents that help build and change it. 0015 fixes the outline: a small set of block kinds, communication through the command registry, the typed event bus and a shared context only, a declarative versioned layout file that direct manipulation also writes, pre-assembled layouts, user blocks without code and code blocks in a sandbox, agent tools on the app MCP server, and the review ladder of 0010 for agent-written code. First-party features are blocks. 0015 leaves open: block API stability and layout migrations, the sandbox and permission model, shipping blocks as Claude plugins (R7), and how the shared context relates to observation scoping (R13).

Milestone 1 (0014) built the substrate: the command registry with zod schemas whose ids are also MCP tool names, the `Caller` type with folder scope for MCP callers, the synchronous typed event bus with the `AppEvent` union, IPC with one `commands:invoke` channel limited to the main frame, the app MCP server with per-session tokens, and the surface types of 0006 as types only. The renderer has a fixed layout in `App.tsx` with a tree pane and a surface pane.

The survey (`notes/blocks-prior-art.md`) found:

- VS Code reads static contribution points without running extension code and gates commands, menus and views with `when` expressions over context keys.
- Nimbalyst passes a typed host object to every block, built-in ones included, keeps a closed permission list with a first-use consent prompt, and warns in its own architecture document that a declared capability table is "an API contract, not a sandbox". Its SDK review found that docs, types and runtime had drifted apart.
- Claude Code mods draw only in Claude's own terminal, Desktop and VS Code interfaces and draw nothing under `claude -p`, so they cannot be the block runtime. Claude plugins can carry an Agide sidecar: `claude plugin validate --strict` (2.1.326) accepts `metadata.agide` pointing to a file in the plugin and rejects a top-level `agide` key.
- dockview and FlexLayout are current, MIT, declare React 19 in their peer range and serialize to JSON. golden-layout has had no release since 2022. rc-dock is Apache-2.0 with more dependencies. No engine was installed or run.
- Electron offers a sandboxed iframe with an opaque origin inside the app renderer, or a separate `WebContentsView` process with its own session partition. A permission manifest counts only where the main process enforces it on each bridge call.

## Decision

### 1. Block kinds

A block package contributes one or more of the kinds below. Every kind is registered by type id in a main-process `BlockRegistry`; layouts and other blocks refer to it by that id.

| Kind | What it is | Runs where | Who can contribute it in this design |
|---|---|---|---|
| Surface type | The 0006 `SurfaceType`: creation, persistence, mount, observation, tools for a tree leaf | Main process; views are `WebContentsView` or renderer components | First-party only. Third-party surface types wait for the utility-process loader of 0006 section 1 |
| Pane | A view placed in the layout that is not tied to a tree leaf: the tree, the surface host, inbox views, the agent roster, usage rankings, review queues | Renderer (first-party), sandboxed frame (code blocks) | First-party, declarative compositions of existing panes, code blocks |
| Command | A `Command` of the registry (0013): id, schemas, UI binding, MCP flag, `run` | Main process | First-party code; composite commands (an ordered list of registry calls with input templates, no loops) without code; code blocks contribute commands only through an MCP server in their plugin, under Claude's trust |
| Data source | A named, read-only query with a params schema and a row schema, plus the event types that invalidate it. Panes bind to it; the agent reads it through a tool | Main process | First-party code; derived sources (filter, sort, group over a first-party source) without code |
| Policy | Declarative rules read by a first-party engine: review policy (0010 section 5), inbox rules and quiet hours (0016), observation redaction patterns (0006 section 5), block grants | Data only, evaluated in the main process | First-party schema; users and blocks supply values. A policy from a block or a user layer can only tighten the effective policy |

Layouts, compositions and templates are not block kinds. They are documents that place and configure pane instances (section 4 and section 7).

A surface is shown in the layout through the `agide/surface-host` pane, which mounts whichever surface type the bound node has. The pane owns the bounds that a native view (the browser surface of 0006) must follow, and tells the main process to hide the native view during a docking drag.

### 2. Block manifest

A block package carries one manifest, `agide/block.json`, validated by one zod schema in `src/core/blocks/manifest.ts`. The same schema produces the TypeScript types, the JSON Schema that `blocks_list` and the docs publish, and `docs/blocks.md` through a generator that a unit test compares with the file, as `pnpm parity` does for `docs/parity.md`. First-party blocks declare the same manifest as TypeScript objects checked by the same schema.

Sketch:

```json
{
  "apiVersion": "1.0",
  "id": "acme-review-board",
  "version": "0.3.1",
  "title": "Review board",
  "engines": { "agide": ">=0.2.0 <0.4.0" },
  "panes": [
    {
      "type": "acme-review-board/board",
      "title": "Review board",
      "icon": "icons/board.svg",
      "tier": "code",
      "entry": "panes/board/index.html",
      "configVersion": 2,
      "configSchema": { "type": "object", "properties": { "columns": { "type": "array", "items": { "type": "string" } } } },
      "defaultConfig": { "columns": ["C", "D", "E"] },
      "size": { "minWidth": 240, "preferredWidth": 360 },
      "inputs": { "folder": { "contextKey": "node.current", "required": false } }
    }
  ],
  "compositions": ["compositions/review-corner.json"],
  "templates": ["templates/project-cockpit.json"],
  "dataSources": ["sources/my-open-items.json"],
  "commands": ["commands/open-board.json"],
  "events": {
    "emits": [{ "type": "ext.acme_review_board.card_opened", "schema": "events/card_opened.schema.json" }],
    "consumes": ["review.changeset_assessed", "context.changed"]
  },
  "context": { "reads": ["node.current", "selection.object"], "writes": ["selection.object"] },
  "permissions": ["commands.invoke:ui_focus_node", "data.read:review.queue", "storage.block"]
}
```

Rules:

- `id` equals the `name` in the plugin's `plugin.json` (kebab case; the reserved names of Claude plugins apply), and the validator rejects a mismatch. A marketplace entry may list the plugin under another name, but Claude Code namespaces components under the `plugin.json` name. Type ids are `<block id>/<local id>`. First-party types use the `agide/` prefix, so the block id `agide` is reserved.
- Third-party event types are `ext.<block id in snake case>.<name>` and carry a JSON Schema. First-party event types stay in the `AppEvent` union. A block cannot emit a first-party event type.
- Composite commands from a block get the id `ext_<block id in snake case>_<verb>`, so they keep the `<area>_<verb>` form of 0013 and cannot collide with first-party areas.
- `permissions` is a closed set (section 8). An unknown id is an error, not a warning.
- The manifest is pure data. The host lists, places and validates a block without running its code.

### 3. Communication channels

Blocks talk to the app and to each other through these channels and no other. Each block declares in its manifest what it uses, and the main process enforces the declaration for code blocks.

| Channel | Use | Shape |
|---|---|---|
| Command registry | Requests that change state or return a value | `invoke(id, input, caller)` returning `{ ok, value }` or `{ ok: false, error }` (0013). A code block's calls run with a new caller kind `{ kind: 'block', blockId, instanceId, scope }`, where `scope` is the instance's folder id or `all` (section 4); the registry checks the block's grant before parsing input. Commands that act on nodes keep `requireInScope` |
| Typed event bus | Facts that already happened, fan-out to any listener | Past-tense events with a `type` and a serializable payload (0013). Code blocks receive only the types they consume and hold a grant for, and only events whose node ids lie in the instance's folder scope |
| Shared context | What the user is looking at now, per window | A typed key-value map owned by the main process; changes emit `context.changed` with the key and window id |

Shared context keys in this design:

| Key | Value | Written by |
|---|---|---|
| `node.current` | the tree node id the user opened | tree pane, `ui_focus_node`, inbox deep links |
| `node.secondary` | a node id shown beside the current one | `ui_open_to_side` |
| `surface.focused` | surface id with keyboard focus | surface host |
| `selection.object` | `{ kind, id, label, data? }`, `data` capped at 32 KiB, marked untrusted | any pane that declares the write |
| `inbox.item.current` | inbox item id | inbox panes, notification clicks |
| `window.layout` | the layout id the window shows | layout engine |

A key holds references (ids and labels), never surface content. Content stays behind the surface's observation switch.

Shared context and observation scoping (R13):

- The shared context is the user's state, so an agent sees it only as observation. A later `context_get` tool and the per-turn digest of 0006 section 4 return context values filtered by the caller's folder: a key whose node lies outside the agent's folder reads as `outside_scope` with no id, and `selection.object` is withheld when its source pane shows another folder.
- A surface with observation `off` is not reported in context to any agent, even when it has focus.
- Every context read by an agent is logged in the access log of 0006 section 5, like an observation.
- Blocks never forward context to an agent on their own. A block that wants the agent to know something posts to the inbox or calls a registry command, both of which carry the block as the caller.

Shared context and the inbox (R21):

- An inbox item's deep link is a context assignment plus a reveal: `{ context: { "node.current": "<id>", "inbox.item.current": "<id>" }, reveal: { paneType, config? } }`. Opening an item writes the keys and asks the layout to show a pane of that type, adding it to the current layout as a split when none exists. The peek of 0016 is a surface host bound to `node.secondary` in that split that mounts the surface with the read-only peek mode of 0016, which does not take focus, so the message card stays visible.
- Inbox views are panes bound to the `inbox.items` data source with a filter config. The "several inboxes" of 0016 are pane instances with different filters, saved in layouts or as compositions.
- Unread counts for the profile badge (0017) come from the same data source.

`when` expressions over context keys for command enablement and pane visibility (the VS Code pattern) wait until the key set settles.

### 4. Layout file

A layout is a JSON document in the profile's data directory (0017), `layouts/<id>.json`. JSON because the agent writes it, zod validates it and JSON Schema describes it to the agent. Shipped presets live in the app resources, read only; editing a preset saves a copy in the profile.

Agide's own arrangement tree is the authoritative description of where panes are. The engine's serialization is kept only as `engineState`, a cache keyed by engine name and version and by a hash of the arrangement. On load the app uses the cache when the hash matches and rebuilds from the arrangement otherwise. The survey proposed storing the engine's serialization as the authoritative field; this record changes that, because an agent cannot write an engine's internal format reliably, and an engine change would make every file opaque again.

Fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | integer, the layout schema version |
| `revision` | integer, raised on every save; `layout_apply` checks it |
| `id`, `title` | layout id and display name |
| `instances` | map of instance id to `{ type, version, configVersion, config, bindings?, scope? }` |
| `arrangement` | tree of `split` (`row` or `column`, children with `size` weights) and `tabs` (`panes` list of instance ids, `active`) |
| `floating` | optional list of floating groups (waits for the engine spike) |
| `engineState` | optional cache, never edited by hand or by the agent |

A binding gives a pane input its value: `{ "context": "<key>" }` follows a context key, `{ "value": <json> }` is fixed, `{ "source": "<data source id>", "params": { ... } }` reads a data source. `scope` is a folder id or `all`; a code pane's bridge calls run with that folder (section 8).

Example, the "Session" preset (the milestone 1 arrangement as a layout):

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "id": "session",
  "title": "Session",
  "instances": {
    "tree": { "type": "agide/tree", "version": "^1", "configVersion": 1, "config": {} },
    "main": {
      "type": "agide/surface-host",
      "version": "^1",
      "configVersion": 1,
      "config": { "emptyText": "Open a session or tab from the tree" },
      "bindings": { "node": { "context": "node.current" } }
    }
  },
  "arrangement": {
    "split": "row",
    "children": [
      { "size": 1, "tabs": { "panes": ["tree"], "active": "tree" } },
      { "size": 3, "tabs": { "panes": ["main"], "active": "main" } }
    ]
  }
}
```

The "Pair" preset adds a second surface host bound to `node.secondary` to the right of `main`, so a session and its browser tab, or a session and a sub-agent transcript, show side by side. "Open to the side" in the tree context menu (`ui_open_to_side`) sets that key:

```json
"side": {
  "type": "agide/surface-host", "version": "^1", "configVersion": 1,
  "config": { "emptyText": "Use Open to the side on a tree item" },
  "bindings": { "node": { "context": "node.secondary" } }
}
```

with the arrangement `row: tree (1), main (3), side (3)`.

Both presets use only blocks that exist in the first slice. A "Supervisor" preset (tree, surface host, inbox, agent roster, usage ranking, review queue) ships when those panes exist.

Rules for the file:

- The file is the source of truth. Direct manipulation in the UI writes it (debounced, atomic temporary file and rename, `revision` raised). A file watcher reloads it when another program changes it; a write by the app itself is recognised by content hash and ignored.
- An invalid file on disk does not replace the running layout. The app keeps the last valid revision, shows the validation errors with their JSON paths, and never overwrites the user's file with the old content.
- An instance whose type is missing, disabled or outside its `version` range renders as `agide/placeholder` with the type, the reason and the untouched config. Saving keeps the instance as it was. Opening a layout never deletes data.
- Each window shows one layout; the window's layout id is kept in the profile's settings.
- Every applied revision goes into a bounded history in the profile's store. Undo applies an earlier revision as a new revision, so an undo can itself be undone.

### 5. Layout engine

dockview (`dockview-react`, which depends on `dockview` and the zero-dependency `dockview-core`), MIT, behind a `LayoutEngine` adapter in `src/renderer/layout/`. Reasons: a current major release line with a zero-dependency core, React 19 in the declared peer range, tabs, groups, floating groups and popout windows, and programmatic add and remove of panels, which the arrangement-to-engine adapter needs. The type declarations of `dockview-core` 8.9.0 name `toJSON()`, `fromJSON(data, options?)`, `addPanel`, `removePanel`, `addFloatingGroup` and `addPopoutGroup` on the dockview API. FlexLayout (MIT) is the fallback; it is pre-1.0 and has a smaller user base. The proprietary `dockview-enterprise` package is not used; it holds layout history, keyboard docking and keyboard navigation among other modules, so Agide's undo comes from its own revision history (section 4). rc-dock is not chosen for its extra dependencies, golden-layout for its lack of maintenance. The dockview packages have no install scripts, so `allowBuilds` in `pnpm-workspace.yaml` does not change.

The MIT license is compatible with the project's Apache-2.0 license (0012). The packaged app bundles dockview, so it ships the MIT licence text with its copyright line (2021 mathuo), and `NOTICE` lists the dependency.

Because the arrangement is Agide's own, the adapter is the only code that knows the engine. A switch to FlexLayout changes the adapter and drops the `engineState` caches.

The first slice starts with a check of dockview in this app before the adapter is written: React 19.3.1 in the Electron renderer, the placeholder round trip, a drag across a surface host that holds a native view, and a `toJSON`/`fromJSON` round trip of the `engineState` cache. If a check fails and cannot be worked around inside the adapter, the slice switches to FlexLayout and records why.

### 6. Versioning and migrations

| What | Version marker | Compatibility rule | Migration |
|---|---|---|---|
| Layout file | `schemaVersion` integer | The app reads its own and every lower version | Ordered pure functions `vN → vN+1` in `src/core/layout/migrations/`, each with a fixture test. Migration runs in memory on load; the result is written only on the next save, and the original is kept beside it as `<id>.v<N>.json`. A file above the known version opens read only with a notice, as the store's `migrate` refuses a newer schema (0013) |
| Block API (manifest, host object, bridge messages) | `apiVersion` `major.minor` in the manifest; `engines.agide` range | Minor versions add optional fields and calls only. The host supports the current major and the previous one during a deprecation period announced in the changelog | A block outside the supported range becomes a placeholder |
| Block config | `configVersion` integer per pane type | The block owns its config format | First-party and code blocks provide `migrateConfig(from, config)`; declarative blocks change their schema with a new block version and keep accepting old configs. The layout migration never edits block configs |
| Commands | id | Input changes add optional fields only | A breaking change gets a new command id; the old id stays as an adapter until the next major version and is marked deprecated in `blocks_list` and the parity table |
| Events and context keys | type name, key name | Payload changes add optional fields only | A type or key name is never reused with another meaning |

### 7. User-added blocks

Declarative tier (no code, no sandbox needed):

- A composition is a saved fragment of a layout: pane instances with config and bindings, and their arrangement. Inserting it into a layout copies the instances with new ids.
- A template is a composition with declared parameters (JSON Schema), for example a "project cockpit" that takes a folder id and binds every pane to it. Parameters are substituted into config and bindings only; there is no expression language.
- Derived data sources (filter, sort, group over a first-party source), composite commands, and policy values (section 1).
- These files live in the profile (`blocks/local/`) or in a plugin. They go through the same validator as layouts. A declarative block that only places first-party panes cannot raise anyone's permissions: every call it leads to runs with the caller of the person or agent who triggered it.

Code tier:

- Code blocks contribute panes only. A pane's `entry` is an HTML file in the package, served through a custom `agide-block:` protocol handler from the installed version's directory, with a CSP that starts at `default-src 'none'` and allows `script-src` and `style-src` from the block's own origin only. `connect-src` is `'none'`; network access goes through the bridge (section 8).
- Default tier: blocks the user or the user's agent wrote and accepted through the review ladder run in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`, so the origin is opaque) inside the app renderer. It sits in the DOM, so docking, theming and capture work. Blocks installed from any other marketplace run in a `WebContentsView` with `sandbox: true`, context isolation, no Node integration, their own session partition per block, a permission handler that denies every request, and navigation and window-open handlers that deny everything. The main process then identifies the sender by `webContents` id, which a compromised app renderer cannot forge. The surface host's bounds and drag handling (section 1) already serve native views.
- The bridge is a `MessagePort` per instance. The app renderer's host shim relays iframe messages and attaches the instance id from the frame it created; a `WebContentsView` block gets its port from the main process directly.
- The host object a code pane receives is the same contract a first-party pane uses (`config`, `inputs`, `setConfig`, `invoke`, `subscribe`, `context`, `storage`, `theme`), carried over the bridge. First-party panes call it directly.
- Themes reach code panes as CSS custom properties on load and on change.

Packaging (R7):

- A block package is a Claude plugin whose `plugin.json` has `metadata.agide` pointing to `./agide/block.json`. A top-level `agide` key is not used, because `claude plugin validate --strict` rejects it.
- Distribution, install, update, dependencies between blocks, `userConfig` with secure storage, and allowlists of marketplaces use the Claude marketplace format and the `claude plugin` CLI, run as a subprocess under the profile's `CLAUDE_CONFIG_DIR` (0017). Agide builds no marketplace of its own.
- Declarative blocks the user makes locally do not need a plugin; they are files in the profile.
- A block package may also hold a skill that teaches the agent the block's commands, and an MCP server for its data. Those components run in every Claude session of the profile with the user's rights, outside any Agide sandbox: on the host, or inside the isolation environment when the session runs under a provider of 0018. The trust prompt lists them (section 8).
- Claude mods are not a block runtime: a mod draws nothing in sessions under `claude -p` and only in Claude's own interfaces otherwise.

### 8. Security of third-party blocks

- Permission ids form a closed set: `commands.invoke:<command id>`, `events.subscribe:<event type>`, `context.read:<key>`, `context.write:selection.object`, `data.read:<source id>`, `storage.block` (a per-block key-value store in the profile), `net.fetch:<origin>`, `clipboard.write`, `notify`. No permission gives files, processes, Node APIs or other blocks' storage. A block that needs those ships an MCP server in its plugin and is shown as unsandboxed code.
- The main process checks every bridge call against the instance's grants and its folder `scope`. A grant the main process does not enforce is not added to the set.
- Commands that send input to sessions, perform outward actions (0010 section 6) or change policies are marked high risk in `blocks_list`. A block may request them only by exact id, and the pre-install listing shows them first.
- Pre-install listing, modelled on the `hooks:` and `calls:` output of `claude plugin validate`: panes with their tier, commands and events used, context read and written, data sources, permissions, and every plugin component that runs unsandboxed (hooks, monitors, mods, MCP and LSP servers, `bin/`). The plugin's trust level is that of its most powerful component.
- Updates: an update with the same or fewer grants applies; an update that adds grants or unsandboxed components stays disabled until the user approves the new listing. Claude Code updates a plugin in the background when auto-update is on for its marketplace, and the plugin's hooks and servers then run in Claude sessions before Agide shows a listing. Agide therefore adds block marketplaces with auto-update off and runs updates itself. A marketplace entry fixes a git source to a commit with `sha` and an archive by `sha256`.
- A block can be disabled at once from the blocks pane or by `block_disable`; its instances turn into placeholders.
- Everything a block sends to the agent (inbox text, `selection.object.data`, data source rows from its MCP server) is untrusted data: plain text in the UI and labelled as untrusted in tool results.
- A policy contributed by a block can only tighten. A block cannot register MCP tools on the app server; its own MCP server is the plugin's business under Claude's trust prompt.
- Bridge calls are rate limited per instance, and a pane that stops answering is unloaded.

### 9. Agent tools

All are registry commands with `mcp: true`, so the parity rule of 0013 covers them:

| Tool | Does |
|---|---|
| `blocks_list` | Lists block types with kind, version, tier, config JSON Schema, inputs, events, context keys, data sources, high-risk marks, and the presets, compositions and templates |
| `layout_get` | Returns a layout by id (default: the layout of the window that shows the caller's folder) with its `revision` |
| `layout_validate` | Validates a layout document or a JSON Patch against a layout without applying it; returns errors and warnings with JSON paths, and the placeholders it would create |
| `layout_apply` | Takes `layoutId`, `expectedRevision` and a full document or a JSON Patch. Validates, refuses a stale revision with `invalid_input` and the current revision, computes a readable diff (instances added, removed, moved; config and binding changes), applies it, and returns the new revision, the diff and an undo reference. The user sees the diff in a notice with an Undo button |
| `layout_undo` | Applies an earlier revision as a new one; UI-bound to Cmd+Z in layout edit mode |
| `block_scaffold` | Writes the skeleton of a composition, template or code pane (plugin directory, sidecar, schema, entry file, a test page) into a path inside the session's working directory. Writes nothing into the profile |
| `block_submit` | Takes a block directory in the working directory, snapshots it by content hash, validates it, builds the pre-install listing and opens a review unit. On accept the snapshot is copied into the profile's local marketplace and loaded |
| `ui_capture_window` | Returns a PNG of the window or of one pane instance (`webContents.capturePage` with a rectangle). Panes whose bound node lies outside the caller's folder, and surfaces with observation `off`, are masked. Each capture is logged in the access log. A capture of the whole window without masks is a UI action only |

The agent's layout changes are scoped: an MCP caller may apply a layout only to windows whose `node.current` lies in its folder, and may bind panes only to nodes in its folder.

Review ladder for agent work on blocks (0010):

- Layout changes and declarative blocks that use only first-party panes and request no grants are rung A: validator, diff and undo. Every such change is in the daily digest.
- A layout change or declarative block that grants a code block a wider `scope` than the caller's folder, or adds an instance of a code block that the user has not yet accepted, goes to rung C.
- A new or changed code block is a review unit: the content-hash snapshot against the last accepted snapshot, with reasons from the manifest. Default rungs: code with grants for reading only, C (the reviewer of rung B runs first, as 0010 requires from C); any `commands.invoke` of a state-changing command, `net.fetch` or `context.write`, D; any high-risk command or an MCP server, hook, monitor, mod or `bin/` in the package, E. Policy values from a block are policy changes and take the hard floor of 0010 section 2.
- Seen marks bind to the snapshot hash; a later change by the agent is a new unit. The agent can request a higher rung, never a lower one.
- Until the review slice of 0010 exists, `block_submit` puts every code block at rung E: the user reads the files before accept.

## Consequences

### First slice of milestone 2

Builds:

- `src/core/blocks`: the manifest schema, the `BlockRegistry`, JSON Schema export and the `docs/blocks.md` generator with its out-of-date test.
- `src/core/layout`: the layout schema at version 1, validation with JSON paths, the migration runner with a test migration from a fixture, the structural diff, JSON Patch application, revision check and the revision history with undo.
- `src/core/context`: the shared context store per window with `node.current`, `node.secondary`, `surface.focused` and `window.layout`, and the `context.changed` event.
- First-party panes registered as blocks: `agide/tree`, `agide/surface-host` (from `SurfacePane` and `TerminalPane`) and `agide/placeholder`. `App.tsx` becomes a layout host.
- The dockview check and the `LayoutEngine` adapter.
- The layout file in the profile data directory with the watcher, atomic writes and the invalid-file rule.
- Tools: `blocks_list`, `layout_get`, `layout_validate`, `layout_apply`, `layout_undo`, `ui_capture_window` with masking, and `ui_open_to_side`. `ui_capture_window` needs an image result in the MCP tool mapping, which returns text content only today (`src/core/mcp/tools.ts`).
- The "Session" and "Pair" presets and a layout switcher in the window.
- Tests: unit tests for the schema, migrations, diff, revision conflict, undo and the placeholder round trip; e2e tests for preset load, a hot reload of an edited file, an invalid file that leaves the layout running, and an apply and undo through the MCP harness; a real-Claude script on Haiku in which an agent switches the window to "Pair" through `layout_apply` and checks it with `ui_capture_window`.

Waits:

- Code blocks: the `agide-block:` protocol, both sandbox tiers, the bridge with grant enforcement, the pre-install listing, `block_scaffold` and `block_submit`.
- Plugin discovery and install through `claude plugin` (the `list` output format and the cache location under a custom `CLAUDE_CONFIG_DIR` are not verified).
- Compositions and templates, derived data sources, composite commands, policies as blocks, `when` expressions, floating groups and popout windows, third-party events, `context_get` and the context lines of the observation digest (with the observation slice).
- The inbox, agent roster, usage and review panes and the "Supervisor" preset, built as blocks when their modules exist.
- The ladder integration for blocks, which needs the review slice of 0010.

### Other consequences

- The browser surface (milestone 2 item 1 in 0014) mounts through `agide/surface-host` from the start, so its bounds and drag handling live in one place.
- Layouts are profile data (0017). Blocks are UI and always run on the host, also when agents run in an isolated environment (0018).
- The usage views of 0019 and the inbox views of 0016 are panes over data sources; their modules expose data sources from the start.
- The parity check of 0013 covers the new tools without change. Context writes from the UI that have no command (a click in the tree) go through `ui_focus_node` or a new command, so the agent has the same action.
- A rough guess for the first slice is 4 to 6 working days in 0005 units, inside the 15 to 25 days of 0015; low confidence.
- Not verified: dockview in this app (React 19.3.1, the serialization round trip, drag over a native view); whether Electron puts an opaque-origin iframe from a custom protocol in a separate renderer process; how a CSP with `'self'` resolves in an opaque-origin frame served from a custom scheme, and which `protocol.registerSchemesAsPrivileged` options the scheme needs; `webContents.capturePage` with a rectangle on a window that holds `WebContentsView` children (the Electron docs describe a capture of one page, so child views may need their own captures); a Claude plugin install with the sidecar from each marketplace source type; how Agide lists installed plugins per profile.
