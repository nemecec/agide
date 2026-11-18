import type { ProfileLaunchSpec } from './types';

/** Docker flags every session container gets, with the probe finding behind each (`notes/probes-m3-isolation.md`). */
export const CONTAINER_RUN_FLAGS = {
  /** I2: teardown with `--rm` and a label leaves no container, volume or network. */
  remove: '--rm',
  /** 0022 and I2: the TUI as PID 1 needs an init process for signals and zombie processes. */
  init: '--init',
  /** Label that marks the app's containers, so `terminate` and the start-up cleanup touch only those. */
  label: 'agide.session',
  /** Label with the data directory fingerprint of the profile process that started the container. */
  ownerLabel: 'agide.owner',
} as const;

/** The name of the container of a session. */
export function containerName(sessionId: string): string {
  return `agide-${sessionId}`;
}

export interface Mount {
  readonly hostPath: string;
  readonly readOnly: boolean;
}

export interface DockerRunInput {
  readonly sessionId: string;
  readonly ownerId?: string | undefined;
  readonly user: string;
  readonly hostAlias: string;
  readonly image: string;
  /** What runs in the image before the Claude arguments. */
  readonly command: readonly string[];
  readonly cwd: string;
  readonly mounts: readonly Mount[];
  /** Names of the variables the container receives. Their values come from the environment of the docker client, so no value is an argument. */
  readonly envNames: readonly string[];
  /** Variables with a fixed value that holds nothing secret. */
  readonly fixedEnv: Readonly<Record<string, string>>;
  readonly claudeArgs: readonly string[];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The names of the variables of a launch that enter the container: the profile's extra variables, the launch's,
 * the tool-file variables, the configuration directories and the terminal type. The host's own environment
 * (PATH, HOME, credentials) stays outside.
 */
export function containerEnvNames(profile: ProfileLaunchSpec, launchEnv: Readonly<Record<string, string>> | undefined, available: Readonly<Record<string, string>>): string[] {
  const names = new Set<string>(['TERM', 'COLORTERM', 'CLAUDE_CONFIG_DIR']);
  for (const key of ['LANG', 'LC_ALL']) if (key in available) names.add(key);
  for (const key of [...Object.keys(profile.extraEnv ?? {}), ...Object.keys(launchEnv ?? {}), ...profile.toolFiles.map((file) => file.envVar)]) names.add(key);
  if (profile.ghConfigDir !== undefined) names.add('GH_CONFIG_DIR');
  return [...names].filter((name) => ENV_NAME.test(name) && name !== 'HOME' && name in available);
}

/** `--mount` value of a bind mount at the same absolute path. A path with a comma or a line break would add or end an option. */
export function mountSpec(mount: Mount): string {
  if (/[,\n\r\0]/.test(mount.hostPath)) throw new Error(`a mount path cannot contain a comma or a line break: ${JSON.stringify(mount.hostPath)}`);
  return `type=bind,src=${mount.hostPath},dst=${mount.hostPath}${mount.readOnly ? ',readonly' : ''}`;
}

/** Arguments of `docker run` for one launch (0029, container table). */
export function buildDockerRunArgs(input: DockerRunInput): string[] {
  const args: string[] = ['run', '-it', CONTAINER_RUN_FLAGS.remove, CONTAINER_RUN_FLAGS.init];
  args.push('--label', `${CONTAINER_RUN_FLAGS.label}=${input.sessionId}`);
  if (input.ownerId !== undefined) args.push('--label', `${CONTAINER_RUN_FLAGS.ownerLabel}=${input.ownerId}`);
  args.push('--name', containerName(input.sessionId), '--user', input.user, '--add-host', `${input.hostAlias}:host-gateway`);
  for (const name of input.envNames) args.push('-e', name);
  for (const [name, value] of Object.entries(input.fixedEnv)) args.push('-e', `${name}=${value}`);
  for (const mount of input.mounts) args.push('--mount', mountSpec(mount));
  args.push('-w', input.cwd, input.image, ...input.command, ...input.claudeArgs);
  return args;
}
