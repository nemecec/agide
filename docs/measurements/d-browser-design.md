# d-browser-design

Start: 2026-11-17 20:30:21 UTC
End: 2026-11-17 20:37:21 UTC

## What was built

- `docs/decisions/0026-browser-surface-and-observation-design.md` (proposed): the `browser-tab` surface type (state, persistence, creation from a URL, tab chrome, placement through `agide/surface-host`, parking, suspend with still images during drags and overlays, focus), partitions per service with the recognizer for Jira, GitHub, Slack and Notion URLs, the hosted tools on an `agide-browser` endpoint with the Claude in Chrome names and schemas, the per-call order of checks (folder scope, forged leaf, observation, site check for acting calls), CDP highlight, "Open in Chrome", navigation, window-open and permission policy, the observation switch, indicator, access log, redaction, capture composition with masks, the `UserPromptSubmit` digest file, the data that leaves the app, threats, and the first slice with what waits.
- Probe PB1 (`probes/pb1_server_names.mjs`, `probes/out/pb1_server_names.json`, a section in `probes/RESULTS.md`): the CLI 2.1.326 accepts `browser` and `agide-browser` as MCP server names and drops `claude-in-chrome` without an error. One Haiku run, 0.0035 USD.

## Inputs read

`notes/browser-tools-mapping.md`, 0002, 0006, 0020, 0024, 0025, parts of 0010, 0011, 0013, 0021, 0022, `probes/RESULTS.md` (P8, P9), and in `app/src` the surface types, surface catalog, partition names, capture masking, window policy, hook settings and MCP config.

## What took long

- The gate for acting in signed-in pages: clicks and scripts in a Jira or GitHub tab are outward actions the connector gate does not see, so the record adds a site table enforced in main on every acting call.
- Capture masking: a window capture does not include child views, so the record reuses the drag stills to compose captures.

## What could not be finished

- No Electron or CDP behaviour was exercised; the record lists those items as first-slice checks.
- The effect of `--no-chrome` on the tool list and how long the CLI keeps an MCP call open were not probed.
EOF