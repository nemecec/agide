# Review of the milestone 4 contracts (0038)

Start: 2026-11-21 07:26 UTC. End: 2026-11-21 07:38 UTC.

## What I did

- Read 0037, 0038, the contract files under `app/src/core/swarm`, `app/src/core/session/streamSpawner.ts`, the session service seam in `PtySessionService.ts`, `app/src/main/modules/swarm.ts`, `modules.ts` and the renderer stubs.
- Ran `pnpm typecheck`, `pnpm test` and `pnpm e2e` before and after the changes; all pass. `pnpm check:colours` passes.
- Mutated the in-memory runtime, the in-memory manager, `policy.ts`, `tiers.ts` and the leaf adoption in `main/modules/session.ts`, one mutation at a time, and ran the contract suites. Mutations that survived at first: a resume of an unknown id allowed, the queue sorted newest first (the two swarms of the test started in the same millisecond), an allow sent as a deny, the active-swarms-per-session limit dropped, a swarm agent seeing every swarm. After the test changes below each of them fails a contract test. One mutation still survives: the manager deciding `done` without asking `isBusy`; with the in-memory runtime it behaves the same, because `end` waits for queued turns.
- Checked against primary sources: P33 (`probes/out/p33_report.json`: a reused `--session-id` fails with "Session ID ... is already in use"), the reported `system/init` modes in the P30 to P35 logs (`default` for manual, `auto` as `auto`), and the Node.js process I/O note (pipes are asynchronous on POSIX), which supports the drain claim for the fake CLI.

## Contract changes

- `core/swarm/types.ts`: `SwarmApprovalPayload`, the payload of `swarm:can_use_tool` items, so w-manager (writer) and w-ui (reader of the card) share one shape.
- `core/swarm/runtime/types.ts`: the `init` event says the manager does the mode check; `resume` names `not_found` for an id that was never launched.
- `core/swarm/runtime/InMemoryAgentRuntime.ts`: `reportMode`, the mode its `system/init` reports.
- `core/swarm/manager/InMemorySwarmManager.ts`: the `system/init` mode check (looser or unknown mode ends the agent with `mode-mismatch`, a stricter one adds a warning); swarm warnings kept and returned by `status`.
- Contract suites: tests for a resume of an unknown id, a deny, supersession by an interrupt with a late answer refused, the active swarms per session, a swarm agent's view and steering, and the mode check; the queue-order test starts the second swarm later.
- 0038: the mode check moves from the w-runtime slice to w-manager (the runtime cannot carry a manager end reason or a swarm warning); the `StreamAgentRuntime` construction and its registration; the approval payload seam; where `SwarmCaller.depth` comes from; a session close the manager did not ask for; the mutation list.

## Not finished

- A second reviewer agent: this run had no tool to start one.
- Temporary files under `/tmp` (`rv38`, `rv38-*.log`): removal was denied.
