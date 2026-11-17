# 0025 User decisions before milestone 3

Status: accepted
Date: 2026-11-17
Decided by: Neeme (answers to the questions in 0024); the scope and the precautions are agent choices where marked

## Context

0024 listed questions for the user after milestone 2. The user answered some and asked to start milestone 3.

## Decision

- Permission model. The permission mode of a session is selectable, per profile and per session. The default is auto, with ask rules for outward-facing tools, a hook on every tool call and a network policy, as 0010, 0011 and 0012 describe. The modes offered are those of the CLI: manual (`default`), accept edits, plan and auto. Bypass mode is offered only inside an isolating provider.
- Local agents run as the user. This is accepted until isolation providers exist. The setup pane keeps stating it.
- Installing third-party software for the isolation probes is allowed: Anthropic's sandbox runtime, a container runtime and OpenShell. Agent choice of precautions: no administrator rights; package managers or checksummed releases; read an installer script before it runs; keep tool state under a temporary or project-local prefix where possible; record every change to the host in the probe notes without absolute paths; no real credentials and no subscription login inside a test environment; remove test containers, sandboxes and installs that are not kept.
- The public repository is intended.
- Records 0020, 0021 and 0022 stay `proposed`. The user did not object and asked to continue, so the build proceeds on them. Confirmation in words is still open.
- Milestone 3 scope and order (agent choice; the user left it open): the browser surface with observation, the selectable permission model with the outward-action gate, task start from a prompt, a pull request or a Jira key, agent nodes with usage views, and the isolation providers for Anthropic's sandbox runtime and a container with their probes. The review slice (0010) and the OpenShell provider move to milestone 4.
- The weights of R20 to R24 stay as proposed: R20, R21 and R22 weigh 3; R23 and R24 weigh 2. The scope question of 0007 stays open; the re-estimate of 0024 gives no reason to cut scope yet.

## Consequences

- A run of milestone 3 may install third-party software on the host under the precautions above. Probe notes list what was installed and what was removed.
- Session launch reads the permission mode from the profile and the session. The default for a new profile is auto.
- Open questions from 0024 that remain: confirmation of 0009 to 0011 and of 0020 to 0022, the Anthropic terms reading in 0022, whether the claude.ai login belongs to an organization with connector controls, the Bash sandbox against 0012's network default, plan usage of other profiles in the rail, and removal of folder-trust entries from the Claude configuration.
