# Review of w-reviewer

Label: review:w-reviewer. Start 2026-11-21 16:33 UTC, end 2026-11-21 16:45 UTC.

## What was done

- Read 0040 sections 9 to 11, 16 and 17, 0041, the reviewer files under `app/src/core/review/reviewer/` and the diffs of the shared files (`mcp/grants.ts`, `HttpAppMcpServer.ts`, `mcp/types.ts`, `mcp/tools.ts`, `StreamAgentRuntime.ts`, `streamLaunch.ts`, `normalize.ts`), the real-Claude script.
- Ran the tests of `src/core/review`, `src/core/swarm`, `src/core/mcp` and `src/main/modules`: all passed. `tsc -p tsconfig.node.json` reports errors only in files of other builders (`InMemorySwarmManager.ts`, `main/modules/review.ts`). The colour check passed.
- Ran `node scripts/mutation-checks.mjs reviewer:`: every reviewer mutation was killed.
- Ran further mutations with a script under the temporary directory that copies the file, applies the change, runs the tests and restores the file, compared with `cmp` (every file restored byte for byte). Survivors: fsmonitor not disabled in the checkout; the driver's retry after a cancel failure that it did not request; the tool set not declared on resume; a policy lowering a hard reviewer reason (equivalent, no reviewer reason is hard).
- A scratch test (created and deleted again in the reviewer folder) showed that `cancel` during the checkout preparation is lost and the reviewer launches.
- A git experiment in the temporary directory showed that a smudge filter named in the common directory's `info/attributes` runs during the reviewer checkout with the builder's flags.

## Not done

- The real-Claude script was not run again; no model was started.
- The temporary directory `/tmp/agide-review-w-reviewer/` (mutation script, test temp files, a git experiment) was not removed: the permission system denied `rm`. The coordinator can remove it.
- The wiring of the persistent manager and the review module was not reviewed (w-manager).
