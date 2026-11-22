# Stand-in processes that tests leave behind

Start: 2026-11-22 10:23:34 UTC. End: 2026-11-22 10:44:35 UTC.

## Symptom

Test runs that timed out or were killed under load left idle node processes behind: `node -e setInterval(() => {}, 1000)`, parent pid 1, about 32 MB each, with a working directory under a `stream-runtime-*` temporary directory. A check of the machine found them after about 15 hours of test runs, and they were stopped by hand. Both counts are in the table of measurements.

## Cause

The stand-in had no condition to end. A test runner that dies cannot run `afterEach` hooks or signal a process group, so whatever the stand-in's parent did not end stayed alive.

Reproduction before the change: a scratch runner starts `fake-claude-stream.mjs` the way the stream harness does (its own process group, piped stdio, `FAKE_CLAUDE_CHILD_PID_FILE`), and the shell sends SIGKILL to the runner. The fake CLI exits when its stdin closes. The stand-in it started stays, with parent pid 1, until it is stopped by hand. It was still running after the four seconds the script watched.

The same mechanism applies to the fake CLI itself in its `FAKE_CLAUDE_STUBBORN` and `FAKE_CLAUDE_IGNORE_STDIN_CLOSE` modes: it ignores a closed stdin and keeps an interval alive, so a runner that dies leaves it running too.

Each of these spawned a stand-in with its own copy of the script and no end condition: `fake-claude-stream.mjs`, `systemProcesses.test.ts` (a detached stand-in and the script of a group leader) and `PtySessionStream.test.ts`.

### Cleanup that a failing test can skip

Vitest runs the `afterEach` hooks after a timeout, so a timed-out test does reach them. A hook that throws ends the loop over the remaining hooks, including the hooks of outer suites, and `onTestFinished` hooks run in a later step that this failure does not skip. These cleanups depended on a chain that could break:

- `StreamAgentRuntime.test.ts` and `PersistentSwarmManager.stream.test.ts` call `runtime.dispose()` before `harness.close()` in one hook. A rejected `dispose()` skipped the close, so the session service stayed up and the `stream-runtime-*` directory stayed on disk.
- `reviewerIntegration.test.ts` called only `harness.close()` and never `runtime.dispose()`.
- `harness.close()` removed the directory only after `sessions.shutdown()` had resolved.
- `systemProcesses.test.ts` removed its directory in a `finally` and never ended the leader or its child when an assertion failed before `terminate`.
- `PtySessionStream.test.ts` ended its stand-in only through `service.stop` in the body of the test.

### Product code

No leak comes from product code. `StreamAgentRuntime` signals the agent's process group in `signal` (stop, end after the grace period) and in `finalize` (SIGKILL after the leader exited). With both calls removed, the tests of the runtime that check children of the agent fail (table below), so the existing tests detect a product defect of this kind. The reproduction above leaves an orphan with no product code involved, because no product code runs after the runner is killed.

## Changes

- `fixtures/standIn.mjs` (with `standIn.d.mts`): `spawnStandIn` starts the idle process. The stand-in checks every second that the process it watches runs (`process.kill(pid, 0)`) and exits when it is gone, and exits at the latest after three minutes. Its script starts with `setInterval`, so `ps` still lists it as `node -e setInterval(...)`. `endWithParent` is the same watch for the fake CLI, `endStandIn` kills a pid only when its command line is a stand-in, and `killGroup` sends SIGKILL to a process group.
- `fixtures/fake-claude-stream.mjs` starts its stand-in with `spawnStandIn` and ends by itself in the stubborn and stdin-ignoring modes when its parent is gone. `FAKE_CLAUDE_CHILD_WATCH_PID` names the process the stand-in watches; the default is the fake CLI.
- `fixtures/streamHarness.ts`: with `children`, the stand-in watches the test runner, not the fake CLI. A stand-in that watched the fake CLI would end by itself within a second of the fake CLI, and the tests that check that the runtime ends the process group would no longer detect a runtime that does not. `close` runs once. It disposes the runtime, shuts the session service down and ends the recorded stand-in even when an earlier step throws, then removes the directory. `streamHarness` registers `close` with `onTestFinished`, so it runs after a failure or a timeout whatever the `afterEach` hooks of the file do.
- `systemProcesses.test.ts` and `PtySessionStream.test.ts` start their stand-ins with `spawnStandIn` and end them in `onTestFinished`. The leader of the group test is a scratch script that starts a stand-in watching the test runner, so only the signal to the group ends it.

## Tests

`fixtures/processLeaks.test.ts`:

- A scratch parent script starts a stand-in. After the parent is killed with SIGKILL, the stand-in has to end within eight seconds.
- A stand-in stays up while its parent runs and ends at its lifetime cap.
- A scratch parent starts the fake CLI in the stdin-ignoring mode with its stdin closed. The fake CLI stays up while the parent runs and ends within eight seconds of the parent's SIGKILL.
- An `it.fails` test starts a harness with an agent and its stand-in and throws in its body. Another one does the same and times out. A test after them checks that each stand-in ended and each directory is gone.
- `close` ends the stand-in, removes the directory and may run twice.
- `killGroup` ends a group, and a gone group or no leader is not an error.

## Measurements

Counts come from `ps -axo pid,ppid,command | grep 'node -e setInterval' | grep -v grep` and `ls -d "$TMPDIR"/stream-runtime-*`, with the `TMPDIR` of `os.tmpdir()`.

| Situation | Stand-ins | `stream-runtime-*` directories |
| --- | --- | --- |
| Found on the machine before this work, stopped by hand | 19 | not recorded |
| Start of this work | 0 | 0 |
| Reproduction before the change, 4 s after SIGKILL of the runner | 1, parent pid 1, stopped by hand | 0 |
| Affected files, five runs after the change (each run counted) | 0 | 0 |
| Affected files under CPU pressure | 0 | 0 |
| Forced timeouts at 40 different moments of a launch under CPU pressure | 0 | 0 |
| `pnpm coverage` once after the change | 0 | 0 |
| Whole vitest run killed with SIGKILL while a stubborn agent and its stand-in run | 0 after 0.9 s | 1, removed by hand |

The affected files are `StreamAgentRuntime.test.ts`, `systemProcesses.test.ts`, `PtySessionStream.test.ts`, `fakeClaudeStream.test.ts`, `processLeaks.test.ts`, `agentRuntime.test.ts`, `PersistentSwarmManager.stream.test.ts` and `reviewerIntegration.test.ts`. CPU pressure: sixteen `yes > /dev/null` processes on a machine with eight cores that already ran at a load average above fifteen, stopped afterwards. The forced timeouts are a scratch test file outside the repository with `it.fails(..., { timeout })` from 10 ms to 478 ms, each starting a harness with a stand-in. It checks, while its own worker still runs, that no stand-in watching that worker, no fake CLI and no directory is left. With the `onTestFinished(close)` line removed, the same file found a stand-in and a directory for every one of the 40 tests.

Other results:

- `pnpm typecheck` passes. `pnpm check:colours` prints `no colour literal outside the allowlist`.
- `pnpm coverage` passes in 40 s: 269 files, 3097 tests passed, 2 expected failures (`it.fails`), 15 skipped. Lines of `src/core/**` are 97.10 %, above the threshold of 97 %.

### Mutation checks

Each file was copied first, changed, tested, and restored from the copy; `cmp` reported the restored file as identical every time.

| Change | Test that failed |
| --- | --- |
| The stand-in does not check its parent | `ends within a bound after its parent is killed with SIGKILL` |
| `endWithParent` does not check its parent | `is a fake CLI that ignores a closed stdin, and ends within a bound after its parent is killed with SIGKILL` |
| The stand-in has no lifetime cap | `stays up while its parent runs and ends at its lifetime cap` |
| `streamHarness` does not register `close` with `onTestFinished` | `leaves no stand-in and no directory behind once the cleanup hooks of those tests have run` |
| `StreamAgentRuntime` sends no signal to the process group (product code, to check the existing tests) | `ends the processes the agent started, which share its process group` and `ends the children of an agent that exits on its own request to end` |
| `systemProcesses.terminate` signals the leader and not the group (product code) | `ends a process that the leader of the group started` |

The last two rows show that the tests that read a recorded pid still detect the failures they exist for, now that every stand-in ends by itself.

## Not covered

- A runner killed with SIGKILL leaves its `stream-runtime-*` directory, since no code runs afterwards. The directory holds a record file, session state and event files.
- `isolationProviderContract.ts` and `SrtProvider.test.ts` spawn `sleep 30`, which ends by itself after thirty seconds; they are unchanged.
- Temporary directories of other tests (`swarm-steps-*`, `agide-*` and the like) keep their `afterEach` removal.
- The Playwright suite, `pnpm build` and a CI run on Linux were not run. The fake CLI is also the executable of several end-to-end specs; it now imports `standIn.mjs` from its own directory.
