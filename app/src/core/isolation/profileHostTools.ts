import { AgentWritableRegistry, type AgentWritableMemory } from './agentWritable';
import { HostTools } from './hostTools';
import type { IsolationOptions } from './providerOptions';

export interface ProfileHostToolsInput {
  /** The profile's `isolation.options`, read at each lookup. */
  readonly options: () => IsolationOptions;
  /** The profile's Claude configuration directory, or undefined for the CLI default. */
  readonly claudeConfigDir: () => string | undefined;
  /** Directories below which agents get their workspaces. */
  readonly agentRoots: readonly string[];
  /** Keeps the set in the profile database (`AgentWritableStore`). */
  readonly memory?: AgentWritableMemory;
  readonly appPath?: string;
}

/** The host tools of a profile process and the registry they read: always handed on together (`ProviderSetup.host`). */
export interface ProfileHostTools {
  /** Finds every host-side program outside `writable`. */
  readonly tools: HostTools;
  /** The directories the profile's agents may write: the providers and the session module add to it as launches and sessions become known. */
  readonly writable: AgentWritableRegistry;
}

/**
 * The host tools of a profile process and the registry they read: no program is looked up in a directory that one of
 * the profile's agents may write, or could write at any time since the memory was made (`AgentWritableRegistry`,
 * built on the list that `buildSrtSettings` takes its allowances from). While the memory cannot be read, programs are
 * looked up in the fixed directories only.
 */
export function createProfileHostTools(input: ProfileHostToolsInput): ProfileHostTools {
  const writable = new AgentWritableRegistry(() => ({ claudeConfigDir: input.claudeConfigDir(), extraWritePaths: input.options().extraWritePaths, agentRoots: input.agentRoots }), input.memory);
  return { tools: new HostTools({ ...(input.appPath === undefined ? {} : { appPath: input.appPath }), excluded: () => writable.directories(), recorded: (paths) => writable.recordedHolding(paths), complete: () => writable.complete() }), writable };
}
