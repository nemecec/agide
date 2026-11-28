# Review of the Chrome extension probe (review:ext-probe)

Start: 2026-11-28T12:51:54Z
End: 2026-11-28T13:05:00Z

## Work

An independent review of `notes/probes-m7-chrome-extensions.md`, the scripts `probes/p58_ext_load.mjs`, `p59_ext_static_apis.mjs`, `p60_sw_shim_preload.cjs`, the P58 to P60 section of `probes/RESULTS.md` and `docs/measurements/chrome-extension-probe.md`. Nothing under `app/` was edited and no application test, build or e2e run was started.

- Reran P58 with the app's Electron 45.3.3 in throwaway user data directories: stock, with the P60 stubs, the restart read, on Bitwarden 2026.1.0 and on 2026.10.2 (found in another Chrome profile); a lifetime run with a minimal manifest 3 extension as an idle control; P59 on 2026.1.0 (identical output to the probe's).
- A separate throwaway script checked `will-frame-navigate` for an inserted `chrome-extension://` iframe and the accessibility values of a password input and a `cvv` text input.
- Read `app/src/main/browser` (guards, `ElectronViews.sessionFor`, `openInChrome`) and `app/src/core/browser` (`PageSession.maskSecrets`, `readPage`, `find`, `redaction.ts`, `axTree.ts`), the library README and roadmap, and the Electron 45.3.3 extension docs.

## Findings fixed in the files

- Electron stops an idle extension worker after 30 s; the note said it never does.
- The library table ticked `commands`, `tabs.move` and `tabs.discard`, which the README leaves unticked; `captureVisibleTab`, `onReplaced` and `notifications.onButtonClicked` were missing from the gaps.
- `find` matches on accessibility values and is a gap of the redaction.
- The relative `--preload` path of the run line failed; the script now resolves it.
- Smaller corrections: load times, the active-tab query, the manifest shortcuts, the evidence file list, the `use_dynamic_url` point for the guard exception.

## What could not be done

- No login, so unlock, overlay, fill and the save-login bar stay unmeasured.
- The library was not installed.
- Free disk was 5.2 GiB at the start and stayed above 3 GiB.

## Temporary files

`/tmp/agide-ext-probe/` (created by this review) held the copied extension code folders, the user data directories, the evidence and the fetched README files; removed at the end.
