# Agide spike: index

Spike to choose the base for a personal, macOS-only desktop tool for agentic coding. Records are dated point-in-time decisions from 2026-11-17 and hold for Claude Code 2.1.326.

## Decision records (`decisions/`)

| Record | Status | Subject |
|---|---|---|
| [0001](decisions/0001-scope-and-constraints.md) | accepted | Scope, constraints, scoring scale and decision rule |
| [0002](decisions/0002-surfaces-awareness-and-embedded-browser.md) | accepted | R12 to R16: surfaces, shared awareness, agent shows things, Claude in Chrome, visible swarms |
| [0003](decisions/0003-model-tiering-and-reuse.md) | accepted | Model tiering for spike agents, reuse of earlier work |
| [0004](decisions/0004-claude-launch-path-and-reuse.md) | proposed | Claude launch paths, permissions, app-hosted MCP, skills, plugins, connectors, `--bare` risk |
| [0005](decisions/0005-candidate-triage-and-scores.md) | proposed | Candidate sheet and reviewed R1 to R19 scores; open disagreements |
| [0006](decisions/0006-surfaces-browser-and-awareness-design.md) | proposed | Surface interface, embedded browser, Claude in Chrome options, observation, privacy, Slack and Discord, service objects |
| [0007](decisions/0007-base-decision-and-next-steps.md) | proposed | Base decision (greenfield) on reviewed R1 to R19 scores, arithmetic, stage 2, user decisions |
| [0008](decisions/0008-collaboration-orchestration-and-layered-review.md) | accepted | R17 to R19: collaboration tooling, swarm orchestration, layered review |
| [0009](decisions/0009-agent-swarm-visibility-design.md) | proposed | R16 design: event sources, node states, count, removal, history, app-started agents |
| [0010](decisions/0010-layered-review-and-escalation-design.md) | proposed | R19 design: levels, risk reasons, ladder, policy, outward-action gate, first slice |
| [0011](decisions/0011-collaboration-tooling-and-swarm-orchestration.md) | proposed | R17 and R18 design: per-service access and approval, orchestration primitives, swarm definition, tiers and budgets |
| [0012](decisions/0012-greenfield-accepted-and-defaults.md) | accepted | Greenfield accepted by the user; the name Agide; the Apache 2.0 license; milestones; defaults for the open rows of 0007 |
| [0013](decisions/0013-stage2-architecture-and-contracts.md) | accepted | Stage 2 toolchain, modules, contracts, ownership and test strategy; amendments after review |
| [0014](decisions/0014-milestone-1-results.md) | accepted | Milestone 1 results: slices against R1, R4, R6 and R8, probe results that amend 0004, review fixes, measured effort and re-estimate, milestone 2 |
| [0015](decisions/0015-composable-ui-requirement.md) | proposed | R20 composable, user-assembled UI |
| [0016](decisions/0016-tasks-reminders-and-inbox-requirement.md) | proposed | R21 tasks, reminders and inbox |
| [0017](decisions/0017-profiles-requirement.md) | proposed | R22 profiles: separate Claude logins, browser sessions and data, one process per profile, unread badges |
| [0018](decisions/0018-pluggable-agent-isolation-requirement.md) | proposed | R23 pluggable isolation providers (host, container, OpenShell, remote) |
| [0019](decisions/0019-usage-visibility-requirement.md) | proposed | R24 token and plan usage visibility, with swarms on the subscription login |
| [0020](decisions/0020-block-model-and-layout-design.md) | proposed | R20 design: block kinds and manifest, shared context, layout file, dockview, versioning, user blocks, security, agent tools, first slice |
| [0021](decisions/0021-inbox-and-tasks-design.md) | proposed | R21 design: item model, schema, hook mapping, agent tools, context layers, inbox pane, tasks and recurrence, notifications, first slice |
| [0022](decisions/0022-profiles-and-isolation-design.md) | proposed | R22 and R23 design: profile layout and migration, process model, registry, tool credentials, `IsolationProvider`, provider order, probes, first slice |
| [0023](decisions/0023-milestone-2-architecture-and-contracts.md) | accepted | Milestone 2 slices, modules, contracts, ownership, init order and test strategy; amendments after review |
| [0024](decisions/0024-milestone-2-results.md) | accepted | Milestone 2 results: slices against R20 to R23, closed milestone 1 findings, probe and build results that amend 0004, 0019 and 0021, review fixes, tests and coverage, measured effort and re-estimate, milestone 3 |

0007 is accepted for the base through 0012. 0004 needs the amendments listed in 0014 and 0024; 0019 and 0021 need those listed in 0024.

The plan: [spike-plan.md](spike-plan.md).

## Application (`../app/`)

The greenfield app lives in `../app/` in this repository. `../app/README.md` covers install, run, environment variables and the test commands. Architecture and contracts: 0013 (milestone 1) and 0023 (milestone 2). Results: 0014 and 0024.

| Command (run in `../app/`) | Checks |
|---|---|
| `pnpm typecheck` | TypeScript for the main process and the renderer |
| `pnpm test` | Vitest over `src/core`, `src/main`, `src/shared` and the renderer logic; no network, no Claude |
| `pnpm coverage` | the unit tests with coverage thresholds |
| `pnpm e2e` | builds the app and runs Playwright against it with a hidden window |
| `pnpm coverage:e2e` | the end-to-end tests with renderer and main-process coverage; not a gate |
| `pnpm parity` | checks that every UI-bound command is an MCP tool or states an exemption; writes `parity.md` |
| `pnpm blocks-docs` | writes `blocks.md` from the block manifest and layout schemas |
| `node scripts/smoke-real-claude.mjs`, `pnpm e2e:claude-mcp`, `pnpm e2e:real-claude`, `pnpm e2e:real-claude-inbox` | real `claude` on Haiku with the budget cap; outside the default test commands |

## Other documents (`docs/`)

| File | Content |
|---|---|
| `parity.md` | UI and MCP parity table, generated by `pnpm parity` |
| `blocks.md` | First-party pane types, shared context keys, and the JSON Schemas of the block manifest and the layout document, generated by `pnpm blocks-docs` |
| `measurements/*.md` | start and end times and a short account per agent step of stage 2; files of milestone 1 steps that ran again in milestone 2 (`integrate.md`, `fix.md`, `record.md`) have a milestone 2 section |

## Notes (`../notes/`)

| File | Content |
|---|---|
| `probes.md` | Probe details, measurements and gaps |
| `triage-superset.md`, `triage-emdash.md`, `triage-nimbalyst.md`, `triage-vscode.md` | Candidate sheets with upstream health measurements |
| `greenfield-and-libraries.md` | Greenfield stack, library choices, measurements |
| `surfaces-and-browser.md` | Claude in Chrome, Electron browser parts, observation routes, Slack and Discord, surface interface |
| `surfaces-candidates.md` | R12 to R15 per candidate |
| `swarm-visibility.md` | R16: P5 probe results, event sources, design, scores |
| `collaboration-tooling.md` | R17: per-service access, views, task start, approval classes, scores |
| `swarm-orchestration.md` | R18: Claude Code primitives, swarm design, cost control, scores |
| `review-prior-art.md` | R19: prior art and risk signals |
| `review-ladder-design.md` | R19: ladder, policy, outward gate, estimates |
| `review-features-candidates.md` | R19: review features per candidate, scores |
| `probes-stage2.md` | Stage 2 probes P6 to P10: PTY permissions, PTY session ids, `additionalContext`, setting sources, PTY interrupt |
| `probes-m2.md` | Milestone 2 probes P11 to P15: Notification hook, status line, transcript usage, waiting `PermissionRequest` hook, Elicitation; reviewer re-run |
| `blocks-prior-art.md` | R20 survey: extension models of other tools, React layout engines, sandboxing user-written UI in Electron, layout file formats and migration, blocks as Claude plugins |
| `profiles-and-isolation.md` | R22 and R23 survey: OpenShell, the Claude Code sandbox runtime, Docker Sandboxes and dev containers, SSH hosts, what a Claude configuration directory holds, gh, git and SSH credentials per profile, Electron multi-instance patterns, a cross-process registry |

The R16 to R19 notes and `surfaces-candidates.md` end with a "Review corrections" section that lists what the independent review changed.

Structured reports: `../notes/reports/*.json` (emdash, nimbalyst, greenfield-libs, vscode; superset has a triage note only). Reviews: `../notes/reviews/vscode.json`; reviews from the run that wrote 0004 to 0007 are summarized in those records and are not stored as files. The R16 to R19 reviews are not stored in the project; their corrections are in the notes' "Review corrections" sections and in 0005. The R12, R13 and R15 scores per fork exist only in 0005.

Candidate clones (read only, never installed or run): `../candidates/`.

## Re-running the probes

The probes call the real `claude` CLI under the user's login and spend a small amount of subscription budget per run. Results hold for the CLI version they ran against.

1. Check the CLI version: `claude --version`. The records assume 2.1.326.
2. Run from `../probes/` with no dependencies: `node <script>.mjs` or `python3 <script>.py`. Every script states its usage in its first line.
3. The scripts use `--model haiku`, `--max-budget-usd 0.25` on `-p` runs, the empty working directory `probes/work`, `--setting-sources user` and, except for connector probes, `--strict-mcp-config`. They remove variables injected by a parent Claude Code session and keep `CLAUDE_CONFIG_DIR`, which selects the login.
4. Never point a probe at a candidate repository or a PR checkout.

| Script | Probe |
|---|---|
| `smoke.mjs` | one stream-json turn |
| `p1_stream.mjs [multi\|session\|image\|init\|interrupt\|all]` | P1 stream-json |
| `p1c_permissions.mjs [step ...]` | P1c permissions |
| `p1b_pty.py [basic\|mcp\|perm_hook\|perm_screen]` | P1b interactive TUI, P3 in the PTY |
| `p2_reuse.mjs [listing\|skills\|connector\|status\|bare\|all]`, `p2_pty.py` | P2 skills, plugins, connector, `--strict-mcp-config`, `--bare` |
| `mcp_selftest.mjs`, `p3_mcp.mjs` | P3 app-hosted MCP server (`mcp_host.mjs`) |
| `p5_subagents.mjs [stream\|failure\|all]`, `p5_subagents_pty.py` | P5 subagent events and hooks |
| `mkimg.py`, `pty_explore.py` | fixture image, TUI startup screen |
| `p6_pty_permissions.py`, `p7_pty_sessions.py`, `p8_additional_context.py [p\|pty]`, `p9_setting_sources_p.mjs`, `p9_setting_sources_pty.py`, `p9b_strict_compare.mjs`, `p10_pty_interrupt.py` | P6 to P10 (helpers `stage2_lib.py`, `make_checkout.py`, `hooks/perm_policy.py`, `hooks/ctx_hook.py`, `hooks/marker_hook.py`) |
| `p11_notification_hook.py`, `p12_statusline.py`, `p13_transcript_usage.py`, `p14_waiting_permission_hook.py`, `p15_elicitation.py` | P11 to P15 (helper `m2_lib.py`, which answers the folder-trust dialog; `hooks/statusline_capture.py`, `hooks/perm_wait.py`, `hooks/elicit_answer.py`, `fixtures/elicit_mcp_server.mjs`) |

Raw logs and per-probe reports go to `../probes/out/`. Summary: `../probes/RESULTS.md` for P1 to P3 and P6 to P15; P5 is summarized in `../notes/swarm-visibility.md`; P6 to P10 details are in `../notes/probes-stage2.md`, P11 to P15 details in `../notes/probes-m2.md`. Probes not yet written are listed in 0007 (stage 2), 0014, 0021 (P16, P17), 0022 (E, C, G, D, O and S series) and 0024. The probes work in directories under `probes/work/`. A new directory can raise the CLI's folder-trust prompt with "No, exit" highlighted; `m2_lib.py` answers it, and each answer adds a trust entry for that directory to the user's Claude config.
