# d-browser-survey

Start: 2026-11-17 20:27:06 UTC
End: 2026-11-17 20:29:59 UTC

## Work

Wrote notes/browser-tools-mapping.md: Claude in Chrome tool list with input schemas and matching semantics, CDP mapping through webContents.debugger, WebContentsView facts (bounds, z-order, hiding, partitions, permission handlers, window open and navigation guards, security checklist), what the earlier notes and the Superset source (read only) solved, observation signals and costs, redaction needs and a test strategy built on a local HTTP server.

## What took long

The Chrome docs page lists no tool schemas, so the schemas were taken from the tool definitions of the session. The fetched Electron View pages are summaries and do not describe z-order beyond addChildView.

## Not finished

Nothing was executed against Electron. CDP behavior is marked as unverified in the note, and the open items section lists what a probe should settle (hidden view frames, replMode, iframe targets, multiple debugger clients). The Codex MCP server was not used.
