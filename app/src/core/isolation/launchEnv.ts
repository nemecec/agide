import { claudeEnv } from '../session/env';
import type { ProfileLaunchSpec } from './types';

/**
 * The environment of a launched `claude`: the profile's base environment scrubbed of variables a parent Claude
 * Code session injects, then the extra variables and those of the launch, the tool files, `GH_CONFIG_DIR` and `CLAUDE_CONFIG_DIR`.
 * Later entries win. `toEnv` maps a host path to the path the process sees.
 */
export function launchEnv(
  profile: ProfileLaunchSpec,
  toEnv: (hostPath: string) => string,
  launch: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const extra: Record<string, string> = { ...profile.extraEnv, ...launch };
  for (const file of profile.toolFiles) extra[file.envVar] = toEnv(file.hostPath);
  if (profile.ghConfigDir !== undefined) extra['GH_CONFIG_DIR'] = toEnv(profile.ghConfigDir);
  if (profile.claudeConfigDir !== undefined) extra['CLAUDE_CONFIG_DIR'] = toEnv(profile.claudeConfigDir);
  return claudeEnv(profile.env, extra);
}
