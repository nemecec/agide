import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { contractSpec } from '../runtime/agentRuntimeContract';
import { killGroup, processRuns, spawnStandIn, STAND_IN_POLL_MS } from './standIn.mjs';
import { streamHarness } from './streamHarness';

const STAND_IN_URL = pathToFileURL(join(import.meta.dirname, 'standIn.mjs')).href;
const FAKE_CLAUDE_STREAM = join(import.meta.dirname, 'fake-claude-stream.mjs');
/** How long a test waits for a process to end on its own: several polls of a stand-in, with room for a loaded machine. */
const ENDS_WITHIN_MS = 8_000;

async function eventually(check: () => boolean, what: string, ms = ENDS_WITHIN_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not within ${ms} ms: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Starts a scratch parent process in its own process group. `body` is the rest of its script; it gets the directory
 * of the parent and writes the pid of the process it starts to `pidFile`. The parent ends by itself after a minute,
 * and the end of the test kills its group and removes the directory.
 */
async function startParent(body: (dir: string, pidFile: string) => string): Promise<{ parent: ChildProcess; childPid: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'stand-in-parent-'));
  const pidFile = join(dir, 'child.pid');
  const script = join(dir, 'parent.mjs');
  writeFileSync(script, [`import { writeFileSync } from 'node:fs';`, body(dir, pidFile), `setTimeout(() => undefined, 60_000);`].join('\n'));
  const parent = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  onTestFinished(() => {
    killGroup(parent.pid);
    rmSync(dir, { recursive: true, force: true });
  });
  await eventually(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', 'the parent wrote the pid of its child');
  return { parent, childPid: Number(readFileSync(pidFile, 'utf8')) };
}

describe('a stand-in that its parent leaves behind', () => {
  it('ends within a bound after its parent is killed with SIGKILL', async () => {
    const { parent, childPid } = await startParent((_dir, pidFile) =>
      [`import { spawnStandIn } from ${JSON.stringify(STAND_IN_URL)};`, `writeFileSync(${JSON.stringify(pidFile)}, String(spawnStandIn().pid));`].join('\n'),
    );
    expect(processRuns(childPid), 'the stand-in runs while its parent runs').toBe(true);
    parent.kill('SIGKILL');
    await eventually(() => !processRuns(childPid), 'the stand-in ends after its parent was killed');
  });

  it('stays up while its parent runs and ends at its lifetime cap', async () => {
    const child = spawnStandIn({ maxLifetimeMs: 3 * STAND_IN_POLL_MS });
    onTestFinished(() => void child.kill('SIGKILL'));
    await new Promise((resolve) => setTimeout(resolve, 2 * STAND_IN_POLL_MS));
    expect(child.exitCode, 'still running after more than one poll while its parent is alive').toBeNull();
    await eventually(() => child.exitCode !== null, 'the stand-in ends at its lifetime cap');
    expect(child.exitCode, 'the cap ends it with code 0').toBe(0);
  });

  it('is a fake CLI that ignores a closed stdin, and ends within a bound after its parent is killed with SIGKILL', async () => {
    const { parent, childPid } = await startParent((dir, pidFile) =>
      [
        `import { spawn } from 'node:child_process';`,
        `const env = { ...process.env, FAKE_CLAUDE_IGNORE_STDIN_CLOSE: '1', FAKE_CLAUDE_STATE: ${JSON.stringify(join(dir, 'state'))} };`,
        `const fake = spawn(process.execPath, [${JSON.stringify(FAKE_CLAUDE_STREAM)}, '--session-id', ${JSON.stringify(randomUUID())}], { env, stdio: 'ignore' });`,
        `writeFileSync(${JSON.stringify(pidFile)}, String(fake.pid));`,
      ].join('\n'),
    );
    await new Promise((resolve) => setTimeout(resolve, 2 * STAND_IN_POLL_MS));
    expect(processRuns(childPid), 'the fake CLI stays up with its stdin closed while its parent runs').toBe(true);
    parent.kill('SIGKILL');
    await eventually(() => !processRuns(childPid), 'the fake CLI ends after its parent was killed');
  });
});

describe('a test of the stream harness that fails or times out', () => {
  const started: { readonly dir: string; standIn: number; ranInBody: boolean }[] = [];

  /** Starts an agent whose fake CLI has a stand-in, and records the harness directory and the stand-in. */
  async function agentWithStandIn(): Promise<void> {
    const h = await streamHarness({ children: true });
    const record = { dir: h.dir, standIn: 0, ranInBody: false };
    started.push(record);
    await h.runtime.launch(contractSpec(h, '/text hi'));
    record.standIn = Number(readFileSync(h.childPidFile, 'utf8'));
    record.ranInBody = processRuns(record.standIn);
  }

  it.fails('throws in its body with an agent and its stand-in running', async () => {
    await agentWithStandIn();
    throw new Error('the body fails');
  });

  it.fails('times out in its body with an agent and its stand-in running', { timeout: 3_000 }, async () => {
    await agentWithStandIn();
    await new Promise(() => undefined);
  });

  it('leaves no stand-in and no directory behind once the cleanup hooks of those tests have run', async () => {
    expect(started.length, 'both failing tests started a harness').toBe(2);
    expect(
      started.map((record) => record.ranInBody),
      'the stand-in ran while the body of each test ran',
    ).toEqual([true, true]);
    for (const record of started) {
      await eventually(() => !processRuns(record.standIn), `the stand-in ${record.standIn} of ${record.dir} ended`);
      expect(existsSync(record.dir), `${record.dir} is removed`).toBe(false);
    }
  });

  it('closes on request, ends the stand-in with it, removes the directory, and may close twice', async () => {
    const h = await streamHarness({ children: true });
    await h.runtime.launch(contractSpec(h, '/text hi'));
    const standIn = Number(readFileSync(h.childPidFile, 'utf8'));
    expect(processRuns(standIn), 'the stand-in runs before the close').toBe(true);
    await h.close();
    await eventually(() => !processRuns(standIn), 'the stand-in ends with the close');
    expect(existsSync(h.dir), 'the directory is removed').toBe(false);
    await expect(h.close(), 'a second close is not an error').resolves.toBeUndefined();
  });
});

describe('the fixture helpers', () => {
  it('kills the process group of a leader, and does nothing when the group is gone or there is no leader', async () => {
    const leader = spawnStandIn({ detached: true });
    onTestFinished(() => void leader.kill('SIGKILL'));
    expect(processRuns(leader.pid!), 'the leader runs').toBe(true);
    killGroup(leader.pid);
    await eventually(() => leader.signalCode !== null, 'the leader ends with its group');
    expect(leader.signalCode, 'the group got SIGKILL').toBe('SIGKILL');
    expect(() => killGroup(leader.pid), 'a group that is gone is not an error').not.toThrow();
    expect(() => killGroup(undefined), 'no leader is not an error').not.toThrow();
  });

  it('signals nothing for a pid that cannot lead a group: 0 is the own group, 1 is every process, a negative pid is another process', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      for (const leader of [0, 1, -1, -4242, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) killGroup(leader);
      expect(kill, 'no signal was sent for any of those values').not.toHaveBeenCalled();
      killGroup(2_147_000_000);
      expect(kill, 'a real pid above 1 gets the group signal').toHaveBeenCalledWith(-2_147_000_000, 'SIGKILL');
    } finally {
      kill.mockRestore();
    }
  });

  it('starts the stand-in of the harness so that it watches the test runner and not the fake CLI that starts it', async () => {
    const h = await streamHarness({ children: true });
    await h.runtime.launch(contractSpec(h, '/text hi'));
    const standIn = Number(readFileSync(h.childPidFile, 'utf8'));
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(standIn)], { encoding: 'utf8' }).trim();
    const [watched] = command.split(/\s+/).slice(-2);
    expect(watched, 'the watched pid is the pid of the test runner, so the group-kill tests see a stand-in that outlives the fake CLI').toBe(String(process.pid));
    const parent = execFileSync('ps', ['-o', 'ppid=', '-p', String(standIn)], { encoding: 'utf8' }).trim();
    expect(parent, 'the fake CLI, not the runner, is the parent of the stand-in').not.toBe(String(process.pid));
  });
});
