# d-blocks-review

Start: 2026-11-17 15:10:43 UTC
End: 2026-11-17 15:17:21 UTC

## What was done

Independent review of `docs/decisions/0020-block-model-and-layout-design.md` and `notes/blocks-prior-art.md`, with edits in both files.

Checked against primary sources:

- npm registry: versions, dates, licences, peer ranges and dependencies of `dockview`, `dockview-react`, `dockview-core`, `dockview-enterprise`, `flexlayout-react`, `rc-dock` and `golden-layout`. The survey table matches.
- dockview 8.9.0 tarballs (downloaded to a temporary directory, read only, not installed or run): the MIT `LICENCE.md`, the type declarations of `toJSON`, `fromJSON`, `addPanel`, `removePanel`, `addFloatingGroup` and `addPopoutGroup`, and the absence of install scripts. The repository licence file lists `dockview-enterprise` as proprietary; its source holds layout history and keyboard docking modules.
- GitHub API: star counts and licences of the engine repositories.
- `claude plugin validate --strict` (2.1.326) on throwaway plugins in a temporary directory: a top-level `agide` key warns and fails the strict run; `metadata.agide` passes. No model call.
- Claude Code docs: mods overview, plugin manifest reference, marketplace reference, plugin security.
- VS Code when-clause and webview docs, Obsidian views, Theia widgets, Electron security and `webContents.capturePage`.
- Nimbalyst clone (read only): the "API contract, not a sandbox" passage, the 32 KiB context item limit, the permission ids, `KNOWN_RUNTIMES`, the SDK review date, the registry README.
- App code: command, event and surface types, the command id pattern, the MCP tool result mapping, `docs/parity.md`.

## What took long

Reading the full Claude Code marketplace and security pages, which hold the auto-update behaviour that 0020's update rule did not cover.

## What could not be finished

- No layout engine was installed or run in the app; the React 19.3.1, placeholder and native-view drag checks stay with the first slice.
- Obsidian plugin guidelines, Home Assistant, Zed and Grafana pages, and the MDN iframe page were not re-read.
