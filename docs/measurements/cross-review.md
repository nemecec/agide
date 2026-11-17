# cross-review

Start: 2026-11-17 10:03:08 UTC (date -u). End: 2026-11-17 10:42:25 UTC (date -u). Wall time about 39 minutes.

Cross-model review of `docs/decisions/0013-stage2-architecture-and-contracts.md` and `0014-milestone-1-results.md` against the code in `app/`, the test output, the measurement files and the probe output in `probes/out/`. No source file in `app/` is changed.

## Commands run

- `pnpm typecheck`, `pnpm test`, `pnpm e2e` in `app/`: all pass, at the start and again at the end.
- `pnpm e2e:claude-mcp` and `pnpm e2e:real-claude` once each (haiku, 0.25 USD cap): both pass. Costs 0.0042 and 0.0046 USD.
- A mutation run over the unit tests: one rule removed at a time, `vitest run`, file restored and compared by checksum. The source tree is identical before and after.
- A temporary Playwright spec with three folder levels and a leaf below them (drag across levels, rejected cycle drop, restart): passes. The spec is deleted.
- Two instances of the built app on one data directory, hidden: the second exits with code 0 after about a quarter of a second. An instance on another data directory runs next to the first.
- The hook command of `core/session/hooks.ts` under `fish -c`, `zsh -c`, `bash -c` and `/bin/sh -c` with an inbox path that holds spaces and a quote: each stores its payload.
- One `claude -p` call (haiku, 0.25 USD cap, empty temporary directory, `--setting-sources user`, `--strict-mcp-config`, tools off, cost 0.0007 USD) with a `UserPromptSubmit` hook that records its own interpreter: the CLI started it as `/bin/sh -c <command>` with `claude` as the parent, `SHELL` was `/bin/zsh`, and the model reported no text from the hook.
- `pnpm view` for `typescript-eslint`, `typescript` and `better-sqlite3` (public registry, package names only).

## Findings

Errors corrected in the records:

- P6: the records and the notes said that no approval dialog shows when the `PermissionRequest` hook answers. The raw PTY output of all P6 cases holds the dialog text; the hook's answer closes the dialog without a keypress. 0014 now says so and lists a waiting hook as untested.
- P9b and P9 were mixed: the controlled comparison is `-p` only; the PTY result comes from single P9 runs.
- P8: the two sizes next to the limit ran in `-p` only.
- 0014 said the app "refuses a second instance" under "what is shown" and S1 "at three levels and deeper"; neither had a test. Both are now stated with their evidence (manual run, temporary spec).
- The re-estimate concluded that the total "points below the 168 days". The measurements are agent minutes with no user hours, so they give no total in engineer days. The paragraph now states what the measurements show.
- The token column is empty and 0012 asks for tokens; now an open item.
- 0013: `pnpm test` also covers `src/main`; the `ui_*` commands were written by the MCP builder; no renderer builder ran; the revoke after a failed launch applies to `session_create` only; node-pty's install script can build with node-gyp.

Mutation results (all listed in 0013 under "Rules without a test"):

- Fail a test: both forged-leaf guards, scope of `ui_create_leaf` and of the moved node, session scope, revoke on exit, revoke on a top-level move, rescope on move, startup cleanup, bypass confirmation, migration version check, listener error handling, 413, `OutputBuffer` trim, inbox reset, parity exemption rule.
- Pass every test: revoke on close (the exit before it revokes), revoke after a failed `session_create` launch, withheld grant for a resumed session whose leaf is outside its folder, `busy_timeout`, the 500 handler.
- `UNION ALL` in `isWithin`: the stored-cycle test never returns. The run timed out after 240 seconds and left one test worker spinning, which I stopped.

Supported as written: the toolchain versions, the Node and SQLite versions inside Electron, the contracts in 0013 against the code, P7, P10, the P9 table, the wall times and their sums, the 0005 and 0007 figures, and the arithmetic of the projection.

## What took long

The mutation run: the `UNION ALL` case hung until its timeout.

## Not finished

- `notes/probes-stage2.md` and `probes/RESULTS.md` still say that no dialog appears in P6. They are outside the two records; 0014 names the discrepancy.
- 0004 is not edited (as before).
- Not checked: the reports of the builder, integration, review and fix steps that 0014 summarizes (not stored as files), the statement that the reviews rejected the integrated code, and the flake fix beyond the two e2e runs of this review.
- The shell guard refused the removal of my scratch files: `/tmp/agui-review-mut`, `/tmp/agui-review-hookshell` and the `/tmp/agui-review-*.log` files. They hold a mutation script, checksum lists, the hook probe script and test logs.
- No token count is available to me.
