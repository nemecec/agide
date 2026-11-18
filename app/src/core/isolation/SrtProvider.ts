import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { resolveClaudeBinary } from '../session/env';
import type { SessionId } from '../session/types';
import { HostEnvironment, signalProcess } from './HostEnvironment';
import { launchEnv } from './launchEnv';
import { SessionFiles } from './SessionFiles';
import { buildSrtSettings } from './srtSettings';
import {
  IsolationError,
  type AgentEnvironment,
  type ClaudeLaunch,
  type EnvironmentSpec,
  type IsolationProvider,
  type ProviderCapabilities,
  type ProviderCheck,
  type PtyCommand,
} from './types';

export interface SrtProviderOptions {
  /** Host directory for 0600 session files, normally `<profile data>/sessions`. */
  readonly sessionFilesDir: string;
  /** The `srt` executable of `@anthropic-ai/sandbox-runtime`: a path, or a name looked up on PATH. */
  readonly srtBinary: string;
  /** Defaults to `resolveClaudeBinary(process.env)`. */
  readonly claudeBinary?: string;
  /** Directory of the generated srt settings file per session (0700, file 0600). */
  readonly settingsDir: string;
  /** Write allowances beyond the workspace, the hook inbox, the Claude configuration and the CLI temp directory. */
  readonly extraWritePaths?: readonly string[];
  /** Paths the agent may not read, for example the directories of other credentials. */
  readonly extraDenyRead?: readonly string[];
}

export const SRT_INSTALL_FIX = 'Install it with `pnpm add -g @anthropic-ai/sandbox-runtime` and set its path in the profile isolation settings.';

const SETTINGS_FILE = 'srt.json';

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The file a command name resolves to, or the path itself when it has a directory part. */
export function findExecutable(name: string, pathVariable: string | undefined = process.env['PATH']): string | undefined {
  if (name.includes('/')) return executable(name) ? name : undefined;
  return (pathVariable ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, name))
    .find(executable);
}

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

  constructor(readonly options: SrtProviderOptions) {
    this.claudeBinary = options.claudeBinary ?? resolveClaudeBinary(process.env);
    new SessionFiles(options.settingsDir).removeAll();
  }

  check(): Promise<ProviderCheck> {
    if (findExecutable(this.options.srtBinary) === undefined) {
      const named = this.options.srtBinary.includes('/') ? `${this.options.srtBinary} is not executable` : 'The sandbox runtime (srt) is not installed';
      return Promise.resolve({ ok: false, reason: named, fix: SRT_INSTALL_FIX });
    }
    if (findExecutable(this.claudeBinary) === undefined) {
      return Promise.resolve({ ok: false, reason: `${this.claudeBinary} is not executable`, fix: 'Install Claude Code or set AGIDE_CLAUDE_BIN.' });
    }
    return Promise.resolve({ ok: true });
  }

  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['srt', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new SrtEnvironment(id, spec, new SessionFiles(this.options.sessionFilesDir), this.options, this.claudeBinary);
      this.environments.set(id, environment);
    }
    return Promise.resolve(environment);
  }
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
  ) {
    super(id, spec, files);
    this.settings = new SessionFiles(options.settingsDir);
  }

  async ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    const { workspace, profile } = this.spec;
    if (workspace.mode !== 'bind') throw new IsolationError('unsupported', 'srt runs in a host directory only');
    const inbox = this.inboxes.get(launch.sessionId);
    const settings = buildSrtSettings({
      writeDirs: [workspace.hostPath, launch.cwd, ...(inbox === undefined ? [] : [inbox])],
      claudeConfigDir: profile.claudeConfigDir,
      network: this.spec.network,
      ...(this.options.extraWritePaths === undefined ? {} : { extraWritePaths: this.options.extraWritePaths }),
      ...(this.options.extraDenyRead === undefined ? {} : { extraDenyRead: this.options.extraDenyRead }),
    });
    const settingsPath = this.settings.writePrivate(launch.sessionId, SETTINGS_FILE, JSON.stringify(settings));
    this.sessions.add(launch.sessionId);
    return {
      file: this.options.srtBinary,
      args: ['-s', settingsPath, '--', this.claudeBinary, ...launch.args],
      cwd: launch.cwd,
      env: launchEnv(profile, this.paths.toEnv, launch.env),
    };
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
