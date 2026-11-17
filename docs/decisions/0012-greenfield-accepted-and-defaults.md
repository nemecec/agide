# 0012 Greenfield accepted; defaults for open decisions

Status: accepted
Date: 2026-11-17
Decided by: Neeme (base); the defaults below are agent choices, each revisable

## Context

0007 proposed a greenfield Electron shell as the base and listed decisions only the user can make. The user accepted the base ("Ok, greenfield Electron shell it is. Continue.") and gave no answers to the other rows.

## Decision

- The base is a greenfield Electron shell for macOS. 0007 moves to accepted for the base.
- The application is named Agide (decided by the user on 2026-11-17). The environment variables use the prefix `AGIDE_`, a project review policy file would live in `.agide/`, and the window title is "Agide". The spike folder keeps the name `agentic-gui-spike`.
- Stage 2 proceeds in milestones. Milestone 1 covers the first two items of the 0007 stage 2 list (shell, tree and persistence, the Claude session surface in a PTY, the app's MCP server and command registry) and the probes that gate them. After each milestone the greenfield estimate is re-measured from the finished slices (0007 item 13).
- The code lives in `app/` inside the spike folder as its own git repository on the branch `spike/stage2`. No commit, push or pull request is made until the user asks.
- Where the user has not answered a row of the 0007 decision table, the recommendation in that row applies: no third-party candidates are built or run; hooks go through `--settings`; app-launched agents keep the user's auto mode with ask rules, a hook on every call and a network allowlist; reviewers use `fable` on the high rungs and `opus` on the first; the review policy lives in an app-side store; browser tabs are hosted with equivalent tools and an option to open in real Chrome; small parts of MIT and Apache-2.0 candidates may be copied with their notices; observation is on-demand for browser tabs and sessions and off for Slack and Discord.
- Swarms run on the subscription login (decided by the user on 2026-11-17, answering the 0007 row "Swarms on the subscription login"). Claude Code can also start swarms of agents itself. A configurable cap on concurrent app-started agents protects the machine and the plan limits; its default is 4. Token and plan usage is shown per session, agent, swarm and profile (0019).
- Records 0009, 0010 and 0011 stay proposed. Milestone 1 builds only the parts they share with 0004 and 0006.
- Moving the Atlassian connector to v2 changes the user's account and stays with the user.
- Token spend follows 0003. Per-agent wall time and tokens are recorded for each slice in `docs/measurements/`.

## Consequences

- The rows "Total effort and scope", "Design records 0009 to 0011" and the organization-account question stay open and are asked again when a milestone depends on them.
- Real Claude calls made by tests use the small model and a per-call budget cap, and run under the user's own login.
- The Electron app opens windows on the user's screen when tests run, unless a test runs it hidden.
