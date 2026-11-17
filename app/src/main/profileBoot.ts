import { join } from 'node:path';
import {
  chooseProfile,
  ensureDir,
  ensureProfilesRoot,
  FileProfileStore,
  profilePaths,
  type ProfileDefinition,
  type ProfileId,
  type ProfileSettings,
  type ResolvedProfile,
} from '../core/profile/index';

export type BootResult =
  /** `AGIDE_USER_DATA` without `AGIDE_ROOT`: one unnamed profile on the given data directory (the milestone 1 tests). */
  | { readonly kind: 'legacy' }
  /** A milestone 1 process holds the root. */
  | { readonly kind: 'busy' }
  | {
      readonly kind: 'profile';
      readonly resolved: ResolvedProfile;
      readonly definition: ProfileDefinition;
      readonly settings: ProfileSettings;
      readonly dataDir: string;
      readonly notice?: string;
    };

export interface BootOptions {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** The default root, `<appData>/agide`, used when `AGIDE_ROOT` is not set. */
  readonly defaultRoot: string;
}

/** Everything that must be decided before Electron's `ready`: the profile, its data directory, its settings. */
export function bootProfile(options: BootOptions): BootResult {
  const rootOverride = options.env['AGIDE_ROOT'];
  if (options.env['AGIDE_USER_DATA'] && !rootOverride) return { kind: 'legacy' };
  const root = rootOverride || options.defaultRoot;
  if (ensureProfilesRoot({ root, env: options.env }).status === 'busy') return { kind: 'busy' };

  const reader = new FileProfileStore({ root, ownerId: '' });
  const choice = chooseProfile({ argv: options.argv, env: options.env, root, exists: (id) => reader.get(id) !== undefined });
  return profileBoot(root, choice.id, choice.notice);
}

function profileBoot(root: string, id: ProfileId, notice: string | undefined): BootResult {
  const store = new FileProfileStore({ root, ownerId: id });
  const definition = store.get(id);
  if (!definition) throw new Error(`profile ${id} has no definition`);
  const dataDir = profilePaths(root, id).data;
  ensureDir(dataDir);
  return {
    kind: 'profile',
    resolved: { root, id },
    definition,
    settings: store.readSettings(id),
    dataDir,
    ...(notice === undefined ? {} : { notice }),
  };
}

export const databasePath = (dataDir: string): string => join(dataDir, 'app.db');
