import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ensureDir, sleepSync, writeFileAtomic } from './fsio';
import { rootPaths } from './paths';
import { defaultSettings } from './schemas';
import { processLiveness } from './registryStatus';
import { DEFAULT_PROFILE_ID, type ProfileDefinition, type ProfileSettings } from './types';

export type MigrationResult =
  /** `profiles/` existed already or this call created it. */
  | { readonly status: 'ready' }
  /** A milestone 1 process holds the root: the caller shows a notice and exits. */
  | { readonly status: 'busy' };

export interface MigrationOptions {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly isAlive?: (pid: number) => boolean;
  readonly pid?: number;
  /** How long to wait for another process that holds the migration lock. Default 30 seconds. */
  readonly waitMs?: number;
}

/** Files of milestone 1 at the root that belong to the default profile's data directory. */
const M1_FILES = ['app.db', 'app.db-wal', 'app.db-shm'];
/** `Partitions` holds the browser surfaces' persist:<service> state, so a default profile keeps its browser logins. */
const M1_DIRECTORIES = ['session-events', 'Partitions'];

/**
 * On the first start of the profile build, creates `profiles/default/` from the milestone 1 data at the root
 * (design 0022 section 1). The default profile adopts the login the app sees: a `CLAUDE_CONFIG_DIR` in the
 * environment is stored in the settings, since an app started from the Finder has no shell environment.
 *
 * The profile is built in `profiles.migrating/` and renamed to `profiles/` last. Milestone 1 files are copied,
 * and removed only after the rename, so a crash never loses them. A process that finds the lock held waits for
 * `profiles/`; a lock of a dead pid is taken over.
 */
export function ensureProfilesRoot(options: MigrationOptions): MigrationResult {
  const paths = rootPaths(options.root);
  const isAlive = options.isAlive ?? processLiveness.isAlive;
  const pid = options.pid ?? process.pid;
  ensureDir(options.root);
  const deadline = Date.now() + (options.waitMs ?? 30_000);

  for (;;) {
    if (existsSync(paths.profiles)) return { status: 'ready' };
    if (milestoneOneProcessRuns(options.root, pid, isAlive)) return { status: 'busy' };
    try {
      writeFileSync(paths.migrateLock, String(pid), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(readLockPid(paths.migrateLock));
      if (!Number.isInteger(holder) || holder <= 0 || !isAlive(holder)) {
        takeOverLock(paths.migrateLock, holder);
        continue;
      }
      if (Date.now() > deadline) throw new Error('the profile migration of another process did not finish');
      sleepSync(50);
      continue;
    }
    try {
      if (!existsSync(paths.profiles)) migrate(options);
    } finally {
      removeQuietly(paths.migrateLock);
    }
    return { status: 'ready' };
  }
}

function migrate(options: MigrationOptions): void {
  const paths = rootPaths(options.root);
  const staging = `${paths.migrating}.${options.pid ?? process.pid}`;
  rmSync(paths.migrating, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
  const dir = join(staging, DEFAULT_PROFILE_ID);
  const data = join(dir, 'data');
  mkdirSync(staging, { mode: 0o700 });
  chmodSync(staging, 0o700);
  for (const path of [dir, data]) ensureDir(path);

  const copied: string[] = [];
  for (const name of M1_FILES) {
    const source = join(options.root, name);
    if (existsSync(source)) {
      cpSync(source, join(data, name));
      copied.push(source);
    }
  }
  for (const name of M1_DIRECTORIES) {
    const source = join(options.root, name);
    if (existsSync(source)) {
      cpSync(source, join(data, name), { recursive: true });
      copied.push(source);
    }
  }

  const inherited = options.env['CLAUDE_CONFIG_DIR'];
  const settings: ProfileSettings = {
    ...defaultSettings({ isDefaultProfile: true, claudeConfigDir: '' }),
    ...(inherited && inherited.startsWith('/') ? { claudeConfig: { mode: 'directory' as const, path: inherited } } : {}),
  };
  const definition: ProfileDefinition = {
    schema: 1,
    id: DEFAULT_PROFILE_ID,
    name: 'Default',
    colour: '#5b7fa6',
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
  writeFileAtomic(join(dir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  writeFileAtomic(join(dir, 'profile.json'), `${JSON.stringify(definition, null, 2)}\n`);

  try {
    renameSync(staging, paths.profiles);
  } catch (error) {
    // Another process finished the migration first; its profiles directory stands and the sources are its to remove.
    rmSync(staging, { recursive: true, force: true });
    if (existsSync(paths.profiles)) return;
    throw error;
  }
  for (const source of copied) rmSync(source, { recursive: true, force: true });
}

/** Chromium's `SingletonLock` at the root is a symbolic link `<host>-<pid>` while a milestone 1 process runs. */
function milestoneOneProcessRuns(root: string, ownPid: number, isAlive: (pid: number) => boolean): boolean {
  const lock = join(root, 'SingletonLock');
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false;
    const pid = Number(readlinkSync(lock).split('-').at(-1));
    return Number.isInteger(pid) && pid > 0 && pid !== ownPid && isAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Removes the lock of a dead holder so that only one process does it: the lock is renamed to a name of this
 * process, which succeeds for one of several callers. A lock that is not the dead holder's by then, because a
 * live process created its own in between, is put back.
 */
function takeOverLock(lock: string, deadHolder: number): void {
  const taken = `${lock}.stale-${randomBytes(6).toString('hex')}`;
  try {
    renameSync(lock, taken);
  } catch {
    return;
  }
  const content = readLockPid(taken);
  removeQuietly(taken);
  if (content !== '' && Number(content) !== deadHolder) {
    try {
      writeFileSync(lock, content, { flag: 'wx', mode: 0o600 });
    } catch {
      // A third process took the lock meanwhile.
    }
  }
}

function readLockPid(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}
