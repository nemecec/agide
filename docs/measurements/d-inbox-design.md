# d-inbox-design

Start: 2026-11-17 15:00:02 UTC
End: 2026-11-17 15:08 UTC
Wall time: about 8 minutes

## Work

- Read 0009, 0010, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0019, `probes/RESULTS.md`, `notes/probes.md`, `notes/probes-stage2.md`, `notes/swarm-visibility.md`, and the milestone 1 store, session hook, session status and surface type code.
- Wrote `docs/decisions/0021-inbox-and-tasks-design.md` (status proposed): item model, SQL schema and migration plan, hook and app source mapping with verification status, `inbox_post` and `inbox_ask`, context layers and session summaries, UI with peek mount mode, tasks and reminders with the scheduler, noise control, untrusted text, notifications and badge, tests, first slice.
- Ran every SQL block of the record against `node:sqlite` (Node 22) on top of the milestone 1 `tree_nodes` and `sessions` tables in a temporary directory: the tables create, the open dedupe index refuses a second open item with the same key and frees it once the item is done, a snoozed state without a time is refused, a repeat schedule run is refused, and items move to the top level when their folder is deleted.
- Searched `probes/out` for Notification payloads. None existed at the start. A parallel P11 run (`probes/p11_notification_hook.py`, not written by this step) finished during the work; its report was read and the record uses its results (permission and idle subtypes, payload keys, timing).

## What took long

Checking which hook facts are probed and which are only documented, across the probe notes and the raw logs.

## Not finished

- P12 (long MCP tool calls), P13 (waiting PermissionRequest hook), P14 (Elicitation) are named in the record and not run.
- No code was written; the record is a design.
