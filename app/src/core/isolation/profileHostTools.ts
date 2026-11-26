import { agentWritableDirectories } from './agentWritable';
import { HostTools } from './hostTools';
import type { IsolationOptions } from './providerOptions';

export interface ProfileHostToolsInput {
  /** The profile's `isolation.options`, read at each lookup. */
  readonly options: () => IsolationOptions;
  /** The profile's Claude configuration directory, or undefined for the CLI default. */
  readonly claudeConfigDir: () => string | undefined;
  /** Directories below which agents get their workspaces. */
  readonly agentRoots: readonly string[];
  readonly appPath?: string;
}

/**
 * The host tools of a profile process: no program is looked up in a directory that one of the profile's agents may
 * write (`agentWritableDirectories`, the list that `buildSrtSettings` takes its allowances from).
 */
export function createProfileHostTools(input: ProfileHostToolsInput): HostTools {
  return new HostTools({
    ...(input.appPath === undefined ? {} : { appPath: input.appPath }),
    excluded: () => agentWritableDirectories({ writeDirs: [], claudeConfigDir: input.claudeConfigDir(), extraWritePaths: input.options().extraWritePaths, agentRoots: input.agentRoots }),
  });
}
