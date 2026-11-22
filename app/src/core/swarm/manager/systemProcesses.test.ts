import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { killGroup, spawnStandIn } from '../fixtures/standIn.mjs';
import { systemProcesses } from './PersistentSwarmManager';

describe('the process control of the host', () => {
  it('sees a live process and its command line, and not a process that does not exist', () => {
    expect(systemProcesses.alive(process.pid), 'this process is alive').toBe(true);
    expect(systemProcesses.alive(2 ** 22 + 7), 'a pid that no process has').toBe(false);
    expect(systemProcesses.commandLine(process.pid), 'the command line of this process').toContain('node');
    expect(systemProcesses.commandLine(2 ** 22 + 7), 'no command line for a missing process').toBeUndefined();
  });

  it('ends a process group and its leader, and does nothing for a process that is gone', async () => {
    const child = spawnStandIn({ detached: true });
    onTestFinished(() => killGroup(child.pid));
    const exited = new Promise<string | null>((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
    systemProcesses.terminate(child.pid!);
    expect(await exited, 'the leader got SIGTERM').toBe('SIGTERM');
    expect(() => systemProcesses.terminate(2 ** 22 + 7), 'a missing process is not an error').not.toThrow();
  });

  it('ends a process that the leader of the group started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agide-group-'));
    const pidFile = join(dir, 'grandchild.pid');
    const leaderFile = join(dir, 'leader.mjs');
    // The grandchild watches this test process, so only the signal to the group ends it before the test ends.
    writeFileSync(
      leaderFile,
      [
        `import { writeFileSync } from 'node:fs';`,
        `import { endWithParent, spawnStandIn } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'fixtures', 'standIn.mjs')).href)};`,
        `const watched = Number(process.argv[2]);`,
        `writeFileSync(${JSON.stringify(pidFile)}, String(spawnStandIn({ parentPid: watched }).pid));`,
        `endWithParent(watched);`,
      ].join('\n'),
    );
    const leader = spawn(process.execPath, [leaderFile, String(process.pid)], { detached: true, stdio: 'ignore' });
    onTestFinished(() => {
      killGroup(leader.pid);
      rmSync(dir, { recursive: true, force: true });
    });
    let grandchild = 0;
    for (let attempt = 0; attempt < 100 && grandchild === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      grandchild = Number((existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : '').trim() || 0);
    }
    expect(grandchild, 'the leader wrote the pid of the grandchild').toBeGreaterThan(0);
    expect(systemProcesses.alive(grandchild), 'the grandchild runs before the call').toBe(true);
    systemProcesses.terminate(leader.pid!);
    for (let attempt = 0; attempt < 100 && systemProcesses.alive(grandchild); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(systemProcesses.alive(grandchild), 'the grandchild is gone after the group got the signal').toBe(false);
  });
});
