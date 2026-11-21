# d-swarm

Start: 2026-11-21T06:41:02Z (date -u). End: 2026-11-21T06:49:01Z (date -u).

## Built

- `docs/decisions/0037-swarm-orchestration-design.md`: the swarm definition (zod schema and an example), the stream-json agent runtime through the isolation provider (`AgentEnvironment.processCommand`), the manager with run states, cap queue, stages and failure policy, steering, budgets with reservations, the tier table, approvals from `can_use_tool` with the app timeout and the permission cap, worktree isolation with result collection and cleanup, the MCP tools with scope, roles and spawn depth, the UI, usage and alert integration, persistence, threats, tests, the first slice and what waits.

## Account

- Inputs read: `notes/probes-m4-swarm.md`, `notes/swarm-orchestration.md`, 0003, 0010, 0011, 0012, 0021, 0025, 0027, 0028, parts of 0029 and 0035, and the code in `app/src/core/agents`, `core/session`, `core/isolation`, `core/mcp/grants.ts`, `core/permissions/modes.ts`, `core/commands/parity.ts`, `core/inbox/inboxCommands.ts`, `core/tasks/GitWorkingDirectoryManager.ts`, `main/modules/agents.ts`; one probe log (`probes/out/p30_stream_agent.jsonl`) to confirm that stream `assistant` messages carry `message.usage`.
- Checks run: the SQL of section 12 against `node:sqlite` in memory with stand-in `tree_nodes` and `sessions` tables (constraints refuse and accept as the record states); the definition schema with the app's zod against the example (accepted; bypass and unknown keys refused). Both scripts were temporary files outside the repository and are removed.
- No real-Claude calls, no app code changes, no tests run (the task is a design record).
- Longest step: reading 0027, 0021 and 0028 against the current code to keep the record consistent with the agent store, the cap check and the gate.
- Disk: about 10 GiB free before and after.
- Not finished: no independent review from inside this run (no agent-spawning tool is available to this step); the record is `proposed` and waits for the review the workflow schedules.
