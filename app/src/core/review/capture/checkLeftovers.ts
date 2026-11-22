import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { removeTree } from './CheckClones';
import type { CheckProcesses } from './ProcessSweep';

export interface LeftoverOptions {
  readonly processes: CheckProcesses;
  /** Holds one directory per swarm with the checkouts of runs, and the `-tmp` directories next to them; this profile's only. */
  readonly checkoutRoot: string;
  /** The `srt` settings files of check launches. */
  readonly settingsDir: string;
  /** Removes the clone directories. */
  readonly clones: { sweep(): Promise<void> };
}

/**
 * Cleans up after a killed app, before any check runs: first the processes that its runs left (a detached one can
 * recreate its run directories, since `srt` allows writes by path), then the checkouts with their temporary
 * directories, the settings files and the clones. A stale git worktree record is pruned by the next run on the same
 * repository. A step that fails does not stop the others; the first error is thrown at the end.
 */
export async function sweepCheckLeftovers(options: LeftoverOptions): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (step: () => Promise<unknown>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  };
  await attempt(() => options.processes.endStale(new Set()));
  await attempt(() => options.clones.sweep());
  for (const directory of [options.checkoutRoot, options.settingsDir]) {
    await attempt(async () => {
      for (const name of await readdir(directory).catch(() => [])) await removeTree(join(directory, name));
    });
  }
  if (errors.length > 0) throw errors[0];
}
