# Spike plan v2: base for a task-focused agentic coding GUI

## Decision
Pick the base: fork Superset, fork Emdash, fork Nimbalyst, greenfield Electron shell, or a VS Code extension.

## Day 0: decisions and constraints (before any code)
1. Personal tool or tool for colleagues. This decides legality (see below) and whether AGPL code is acceptable.
2. Legal position, from Anthropic's legal-and-compliance page: an end user may sign in to the unmodified Claude Code binary with their own subscription, including on a third-party platform. Putting Claude Code in "your products" needs the Commercial Terms, subscription limits assume "ordinary, individual usage", and `claude -p` is documented as "the Agent SDK via the CLI". Treat the team case as unresolved: ask Anthropic (contact sales) before building for colleagues. A personal tool is the low-risk case.
3. Use one `claude` version for the whole spike: 2.1.326, the latest release on the npm `latest` tag on 2026-11-17. `--bare` "will become the default for `-p` in a future release"; bare mode never reads OAuth or the keychain and skips plugins, hooks and auto MCP. Subscription use through `-p` may break.
4. Scoring numbers (see Phase 3) fixed in writing before Phase 2.

## Safety rules
- Phase 0 runs on the real account, on the host, with no candidate code present.
- Candidates are cloned into fresh empty directories and run in a VM with a separate Claude login or a budget-capped API key, one test GitHub account and one Jira sandbox. Read postinstall scripts before installing.
- `claude -p` shows no trust dialog and runs a repo's `.claude/settings.json` hooks and `.mcp.json` servers. Never start `claude` inside a candidate repo or PR checkout without `--setting-sources user --strict-mcp-config`, and inspect the repo's `.claude/` folder first.
- App-hosted MCP server: bind 127.0.0.1, per-session token, check the Origin header.

## Phase 0 (days 1-2): base-independent probes, plain scripts
- P1 stream-json: `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`. Test multi-turn input, `--resume`, images, interrupts (SIGINT; the `capabilities` field in `system/init`), cost fields.
- P1b interactive TUI in a PTY, which is the likely launch path of existing forks. Compare event access (hooks, transcript files) with P1. Note `--bg`/`claude attach` and remote control as fallbacks.
- P1c permissions: `--permission-prompt-tool` (documented, absent from `--help`), the `PermissionRequest` hook, `--permission-prompts`. `-p` starts in Manual mode since 2.1.302, so app tools need an `mcp__app__*` allow rule.
- P2 reuse: user skills, a marketplace plugin and a claude.ai connector (Atlassian) in both P1 and P1b. A reviewer reports `-p` cannot run connector OAuth; authorize interactively first, then test. Also check whether `--strict-mcp-config` excludes claude.ai connectors.
- P3 app-hosted MCP: localhost HTTP server with `ui_create_folder`, `ui_move_session`, `ui_open_file`. The config entry needs `"type":"http"`; a missing type is skipped silently, so assert on `mcp_server_errors` and `mcp_servers` in `system/init`.
- P4 second agent via an ACP adapter (Codex or Gemini; Kimi if an adapter exists). ACP is for these only, since the Claude ACP adapter is built on the Agent SDK (unchecked).

Stop rule: if no launch path (P1, P1b) supports P2 and P3, revisit the architecture before any candidate work.

## Phase 1 (days 3-4): triage of five candidates
One sheet each: license file (not README), process layout and IPC, state store and persistence, extension points, upstream health (commits per week over 8 weeks, issue/PR response time, bus factor, release cadence), clean install and build time, start time, memory with 5 sessions. Also:
- Launch mode of the agent CLI (PTY or structured) and whether it survives the `--bare` change.
- Telemetry and auto-update behavior.
- For Superset: what works without a Superset account. Its MCP server is cloud-hosted and manages tasks, workspaces and terminals, not the app window.
Cut to at most 2 forks plus greenfield and VS Code. Cut a fork if the license blocks a private fork, the build does not reproduce in half a day, or core features need a cloud service.

## Phase 2 (days 5-10): discriminating slices only
Per base, 4 slices: S1 nested folder tree with drag and persistence (3 levels, survives restart); S2 task start from prompt, PR URL and Jira key; S3 UI parity (app MCP server; agent can create folder, move session, open file, start task; parity table of UI actions versus tools); S4 context attach (file, selection, agent message, image).
- VS Code gets S1, S3, S4 only, in a half-size slot (tree view with drag and drop, extension-hosted MCP server, `claude` in a terminal). It already covers LSP, Markdown/HTML preview, diff and build tasks.
- Track human hours and token spend separately from agent wall time. One agent per candidate in its own clone; a human reviews against the checklist. Stagger runs to respect one subscription's rate limits.
- Stop rules: more than 3 days on S1 in a fork marks its sidebar as hard to change. A base with no extension point that fails S3 scores at most 1 on R8.

Library work built once on the greenfield branch, then checked per base only for hostability (a pane or extension point exists):
- Monaco plus LSP client. TypeScript is the pass gate (go-to-definition). Kotlin LSP is a separate recorded risk.
- Serena and ast-grep as MCP servers; agent renames a symbol through each.
- Terminal pane running Gradle and npm.
- Image annotation with Excalidraw or tldraw, PNG export.
- Markdown render, edit and diff on mdast or Lexical/ProseMirror; HTML preview in a sandbox.

## Phase 3 (days 11-12): decide
- Score each requirement 0-3 (absent, major work, moderate work, works) and record days to reach 3.
- Proposed weights, to confirm on Day 0: must-have R1, R2, R4 (Claude), R5, R6, R7, R8 weight 3; R9, R11 weight 2; R3 and extra models weight 1. Any must-have below 2 needs a named plan.
- Pick a fork only if every must-have scores at least 2, its weighted score is at least equal to greenfield's, and estimated days to full scope is at most 70% of greenfield's. Otherwise greenfield.
- Fork cost: churn in the last 8 weeks on the files each fork had to patch, plus the conflict count of merging current upstream.
- Output: scorecard and a one-page decision record (base, runner-up, scores, risks, first milestone, fallback if Anthropic changes subscription rules again).

## Risks to the spike
Unequal polish (use checklist and time logs); rate limits; spike code reused as product (branches `spike/*`, never merged); scope growth into R9/R11 (measured once); stale facts (README and docs data from 2026-11-17, re-verify in Phase 1).
