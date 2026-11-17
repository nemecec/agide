import { readFileSync } from 'node:fs';
import { ensureDir, writeFileAtomic } from './fsio';
import { rootPaths } from './paths';
import { PROFILE_ID } from './schemas';
import { DEFAULT_PROFILE_ID, type ProfileId } from './types';

/** `--profile=<id>` or `--profile <id>` from the start arguments. */
export function profileIdFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length);
    if (arg === '--profile') return argv[i + 1];
  }
  return undefined;
}

/** The id the last focused profile process stored, or undefined. */
export function readLastProfile(root: string): ProfileId | undefined {
  try {
    const value = readFileSync(rootPaths(root).lastProfile, 'utf8').trim();
    return PROFILE_ID.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeLastProfile(root: string, id: ProfileId): void {
  ensureDir(root);
  writeFileAtomic(rootPaths(root).lastProfile, `${id}\n`);
}

export interface ProfileChoice {
  readonly id: ProfileId;
  /** Set when a requested id was unknown and `default` opens instead. */
  readonly notice?: string;
}

/**
 * The profile to open: `--profile`, then `AGIDE_PROFILE`, then the profile focused last, then `default`.
 * An id that names no profile opens `default` with a notice.
 */
export function chooseProfile(options: {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly root: string;
  readonly exists: (id: ProfileId) => boolean;
}): ProfileChoice {
  const requested = profileIdFromArgv(options.argv) ?? options.env['AGIDE_PROFILE'];
  if (requested !== undefined && requested !== '') {
    if (PROFILE_ID.test(requested) && options.exists(requested)) return { id: requested };
    return { id: DEFAULT_PROFILE_ID, notice: `Profile "${requested}" does not exist. Opened the default profile.` };
  }
  const last = readLastProfile(options.root);
  return { id: last !== undefined && options.exists(last) ? last : DEFAULT_PROFILE_ID };
}
