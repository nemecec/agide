# 0005 Candidate triage and scores

Status: proposed
Date: 2026-11-17
Inputs: `notes/reports/*.json`, `notes/reviews/vscode.json`, the reviews of this run (superset, emdash, nimbalyst, greenfield libraries, surfaces research, surfaces candidates, probes), `notes/triage-*.md`, `notes/greenfield-and-libraries.md`, `notes/surfaces-candidates.md`, `notes/surfaces-and-browser.md`, `probes/RESULTS.md`; for R16 to R19 `notes/swarm-visibility.md`, `notes/collaboration-tooling.md`, `notes/swarm-orchestration.md`, `notes/review-features-candidates.md`, `notes/review-ladder-design.md` and their independent reviews
Updated: 2026-11-17, R16 to R19 rows added after review

## Context

Decision 0001 names the candidate bases and the scoring scale; 0002 adds R12 to R16, and 0008 adds R17 to R19. Every candidate was read as a shallow clone. Nothing was installed, built or run, so all scores and efforts rest on reading code and documentation. Independent reviewers checked each report against the sources. Where a review corrects a report, the correction is applied below unless the record says otherwise.

Storage of the evidence: only the VS Code review is on disk (`notes/reviews/vscode.json`). The other reviews of this run exist only as summarized in this record. Superset has a triage note and no structured report. The R12, R13 and R15 scores and efforts for the forks and VS Code have no source file: `notes/surfaces-candidates.md` holds the findings behind them without numbers. The greenfield R12, R13 and R15 figures are in `notes/surfaces-and-browser.md`. The R16 to R19 reviews are not stored in the project; each note lists the corrections it took in a closing "Review corrections" section, and the scores below are the corrected values in those notes.

Scale: 3 works today (effort 0), 2 moderate work, 1 major work, 0 absent or infeasible. Effort is working days for one engineer plus agents to reach 3.

Rules applied the same way to every base:

- A score of 3 needs effort 0. Greenfield has nothing working today, so no greenfield row scores 3 (the library report scores such rows 3; this record scores them 2).
- R4 is split into R4 Claude (weight 3) and extra models (weight 1), as 0001 weighs them.
- R14 is part of R8. The R8 effort includes the show-the-user actions (open, focus, reveal, highlight) and is not added twice.
- R5 is read as PR integration: list, checkout, diff, checks, create, merge and comments. Submitting an approving or blocking review in the app is outside the score and noted per base.
- R12 for the forks adds the Slack surface type, which no fork has. The greenfield R12 estimate already includes it. This addition is mine, low confidence.
- A shared item applies to every base: a launch mode for PR checkouts that skips the repo's hooks and MCP servers and keeps connectors (0004, item 7). It appears as its own row.

## Decision

### Candidate sheet

| | superset (now Paradev) | emdash | nimbalyst | VS Code extension | greenfield Electron |
|---|---|---|---|---|---|
| License | MIT, no other license files, CLA for upstream contributions only | Apache-2.0, trade names excluded | MIT, DCO only; the Agent SDK dependency is under Anthropic commercial terms | Own extension code; Anthropic Claude Code extension is all rights reserved and used unmodified | Own code; libraries MIT or Apache-2.0; tldraw excluded by license terms |
| Claude launch path | Interactive CLI in a PTY with `--dangerously-skip-permissions` through a PATH wrapper; `claude --strict-mcp-config -p` for workspace naming; an optional chat path calls the Agent SDK `query` directly (excluded by 0001) | Interactive CLI in a PTY, no `-p` flags; optional ACP chat on the Agent SDK; a usage probe calls the Agent SDK in a loop while the usage view is shown (removable) | Default provider is the Agent SDK (excluded). The `claude-code-cli` provider runs the interactive CLI in a PTY, is off by default, and routes traffic through a local proxy with an undocumented first-party env flag; no jsonl transcript backend exists | Own `claude` in an integrated terminal; auto-connects to the Anthropic extension's `ide` server | Interactive CLI in a PTY, `-p` stream-json as a second path (0004) |
| Hooks and user config | Merges hooks into the real `~/.claude/settings.json`; writes plugin MCP entries to `~/.claude.json`; a PreToolUse guard denies the first Artifact publish per app terminal | Rewrites `~/.claude/settings.json` wholesale before each PTY spawn | `MCPConfigService` writes `~/.claude.json` through `os.homedir()` and ignores `CLAUDE_CONFIG_DIR` | Hooks would be the extension's choice | `--settings` per launch, no writes to user files |
| Extension points | `@superset/panes` typed registry, but the app's pane list is fixed; skills and CLI commands as agent plugins; host tRPC; managed-MCP writer | Compile-time contributions (tabs, plugins), typed command catalog, wire contracts | Runtime extension SDK: custom editors, panels, backend modules, `aiTools` served on the app MCP server, agent providers | VS Code extension API: tree views with drag and drop, webviews, commands, terminals; no layout or window control | Whatever the app defines (0006 surface interface) |
| Agent-facing control today | `superset` CLI over local host tRPC (panes, browser with per-pane CDP, workspaces, tag folders) plus shipped skills; cloud MCP has no UI tools | none | App-hosted loopback MCP with token and per-session URL; spawn tools; browser extension tools | none; an extension-hosted MCP server is possible | none |
| Upstream health (words; figures in the triage notes) | Very active, several authors, frequent releases and daily canary; steady churn in the files a fork would patch | Very active, one author writes most commits, no commits on main after 2026-11-10 at reading time | Very active, one author writes nearly all commits, frequent prereleases, a very large and often changed session history component, database mid-migration | VS Code very active; the Anthropic extension is closed source and changes often | Electron and core libraries active; JetBrains Kotlin LSP alpha with expiring builds; `monaco-languageclient` lags `monaco-vscode-api` |
| Cloud dependence | Production build forces a vendor sign-in and organisation; the account-free path is a development flag only; default URLs, updater and analytics point at the vendor; local CLI path needs an organisation id | Optional vendor OAuth broker; update feed at the vendor; local work needs no account; telemetry only with a CI key | Account, sync, team and sandbox features use vendor services; local sessions, editors, MCP and PR mode work without an account per docs; analytics on by default | Microsoft marketplace and telemetry (not assessed) | none |

### Scores after reviewer corrections

Weights per 0001 as amended by 0002 and 0008. Cells are score / effort days. Every row is reviewed; R16 to R19 were reviewed in a later run than R1 to R15.

| Req | Weight | superset | emdash | nimbalyst | vscode | greenfield |
|---|---|---|---|---|---|---|
| R1 desktop GUI | 3 | 2 / 4 | 3 / 0 | 3 / 0 | 3 / 0 | 2 / 4 |
| R2 attach context | 3 | 2 / 5 | 2 / 6 | 2 / 3 | 2 / 3 | 2 / 5 |
| R3 image annotation | 1 | 2 / 4 | 2 / 4 | 2 / 4 | 2 / 5 | 2 / 3 |
| R4 Claude | 3 | 2 / 1 | 2 / 1 | 2 / 10 | 3 / 0 | 2 / 3 |
| Extra models | 1 | 3 / 0 | 2 / 1 | 2 / 2 | 2 / 2 | 2 / 7 |
| R5 GitHub PRs | 3 | 3 / 0 | 3 / 0 | 3 / 0 | 2 / 3 | 2 / 6 |
| R6 task tree and start | 3 | 2 / 11 | 2 / 11 | 2 / 8 | 2 / 10 | 2 / 10 |
| R7 reuse Claude features | 3 | 3 / 0 | 3 / 0 | 2 / 2 | 3 / 0 | 2 / 2 |
| R8 agent drives UI (incl. R14) | 3 | 2 / 4 | 2 / 14 | 2 / 8 | 2 / 6 | 2 / 8 |
| R9 LSP and agent AST | 2 | 1 / 12 | 2 / 8 | 1 / 10 | 2 / 3 | 2 / 12 |
| R10 build tools | 1 | 3 / 0 | 3 / 0 | 3 / 0 | 3 / 0 | 2 / 2 |
| R11 Markdown and HTML | 2 | 2 / 5 | 2 / 7 | 3 / 0 | 2 / 8 | 2 / 12 |
| R12 surfaces | 3 | 1 / 18 | 1 / 18 | 1 / 14 | 2 / 15 | 2 / 8 |
| R13 shared awareness | 3 | 1 / 12 | 0 / 18 | 1 / 11 | 1 / 15 | 2 / 9 |
| R15 Claude in Chrome tools | 2 | 2 / 6 | 1 / 10 | 2 / 9 | 1 / 15 | 2 / 9 |
| R16 visible swarms | 3 | 2 / 6 | 2 / 8 | 1 / 12 | 2 / 6 | 2 / 7 |
| R17 collaboration tooling | 3 | 1 / 17 | 1 / 18 | 2 / 14 | 1 / 19 | 1 / 17 |
| R18 swarm orchestration | 3 | 2 / 7 | 1 / 15 | 2 / 6 | 1 / 16 | 1 / 14 |
| R19 layered review | 3 | 1 / 23 | 1 / 25 | 1 / 20 | 1 / 28 | 1 / 29 |
| Shared: safe PR launch with connectors | – | 1 | 1 | 1 | 1 | 1 |

Weighted totals, effort sums and the decision rule are in 0007.

### Notes per base

Superset:
- R1 2 / 4: the vendor sign-in gate, default URLs and the updater feed need patching; behaviour of cloud-dependent shell parts with no server is unknown.
- R2: the chat composer counts only for agents other than Claude, since Claude's chat path is the Agent SDK. The effort includes a composer for terminal sessions.
- R3 2 / 4 per the review, against 1 / 8 in the triage note (pane and image view registries and path paste exist; low confidence).
- R5: no review submission (approve or request changes); about 1 to 2 days if in scope.
- R6 is borderline 1: nesting needs a data-model and drag-and-drop rewrite, and the S1 stop rule of the spike plan is likely to trigger.
- R7 3: P2 passes in a PTY outside Superset. Open: whether the PATH wrapper and `CLAUDE_CONFIG_DIR` forwarding keep the same login. The Artifact guard hook changes stock Claude behaviour and needs removal. That removal is work, so 3 / 0 conflicts with the rule above that a score of 3 needs effort 0. At 2 the superset weighted total equals the greenfield total (0007, sensitivity).
- R8 4 days counts the `superset` CLI and skills as "another API". If an MCP layer is required by design, effort is 7.
- R15: a per-pane `webContents.debugger` CDP bridge is merged on the default branch (not run). Superset also hosts Chrome Web Store extensions and emulates native messaging from Chrome's host manifest directories, so the stock Claude in Chrome extension might install and connect there; no `chrome.debugger` shim was found, so its page tools may fail. Open question, low confidence.

Emdash:
- R3 2 / 4 per the review, against 1 / 8 in the report (tab providers, image renderer, terminal file drop exist).
- R5: no review submission, inline comment posting, reply or thread resolution; no PR URL paste. 2 / 2 to 3 days if in-app review is in scope.
- R7 3: P2 passes in a PTY outside Emdash. Open: Emdash takes `CLAUDE_CONFIG_DIR` from a `$SHELL -ilc env` capture, and the user's login shell is fish. The rewrite of the user's `settings.json` (candidate sheet) is a change a fork has to make, the same conflict with effort 0 as for superset.
- R8 14: the S3 estimate of 12 days plus reveal and highlight, which the report did not itemize. The command catalog lowers the bridge cost.
- R9: Java and Kotlin absent from the LSP table.
- R11 effort about 7 per the review, against 10 in the report: an HTML preview renderer with Monaco source exists.
- R13 0: no observation channel to the agent found.

Nimbalyst:
- R1 3 / 0 and R7 2 / 2 after the review (a score of 3 needs effort 0; the CLI path is off by default, untested on 2.1.326, uses legacy SSE for its MCP entries, which no probe covers, and its MCP config ignores `CLAUDE_CONFIG_DIR`).
- R4 Claude 10 days: removing the proxy (0001) needs a new transcript backend from jsonl or hooks, and the first-party env flag must go. The split of the reviewed 12 days into Claude and extra models is mine.
- R6 and R8: whether the spawn tools can start a `claude-code-cli` child is not checked.
- R8 2 / 8, against 6 in the report. The reason for the difference is not recorded; emdash and greenfield carry the same added days for reveal and highlight.
- R12 1 and R13 1 per the review: the browser opens as an editor tab and is not a tree leaf, and editor context reaches only the SDK and API providers; in the CLI provider the context parameter is unused.
- R15 effort about 9 per the review: the browser tools lack console, network, page text, accessibility tree, form and upload tools.

VS Code extension:
- R2 effort 3: a `claude` in the integrated terminal gets selection and active-file context through the Anthropic extension's `ide` server. That path depends on a closed-source extension and is treated as optional.
- R4 split: Claude 3 / 0, extra models 2 / 2 (Kimi unchecked, low confidence).
- R7 3: the report's evidence is docs only; P2 passes in a PTY with the Atlassian connector, which supports the score.
- R12 2 / 15 is kept from the surfaces report. Whether a tree item can open the integrated browser as a leaf in the sense of 0002 is not verified; if not, the 0002 cap makes it 1.
- R13 1 / 15 per the review: the docs describe the integrated browser's sharing features for VS Code chat and name no Claude harness, and no extension API or CDP endpoint for it is documented. Whether Claude Code in VS Code can use those chat tools is not verified. R12 at the same effort scores 2, so the line between 2 and 1 is a judgement here (see Consequences).
- R11 2 / 8 is near the line to 1.

Greenfield:
- Scale: R1, R3, R5, R7, R8 and R10 score 2 here, against 3 in the library report.
- R4 split: Claude 2 / 3, extra models 2 / 7 (ACP client UI; `codex-acp` and Kimi untested).
- R8 effort 8, against 6 in the library report, for the show-the-user actions; R14 (3 / 3 in `notes/surfaces-and-browser.md`, 2 under this record's scale) is counted inside it.
- R9 may drop by about 1 day: Claude Code's native LSP tool with the user's Kotlin, Java and other LSP plugins gives the agent inspection; rename still needs Serena or ast-grep.
- R12, R13, R15 from the surfaces research. R15 is low confidence: matching the Claude in Chrome tool semantics (coordinate scaling, element references, tab-group scoping, per-site permissions) is the bulk of the work.

### R16 to R19 after review

Changes from the reports (report value, then reviewed value):

| Base | R16 | R17 | R18 | R19 |
|---|---|---|---|---|
| superset | 2 / 10 to 2 / 6 | 2 / 15 to 1 / 17 | 2 / 9 to 2 / 7 | 1 / 26 to 1 / 23 |
| emdash | 1 / 12 to 2 / 8 | 2 / 16 to 1 / 18 | unchanged | unchanged |
| nimbalyst | unchanged | 2 / 12 to 2 / 14 | 2 / 8 to 2 / 6 | 1 / 22 to 1 / 20 |
| vscode | unchanged (confidence low to medium) | 1 / 17 to 1 / 19 | unchanged | unchanged |
| greenfield | 2 / 8 to 2 / 7 | 1 / 15 to 1 / 17 | 1 / 18 to 1 / 14 | 1 / 24 to 1 / 29 |

Rationale per requirement:

- R16. Superset already registers `SubagentStart` and `SubagentStop`, keeps a roster with a running count, moves finished agents to a capped in-memory list and opens transcripts in panes; missing are tree child rows, waiting and failed states, durable history and workflow agents. Emdash and VS Code both get subagent data from PTY hooks only, and emdash already has the hook server and installer, so both score 2. Nimbalyst stays 1: its subagent data comes only through the Agent SDK path that 0001 excludes. Greenfield loses the app-started swarm tool, which belongs to R18.
- R17. The agent half (connectors and `gh`) works on every base. Superset's Slack, Notion and Linear integrations run in its hosted backend with the Anthropic SDK and server-held tokens and are not reusable under 0001. Emdash's stated effort (18) exceeds greenfield's (17), so it cannot score 2 while greenfield scores 1; the work items listed for emdash in the note sum to 17 (see the disagreements table). Every base gains task start from Slack and Notion objects. Greenfield is itemized and includes the corrected outward gate (ask rules per connector tool, a `PreToolUse` command inspector, a sandbox network allowlist). Nimbalyst keeps 2: app MCP, browser tools with URL read, `gh` PR flow.
- R18. Merge is outside R18 as 0008 states it and is removed from every effort. Superset has start, model and effort, steer, stop one and worktree isolation as MCP tools, but every call goes through the vendor relay. Nimbalyst's `spawn_session` takes model, effort and worktree. Greenfield builds on the Workflow tool under `-p` (probed), background sessions and cross-session messaging (docs only).
- R19. No base has a per-changeset risk model, a review ladder chosen by policy or a review record. The 0008 plain-diff cap applies only to vscode; superset, emdash and nimbalyst score 1 on remaining work. Superset has per-turn changesets with undo and webhook-triggered agent runs (hosted backend); nimbalyst has the alpha Crew extension with scheduled reviewers and a notification ladder; emdash has review prompts and automation templates. Greenfield is 29 days with the rows the review found missing (checkpoint and check executor, digest and queue, summary generation, `report_outcome` loop, merge gate, reviewer settings isolation), so every fork figure is below greenfield.

Confidence is low for every R17 to R19 effort and for superset R16. The R19 fork efforts are totals with no split across work items.

### Unresolved disagreements between reports and reviews

| Topic | Report | Review | Status |
|---|---|---|---|
| Superset R8 effort | 7 days with an MCP layer | about 4 days, CLI counts as "another API" | 4 used; depends on whether MCP is a design requirement (user decision in 0007) |
| Superset R6 | 2 | 2 kept, borderline 1 | 2 used; does not change the outcome in 0007 |
| Claude in Chrome in Superset | not feasible in Electron | open question through Superset's extension host and native messaging | undetermined; settles only by running Superset |
| Nimbalyst R13 and the triage note's "PTY CLI path exists" | 2 / 8 | 1 / 10 to 12; how a PTY session gets context is unchecked | review value used, low confidence |
| Emdash and superset R5 | 3 | 3 only if in-app review submission is out of scope | 3 used under the stated reading |
| Greenfield R5 extra day for safe PR launch | not listed | added to greenfield | moved to the shared row for every base |
| Probe: `defaultMode auto` applies under `--setting-sources user` | stated as cause | cause not isolated | no control run; the headless docs say `-p` starts in Manual mode when nothing sets a mode, which supports the report (0004). Design unaffected (mode is always set) |
| Probe: PTY approval through the hook | allow and deny in both paths | only allow for an MCP tool tested in the PTY | open, test in stage 2 |
| VS Code R7 connector evidence | docs only | P2 PTY pass covers it | resolved in favour of the report's score |
| Slack rate-limit date for existing installs | March 2026 per an FAQ | cited changelog says existing installs are not affected | FAQ not cited; statement dropped |
| R16 weight in `notes/swarm-visibility.md` | 2 | 0008 sets 3 | 0008 applies; note corrected |
| Emdash R16 against VS Code R16 | 1 / 12 and 2 / 6 | inconsistent: raise emdash to 2 / 8 or justify | emdash 2 / 8 used; the residual effort order (emdash 8, vscode 6 with less existing plumbing) rests on VS Code API facts from memory |
| Greenfield R18 effort | 18 | R18 review: 13 to 15; R19 review: keep 18 | 14 used: the R18 review is the specialised one and removes merge, which 0008 does not ask for |
| Greenfield R17 and R19 efforts | 15 and 24 | 16 to 17 and 28 to 30 | 17 and 29 used (upper half, since the review found missing rows) |
| R19 0008 cap on forks | caps every fork at 1 | applies only to vscode | review applied; fork R19 scores of 1 are effort judgements |
| Emdash R17 effort | 16 | 18, and score 1 because the effort exceeds greenfield's 17 | 18 used. The work items in `notes/collaboration-tooling.md` sum to 17, equal to greenfield; at 17 the emdash total in 0007 is 164 and its ratio stays 0.98 |
| `--strict-mcp-config` and claude.ai connectors | drops them (`probes/RESULTS.md`) | `p2_report_listing.json` proves nothing; the re-run that shows it is not stored | stored logs of other runs support it without a controlled comparison (0004) |
| 0002 cap on R12 applied to greenfield | not raised | not raised | under the reading "does not host a browser tab as a tree leaf today" greenfield has nothing today and would also score 1; 2 / 8 is kept, and 0007 carries the other value as a sensitivity row |

## Consequences

- Every fork scores 1 or lower on at least one must-have among R12 and R13. 0007 applies the decision rule to these scores.
- All efforts rest on code reading. Spread between bases on single rows is often smaller than the estimate error.
- No day threshold separates score 2 from score 1. Rows of 10 to 15 days carry both scores: greenfield R9 2 / 12 and vscode R12 2 / 15, against superset R13 1 / 12, nimbalyst R13 1 / 11 and vscode R13 1 / 15. The must-have scores of 1 that decide rule 1 in 0007 are judgements of this kind, except fork R12, which the 0002 cap sets.
- Efforts are sums per requirement. Overlap between requirements is not removed; the VS Code review names the hook and status plumbing shared by R2 and R6 and the localhost MCP server shared by R8 and R9. The same kind of overlap exists in every base, and no deduplicated totals exist.
- Fork maintenance cost (churn on patched files, merge conflicts against current upstream) was not measured and is not in the efforts. It would raise every fork total.
- R16 to R19 (0008) are reviewed and enter the main computation in 0007.
- R17 effort for PR and Jira task start overlaps R5 and R6, and the R18 app MCP server overlaps R8 (emdash). These overlaps are in the sums like the others above.
