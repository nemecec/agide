import { spawn, type SpawnOptions } from 'node:child_process';
import type { ProfileId } from '../core/profile/index';

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => { unref(): void; on(event: 'error', listener: (error: Error) => void): unknown };

export interface LauncherOptions {
  readonly ownId: ProfileId;
  readonly focusOwnWindow: () => void;
  /** `process.execPath`. */
  readonly executable: string;
  /** Arguments that make the executable run the app: the entry script in development, none when packaged. */
  readonly appArgs: readonly string[];
  /** The environment this process started with. */
  readonly env: NodeJS.ProcessEnv;
  readonly spawn?: SpawnFn;
  readonly onFailure?: (id: ProfileId, error: Error) => void;
}

/**
 * `openProfile(id)` (design 0022 section 2). The own profile gets its window focused. Another profile is
 * started as a detached process with `--profile=<id>`; if that profile already runs, the new process hits the
 * single-instance lock, hands over the request and exits, so the launcher keeps no state and reads no registry.
 */
export function createProfileLauncher(options: LauncherOptions): (id: ProfileId) => void {
  const run: SpawnFn = options.spawn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
  return (id) => {
    if (id === options.ownId) {
      options.focusOwnWindow();
      return;
    }
    const child = run(options.executable, [...options.appArgs, `--profile=${id}`], {
      detached: true,
      stdio: 'ignore',
      env: options.env,
    });
    child.on('error', (error) => options.onFailure?.(id, error));
    child.unref();
  };
}
