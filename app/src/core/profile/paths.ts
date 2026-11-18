import { join } from 'node:path';
import type { ProfileId } from './types';

/**
 * File layout under the app root (design 0022 section 1). Directories are 0700, files 0600.
 * The app root is `<appData>/agide`, or `AGIDE_ROOT` in tests.
 */
export interface ProfilePaths {
  readonly dir: string;
  readonly definition: string;
  readonly settings: string;
  /** Electron `userData` of the profile: `app.db`, session inboxes, session files, Chromium state. */
  readonly data: string;
  /** `CLAUDE_CONFIG_DIR` of a new profile. */
  readonly claude: string;
  /** 0600 session files (`mcp.json`, `settings.json`) per session, in 0700 directories. */
  readonly sessionFiles: string;
  /** Hook inbox directories per session. */
  readonly sessionEvents: string;
  readonly layouts: string;
  readonly tools: {
    readonly gh: string;
    readonly gitconfig: string;
    readonly sshConfig: string;
    readonly awsConfig: string;
    readonly awsCredentials: string;
    readonly npmrc: string;
    readonly docker: string;
  };
  /** State of one isolation provider for this profile. */
  envs(provider: string): string;
}

export function profilePaths(root: string, id: ProfileId): ProfilePaths {
  const dir = join(root, 'profiles', id);
  const data = join(dir, 'data');
  const tools = join(dir, 'tools');
  return {
    dir,
    definition: join(dir, 'profile.json'),
    settings: join(dir, 'settings.json'),
    data,
    claude: join(dir, 'claude'),
    sessionFiles: join(data, 'sessions'),
    sessionEvents: join(data, 'session-events'),
    layouts: join(data, 'layouts'),
    tools: {
      gh: join(tools, 'gh'),
      gitconfig: join(tools, 'gitconfig'),
      sshConfig: join(tools, 'ssh_config'),
      awsConfig: join(tools, 'aws', 'config'),
      awsCredentials: join(tools, 'aws', 'credentials'),
      npmrc: join(tools, 'npmrc'),
      docker: join(tools, 'docker'),
    },
    envs: (provider) => join(dir, 'envs', provider),
  };
}

export interface RootPaths {
  readonly profiles: string;
  readonly registry: string;
  readonly lastProfile: string;
  readonly migrateLock: string;
  readonly migrating: string;
}

export function rootPaths(root: string): RootPaths {
  return {
    profiles: join(root, 'profiles'),
    registry: join(root, 'registry'),
    lastProfile: join(root, 'lastProfile'),
    migrateLock: join(root, 'migrate.lock'),
    migrating: join(root, 'profiles.migrating'),
  };
}

export const registryFile = (root: string, id: ProfileId): string => join(rootPaths(root).registry, `${id}.json`);
