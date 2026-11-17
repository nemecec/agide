# d-probes

Start: 2026-11-17 15:00:04 UTC (date -u). End: 2026-11-17 15:25 UTC (date -u). Wall time about 25 minutes.

Built the probe scripts for milestone 2 (P11 Notification hook, P12 status line, P13 transcript usage, P14 waiting PermissionRequest hook, P15 Elicitation), a helper `probes/m2_lib.py`, hook helpers and a stdio MCP fixture. Ran each against the real `claude` 2.1.326 on Haiku. Results are in `probes/RESULTS.md` (new dated section) and `notes/probes-m2.md`. Raw logs are in `probes/out/`.

What took time: the first P11 run exited at once because fresh directories under `probes/work/` raised the folder-trust dialog and the typed prompt chose "No, exit"; the helper now answers it. The P11 idle wait and the P14 cases (hook waits of 8 to 12 s plus the 60 s wait in the timeout case) are the longest runs. A JSON serialisation error (a bytes key) lost one P14 run, which was re-run in full. P15 needed its own stdio server because `mcp_host.mjs` answers plain POSTs only.

Not finished: the replacement of a user-level status line (this login has none), whether the cost field includes subagents, a waiting Elicitation hook, URL-mode elicitation. Listed in `notes/probes-m2.md` under "Not verified".

Sandbox: no step was blocked. Temporary directories under `probes/work/` were removed.
