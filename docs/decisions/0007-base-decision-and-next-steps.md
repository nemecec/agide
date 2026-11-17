# 0007 Base decision and next steps

Status: base accepted by the user on 2026-11-17 (see 0012, which also records the defaults for the decisions in the last section)
Date: 2026-11-17
Updated: 2026-11-17, recomputed with the reviewed R16 to R19 scores
Inputs: 0001, 0002, 0004, 0005, 0006, 0008, 0009, 0010, 0011; `notes/swarm-visibility.md`, `notes/swarm-orchestration.md`, `notes/collaboration-tooling.md`, `notes/review-features-candidates.md`, `notes/review-ladder-design.md`

## Context

0001 sets the decision rule. A fork is chosen only if:

1. every must-have scores at least 2;
2. its weighted score is at least the greenfield score;
3. its effort to full scope is at most 70% of the greenfield effort.

Otherwise the base is greenfield. Weights under 0001, 0002 and 0008: R1, R2, R4 Claude, R5, R6, R7, R8, R12, R13, R16, R17, R18 and R19 weigh 3 and are the must-haves; R9, R11 and R15 weigh 2; R3, R10 and extra models weigh 1. 0001 names no weight for R10; this record uses 1, as the spike task text does.

Every score below is reviewed (0005). The unreviewed report values for R16 to R19 appear only as a sensitivity row.

## Decision

The base is the greenfield Electron shell.

### Rule 1: must-haves at least 2

| Base | Must-haves below 2 |
|---|---|
| superset | R12 1, R13 1, R17 1, R19 1 |
| emdash | R12 1, R13 0, R17 1, R18 1, R19 1 |
| nimbalyst | R12 1, R13 1, R16 1, R19 1 |
| vscode | R13 1, R17 1, R18 1, R19 1 |

Every fork fails rule 1.

Scores of 2 on must-haves that 0005 marks as close to 1: superset R6 (nesting needs a data-model and drag-and-drop rewrite) and vscode R12 (1 under the 0002 cap if a tree item cannot open the integrated browser as a leaf; not verified).

### Rule 2: weighted score

Weights in order R1, R2, R3, R4, X (extra models), R5, R6, R7, R8, R9, R10, R11, R12, R13, R15, R16, R17, R18, R19: 3, 3, 1, 3, 1, 3, 3, 3, 3, 2, 1, 2, 3, 3, 2, 3, 3, 3, 3. Maximum 144.

```
                R1 to R15 (unchanged)                                                          R16 to R19
superset   6+6+2+6+3+9+6+9+6+2+3+4+3+3+4 = 72    + 2*3+1*3+2*3+1*3 = 6+3+6+3 = 18   = 90
emdash     9+6+2+6+2+9+6+9+6+4+3+4+3+0+2 = 71    + 2*3+1*3+1*3+1*3 = 6+3+3+3 = 15   = 86
nimbalyst  9+6+2+6+2+9+6+6+6+2+3+6+3+3+4 = 73    + 1*3+2*3+2*3+1*3 = 3+6+6+3 = 18   = 91
vscode     9+6+2+9+2+6+6+9+6+4+3+4+6+3+2 = 77    + 2*3+1*3+1*3+1*3 = 6+3+3+3 = 15   = 92
greenfield 2*36                          = 72    + 2*3+1*3+1*3+1*3 = 6+3+3+3 = 15   = 87
```

superset (90), nimbalyst (91) and vscode (92) pass rule 2; emdash (86) fails.

### Rule 3: effort at most 70% of greenfield

Effort sums from 0005, same row order, plus the shared PR-launch item.

```
                R1 to R15 + shared                      R16 to R19
superset   83                              + 6+17+7+23   = 53   = 136
emdash     99                              + 8+18+15+25  = 66   = 165
nimbalyst  82                              + 12+14+6+20  = 52   = 134
vscode     86                              + 6+19+16+28  = 69   = 155
greenfield 101                             + 7+17+14+29  = 67   = 168

70% of 168 = 117.6
superset 136/168 = 0.81   emdash 165/168 = 0.98   nimbalyst 134/168 = 0.80   vscode 155/168 = 0.92
```

Every fork fails rule 3.

### Sensitivity

| Change | Effect |
|---|---|
| R1 to R15 only (0008 not applied) | weighted superset 72, emdash 71, nimbalyst 73, vscode 77 against greenfield 72; effort ratios 83/101 = 0.82, 99/101 = 0.98, 82/101 = 0.81, 86/101 = 0.85. Rule 3 fails every fork |
| R16 to R19 at the unreviewed report values | weighted 93, 86, 91, 92 against 87; efforts 143, 167, 136, 153 against 166; ratios 0.86, 1.01, 0.82, 0.92. Same result |
| Greenfield R17 to R19 at the low ends of the review ranges in 0005 (16, 13, 28; R16 has no range and stays 7) | greenfield 165; nimbalyst 134/165 = 0.81. Rule 3 still fails |
| Greenfield effort underestimated | nimbalyst (134) passes rule 3 only if greenfield reaches 192 days or more, an increase of about 14% |
| Fork effort overestimated | nimbalyst passes rule 3 at 117 days or fewer against greenfield 168, a decrease of about 13% |
| Superset R8 at 7 days (MCP layer by design) | superset 139/168 = 0.83 |
| Drop the Slack surface days added to fork R12 rows (low confidence; 0005 does not state the figure, this row takes 3 days per base) | superset 133/168 = 0.79, emdash 162/168 = 0.96, nimbalyst 131/168 = 0.78; vscode 155/168 = 0.92, or 152/168 = 0.90 if its R12 figure holds Slack days. Rule 3 still fails |
| Superset R7 at 2 (the Artifact guard hook and the settings merge need removal, 0005) | superset 87 against greenfield 87; superset passes rule 2 at equality |
| Emdash R17 at 17 days (the sum of its work items, 0005) | emdash 164/168 = 0.98; unchanged |
| R10 without a weight | superset 87, emdash 83, nimbalyst 88, vscode 89 against greenfield 85; rule 2 results unchanged |
| Greenfield R12 at 1 (the "does not host today" reading of the 0002 cap applied to greenfield as well, 0005) | greenfield 84; emdash (86) then passes rule 2 with the others. Rules 1 and 3 unchanged |
| Fork R19 scored 2 (efforts of 20 to 25 days read as moderate) | every fork still has must-haves below 2: R13 for all, R12 for superset, emdash and nimbalyst, R17 for superset, emdash and vscode, R18 for emdash and vscode, R16 for nimbalyst |
| Overlap between requirements removed (R17 task start with R5 and R6; R18 app MCP server with R8) | not computed; lowers both sides of the ratio, direction unknown |
| Fork maintenance cost (churn, merge conflicts, removal of vendor account, relay, updater and telemetry code) | not measured; raises every fork total |

The rule 3 margin for the best fork (0.80 against 0.70) is within the error of code-reading estimates.

Rule 1 has parts of different strength:

- For superset, emdash and nimbalyst, R12 is 1 by the 0002 cap: none has a browser tab as a left-tree leaf today (`notes/surfaces-candidates.md`). The cap says "cannot host"; this record reads it as "does not host today". Under the other reading the cap does not apply and R12 becomes an effort judgement (14 to 18 days for the forks against 8 for greenfield). The first reading, applied to greenfield, would cap its R12 at 1 as well, since nothing exists there today; rule 1 tests forks only, so that changes rule 2 alone (sensitivity row above).
- Vscode R19 is 1 by the 0008 cap (plain diff tooling only). The Electron forks have more than a plain diff, so their R19 scores of 1 are effort judgements (20 to 25 days), not the cap. R19 alone does not firmly fail every fork under rule 1.
- Nimbalyst R16 is 1 because its subagent data comes only through the Agent SDK path that 0001 excludes; this follows from 0001, not from an effort figure.
- Emdash R13 is 0 because no observation channel to the agent exists in it (0005); this is a finding from code reading, not an effort figure.
- The other R13, R17 and R18 scores of 1, and the 2 on R12 for vscode, are effort judgements. 0005 has no day threshold between score 2 and score 1.

So rule 1 is firm for superset, emdash and nimbalyst under the first reading of the R12 cap, for nimbalyst also through R16 and for emdash also through R13. It is softer for vscode, which rests on effort judgements for R13, R17 and R18 and on the cap for R19. The base does not rest on one rule: every fork fails rule 1 and every fork fails rule 3, on separate evidence.

Greenfield scores 1 on R17, R18 and R19. Rule 1 tests forks only, so this does not enter the rule. It means the chosen base starts with major work on each of them, and its weighted score (87) is below superset, nimbalyst and vscode.

### Runner-up and what would settle it the other way

Runner-up: nimbalyst, with the lowest effort ratio (0.80) and the most useful parts: app-hosted MCP with per-session URL, `spawn_session` with model, effort and worktree, session tree with drag and drop, Lexical Markdown with tree diff, extension SDK, PR mode, and the alpha Crew extension with scheduled reviewers. Its Claude path conflicts with 0001 by default (Agent SDK; a proxy on the CLI path), the CLI path is off by default, and its subagent view depends on the excluded SDK path.

A fork would be chosen only if all of these were shown: a browser tab as a first-class tree leaf with folder-scoped observation reachable at moderate cost (R12, R13 to 2); every other must-have of that fork that scores below 2 raised to 2 (R16 and R19 for nimbalyst, R17 and R19 for superset); and the fork's effort at or below 70% of a greenfield estimate checked in stage 2. Running the fork would be needed to show the first; 0001 does not allow that without the user decision below.

### Stage 2

Build on the greenfield branch (`spike/*`, never merged into the product), in this order:

1. Shell and tree: Electron window, headless-tree with SQLite, nested folders with drag and persistence across restart (S1), session surface running the interactive `claude` in a PTY with hooks from `--settings` (0004).
2. App MCP server and command registry: token, Origin check, per-session URL with folder id; `ui_*` and `surface_*` tools; parity table of UI actions against tools (S3).
3. Browser surface: `WebContentsView` with persistent partitions, in-process debugger, hosted browser tools with schemas compared against the Claude in Chrome tool list (0006 option C), CDP highlight, service recognizer (0006 section 8).
4. Observation: `surfaces_observe`, per-surface switch, indicator, access log, redaction; a `UserPromptSubmit` digest hook.
5. Task start from prompt, PR URL, Jira key, Slack permalink and Notion URL (S2, 0011); context attach of file, selection, agent message and image (S4).
6. Agent nodes and history (0009): event normaliser for stream-json and hooks, agent store, removal timer, history view and transcript viewer.
7. Outward-action gate (0010, 0011): action class table, ask rules per connector tool, `PreToolUse` command inspector, sandbox network allowlist, draft and approve dialogs.
8. Review first slice (0010): checkpoint at turn end, app-run checks and rule reasons, changeset, file and hunk views with seen marks, a rung B reviewer process, policy parser.
9. Swarm process manager (0011): process per agent, tier table, per-agent and swarm caps, `swarm_*` tools.
10. Slack surface over the web client plus the connector.
11. Probes still open, each a small script in `probes/`: PTY deny and built-in tools through the `PermissionRequest` hook; PTY interrupt and image paste; `--session-id`, `--resume` and `--fork-session` in the PTY; `additionalContext` injection in both paths; a stored run of the `--strict-mcp-config` connector check; a run in a checkout with a `.mcp.json` and project settings that confirms, in both paths, the documented behaviour that `--setting-sources user` without `--strict-mcp-config` skips them and keeps connectors, and whether it suppresses the project `CLAUDE.md` (decides PR tasks with connectors and the reviewer launch); the Atlassian v2 connector's tool names from `mcp_status` after the move; the `capabilities` entries and `messaging_socket_path`; `--bg`, `claude agents` and `claude attach` under the subscription; ask rules on `mcp__claude_ai_*` tool names in auto mode; `updatedInput` through the hook and through `can_use_tool`; `agent_id` on PTY approval hooks; `SendMessage` and `stop_task` on a running subagent; `isolation: worktree` with uncommitted changes; subagent inheritance of the app server from `--mcp-config`; `/code-review` with an explicit range reporting through an app tool; one connector write call to a test target; P4, a second agent through ACP (`codex-acp`, `gemini --acp`, Kimi); a model other than Haiku; several concurrent sessions on one subscription.
12. Library checks from the spike plan: Monaco with `monaco-languageclient` and TypeScript go-to-definition as the pass gate; Kotlin LSP as a recorded risk; Serena and ast-grep renames; Excalidraw PNG export; mdast outline and diff.
13. Track human hours, agent wall time and token spend per slice, and re-estimate greenfield effort from the measured slices. If the re-estimate exceeds the threshold in the sensitivity table, reopen this record.
14. A cross-family review of these decision records, as 0003 requires.

### Decisions only the user can make

| Decision | Options | Recommendation |
|---|---|---|
| Build and run third-party candidates on the host (no VM exists) | (a) do not run them; (b) run on the host with precautions; (c) create a macOS VM first (Apple Virtualization framework through a tool such as UTM or Tart) and run there | (a) for now: the base decision does not depend on running them. If running becomes necessary (for example to test Superset's extension host for Claude in Chrome), take (c). If (b) is chosen anyway: a separate macOS user account with no access to the main home directory; a separate Claude login or a budget-capped API key, never the main `CLAUDE_CONFIG_DIR`; a test GitHub account with a fine-grained token; no SSH agent and no AWS profiles in that account; read every `postinstall` and lifecycle script before install and install with scripts turned off where the build allows; an outbound firewall rule for the app; disable auto-update and telemetry by environment or build flag; delete the account afterwards |
| Accept greenfield as the base | accept; ask for a check by running forks | accept: every fork fails rule 1 and rule 3 on the scores in 0005. Each rule alone has the limits named under Sensitivity |
| Reading of the 0002 cap on R12 | "does not host a browser tab as a tree leaf today"; "cannot reach it at moderate cost" | the first reading, which this record uses; under the second, fork R12 needs a checked estimate |
| Treatment of new must-haves in rule 1 | keep the rule; let a must-have below 2 pass with a named plan (as the spike plan proposes) | keep the rule. Greenfield also scores 1 on R17, R18 and R19, so the chosen base starts with major work there; stage 2 items 6 to 9 hold that work |
| Claude launch path | PTY only; stream-json only; both | both, PTY primary (0004); swarm and reviewer agents on stream-json (0009, 0011) |
| Hooks in the user's `~/.claude/settings.json` | write into the user file as the forks do; pass through `--settings` | `--settings`; the user file stays untouched |
| Permission mode and outward gate for app-launched agents (the user's `defaultMode` is `auto`) | (a) keep auto, add ask rules for every outward tool, a `PreToolUse` hook and a sandbox network allowlist; (b) run swarm agents in manual mode; (c) rely on `can_use_tool` alone | (a): (c) misses every call that auto mode approves (0010); (b) prompts on every edit |
| Reviewer model on the high rungs | `fable` (most capable per the model-config docs); `opus` (lower cost) | `fable` at rungs C to E, `opus` at rung B, revisited with the measured review spend |
| Where the per-project review policy lives | committed `.agide/review.yaml` in the project repo (visible to colleagues in shared repos); app-side store per repository; both, with the app store tightening the file | app-side store for shared work repositories; a committed file only where the team agrees. The app reads a committed file from the base commit (0010) |
| Claude in Chrome | hosted equivalents; real-Chrome leaves; both | both: hosted tools by default, "open in Chrome" per leaf (0006) |
| Borrowing code from MIT or Apache-2.0 candidates (for example Superset's CDP bridge, Nimbalyst's MCP host and `spawn_session` schema) | read only; copy with license notices | copy small parts with notices where they save time; no dependency on the vendors' packages |
| Observation default per surface type | off; on-demand; live | on-demand for browser and sessions, off for Slack and Discord (0006) |
| Slack and Discord | web client plus connector; native API app; Discord bot | Slack web client plus connector first; Discord later through a bot on a server the user administers |
| Atlassian connector | keep v1 until 2027-03-01; replace it with the v2 connector now | replace it before 2027-03-01. The connector notice says the v1 endpoint is removed then; Atlassian's support pages say v1 use moves to v2 tools automatically and do not say the endpoint is removed (0004). Both tell a Claude user to remove the v1 connector and add the v2 one. Moving early costs one authorization and shows the v2 tool names before the gate tables are built |
| Total effort and scope | accept the greenfield estimate of 168 working days for one engineer plus agents; defer some of R16 to R19 or other requirements to a later release | no recommendation: only the user can weigh the effort against the use. Stage 2 item 13 gives a measured re-estimate to decide on |
| Swarms on the subscription login (decided 2026-11-17: the first option, see 0012) | run app-started swarms under the subscription; use an API key for swarm agents (needs a change to 0001); ask Anthropic first | no recommendation beyond a low cap on concurrent agents until the user decides. Anthropic's legal page says advertised plan limits assume ordinary, individual usage; whether an app-run swarm fits that is not stated there |
| Design records 0009, 0010 and 0011 | confirm; change | confirm after reading; they are proposals by the spike agents |
| Kotlin language server | accept the JetBrains alpha with expiring builds; editor-side Kotlin through Gradle output only | accept the risk for the editor; the agent uses the user's existing Kotlin LSP plugin in Claude Code |
| Scope of R5 | PR integration without in-app review submission; include approve and request changes | include later; it does not change the base |

Question for the user, not a decision: is the claude.ai login used for the tool an organization account whose admins set connector tool controls (`blocked` or `ask`)? Such controls are enforced locally by Claude Code and sit above the app's outward gate (0011).

## Consequences

- Stage 2 starts on greenfield with the surface interface, the browser surface and observation as core parts, as 0002 requires, followed by agent nodes, the outward gate, the review slice and the swarm manager.
- Nimbalyst and Superset stay as reference code for parts (MCP host, `spawn_session` schema, CDP bridge, tree drag and drop, subagent roster), read under their licenses.
- The decision rests on code reading and documentation. No candidate was run, and no greenfield slice exists yet. The rule 1 result for the Electron forks rests on the 0002 cap for R12 as read above, and for nimbalyst also on R16 under 0001; for vscode it rests on effort judgements and the R19 cap. The rule 3 result rests on effort sums, with a margin inside the estimate error. The base follows because every fork fails rule 1 and rule 3, and a fork is chosen only if all three rules hold.
- If a stage 2 re-estimate or a later fork check changes R12 or R13 for a fork to 2, or the greenfield total reaches 192 days, this record is reopened.
