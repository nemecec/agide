import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AgentWritableRegistry } from './agentWritable';
import { buildDockerRunArgs, containerEnvNames, containerName, CONTAINER_RUN_FLAGS, type Mount } from './dockerArgs';
import { HostEnvironment, signalProcess } from './HostEnvironment';
import { hostDirectory, HostTools } from './hostTools';
import { launchEnv } from './launchEnv';
import { SessionFiles } from './SessionFiles';
import type { SessionId } from '../session/types';
import {
  IsolationError,
  type AgentEnvironment,
  type ClaudeLaunch,
  type EnvironmentSpec,
  type IsolationProvider,
  type ProviderCapabilities,
  type ProcessLaunch,
  type ProviderCheck,
  type PtyCommand,
  type ToolLaunch,
} from './types';

/** Inputs of the container provider, from probe I2 (`notes/probes-m3-isolation.md`). */
export interface ContainerProviderOptions {
  /** Host directory of the 0600 session files; the directory of one session is mounted read-only at the same path. */
  readonly sessionFilesDir: string;
  /** `docker` (Docker Desktop) or a compatible CLI: a path, or a name looked up on PATH. */
  readonly dockerBinary: string;
  /** Image with a Linux `claude`, `git`, `ripgrep` and certificates. The provider never pulls it. */
  readonly image: string;
  /** What the image runs before the Claude arguments. Defaults to `claude`. */
  readonly command?: readonly string[];
  /** Host directory of the provider's own Claude configuration (0022: the login is done inside the container). */
  readonly claudeConfigDir: string;
  /** `<uid>:<gid>` of the host user; I2 showed the right ownership of bind-mounted files with it. */
  readonly user: string;
  /** Host name of the host inside the container; Docker Desktop's is `host.docker.internal` (I2). */
  readonly hostAlias?: string;
  /** Fingerprint of the owning profile process; labels its containers so start-up cleanup removes only those. */
  readonly ownerId?: string;
  /** The PATH the docker client is looked up on, outside the container: the app's own, never the profile's. Defaults to `process.env.PATH`. Ignored when `hostTools` is given. */
  readonly appPath?: string;
  /** Finds the docker client. It must read `writable`. Defaults to one over `appPath` that excludes the directories of `writable`. */
  readonly hostTools?: HostTools;
  /** The directories the agents of the profile may write; this provider adds its Claude directory and every directory it mounts writable. Defaults to a registry of its own. */
  readonly writable?: AgentWritableRegistry;
}

export const DEFAULT_HOST_ALIAS = 'host.docker.internal';

/** Fingerprint of a data directory, for the container owner label. */
export function ownerIdOf(dataDir: string): string {
  return createHash('sha256').update(dataDir).digest('hex').slice(0, 12);
}

const DOCKER_TIMEOUT_MS = 8000;

/**
 * Claude in a Docker container per launch (0022 section 6 row 3, probe I2): `docker run -it --rm --init` on the
 * PTY, the workspace, the session's files, the hook inbox and the provider's Claude directory mounted at the same
 * absolute paths, and the app MCP server reached through the host alias with the per-session token.
 */
export class ContainerProvider implements IsolationProvider {
  readonly id = 'container';
  readonly capabilities: ProviderCapabilities = {
    filesystem: 'enforced',
    /** A plain container has no egress policy; a proxy container comes later (0022). */
    network: 'none',
    /** `.credentials.json` in the provider's configuration directory, readable by the agent. */
    login: 'environment-file',
    hookTransports: ['inbox-dir'],
    transcripts: 'host-files',
    /** The hook command names the host's executable, which does not exist inside the image. */
    inspectorHook: 'unavailable',
  };
  private readonly environments = new Map<string, ContainerEnvironment>();
  private readonly writable: AgentWritableRegistry;
  private readonly tools: HostTools;

  constructor(readonly options: ContainerProviderOptions) {
    this.writable = options.writable ?? new AgentWritableRegistry(() => ({ claudeConfigDir: options.claudeConfigDir }));
    this.writable.add([options.claudeConfigDir]);
    this.tools = options.hostTools ?? new HostTools({ ...(options.appPath === undefined ? {} : { appPath: options.appPath }), excluded: () => this.writable.directories() });
  }

  async check(): Promise<ProviderCheck> {
    const { dockerBinary, image } = this.options;
    if (this.tools.find(dockerBinary) === undefined) {
      return { ok: false, reason: 'Docker is not installed', fix: 'Install Docker Desktop, or enter the docker path in the field of this provider.' };
    }
    try {
      await this.tools.run(dockerBinary, ['version', '--format', '{{.Server.Version}}'], { env: process.env, timeout: DOCKER_TIMEOUT_MS });
    } catch {
      return { ok: false, reason: 'Docker is installed but its engine is not running', fix: 'Start Docker Desktop and check again.' };
    }
    try {
      await this.tools.run(dockerBinary, ['image', 'inspect', '--format', '{{.Id}}', image], { env: process.env, timeout: DOCKER_TIMEOUT_MS });
    } catch {
      return { ok: false, reason: `The image ${image} is not present locally`, fix: 'Build or pull the image yourself. The app never pulls images.' };
    }
    return { ok: true };
  }

  /** Removes the containers of this owner that a crash left behind. Call once at start, before any session runs. */
  async removeOrphans(): Promise<void> {
    const { dockerBinary, ownerId } = this.options;
    if (ownerId === undefined) return;
    try {
      const call = { env: process.env };
      const { stdout } = await this.tools.run(dockerBinary, ['ps', '-aq', '--filter', `label=${CONTAINER_RUN_FLAGS.ownerLabel}=${ownerId}`], { ...call, timeout: DOCKER_TIMEOUT_MS });
      const ids = stdout.split('\n').filter(Boolean);
      if (ids.length > 0) await this.tools.run(dockerBinary, ['rm', '-f', ...ids], { ...call, timeout: DOCKER_TIMEOUT_MS * 2 });
    } catch {
      // No Docker, or the engine is down: nothing to clean.
    }
  }

  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['container', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    if (spec.workspace.mode === 'bind') this.writable.add([spec.workspace.hostPath]);
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new ContainerEnvironment(id, spec, new SessionFiles(this.options.sessionFilesDir), this.options, this.tools, this.writable);
      this.environments.set(id, environment);
    }
    return Promise.resolve(environment);
  }
}

class ContainerEnvironment extends HostEnvironment {
  readonly provider = 'container';

  constructor(
    id: string,
    spec: EnvironmentSpec,
    files: SessionFiles,
    private readonly options: ContainerProviderOptions,
    private readonly tools: HostTools,
    private readonly writable: AgentWritableRegistry,
  ) {
    super(id, spec, files);
  }

  /** The docker client as an absolute file, with the trusted PATH and a working directory that holds nothing: `docker run -w` sets the directory inside the container. The writable directories of the launch are in the registry. */
  private dockerLaunch(env: Readonly<Record<string, string>>): { readonly file: string; readonly cwd: string; readonly env: Record<string, string> } {
    const { file, path } = this.tools.launch(this.options.dockerBinary, [], 'the docker client');
    return { file, cwd: hostDirectory(), env: { ...env, PATH: path } };
  }

  protected override appHost(): string {
    return this.options.hostAlias ?? DEFAULT_HOST_ALIAS;
  }

  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    return this.dockerCommand(launch, true);
  }

  /** `docker run -i` without a terminal: the NDJSON of a stream-json agent would be mangled by a TTY. */
  processCommand(launch: ProcessLaunch): Promise<PtyCommand> {
    return this.dockerCommand(launch, false);
  }

  private async dockerCommand(launch: ProcessLaunch, tty: boolean): Promise<PtyCommand> {
    const { workspace, profile } = this.spec;
    if (workspace.mode !== 'bind') throw new IsolationError('unsupported', 'the container provider mounts a host directory');
    const claudeDir = this.options.claudeConfigDir;
    const inbox = this.inboxes.get(launch.sessionId);
    const mounts: Mount[] = [
      { hostPath: workspace.hostPath, readOnly: false },
      { hostPath: this.files.dirOf(launch.sessionId), readOnly: true },
      { hostPath: claudeDir, readOnly: false },
      ...(inbox === undefined ? [] : [{ hostPath: inbox, readOnly: false }]),
      ...(profile.ghConfigDir === undefined ? [] : [{ hostPath: profile.ghConfigDir, readOnly: true }]),
      ...profile.toolFiles.map((file) => ({ hostPath: file.hostPath, readOnly: true })),
    ];
    for (const mount of mounts) if (!mount.readOnly || mount.hostPath === this.files.dirOf(launch.sessionId)) mkdirSync(mount.hostPath, { recursive: true, mode: 0o700 });
    this.writable.add(mounts.filter((mount) => !mount.readOnly).map((mount) => mount.hostPath));
    this.sessions.add(launch.sessionId);

    const env = launchEnv({ ...profile, claudeConfigDir: claudeDir }, this.paths.toEnv, launch.env);
    const args = buildDockerRunArgs({
      sessionId: launch.sessionId,
      ownerId: this.options.ownerId,
      user: this.options.user,
      hostAlias: this.appHost(),
      image: this.options.image,
      command: this.options.command ?? ['claude'],
      cwd: launch.cwd,
      mounts,
      envNames: containerEnvNames({ ...profile, claudeConfigDir: claudeDir }, launch.env, env),
      fixedEnv: { HOME: '/tmp' },
      claudeArgs: launch.args,
      tty,
    });
    const host = this.dockerLaunch(env);
    return { ...host, args };
  }

  /** `docker run -i` of the program with the checkout and `writeDirs` mounted and no network unless the launch asks for it. */
  override async toolCommand(launch: ToolLaunch): Promise<PtyCommand> {
    const [command, ...rest] = launch.argv;
    if (command === undefined) throw new IsolationError('invalid', 'a tool launch needs a command');
    const mounts: Mount[] = [launch.cwd, ...launch.writeDirs].map((hostPath) => ({ hostPath, readOnly: false }));
    const envNames = Object.keys(launch.env).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name !== 'HOME');
    const args = buildDockerRunArgs({
      sessionId: launch.key,
      ownerId: this.options.ownerId,
      user: this.options.user,
      hostAlias: this.appHost(),
      image: this.options.image,
      command: [command],
      cwd: launch.cwd,
      mounts,
      envNames,
      fixedEnv: { HOME: '/tmp' },
      claudeArgs: rest,
      tty: false,
    });
    if (launch.network === 'none') args.splice(1, 0, '--network', 'none');
    this.writable.add(mounts.map((mount) => mount.hostPath));
    return { ...this.dockerLaunch(launch.env), args };
  }

  /** SIGTERM to the docker client is forwarded and ends the session cleanly; SIGKILL of the client leaves the container, so `docker kill` goes first. */
  override async terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    const pid = this.pids.get(sessionId);
    if (signal === 'SIGKILL') {
      await this.tools.run(this.options.dockerBinary, ['kill', containerName(sessionId)], { env: process.env, timeout: DOCKER_TIMEOUT_MS }).catch(() => undefined);
    }
    if (pid !== undefined) signalProcess(pid, signal);
  }
}
