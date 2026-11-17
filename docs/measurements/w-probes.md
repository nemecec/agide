# w-probes

Start: 2026-11-17 08:48:13 UTC (date -u). End: teisipäev 17 november 2026 09:24.18 UTC (date -u). Wall time about 36 minutes.

## Built

Stage 2 probes P6 to P10 as scripts in probes/ with a shared PTY helper (stage2_lib.py), hook helpers (perm_policy.py, ctx_hook.py, marker_hook.py) and a fixture checkout generator (make_checkout.py, fixtures/proj_mcp_server.mjs). Results are in probes/RESULTS.md (new dated section) and notes/probes-stage2.md. Evidence is in probes/out/.

## What took long

- The first P6 run produced no data: new temporary directories in the system temp folder trigger the folder-trust dialog, which blocked every launch. Directories under probes/work/ inherit trust from the parent.
- P9 PTY: the screen text has no spaces between words, so a regex for the project MCP approval dialog failed on the first run, and Enter selected the highlighted "Continue without" option. The fixed run used Up twice and Enter.
- P10: the shell guard in this environment refuses a foreground sleep followed by another command, so the first tool cases ran no tool. A Python sleep replaced it.
- Real-Claude runs dominate wall time (PTY cases about 20 to 60 seconds each).

## Could not finish

- PTY approval in permission modes other than manual, and for subagents.
- Folder-trust dialog with an untrusted checkout (the fixture sits under a trusted parent).
- Image paste and interrupt during an approval dialog (not in the assigned probes).
- Only Haiku; one run per case for P6 to P8 and P10.

No sandbox block occurred.
