import { HostTools, hostTools, launcherArgv, srtToolEnvironment } from '../../isolation/index';
import type { PtyCommand } from '../../isolation/types';
import type { CheckEnvironment } from './ProcessCheckExecutor';

export interface CheckEnvironmentInput {
  /** The profile's isolation provider. */
  readonly provider: string;
  /** `permissions.network.bashSandbox` of the profile: the agent's shell ran confined, so the check may not run with more power. */
  readonly bashSandbox: boolean;
  readonly profileEnv: Readonly<Record<string, string>>;
  readonly srt: {
    readonly binary: string;
    readonly settingsDir: string;
    readonly extraDenyRead?: readonly string[] | undefined;
    /** The PATH `srt` is looked up on; ignored when `hostTools` is given. */
    readonly appPath?: string | undefined;
    /** Finds `srt` and `node` outside the directories the profile's agents may write. Defaults to the shared instance of the app. */
    readonly hostTools?: HostTools | undefined;
  };
}

/**
 * Where the project check runs (0040 sections 6 and 17): never with more power than the agent had. A profile with the
 * Bash sandbox on, or the `srt` provider, runs the check under `srt` with writes limited to its checkout, its temporary directory and its cache clones, and the
 * check is `not_run` when `srt` is not installed. Only a profile without the sandbox runs it as a plain process,
 * which runs under the launcher shell as well.
 */
export function resolveCheckEnvironment(input: CheckEnvironmentInput): CheckEnvironment {
  const { provider, bashSandbox, profileEnv, srt } = input;
  if (provider === 'container') return { kind: 'unavailable', why: 'checks under the container provider are not connected in this build' };
  if (provider === 'srt' || bashSandbox) {
    const tools = srt.hostTools ?? (srt.appPath === undefined ? hostTools() : new HostTools({ appPath: srt.appPath }));
    if (tools.find(srt.binary) === undefined) return { kind: 'unavailable', why: tools.shadowed(srt.binary) === undefined ? 'the sandbox runtime is not installed' : 'the sandbox runtime exists only in a directory that an agent may write' };
    return {
      kind: 'ready',
      environment: srtToolEnvironment({ srtBinary: srt.binary, settingsDir: srt.settingsDir, hostTools: tools, ...(srt.extraDenyRead === undefined ? {} : { extraDenyRead: srt.extraDenyRead }) }),
      profileEnv,
      enforcesNetwork: true,
    };
  }
  return { kind: 'ready', environment: { toolCommand: async (tool) => plainCommand(tool.argv, tool.cwd, tool.env) }, profileEnv, enforcesNetwork: false };
}

/** The program under the launcher shell too: Node reads a death by a signal it has no name for as exit 0 (see `launcherArgv`). */
function plainCommand(argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>): PtyCommand {
  const [file = '', ...args] = launcherArgv(argv);
  return { file, args, cwd, env: { ...env } };
}
