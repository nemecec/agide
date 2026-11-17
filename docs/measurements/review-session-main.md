# Review: session core, main process, preload and renderer

Start: 2026-11-17 09:32:35 UTC
End: 2026-11-17 09:43:12 UTC

## Work

An independent review of `app/src/core/session`, `app/src/main`, `app/src/preload`, `app/src/renderer` and their tests, checked against 0004, 0012 and `probes/RESULTS.md`.

- Ran `pnpm typecheck`, `pnpm test` and `pnpm e2e`. Typecheck and unit tests pass. The full e2e run failed three times in a row on `tree.spec.ts` "renames a node inline" (the rename input detaches). It then passed twice. The test also passes on its own.
- Mutation pass: removed the session scope checks, the MCP revoke on close, the startup cleanup of sessions without a leaf, the IPC sender check, the OutputBuffer trimming and the JsonlTail truncation reset, all together. Unit tests and e2e still passed. The files were restored and compared byte for byte with backups.
- A temporary e2e spec, deleted after the run, showed that an agent in folder A can create a `claude-session` leaf with the id of a session in folder B. Moving that leaf lets it send text to session B. Removing the leaf closes session B.
- A script with concurrent `sh -c` hook commands showed lost events in the events file: 7 of 20 lines parse with 2 KB payloads, and none with 300 KB payloads.
- A temporary unit test, also deleted, showed that `JsonlTail` corrupts a multi-byte character that is split across two reads.

## What took long

Separating the flaky rename e2e test from the mutation runs.

## Not finished

- Hook execution when the app starts from the Finder with fish as the login shell: not run.
- `--resume` for a session that never got a prompt: not run with the real CLI.
- The sandbox refused to delete the scratch folders under `/tmp` (`review-hookrace`, `review-scripts`, `review-bak.*`). They hold only test scripts and file backups.
