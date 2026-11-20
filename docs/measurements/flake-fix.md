# Flaky session tests under `pnpm coverage`

## Symptom

`pnpm coverage` in `app/` fails in some full runs and passes when the failing file runs alone. The failures are in tests that start a real PTY process with a fake CLI and then type into it.

## Reproduction before the fix

Full `pnpm coverage` runs on a laptop, before any change:

| Run | Result | Duration | Failing tests and assertion messages |
| --- | --- | --- | --- |
| 1 | failed | 38 s | `PtySessionService.test.ts` "terminal > writes raw input unchanged": `Error: timed out waiting for turn` |
| 2 | failed | 49 s | `appModules.test.ts` "session module scope > revokes the grant when the session closes and when its process exits": `AssertionError: status after /exit: expected 'idle' to be 'exited'` |
| 3 | failed | 78 s | the two failures of runs 1 and 2 |
| 4 | stopped | | stopped by hand when free disk ran out |
| 5 | failed | 91 s | `appModules.test.ts` as in run 2; `PtySessionService.test.ts` "goes from starting to idle on SessionStart, busy during a turn and back to idle on Stop": `Error: timed out waiting for turn end`; "keeps two prompts apart when sent in a row": `Error: timed out waiting for both turns`; `ContainerProvider.test.ts` (Docker): `SIGKILL: container is gone: expected true to be false` |

Every PTY failure has the same shape: the session reached `idle`, the test typed a line, and the fake CLI never handled it. The status stays `idle` and no `UserPromptSubmit` hook arrives.

A probe that starts `fake-claude.mjs` in a PTY and writes `hello\r` at once shows the mechanism. The output is `hello\r\nfake-claude ready ...`: the terminal driver echoes the input, and the fake CLI never prints `echo: hello`. With the same write 500 ms later, the fake CLI answers.

## Root causes

### The fake CLIs report `SessionStart` before they read the terminal in raw mode

A new PTY starts in canonical mode with `ICRNL` set. In that mode the line discipline turns the `\r` of Enter into `\n` and echoes the input. The fake CLIs (`fake-claude.mjs`, `fake-claude-hooks.mjs`, `fake-claude-agents.mjs`, `scripts/lib/visual/fakeClaude.mjs`, `e2e/fixtures/fake-claude-m3.mjs`) ran the `SessionStart` hook first and switched stdin to raw mode after it. The session service sets `idle` when the hook record arrives, and the tests type as soon as they see `idle`. When the parent process sees the hook record before the child has returned from the synchronous hook run and called `setRawMode`, the typed `\r` reaches the fake CLI as `\n`. The fake CLI submits a line only on `\r`, so the line is never submitted and the test waits until its deadline.

On an idle machine the child wins this race by a small margin. With all test files and V8 coverage in parallel, the child is often descheduled between the hook and `setRawMode`, and the parent wins. This is a race between a readiness signal and the state the test expects: the fixture announced readiness before it was ready. Longer timeouts do not help, since the lost Enter never arrives.

`fake-claude-trust.mjs` already set raw mode before it showed its dialog and had no such failure.

### `sendText` types into a session that has not started

`PtySessionService.sendText` wrote the text, waited `submitDelayMs` and wrote `\r`, whatever the status. The `appModules.test.ts` test sends `/exit` right after `session_create`, while the session is still `starting`. It passed only when the fake CLI reached raw mode within the 300 ms submit delay. Under load the start takes longer, `\r` arrives in canonical mode, the CLI never exits, and `expect.poll` times out on `status after /exit` with `idle`.

This is a defect of the service, not only of the test. Before `SessionStart` the real CLI can show the folder-trust dialog or not read its terminal yet. Text typed then is lost, or its Enter answers the trust dialog. The first prompt of `create` already waited for `SessionStart`; text from `session_send_text` did not.

The grant revocation itself has no race. `onExit` sets the status to `exited` and emits `session.exited` in the same synchronous call, and the session module revokes the grant in its listener for that event, so no poll can see `exited` with the grant still in place.

### Other failures

- `ContainerProvider.test.ts` failed in run 5 while free disk was at 0 bytes. It needs Docker, which the CI runner does not have. It is not analysed further here.
- `tasks.test.ts` "shows the guidance of the base branch" failed in an earlier run. It did not fail in these runs, so no assertion message is available. The test waits for the create prompt, which the service types `firstPromptDelayMs` after `SessionStart`, and the fake CLI now reads raw input before `SessionStart`. What remains is an 8 s deadline inside the test that covers a git clone, a worktree and a CLI start.

## Changes

- The fake CLIs switch stdin to raw mode before they run the `SessionStart` hook, so input typed once the session is `idle` keeps its `\r`.
- `PtySessionService` keeps a `started` promise per process. It resolves when the status leaves `starting`, on the first `SessionStart` or when the process ends. `sendText` waits for it before it types. `write`, which passes raw keys such as the answer to the trust dialog, does not wait.
- `SessionService.sendText` in `src/core/session/types.ts` states that text sent while `starting` is typed once the session leaves `starting`.
- A new test, "types text sent while the session starts once SessionStart has arrived" in `PtySessionService.test.ts`, calls `sendText` right after `create`. With a 20 ms submit delay the old code writes the text and Enter before the fake CLI is in raw mode, so the turn never ends and the test fails. With the change, the text is typed after `SessionStart`.
- The timeouts in `vitest.config.ts` are not changed by this fix.

## Evidence after the fix

Verified on 2026-11-20 on a machine with low load and 14 GiB of free disk: `pnpm typecheck`, ten consecutive full `pnpm coverage` runs (all ten passed; 1419 tests passed and 15 were skipped in each), `pnpm build` and `pnpm e2e` (58 tests) all pass. Before the fix, every one of five coverage runs on this machine failed. The new test guards the bug: with the `await started` line of `sendText` commented out, it timed out waiting for the turn end in three of three runs, and the file was restored afterwards.
