# verify

Start: 2026-11-17 09:32 UTC (date -u). End: teisipäev 17 november 2026 09:36.47 UTC.

Clean copy of app/ without node_modules, pnpm install --frozen-lockfile, then typecheck, test, build and e2e passed (e2e twice and three more times; the rename test in e2e/tree.spec.ts timed out in 2 of 6 runs: the Rename textbox did not appear after F2). e2e-claude-mcp, smoke-real-claude and e2e-real-claude each passed once (haiku, 0.25 USD cap). docs/parity.md is byte-identical to the output of pnpm parity. No commits exist on spike/stage2; all app files are untracked.
Drift in 0013: it describes stub modules (in-memory tree, fake sessions, MCP server that never listens) and lists TerminalPane without SurfacePane; it does not mention session_* commands or AGIDE_CLAUDE_ARGS / AGIDE_SESSION_CWD.
