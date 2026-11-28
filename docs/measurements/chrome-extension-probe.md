# Chrome extension probe (ext-probe)

Start: 2026-11-28T12:27:08Z
End: 2026-11-28T12:51:20Z

## Work

A feasibility probe of the Bitwarden browser extension (2026.1.0, manifest 3) inside the embedded browser of Agide (Electron 45.3.3). Nothing under `app/` was edited and no application test, build or e2e run was started.

- Scripts: `probes/p58_ext_load.mjs` (load into two persistent partitions, popup, content script, storage, service worker through the browser CDP port, with all non-loopback requests cancelled and logged), `probes/p59_ext_static_apis.mjs` (static census of `chrome.*` references), `probes/p60_sw_shim_preload.cjs` (inert stubs for the missing namespaces, installed through a service-worker preload).
- Notes: `notes/probes-m7-chrome-extensions.md` (method, results per question, the missing APIs, the library and the alternatives, what the agent tools can read of a filled password, the proposed rule, design questions). Section appended to `probes/RESULTS.md`; one row added to `docs/README.md`.
- Evidence under `probes/out/` (not tracked): the JSON of the base, shim, restart and lifetime runs, popup and page screenshots, the stderr logs and the static census.

## What took long

- The first run hung: debugger commands sent to the fixture view before its first navigation never resolved. The domains are now enabled after the page load.
- The service worker of stock Electron dies at start on `chrome.webNavigation`, so the popup never left its spinner. A plain assignment in a service-worker preload does not reach the worker's `chrome` object (the preload's world has none); `contextBridge.executeInMainWorld` does.
- An earlier run's popup screenshots were overwritten by later runs with the same name; the evidence names now carry the output file's name, and the base and shim runs were repeated.

## What could not be done

- No login, unlock, fill, inline menu or save-login bar: the rules forbid an account and credentials. The agent-tool answer comes from the code, not from a measured fill.
- The library electron-chrome-extensions was read, not installed (a dependency needs the user's approval), so its coverage is from its README.
- Free disk stayed above 5 GiB during the run (it was 7.8 GiB at the start; other work on the machine used part of it).

## Files outside the row that were touched

| File | Change | Reason |
|---|---|---|
| `probes/RESULTS.md` | one section appended | asked for |
| `docs/README.md` | one row in the notes table | asked for |

## Temporary files

`/tmp/agide-ext-probe/` held the copied extension code, the throwaway user data directories and the stderr logs; it was removed with `rm -r` and checked afterwards (no such directory). Nothing is left to remove.
