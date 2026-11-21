import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemProcesses } from './PersistentSwarmManager';

describe('the process control of the host', () => {
  it('sees a live process and its command line, and not a process that does not exist', () => {
    expect(systemProcesses.alive(process.pid), 'this process is alive').toBe(true);
    expect(systemProcesses.alive(2 ** 22 + 7), 'a pid that no process has').toBe(false);
    expect(systemProcesses.commandLine(process.pid), 'the command line of this process').toContain('node');
    expect(systemProcesses.commandLine(2 ** 22 + 7), 'no command line for a missing process').toBeUndefined();
  });

  it('ends a process group and its leader, and does nothing for a process that is gone', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { detached: true, stdio: 'ignore' });
    const exited = new Promise<string | null>((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
    systemProcesses.terminate(child.pid!);
    expect(await exited, 'the leader got SIGTERM').toBe('SIGTERM');
    expect(() => systemProcesses.terminate(2 ** 22 + 7), 'a missing process is not an error').not.toThrow();
  });

  it('ends a process that the leader of the group started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agide-group-'));
    const pidFile = join(dir, 'grandchild.pid');
    const leaderScript = `const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => undefined, 1000);`;
    const leader = spawn(process.execPath, ['-e', leaderScript], { detached: true, stdio: 'ignore' });
    try {
      let grandchild = 0;
      for (let attempt = 0; attempt < 100 && grandchild === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        grandchild = Number((existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : '').trim() || 0);
      }
      expect(systemProcesses.alive(grandchild), 'the grandchild runs before the call').toBe(true);
      systemProcesses.terminate(leader.pid!);
      for (let attempt = 0; attempt < 100 && systemProcesses.alive(grandchild); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(systemProcesses.alive(grandchild), 'the grandchild is gone after the group got the signal').toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
