import type { ProfileLaunchSpec } from '../isolation/types';
import { profileEnv } from '../profile/profileEnv';
import type { ProfilePaths } from '../profile/paths';
import type { ProfileSettings } from '../profile/types';

/**
 * The provider launch inputs of a profile: the scrubbed environment of `profileEnv`, the Claude configuration
 * directory and, for isolated tool credentials, the gh directory. Providers map the directories to paths inside
 * their environment; the same values are also in `env` for providers that run on the host.
 */
export function profileLaunchSpec(settings: ProfileSettings, paths: ProfilePaths, base: NodeJS.ProcessEnv): ProfileLaunchSpec {
  return {
    claudeConfigDir: settings.claudeConfig.mode === 'directory' ? settings.claudeConfig.path : undefined,
    ghConfigDir: settings.tools.mode === 'isolated' ? paths.tools.gh : undefined,
    env: profileEnv(base, settings, paths),
    toolFiles: [],
  };
}
