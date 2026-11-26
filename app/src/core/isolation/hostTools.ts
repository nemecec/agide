import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { isWithinAny, locateHostBinary, trustedPath } from './hostLaunch';
import { IsolationError } from './types';

/**
 * The host side of the app: every program it starts outside a sandbox goes through this module (a scan in
 * `hostToolsGuard.test.ts` fails when another file starts one). A program name is never looked up through anything
 * that code an agent writes can influence: not a relative or empty entry of PATH, not the working directory, not a
 * directory the agent may write (`agentWritable.ts`). The system tools have fixed absolute paths; `git`, `docker`,
 * `srt`, `node` and the like are searched on an explicit list of directories.
 */

export type SystemToolName = 'df' | 'chmod' | 'ps' | 'lsof' | 'cp' | 'env' | 'open';

const SYSTEM_TOOLS: Readonly<Record<'darwin' | 'linux', Readonly<Record<SystemToolName, string>>>> = {
  darwin: { df: '/bin/df', chmod: '/bin/chmod', ps: '/bin/ps', lsof: '/usr/sbin/lsof', cp: '/bin/cp', env: '/usr/bin/env', open: '/usr/bin/open' },
  linux: { df: '/bin/df', chmod: '/bin/chmod', ps: '/bin/ps', lsof: '/usr/bin/lsof', cp: '/bin/cp', env: '/usr/bin/env', open: '/usr/bin/xdg-open' },
};

/** The fixed absolute path of a system tool. The app runs on macOS; Linux differs for `lsof` and `open` only. */
export function systemTool(name: SystemToolName, platform: NodeJS.Platform = process.platform): string {
  return SYSTEM_TOOLS[platform === 'linux' ? 'linux' : 'darwin'][name];
}

/** The directories that belong to the system: root owns them and no agent writes them. */
export const SYSTEM_DIRECTORIES: readonly string[] = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

/**
 * Where tools that the user installs are found when the app's own PATH does not hold them (an app started from the
 * Dock has a short PATH): Homebrew on both architectures and the directory of Docker Desktop.
 */
export const INSTALL_DIRECTORIES: readonly string[] = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/Applications/Docker.app/Contents/Resources/bin'];

const EMPTY_DIRECTORY = '/var/empty';

/** A working directory that holds nothing: `/var/empty` is owned by root; a system without it gets the temporary directory, which no lookup uses. */
export function hostDirectory(system: string = EMPTY_DIRECTORY): string {
  return existsSync(system) ? system : tmpdir();
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface HostExecOptions {
  /** The whole environment of the process. Default: the PATH alone. The PATH is always the trusted one. */
  readonly env?: NodeJS.ProcessEnv;
  /** Default: a directory that holds nothing (`hostDirectory`). */
  readonly cwd?: string;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly signal?: AbortSignal;
  /** How text output is decoded. Default UTF-8. */
  readonly encoding?: BufferEncoding;
  /** Directories this launch adds to the excluded set (its workspace, checkout or temporary directory). */
  readonly excluded?: readonly string[];
}

type ExecCallback<T> = (error: ExecFileException | null, stdout: T, stderr: T) => void;

const SYSTEM_ENVIRONMENT = { PATH: SYSTEM_DIRECTORIES.join(delimiter), LC_ALL: 'C' } as const;

function spawnFile(file: string, args: readonly string[], options: HostExecOptions, env: NodeJS.ProcessEnv, callback: ExecCallback<never>, bytes = false): void {
  execFile(file, [...args], { env, cwd: options.cwd ?? hostDirectory(), encoding: bytes ? 'buffer' : (options.encoding ?? 'utf8'), ...(options.timeout === undefined ? {} : { timeout: options.timeout }), ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }), ...(options.signal === undefined ? {} : { signal: options.signal }) } as never, callback as never);
}

/** Runs a system tool by its fixed absolute path, with a fixed environment and a working directory that holds nothing. */
export function systemExecFile(name: SystemToolName, args: readonly string[], options: Omit<HostExecOptions, 'env' | 'excluded' | 'encoding'>, callback: ExecCallback<string>): void {
  spawnFile(systemTool(name), args, options, { ...SYSTEM_ENVIRONMENT }, callback as ExecCallback<never>);
}

/** The synchronous form of `systemExecFile`; returns the text of stdout and throws when the tool fails. */
export function systemExecFileSync(name: SystemToolName, args: readonly string[], options: { readonly timeout?: number } = {}): string {
  return execFileSync(systemTool(name), [...args], { env: { ...SYSTEM_ENVIRONMENT }, cwd: hostDirectory(), encoding: 'utf8', ...options });
}

/**
 * The check that stands before every spawn of a command an isolation provider built: its program is an absolute path,
 * so no PATH, working directory or environment variable decides which program starts.
 */
export function requireAbsoluteFile(command: { readonly file: string }): void {
  if (!isAbsolute(command.file)) throw new IsolationError('invalid', 'a command that starts on the host names its program by an absolute path');
}

export interface HostToolsOptions {
  /** The PATH the programs are looked up on: the app's own, never the profile's or a checkout's. Default `process.env.PATH`, read at each lookup. */
  readonly appPath?: string | undefined;
  /** The directories an agent may write (`agentWritableDirectories`), read at each lookup so a changed profile applies at once. */
  readonly excluded?: () => readonly string[];
  /** The directories searched after the app's PATH. Default: the system directories, Homebrew and Docker Desktop. */
  readonly fixedDirectories?: readonly string[];
}

/**
 * Finds the programs the app starts on the host, and starts them. The lookup list is explicit: the entries of the
 * app's PATH that are absolute and outside the agent-writable directories, then the system directories, Homebrew and
 * Docker Desktop. A found file is kept for the next call and checked again before it is used. A program that exists
 * only in an excluded directory is refused with a fixed reason; the path goes to `IsolationError.detail`.
 */
export class HostTools {
  private readonly found = new Map<string, string>();

  constructor(private readonly options: HostToolsOptions = {}) {}

  private appPath(): string | undefined {
    return this.options.appPath ?? process.env['PATH'];
  }

  private fixed(): readonly string[] {
    return this.options.fixedDirectories ?? [...SYSTEM_DIRECTORIES, ...INSTALL_DIRECTORIES];
  }

  private excludedWith(extra: readonly string[]): readonly string[] {
    return [...(this.options.excluded?.() ?? []), ...extra];
  }

  /** The lookup list, in order, without the directories of `excluded`. */
  directories(extra: readonly string[] = []): string[] {
    const excluded = this.excludedWith(extra);
    const fixed = this.fixed().filter((directory) => !isWithinAny(directory, excluded));
    return [...new Set([...trustedPath(this.appPath(), excluded).split(delimiter).filter(Boolean), ...fixed])];
  }

  /** The PATH of a host-side process: the trusted entries of the app's PATH, then the system directories. */
  path(extra: readonly string[] = []): string {
    const excluded = this.excludedWith(extra);
    const system = SYSTEM_DIRECTORIES.filter((directory) => !isWithinAny(directory, excluded));
    return [...new Set([...trustedPath(this.appPath(), excluded).split(delimiter).filter(Boolean), ...system])].join(delimiter);
  }

  /** The absolute file of `binary`, or undefined when no trusted directory holds it. A path with a directory part is made absolute and checked against the excluded set. */
  find(binary: string, extra: readonly string[] = []): string | undefined {
    const excluded = this.excludedWith(extra);
    if (binary.includes('/')) return locateHostBinary(binary, undefined, excluded);
    const kept = this.found.get(binary);
    if (kept !== undefined && executable(kept) && !isWithinAny(kept, excluded)) return kept;
    const file = this.directories(extra).map((directory) => join(directory, binary)).find(executable);
    if (file === undefined) this.found.delete(binary);
    else this.found.set(binary, file);
    return file;
  }

  /** The first executable of `binary` that lies in an excluded directory, as a path; undefined when there is none. */
  shadowed(binary: string, extra: readonly string[] = []): string | undefined {
    const excluded = this.excludedWith(extra);
    if (binary.includes('/')) {
      const resolved = isAbsolute(binary) ? binary : join(process.cwd(), binary);
      return executable(resolved) && isWithinAny(resolved, excluded) ? resolved : undefined;
    }
    const entries = (this.appPath() ?? '').split(delimiter).filter((entry) => isAbsolute(entry));
    return [...entries, ...this.fixed()].map((directory) => join(directory, binary)).find((file) => executable(file) && isWithinAny(file, excluded));
  }

  /**
   * The absolute file of `binary`. Throws an `IsolationError` with a fixed reason when it is not found, and when it
   * is found only where an agent may write.
   */
  require(binary: string, extra: readonly string[] = [], purpose = 'the host program'): string {
    const file = this.find(binary, extra);
    if (file !== undefined) return file;
    const hidden = this.shadowed(binary, extra);
    if (hidden !== undefined) throw new IsolationError('failed', `${purpose} (${binary}) exists only in a directory that an agent may write, so it was not started`, hidden);
    throw new IsolationError('failed', `${purpose} (${binary}) was not found as an executable on the trusted PATH of the app (the absolute entries outside the directories that an agent may write)`);
  }

  /** Throws for a program that a launch needs and that exists only in an excluded directory; a missing one is not an error here. */
  refuseHidden(binary: string, extra: readonly string[] = [], purpose = 'a program the launch needs'): void {
    if (this.find(binary, extra) !== undefined) return;
    const hidden = this.shadowed(binary, extra);
    if (hidden !== undefined) throw new IsolationError('failed', `${purpose} (${binary}) exists only in a directory that an agent may write, so it was not started`, hidden);
  }

  /** The absolute file and the PATH for a host-side start of `binary`. */
  launch(binary: string, extra: readonly string[] = [], purpose?: string): { readonly file: string; readonly path: string } {
    return { file: this.require(binary, extra, purpose), path: this.path(extra) };
  }

  private environment(options: HostExecOptions): NodeJS.ProcessEnv {
    return { ...options.env, PATH: this.path(options.excluded ?? []) };
  }

  /** `execFile` for a program found by this module, with the trusted PATH and a working directory that holds nothing. A program that is not found is an error of the callback. Output is text. */
  execFile(binary: string, args: readonly string[], options: HostExecOptions, callback: ExecCallback<string>): void {
    this.start(binary, args, options, callback as ExecCallback<never>, false);
  }

  /** `execFile` with the output as bytes. */
  execFileBuffer(binary: string, args: readonly string[], options: HostExecOptions, callback: ExecCallback<Buffer>): void {
    this.start(binary, args, options, callback as ExecCallback<never>, true);
  }

  private start(binary: string, args: readonly string[], options: HostExecOptions, callback: ExecCallback<never>, bytes: boolean): void {
    let file: string;
    try {
      file = this.require(binary, options.excluded ?? []);
    } catch (error) {
      process.nextTick(() => callback(error as ExecFileException, (bytes ? Buffer.alloc(0) : '') as never, (bytes ? Buffer.alloc(0) : '') as never));
      return;
    }
    spawnFile(file, args, options, this.environment(options), callback, bytes);
  }

  /** The promise form of `execFile`: text output, rejects on a failure with the error of `execFile` (its `stderr` holds the error output). */
  run(binary: string, args: readonly string[], options: HostExecOptions = {}): Promise<{ readonly stdout: string; readonly stderr: string }> {
    return new Promise((resolve, reject) => {
      this.execFile(binary, args, options, (error, stdout, stderr) => {
        if (error === null) resolve({ stdout, stderr });
        else reject(Object.assign(error, { stdout, stderr }));
      });
    });
  }
}

let shared = new HostTools();

/** The instance the app's modules use. The profile process sets it at start (`setHostTools`); until then it excludes nothing. */
export function hostTools(): HostTools {
  return shared;
}

/** Sets the shared instance; the returned function puts the previous one back. */
export function setHostTools(tools: HostTools): () => void {
  const previous = shared;
  shared = tools;
  return () => {
    if (shared === tools) shared = previous;
  };
}
