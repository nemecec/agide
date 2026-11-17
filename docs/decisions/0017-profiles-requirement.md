# 0017 Top-level profiles

Status: proposed (requirement stated by the user; weight and design await confirmation)
Date: 2026-11-17
Decided by: Neeme (idea); the design direction is an agent proposal
Amends: 0008 (adds R22)

## Context

The user wants top-level profiles that separate Claude subscriptions, browser cookies and the rest, for example a personal profile with a personal login and subscription and a professional profile with a completely isolated environment. Milestone 1 uses one data directory and the user's `CLAUDE_CONFIG_DIR`, which probes show selects the Claude login, transcripts, settings, skills and plugins (`probes/RESULTS.md`).

## Decision

- R22 Profiles. Weight 3 is proposed. A profile is the top-level isolation boundary. It owns:
  - its own data directory (tree store, inbox, tasks, layouts, review records);
  - its own Claude configuration directory, so the login, subscription, connectors, skills, plugins and transcripts are separate;
  - its own browser session partitions, so cookies and logins for Jira, Slack, GitHub and Notion are separate;
  - its own app MCP server, tokens and ports;
  - its own tool credentials (GitHub CLI configuration, git identity, SSH agent socket, environment variables), set per profile when sessions launch.
- Direction for the isolation level: one application process per profile, each with its own user data directory. Profiles run in parallel, like the profiles of a browser with a profile rail. Every window can show a profile switcher (an optional icon strip) that lists all profiles; clicking one focuses that profile's window and starts it if it is not running. The existing single-instance lock per data directory already fits. This is stronger and simpler to reason about than several profiles inside one process.
- Each profile icon in the switcher carries a badge with that profile's count of unread inbox items (R21), like an e-mail client. The count, the profile name and its colour are the only data that cross profiles. They travel through a small registry in a per-user directory (permissions limited to the user) that every profile process writes to and reads from; no message text, session name or project name enters it. The badge can be turned off per profile, and a profile can hide its count from other profiles' switchers. Agents in an isolated environment (0018) cannot reach the registry.
- Otherwise nothing crosses a profile: no shared inbox, no observation across profiles, no cross-profile tool on any MCP server. Any aggregated view is an explicit, opt-in export. Notifications name the profile and the window chrome shows the profile name and colour.
- The per-profile isolation of agents themselves (container, remote host) is covered by 0018.

## Consequences

- The profile boundary is built at the start of milestone 2, before more state is added. Milestone 1's single data directory becomes the default profile.
- A rough guess is 3 to 6 working days to parameterize the data directory, Claude configuration directory, partitions and launch environment, and to build the switcher rail, the registry and the badge; low confidence.
- A profile on a Team or API-key login can answer the subscription question for swarms per profile (0007).
- To verify: how Claude Code keys its stored login when `CLAUDE_CONFIG_DIR` differs on macOS, and that connectors and plugins follow the directory.
