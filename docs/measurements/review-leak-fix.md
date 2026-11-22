# Review of the stand-in leak fix

Start: 2026-11-22 10:45:24 UTC. End: 2026-11-22 10:55:24 UTC.

Verdict: accept with fixes. All findings are minor.

## Checks

- Reproduction: a scratch runner starts the fake CLI of HEAD in its own process group with piped stdio and `FAKE_CLAUDE_CHILD_PID_FILE`, and gets SIGKILL. The stand-in of HEAD still ran 8 s later with parent pid 1 and was stopped by hand. With the change, the stand-in ended about 1.1 s after the SIGKILL when it watches the fake CLI, and about 1.0 s after when it watches the runner.
- `onTestFinished` in vitest 5.1.0: a scratch test file showed that it runs after a failed body, after a timeout, when it is registered in a `beforeEach`, and after an `afterEach` that throws. A throwing `afterEach` skips the outer `afterEach` hook, as the account says. A throwing `onTestFinished` callback does not skip the others. Every caller of `streamHarness()` calls it from a test or a `beforeEach` hook.
- Product mutations: when `signalGroup` signals only the leader, the two group tests of `StreamAgentRuntime.test.ts` fail. When `terminate` signals only the pid, the grandchild test of `systemProcesses.test.ts` fails. With the first mutation, and with the stand-in watching the fake CLI, both group tests pass. This shows why the harness makes the stand-in watch the runner.
- The affected files ran 5 times, and once with 16 `yes` processes on 8 cores at a load average above 14. Each run had 99 passes and 2 expected failures, and took 10 to 11 s.
- Coverage with only `node` and the system directories in `PATH`: 269 files passed, with 3081 tests passed, 2 expected failures and 31 skipped. Lines of `src/core/**` are 97.10 %.
- `pnpm typecheck` and `pnpm build` pass. `AGIDE_HIDDEN=1 pnpm e2e` passed 86 of 86 in 2.7 minutes, with no retries. This includes the 11 swarm and review specs, some of which use the fake CLI.

## Findings

- Minor: `killGroup` does not check its argument. `killGroup(0)` sends SIGKILL to the group of the caller. A scratch process in its own group showed this: the process and its sibling both died. In a test worker, that group contains the vitest process and the shell. `killGroup(1)` becomes `kill(-1, SIGKILL)`, which reaches every process of the user. The current callers pass only `child.pid`, so no caller reaches these cases. Fix: return when `leader` is not an integer above 1.
- Minor: no test checks that the harness makes the stand-in watch the runner. If `FAKE_CLAUDE_CHILD_WATCH_PID` is removed from `streamHarness.ts`, the two group tests pass even when the product signals only the leader. Fix: add a test that sends SIGKILL to the fake CLI alone (not to its group), and then checks that the stand-in still runs after two polls.
- Minor: if the system reuses a pid, `endStandIn` can end the stand-in of another test that runs at the same time. `processRuns` counts EPERM as running, so a watched pid that a process of another user takes over keeps the stand-in alive until the lifetime cap. Both cases are unlikely, and the lifetime cap limits how long the stand-in can run.
- Nit: the fake CLI writes the pid file again at each launch, so `close` ends only the stand-in of the last launch. No test with `children` starts more than one agent.
- Nit: `STAND_IN_SOURCE` includes the source of `processRuns`. A coverage provider that instruments code, such as istanbul, would break the stand-in. The project uses v8 and excludes the fixtures.
- Style: all assertions have messages. The changed text has no banned words, absolute user paths, e-mail addresses or tokens.

## Counts

Before and after every run, the counts were 0 stand-ins and 0 `stream-runtime-*` directories.
