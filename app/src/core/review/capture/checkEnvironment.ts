import { findExecutable, srtToolEnvironment } from '../../isolation/index';
import type { CheckEnvironment } from './ProcessCheckExecutor';

export interface CheckEnvironmentInput {
  /** The profile's isolation provider. */
  readonly provider: string;
  /** `permissions.network.bashSandbox` of the profile: the agent's shell ran confined, so the check may not run with more power. */
  readonly bashSandbox: boolean;
  readonly profileEnv: Readonly<Record<string, string>>;
  readonly srt: { readonly binary: string; readonly settingsDir: string; readonly extraDenyRead?: readonly string[] | undefined };
}

/**
 * Where the project check runs (0040 sections 6 and 17): never with more power than the agent had. A profile with the
 * Bash sandbox on, or the `srt` provider, runs the check under `srt` with writes limited to its checkout, its temporary directory and its cache clones, and the
 * check is `not_run` when `srt` is not installed. Only a profile without the sandbox runs it as a plain process.
 */
export function resolveCheckEnvironment(input: CheckEnvironmentInput): CheckEnvironment {
  const { provider, bashSandbox, profileEnv, srt } = input;
  if (provider === 'container') return { kind: 'unavailable', why: 'checks under the container provider are not connected in this build' };
  if (provider === 'srt' || bashSandbox) {
    if (findExecutable(srt.binary) === undefined) return { kind: 'unavailable', why: 'the sandbox runtime is not installed' };
    return {
      kind: 'ready',
      environment: srtToolEnvironment({ srtBinary: srt.binary, settingsDir: srt.settingsDir, ...(srt.extraDenyRead === undefined ? {} : { extraDenyRead: srt.extraDenyRead }) }),
      profileEnv,
      enforcesNetwork: true,
    };
  }
  return { kind: 'ready', environment: { toolCommand: async (tool) => ({ file: tool.argv[0]!, args: tool.argv.slice(1), cwd: tool.cwd, env: { ...tool.env } }) }, profileEnv, enforcesNetwork: false };
}
