# d-blocks-survey

Start: 2026-11-17 15:00:01 UTC
End: 2026-11-17 15:05:07 UTC

## What was built

- `notes/blocks-prior-art.md`: survey of prior art for composable interfaces (VS Code, Obsidian, Theia, Nimbalyst, Claude Code mods and plugins, Home Assistant, Zed, React layout engines, Electron sandboxing, layout formats and migration) with sources, and an answer on whether Agide blocks can ship as Claude plugins and reuse the marketplace (R7).
- Two throwaway plugin directories in a temporary location, validated with `claude plugin validate` (2.1.326) to see how an Agide sidecar is treated. They were deleted afterwards.
- Layout engine versions, dates, licenses and peer ranges read from the npm registry.

## What took long

- Several fetched pages were summarised by the fetch tool and left gaps (Theia layout restore, Obsidian view state and manifest, Zed UI surface, Home Assistant `customCards`). The note lists these as not read.
- The mods reference and interface pages are large; only the tables on hosts, render sites and the admin and validation pages were used.

## What could not be finished

- No install of a plugin was run, so sidecar survival across marketplace source types is untested.
- No layout engine was installed or run; the drag-over-native-view and React 19.3.1 checks are listed as spike items.
- Whether mod handlers surface in `-p` stream-json output was not tested (no real Claude run).
