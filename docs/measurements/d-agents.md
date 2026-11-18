# d-agents

Start: 2026-11-17 20:27:06 UTC
End: 2026-11-17 20:33:46 UTC
Wall time: about 7 minutes

## Work

- Read 0009, 0012, 0019, 0021 (sections 1 to 3, 8 to 12), 0024, 0025, parts of 0011, 0020, 0022 and 0023, `notes/swarm-visibility.md`, `notes/probes-m2.md`, the P13 report in `probes/out`, `probes/hooks/statusline_capture.py`, and the session code (`hooks.ts`, `HookInbox.ts`, `status.ts`, `types.ts`, `launchArgs.ts`, the launch part of `PtySessionService.ts`, `SessionStore.ts`) and the hook delivery contract of the isolation provider.
- Wrote `docs/decisions/0027-agent-nodes-and-usage-design.md` (status proposed): the event normaliser with hook, stream-json, status line and transcript adapters; the agent store and its states with the derivation per source; agent nodes under session leaves with count, waiting marker, finished tally and removal timers; the history pane and read-only transcript viewer; the SQL schema and transcript copies; app-started agents beside session-started ones; the status line command; usage counting by message id and `cost-state` at exit; rates, ranking, heat markers and rollups; plan usage per profile with a forecast; alerts with pause and stop; estimate labels; threats and limits; probes U1 to U7; the first slice and what waits.
- Ran the SQL of the record against `node:sqlite` (Node 22) with stand-in `tree_nodes` and `sessions` tables: the tables create; a done row without an outcome, a duplicate session and agent key, an app-started row with an agent key and an unknown plan window are refused; a revived row returns to `running`; a folder delete keeps agent rows with no folder. The check script lived in a temporary directory inside the project and was removed.

## What took long

Placing the status line file so that `HookInbox` does not deliver or delete it, and keeping agent figures as a breakdown of session figures so rollups do not double count.

## Not finished

- Probes U1 to U7 are named in the record and not run.
- No code was written; the record is a design.
- Writing the check script under `/tmp` was refused by the sandbox; it ran from a temporary directory in the project instead.
