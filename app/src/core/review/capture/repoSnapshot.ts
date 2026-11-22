import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { GuardedGit, type GitExec } from './guardedGit';

/**
 * What an agent can change in the shared repository from its worktree and that makes the user's own git run its
 * program later, or moves the user's branches (0040 section 17): the configuration files, the hooks directory,
 * `info/attributes` and the refs, plus the user-level Claude files a reviewer would load.
 */

export interface RepoSnapshot {
  readonly commonDir: string;
  readonly configHash: string;
  readonly hooksHash: string;
  readonly infoAttributesHash: string;
  /** `refs/heads/*`, `refs/tags/*` and `refs/replace/*` tips (a replace ref changes what the user's git shows for an object); the branches and refs the app creates for agents are left out. */
  readonly refs: Readonly<Record<string, string>>;
  readonly userConfigHash: string;
}

export interface RefChange {
  readonly ref: string;
  readonly change: 'created' | 'moved' | 'deleted';
  readonly old?: string;
  readonly new?: string;
}

export interface SnapshotDifference {
  /** Which of `config`, `hooks`, `info/attributes` changed. */
  readonly armed: readonly string[];
  /** The content hash now held by each name in `armed`, so a second change of the same kind is told apart from the first. */
  readonly armedContent: Readonly<Record<string, string>>;
  readonly refs: readonly RefChange[];
  readonly userConfigChanged: boolean;
  /** The user-level content hash now, set when `userConfigChanged`. */
  readonly userConfigContent: string | undefined;
}

const MAX_HASHED_BYTES = 8 * 1024 * 1024;
const sha256 = (...parts: (string | Buffer)[]): string => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
};

interface WalkLimits {
  readonly entries: number;
  readonly bytes: number;
  readonly depth: number;
}

const USER_LIMITS: WalkLimits = { entries: 20_000, bytes: 64 * 1024 * 1024, depth: 32 };
const REPO_LIMITS: WalkLimits = { entries: 2_000, bytes: 16 * 1024 * 1024, depth: 16 };

interface Walk {
  entries: number;
  bytes: number;
  readonly limits: WalkLimits;
  /** Real paths of the directories being walked, so a link back into the walk ends it. */
  readonly open: Set<string>;
}

const newWalk = (limits: WalkLimits): Walk => ({ entries: 0, bytes: 0, limits, open: new Set() });

/**
 * A file or directory by content, following links (skill installers and dotfile setups link user-level files, and a
 * link in the hooks directory runs the file it points to). A directory is cut at a number of entries or a depth, a
 * file past a number of bytes in all counts by its size and mtime.
 */
async function hashFollowing(path: string, walk: Walk): Promise<string> {
  let real: string;
  let info;
  try {
    real = await realpath(path);
    info = await stat(real);
  } catch {
    return 'absent';
  }
  if (info.isDirectory()) {
    if (walk.open.has(real)) return 'loop';
    if (walk.open.size >= walk.limits.depth) return 'deep';
    walk.open.add(real);
    const parts: string[] = [];
    for (const name of (await readdir(real)).sort()) {
      if (++walk.entries > walk.limits.entries) {
        parts.push('cut');
        break;
      }
      parts.push(name, await hashFollowing(join(real, name), walk));
    }
    walk.open.delete(real);
    return sha256('dir', ...parts);
  }
  if (!info.isFile()) return sha256('other', String(info.mode));
  walk.bytes += info.size;
  if (info.size > MAX_HASHED_BYTES || walk.bytes > walk.limits.bytes) return sha256('large', String(info.size), String(info.mtimeMs));
  return sha256('file', info.mode & 0o111 ? 'x' : '-', await readFile(real));
}

async function hashFiles(paths: readonly string[], limits: WalkLimits): Promise<string> {
  const parts: string[] = [];
  for (const path of paths) parts.push(path, await hashFollowing(path, newWalk(limits)));
  return sha256(...parts);
}

/** The per-worktree configuration files that exist: adding or removing a worktree changes nothing here. */
async function worktreeConfigs(commonDir: string): Promise<string[]> {
  const entries = await readdir(join(commonDir, 'worktrees')).catch(() => [] as string[]);
  const found: string[] = [];
  for (const name of entries.sort()) {
    const path = join(commonDir, 'worktrees', name, 'config.worktree');
    if (await lstat(path).then(() => true, () => false)) found.push(path);
  }
  return found;
}

const AGENT_REF = /^refs\/heads\/agide\//;

export async function takeSnapshot(input: { readonly commonDir: string; readonly userConfigPaths: readonly string[]; readonly exec?: GitExec }): Promise<RepoSnapshot> {
  const { commonDir } = input;
  const git = await GuardedGit.open(commonDir, { ...(input.exec === undefined ? {} : { exec: input.exec }) });
  const listing = await git.latin1(['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/tags', 'refs/replace']);
  const refs: Record<string, string> = {};
  for (const line of listing.split('\n')) {
    const [ref, oid] = line.split('\0');
    if (ref !== undefined && oid !== undefined && !AGENT_REF.test(ref)) refs[ref] = oid;
  }
  return {
    commonDir,
    configHash: await hashFiles([join(commonDir, 'config'), join(commonDir, 'config.worktree'), ...(await worktreeConfigs(commonDir))], REPO_LIMITS),
    hooksHash: await hashFiles([join(commonDir, 'hooks')], REPO_LIMITS),
    infoAttributesHash: await hashFiles([join(commonDir, 'info', 'attributes')], REPO_LIMITS),
    refs,
    userConfigHash: await hashFiles(input.userConfigPaths, USER_LIMITS),
  };
}

export function compareSnapshots(before: RepoSnapshot, after: RepoSnapshot): SnapshotDifference {
  const armed: string[] = [];
  const armedContent: Record<string, string> = {};
  const check = (name: string, was: string, now: string): void => {
    if (was === now) return;
    armed.push(name);
    armedContent[name] = now;
  };
  check('config', before.configHash, after.configHash);
  check('hooks', before.hooksHash, after.hooksHash);
  check('info/attributes', before.infoAttributesHash, after.infoAttributesHash);
  const refs: RefChange[] = [];
  for (const ref of [...new Set([...Object.keys(before.refs), ...Object.keys(after.refs)])].sort()) {
    const old = before.refs[ref];
    const now = after.refs[ref];
    if (old === now) continue;
    if (old === undefined) refs.push({ ref, change: 'created', new: now! });
    else if (now === undefined) refs.push({ ref, change: 'deleted', old });
    else refs.push({ ref, change: 'moved', old, new: now });
  }
  const userConfigChanged = before.userConfigHash !== after.userConfigHash;
  return { armed, armedContent, refs, userConfigChanged, userConfigContent: userConfigChanged ? after.userConfigHash : undefined };
}
