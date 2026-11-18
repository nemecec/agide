# review-browser-design

Start: 2026-11-17 20:38:14 UTC
End: 2026-11-17 20:47:30 UTC

## What was done

Independent review of `docs/decisions/0026-browser-surface-and-observation-design.md` and `notes/browser-tools-mapping.md`.

- Claude in Chrome tool names and schemas compared with the tool definitions of a live session and with https://code.claude.com/docs/en/chrome. No browser tool was called.
- Electron claims checked against `electron.d.ts` of the installed Electron 45.3.3; CDP methods and parameters against the protocol types of the installed `playwright-core`.
- Probe PB1 output and script, P8 and P9 in `probes/RESULTS.md`, and the app code named by 0026 (surface types, surface catalog, tree commands, request guard, MCP config, session files, launch arguments, capture and masking) read. `claude --help` of 2.1.326 checked for `--chrome` and `--no-chrome`.
- Consistency with 0006, 0012, 0013, 0020, 0021, 0022, 0024 and 0025 checked; both files scanned for style words and personal data.

## Changes

0026: creation through `ui_create_leaf` with a URL removed (the command takes no URL and such a leaf is a forged leaf by the record's own rule); placement IPC stated as a UI-only command; `backgroundThrottling` moved to `webPreferences`; sign-in hosts excluded from `web` for the cross-service rule; "Also use Claude in Chrome" passes `--chrome`; console and network scoping by domain as the extension says; duplicate `left_click_drag` removed; the 120 s approval wait tied to the documented 60 s MCP request limit and a server `timeout`; an ask for agent navigation to origins outside loopback, the site table and the network allowlist, with a threat row; the unsourced "Tab N not found" removed; guards attached at construction with `web-contents-created` as a backstop; `ui_set_observation` gets an `mcpExempt` reason; the window capture claim marked as unverified; the `http` hook transport attributed to 0022; first-slice checks and consequences for contract files extended; a count removed.

Mapping note: tab id row aligned with `tabNumber`; server name row updated after PB1; `/clear` behaviour corrected; sources record what this review checked.

## What took long

Tracing the MCP time limit and the `http` hook transport through 0021 and 0024, and the forged-leaf path through the tree commands.

## Not finished

No Electron or CDP behaviour was run. The Slack and Notion URL formats and the sign-in host list were not checked against real URLs.
