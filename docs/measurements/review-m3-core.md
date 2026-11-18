# review-m3-core

Start: 2026-11-18 00:12 UTC
End: 2026-11-18 00:26 UTC

Independent code review of `app/src/core/browser`, `core/permissions`, `core/tasks`, `core/agents`, `core/isolation` and the main modules `browser.ts`, `permissions.ts`, `tasks.ts` and `agents.ts`.

Work:

- Ran `pnpm typecheck` (clean) and `pnpm coverage` (all files and thresholds pass).
- Ran the shell classifier over inputs that use shell syntax the parser reads differently from bash (`$"..."`, `$(( $(...) ))`, backticks and single quotes inside `${...}`, `time -p`, `function f { ...; }`, `env -S`, `git --config-env=alias.*`) and checked each with bash. Each gave no class.
- Mutated security-relevant lines one at a time and ran the guarding test files. Most mutations failed a test; the survivors are listed in the review result.
- Read the task start path for untrusted text reaching the first prompt, the browser grants and navigation checks, and the srt and container providers for write paths and the hook command.

Not finished: no e2e or real-Claude run; claims that depend on CLI 2.1.326 or srt behaviour (the CLI's own matching of the ask rules on these inputs, srt's built-in write denies, project `.mcp.json` loading under `--setting-sources user`) are marked as not checked.

Temporary files: the mutation runner and two logs under the OS temporary directory could not be removed (removal was denied).
