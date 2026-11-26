import { resolveClaudeBinary } from '../session/env';
import type { SessionId } from '../session/types';
import { agentWritableDirectories } from './agentWritable';
import { HostEnvironment, signalProcess } from './HostEnvironment';
import { findExecutable, insideArgv, splitLoaderVariables } from './hostLaunch';
import { HostTools, hostDirectory, hostTools } from './hostTools';
import { launchEnv } from './launchEnv';
import { SessionFiles } from './SessionFiles';
import { launcherArgv } from './statusLauncher';
import { buildSrtSettings, buildToolSrtSettings } from './srtSettings';
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

export interface SrtProviderOptions {
  /** Host directory for 0600 session files, normally `<profile data>/sessions`. */
  readonly sessionFilesDir: string;
  /** The `srt` executable of `@anthropic-ai/sandbox-runtime`: a path, or a name looked up on PATH. */
  readonly srtBinary: string;
  /** The PATH the sandbox runtime and its helpers are looked up on, outside the sandbox: the app's own, never the profile's. Defaults to `process.env.PATH`. Ignored when `hostTools` is given. */
  readonly appPath?: string;
  /** Finds `srt` and `node` and gives the host-side PATH. Defaults to one over `appPath` that excludes everything this provider lets an agent write. */
  readonly hostTools?: HostTools;
  /** Directories below which agents get their workspaces (the task base); no program is looked up there. */
  readonly agentRoots?: readonly string[];
  /** Defaults to `resolveClaudeBinary(process.env)`. */
  readonly claudeBinary?: string;
  /** Directory of the generated srt settings file per session (0700, file 0600). */
  readonly settingsDir: string;
  /** Write allowances beyond the workspace, the hook inbox, the Claude configuration and the CLI temp directory. */
  readonly extraWritePaths?: readonly string[];
  /** Paths the agent may not read, for example the directories of other credentials. */
  readonly extraDenyRead?: readonly string[];
}

export const SRT_INSTALL_FIX = 'Install it with `pnpm add -g @anthropic-ai/sandbox-runtime` and enter its path in the field of this provider.';

const SETTINGS_FILE = 'srt.json';

export { findExecutable };

/**
 * Anthropic's sandbox runtime around the whole `claude` process (0022 section 6 row 2, probe I1):
 * `srt -s <settings> -- claude <args>`. The settings carry the filesystem and network policy and the keys the TUI
 * and the app MCP server need (`allowPty`, `allowLocalBinding`).
 */
export class SrtProvider implements IsolationProvider {
  readonly id = 'srt';
  readonly capabilities: ProviderCapabilities = {
    filesystem: 'enforced',
    /** The proxy allowlist holds for the whole process; loopback is open because of `allowLocalBinding`. */
    network: 'allowlist',
    /** I1: the Keychain stays readable inside srt, so the agent can read its own login. */
    login: 'host-keychain',
    hookTransports: ['inbox-dir'],
    transcripts: 'host-files',
  };
  private readonly environments = new Map<string, SrtEnvironment>();
  private readonly claudeBinary: string;
  /** The workspaces and Claude configuration directories of the environments prepared so far: agents write them, so no program is looked up there. */
  private readonly known = new Set<string>();
  private readonly tools: HostTools;

  constructor(readonly options: SrtProviderOptions) {
    this.claudeBinary = options.claudeBinary ?? resolveClaudeBinary(process.env);
    this.tools = options.hostTools ?? new HostTools({ ...(options.appPath === undefined ? {} : { appPath: options.appPath }), excluded: () => this.writable() });
    new SessionFiles(options.settingsDir).removeAll();
  }

  /** Everything an agent of this provider may write (`agentWritableDirectories`), for the lookup of host-side programs. */
  private writable(): string[] {
    return agentWritableDirectories({ writeDirs: [...this.known], claudeConfigDir: undefined, extraWritePaths: this.options.extraWritePaths, agentRoots: this.options.agentRoots });
  }

  check(): Promise<ProviderCheck> {
    const writable = this.writable();
    if (this.tools.find(this.options.srtBinary, writable) === undefined) {
      const named = this.options.srtBinary.includes('/') ? `${this.options.srtBinary} is not executable` : 'The sandbox runtime (srt) is not installed';
      return Promise.resolve({ ok: false, reason: this.tools.shadowed(this.options.srtBinary, writable) === undefined ? named : 'The sandbox runtime (srt) exists only in a directory that an agent may write', fix: SRT_INSTALL_FIX });
    }
    if (findExecutable(this.claudeBinary) === undefined) {
      return Promise.resolve({ ok: false, reason: `${this.claudeBinary} is not executable`, fix: 'Install Claude Code or set AGIDE_CLAUDE_BIN.' });
    }
    return Promise.resolve({ ok: true });
  }

  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['srt', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    if (spec.workspace.mode === 'bind') this.known.add(spec.workspace.hostPath);
    if (spec.profile.claudeConfigDir !== undefined) this.known.add(spec.profile.claudeConfigDir);
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new SrtEnvironment(id, spec, new SessionFiles(this.options.sessionFilesDir), this.options, this.claudeBinary, this.tools, this.known);
      this.environments.set(id, environment);
    }
    return Promise.resolve(environment);
  }
}

/**
 * The host-side start of `srt`: the absolute file that `tools` found outside every directory an agent may write, the
 * trusted PATH, and the environment without the variables that change how Node or the loader start. Those go to the
 * program through `env` inside the sandbox, as the profile's PATH does.
 */
function hostStart(tools: HostTools, srtBinary: string, directories: readonly string[], env: Readonly<Record<string, string>>): { readonly file: string; readonly env: Record<string, string>; readonly inside: Record<string, string> } {
  const { file, path } = tools.launch(srtBinary, directories, 'the sandbox runtime');
  tools.refuseHidden('node', directories, 'the program that runs the sandbox runtime');
  const { host, inside } = splitLoaderVariables(env);
  return { file, env: { ...host, PATH: path }, inside };
}

/**
 * `srt -s <settings> -- <argv>` for a program that is not the CLI, with writes limited to its directory and `writeDirs`.
 * The runtime and its helpers run outside the sandbox: they are an absolute file, they get the trusted PATH of the app
 * and they start in a directory that no checkout holds (`hostDirectory` in `hostTools.ts`). The launcher inside the sandbox changes into
 * the checkout and the program there finds its own programs on the PATH of the profile.
 */
function srtToolCommand(options: Pick<SrtProviderOptions, 'srtBinary' | 'extraDenyRead'>, tools: HostTools, settings: SessionFiles, launch: ToolLaunch, agentWritable: readonly string[] = []): PtyCommand {
  if (launch.argv.length === 0) throw new IsolationError('invalid', 'a tool launch needs a command');
  const writeDirs = [launch.cwd, ...launch.writeDirs];
  const host = hostStart(tools, options.srtBinary, [...agentWritable, ...writeDirs], launch.env);
  const content = buildToolSrtSettings({ writeDirs, network: launch.network, loopback: launch.loopback === true, ...(options.extraDenyRead === undefined ? {} : { extraDenyRead: options.extraDenyRead }) });
  const settingsPath = settings.writePrivate(launch.key, SETTINGS_FILE, JSON.stringify(content));
  const inside = insideArgv(launch.env['PATH'], launcherArgv(launch.argv, { directory: launch.cwd }), host.inside);
  return { file: host.file, args: ['-s', settingsPath, '--', ...inside], cwd: hostDirectory(), env: host.env };
}

/**
 * Runs programs under srt without a provider or a session, for the project check of a review. The settings files go
 * to `settingsDir`, which only this caller writes; `release` removes the files of one key. `hostTools` excludes the
 * directories the profile's agents may write; without it the shared instance of the app is used.
 */
export function srtToolEnvironment(options: Pick<SrtProviderOptions, 'srtBinary' | 'appPath' | 'extraDenyRead' | 'settingsDir' | 'hostTools'>): Pick<AgentEnvironment, 'toolCommand'> & { release(key: string): void } {
  const settings = new SessionFiles(options.settingsDir);
  const tools = options.hostTools ?? (options.appPath === undefined ? hostTools() : new HostTools({ appPath: options.appPath }));
  return { toolCommand: async (launch) => srtToolCommand(options, tools, settings, launch), release: (key) => settings.remove(key) };
}

class SrtEnvironment extends HostEnvironment {
  readonly provider = 'srt';
  private readonly settings: SessionFiles;

  constructor(
    id: string,
    spec: EnvironmentSpec,
    files: SessionFiles,
    private readonly options: SrtProviderOptions,
    private readonly claudeBinary: string,
    private readonly tools: HostTools,
    private readonly known: Set<string>,
  ) {
    super(id, spec, files);
    this.settings = new SessionFiles(options.settingsDir);
  }

  /** Everything an agent of this environment may write: the directories of `known`, the allowances of the settings and the defaults of `srt`. No host-side program is looked up there. */
  private writable(claudeConfigDir: string | undefined): string[] {
    return agentWritableDirectories({ writeDirs: [...this.known], claudeConfigDir, extraWritePaths: this.options.extraWritePaths, agentRoots: this.options.agentRoots });
  }

  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    return this.processCommand(launch);
  }

  async processCommand(launch: ProcessLaunch): Promise<PtyCommand> {
    const { workspace, profile } = this.spec;
    if (workspace.mode !== 'bind') throw new IsolationError('unsupported', 'srt runs in a host directory only');
    const inbox = this.inboxes.get(launch.sessionId);
    const writeDirs = [workspace.hostPath, launch.cwd, ...(inbox === undefined ? [] : [inbox])];
    for (const directory of writeDirs) this.known.add(directory);
    const env = launchEnv(profile, this.paths.toEnv, launch.env);
    const host = hostStart(this.tools, this.options.srtBinary, this.writable(profile.claudeConfigDir), env);
    const settings = buildSrtSettings({
      writeDirs,
      claudeConfigDir: profile.claudeConfigDir,
      network: this.spec.network,
      ...(this.options.extraWritePaths === undefined ? {} : { extraWritePaths: this.options.extraWritePaths }),
      ...(this.options.extraDenyRead === undefined ? {} : { extraDenyRead: this.options.extraDenyRead }),
    });
    const settingsPath = this.settings.writePrivate(launch.sessionId, SETTINGS_FILE, JSON.stringify(settings));
    this.sessions.add(launch.sessionId);
    return {
      file: host.file,
      args: ['-s', settingsPath, '--', ...insideArgv(env['PATH'], [this.claudeBinary, ...launch.args], host.inside)],
      cwd: launch.cwd,
      env: host.env,
    };
  }

  override async toolCommand(launch: ToolLaunch): Promise<PtyCommand> {
    const command = srtToolCommand(this.options, this.tools, this.settings, launch, this.writable(this.spec.profile.claudeConfigDir));
    this.sessions.add(launch.key);
    return command;
  }

  /**
   * SIGTERM to srt reaches `claude` (probed). SIGKILL of srt alone leaves `claude` running, so it goes to the
   * process group the PTY child leads, then to the process itself.
   */
  override terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    const pid = this.pids.get(sessionId);
    if (pid !== undefined) {
      if (signal === 'SIGKILL') signalProcess(-pid, signal);
      signalProcess(pid, signal);
    }
    return Promise.resolve();
  }

  override async releaseSession(sessionId: SessionId): Promise<void> {
    this.settings.remove(sessionId);
    await super.releaseSession(sessionId);
  }
}
