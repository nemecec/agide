import { resolveClaudeBinary } from '../session/env';
import type { SessionId } from '../session/types';
import { AgentWritableRegistry } from './agentWritable';
import { HostEnvironment, signalProcess } from './HostEnvironment';
import { findExecutable, insideRoute, splitHostVariables } from './hostLaunch';
import { HostTools, hostDirectory, hostTools, RECORDED_CAUSE } from './hostTools';
import { launchEnv } from './launchEnv';
import { SessionFiles } from './SessionFiles';
import { insideArgv, launcherArgv } from './statusLauncher';
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
  /** Finds `srt` and `node` and gives the host-side PATH. It must read `writable`. Defaults to one over `appPath` that excludes the directories of `writable`. */
  readonly hostTools?: HostTools;
  /** The directories the agents of the profile may write; this provider adds every workspace, working directory and inbox it launches in. Defaults to a registry of its own. */
  readonly writable?: AgentWritableRegistry;
  /** Defaults to `resolveClaudeBinary(process.env)`. */
  readonly claudeBinary?: string;
  /** Directory of the generated srt settings file per session (0700, file 0600). */
  readonly settingsDir: string;
  /** Write allowances beyond the workspace, the hook inbox, the Claude configuration and the CLI temp directory. */
  readonly extraWritePaths?: readonly string[];
  /** Paths the agent may not read, for example the directories of other credentials. */
  readonly extraDenyRead?: readonly string[];
  /** The profile database (`<data>/app.db`): a session may not read it or its journal files. */
  readonly profileDatabase?: string;
}

export const SRT_INSTALL_FIX = 'Install it with `pnpm add -g @anthropic-ai/sandbox-runtime` and enter its path in the field of this provider.';
export const NODE_INSTALL_FIX = 'Install Node.js in a directory that no agent may write, for example with Homebrew.';

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

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
  private readonly writable: AgentWritableRegistry;
  private readonly tools: HostTools;

  constructor(readonly options: SrtProviderOptions) {
    this.claudeBinary = options.claudeBinary ?? resolveClaudeBinary(process.env);
    this.writable = options.writable ?? new AgentWritableRegistry(() => ({ claudeConfigDir: undefined, extraWritePaths: options.extraWritePaths }));
    // The provider keeps the entries it was built with for every session it starts, also after the profile no longer names them.
    this.writable.add(options.extraWritePaths ?? []);
    this.tools = options.hostTools ?? new HostTools({ ...(options.appPath === undefined ? {} : { appPath: options.appPath }), excluded: () => this.writable.directories(), recorded: (paths) => this.writable.recordedHolding(paths) });
    new SessionFiles(options.settingsDir).removeAll();
  }

  check(): Promise<ProviderCheck> {
    const file = this.tools.find(this.options.srtBinary);
    if (file === undefined) {
      const named = this.options.srtBinary.includes('/') ? 'The sandbox runtime (srt) is not executable at the configured path' : 'The sandbox runtime (srt) is not installed';
      const hidden = this.tools.shadowed(this.options.srtBinary);
      const recorded = hidden === undefined ? undefined : this.tools.recordedFor(hidden);
      if (recorded !== undefined) return Promise.resolve({ ok: false, reason: `The sandbox runtime (srt) ${RECORDED_CAUSE}`, fix: recorded });
      return Promise.resolve({ ok: false, reason: hidden === undefined ? named : 'The sandbox runtime (srt), or the code it runs, lies in a directory that an agent may write', fix: SRT_INSTALL_FIX });
    }
    try {
      refuseNode(this.tools, file, []);
    } catch (error) {
      if (!(error instanceof IsolationError)) throw error;
      return Promise.resolve({ ok: false, reason: sentence(error.message), fix: error.message.includes(RECORDED_CAUSE) && error.detail !== undefined ? error.detail : NODE_INSTALL_FIX });
    }
    if (findExecutable(this.claudeBinary) === undefined) {
      return Promise.resolve({ ok: false, reason: 'The Claude CLI is not executable at the configured path', fix: 'Install Claude Code or set AGIDE_CLAUDE_BIN.' });
    }
    return Promise.resolve({ ok: true });
  }

  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['srt', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    this.writable.add([spec.workspace.mode === 'bind' ? spec.workspace.hostPath : undefined, spec.profile.claudeConfigDir]);
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new SrtEnvironment(id, spec, new SessionFiles(this.options.sessionFilesDir), this.options, this.claudeBinary, this.tools, this.writable);
      this.environments.set(id, environment);
    }
    return Promise.resolve(environment);
  }
}

/**
 * Throws when the `node` that the shim `file` of `srt` would start runs code where an agent may write: the first `node`
 * of the host-side PATH, and a `node` beside the shim in the directory of `file` as it is spelled or in its real
 * directory (`HostTools.refuseBeside`).
 */
function refuseNode(tools: HostTools, file: string, directories: readonly string[]): void {
  tools.refuseHidden('node', directories, 'the program that runs the sandbox runtime');
  tools.refuseBeside(file, 'node', directories, 'the program that runs the sandbox runtime');
}

/**
 * The host-side start of `srt`: the absolute file that `tools` found outside every directory an agent may write, the
 * trusted PATH, and an environment that holds the allowed variables (`splitHostVariables`) and the carriers of every
 * other variable of the profile, its PATH included (`insideRoute`). No value of the profile is an argument: the launcher
 * inside the sandbox gets the names only.
 */
function hostStart(tools: HostTools, srtBinary: string, directories: readonly string[], env: Readonly<Record<string, string>>): { readonly file: string; readonly env: Record<string, string>; readonly names: readonly string[]; readonly dropped: readonly string[] } {
  const { file, path } = tools.launch(srtBinary, directories, 'the sandbox runtime');
  refuseNode(tools, file, directories);
  const { host, inside } = splitHostVariables(env);
  const route = insideRoute(inside);
  return { file, env: { ...host, ...route.carriers, PATH: path }, names: route.names, dropped: route.dropped };
}

/**
 * `srt -s <settings> -- <argv>` for a program that is not the CLI, with writes limited to its directory and `writeDirs`.
 * The runtime and its helpers run outside the sandbox: they are an absolute file, they get the trusted PATH of the app
 * and they start in a directory that no checkout holds (`hostDirectory` in `hostTools.ts`). The launcher inside the sandbox changes into
 * the checkout and the program there finds its own programs on the PATH of the profile.
 */
function srtToolCommand(options: Pick<SrtProviderOptions, 'srtBinary' | 'extraDenyRead'>, tools: HostTools, settings: SessionFiles, launch: ToolLaunch): PtyCommand {
  if (launch.argv.length === 0) throw new IsolationError('invalid', 'a tool launch needs a command');
  const writeDirs = [launch.cwd, ...launch.writeDirs];
  const host = hostStart(tools, options.srtBinary, writeDirs, launch.env);
  const content = buildToolSrtSettings({ writeDirs, network: launch.network, loopback: launch.loopback === true, ...(options.extraDenyRead === undefined ? {} : { extraDenyRead: options.extraDenyRead }) });
  const settingsPath = settings.writePrivate(launch.key, SETTINGS_FILE, JSON.stringify(content));
  const inside = launcherArgv(launch.argv, { directory: launch.cwd, inside: host.names });
  return { file: host.file, args: ['-s', settingsPath, '--', ...inside], cwd: hostDirectory(), env: host.env, dropped: host.dropped };
}

/**
 * Runs programs under srt without a provider or a session, for the project check of a review. The settings files go
 * to `settingsDir`, which only this caller writes; `release` removes the files of one key. `hostTools` excludes the
 * directories the profile's agents may write; without it the shared instance of the app is used.
 */
export function srtToolEnvironment(options: Pick<SrtProviderOptions, 'srtBinary' | 'extraDenyRead' | 'settingsDir' | 'hostTools'>): Pick<AgentEnvironment, 'toolCommand'> & { release(key: string): void } {
  const settings = new SessionFiles(options.settingsDir);
  const tools = options.hostTools ?? hostTools();
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
    private readonly writable: AgentWritableRegistry,
  ) {
    super(id, spec, files);
    this.settings = new SessionFiles(options.settingsDir);
  }

  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    return this.processCommand(launch);
  }

  async processCommand(launch: ProcessLaunch): Promise<PtyCommand> {
    const { workspace, profile } = this.spec;
    if (workspace.mode !== 'bind') throw new IsolationError('unsupported', 'srt runs in a host directory only');
    const inbox = this.inboxes.get(launch.sessionId);
    const writeDirs = [workspace.hostPath, launch.cwd, ...(inbox === undefined ? [] : [inbox])];
    this.writable.add([...writeDirs, profile.claudeConfigDir]);
    const env = launchEnv(profile, this.paths.toEnv, launch.env);
    const host = hostStart(this.tools, this.options.srtBinary, [], env);
    const settings = buildSrtSettings({
      writeDirs,
      claudeConfigDir: profile.claudeConfigDir,
      network: this.spec.network,
      ...(this.options.extraWritePaths === undefined ? {} : { extraWritePaths: this.options.extraWritePaths }),
      ...(this.options.extraDenyRead === undefined ? {} : { extraDenyRead: this.options.extraDenyRead }),
      ...(this.options.profileDatabase === undefined ? {} : { profileDatabase: this.options.profileDatabase }),
    });
    const settingsPath = this.settings.writePrivate(launch.sessionId, SETTINGS_FILE, JSON.stringify(settings));
    this.sessions.add(launch.sessionId);
    return {
      file: host.file,
      args: ['-s', settingsPath, '--', ...insideArgv(host.names, [this.claudeBinary, ...launch.args])],
      cwd: launch.cwd,
      env: host.env,
      dropped: host.dropped,
    };
  }

  override async toolCommand(launch: ToolLaunch): Promise<PtyCommand> {
    this.writable.add([launch.cwd, ...launch.writeDirs, this.spec.profile.claudeConfigDir]);
    const command = srtToolCommand(this.options, this.tools, this.settings, launch);
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
