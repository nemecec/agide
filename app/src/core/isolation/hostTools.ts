import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { agentWritableDirectories } from './agentWritable';
import { isWithinAny, trustedPath } from './hostLaunch';
import { IsolationError } from './types';

/**
 * The host side of the app: every program it starts outside a sandbox goes through this module (a scan in
 * `hostToolsGuard.test.ts` fails when another file starts one). A program name is never looked up through anything
 * that code an agent writes can influence: not a relative or empty entry of PATH, not the working directory, not a
 * directory the agent may write (`agentWritable.ts`). The system tools have fixed absolute paths; `git`, `docker`,
 * `srt`, `node` and the like are searched on an explicit list of directories. A candidate counts by where its code
 * lives as well as by where the file sits: a link that leads into an agent-writable directory, and a shim that names a
 * script there, are refused like a file in it.
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
  /**
   * The directories an agent may write (`AgentWritableRegistry.directories`), read at each lookup so a changed profile
   * and a new workspace apply at once. Required: an instance that excludes nothing is a test fixture (`() => []`).
   */
  readonly excluded: () => readonly string[];
  /** The directories searched after the app's PATH. Default: the system directories, Homebrew and Docker Desktop. */
  readonly fixedDirectories?: readonly string[];
  /** For a refused program: the directories recorded at a launch that hold it and how to forget them (`AgentWritableRegistry.recordedHolding`). */
  readonly recorded?: (paths: readonly string[]) => string | undefined;
}

/** The cause in the reason of a program that a directory recorded at a launch holds. */
export const RECORDED_CAUSE = 'lies in a directory that an earlier agent launch made writable (such as the home directory)';

/** A shim larger than this is not read for the script it names. */
const SHIM_MAX_BYTES = 16 * 1024;

/**
 * The directories in which a shim started as `file` looks for its script and for `node`: the directory of `file` as it
 * is spelled, which a shim that takes `dirname "$0"` without resolving links uses (older pnpm, cmd-shim), and the real
 * directory of `file`, which the current pnpm shim resolves to.
 */
function shimDirectories(file: string): string[] {
  try {
    return [...new Set([dirname(resolve(file)), dirname(realpathSync.native(file))])];
  } catch {
    return [dirname(resolve(file))];
  }
}

/**
 * The scripts that a cmd-shim names on its `# cmd-shim-target=` line (pnpm and npm write one for a global program): the
 * shim is a small file in a trusted directory, the code it runs lies where the line says, made absolute against each
 * directory of `shimDirectories`. A file that is not such a shim has none.
 */
function shimTargets(file: string): string[] {
  try {
    if (statSync(file).size > SHIM_MAX_BYTES) return [];
    const targets = [...readFileSync(file, 'utf8').matchAll(/^# cmd-shim-target=(.+)$/gm)].map((match) => (match[1] ?? '').trim());
    return [...new Set(shimDirectories(file).flatMap((base) => targets.map((target) => resolve(base, target))))];
  } catch {
    return [];
  }
}

/** True when the file, the place its link leads to, or a script its shim names lies in `excluded`: an agent may write the code that starts. */
function runsExcludedCode(file: string, excluded: readonly string[]): boolean {
  return isWithinAny(file, excluded) || shimTargets(file).some((target) => isWithinAny(target, excluded));
}

/**
 * Finds the programs the app starts on the host, and starts them. The lookup list is explicit: the entries of the
 * app's PATH that are absolute and outside the agent-writable directories, then the system directories, Homebrew and
 * Docker Desktop. A candidate is used only when its real path (links resolved) and the script of its shim lie outside
 * those directories too. A found file is kept for the next call and checked again before it is used. A program that
 * exists only where an agent may write, or that runs code there, is refused with a fixed reason; the path goes to
 * `IsolationError.detail`.
 */
export class HostTools {
  private readonly found = new Map<string, string>();

  constructor(private readonly options: HostToolsOptions) {}

  private appPath(): string | undefined {
    return this.options.appPath ?? process.env['PATH'];
  }

  private fixed(): readonly string[] {
    return this.options.fixedDirectories ?? [...SYSTEM_DIRECTORIES, ...INSTALL_DIRECTORIES];
  }

  private excludedWith(extra: readonly string[]): readonly string[] {
    return [...this.options.excluded(), ...extra];
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

  private usable(file: string, excluded: readonly string[]): boolean {
    return executable(file) && !runsExcludedCode(file, excluded);
  }

  /** The absolute file of `binary`, or undefined when no trusted directory holds a usable one. A path with a directory part is made absolute and checked the same way. */
  find(binary: string, extra: readonly string[] = []): string | undefined {
    const excluded = this.excludedWith(extra);
    if (binary.includes('/')) {
      const resolved = resolve(binary);
      return this.usable(resolved, excluded) ? resolved : undefined;
    }
    const kept = this.found.get(binary);
    if (kept !== undefined && this.usable(kept, excluded)) return kept;
    const file = this.directories(extra).map((directory) => join(directory, binary)).find((candidate) => this.usable(candidate, excluded));
    if (file === undefined) this.found.delete(binary);
    else this.found.set(binary, file);
    return file;
  }

  /** The first executable of `binary` that lies in an excluded directory or runs code there, as a path; undefined when there is none. */
  shadowed(binary: string, extra: readonly string[] = []): string | undefined {
    const excluded = this.excludedWith(extra);
    const candidates = binary.includes('/') ? [resolve(binary)] : [...(this.appPath() ?? '').split(delimiter).filter((entry) => isAbsolute(entry)), ...this.fixed()].map((directory) => join(directory, binary));
    return candidates.find((file) => executable(file) && runsExcludedCode(file, excluded));
  }

  /** The directories recorded at a launch that hold the code of `file` (the file, its real path, the script of its shim) and the command that forgets them; undefined when none does. */
  recordedFor(file: string): string | undefined {
    return this.options.recorded?.([file, ...shimTargets(file)]);
  }

  /**
   * The refusal for a program that lies where an agent may write, named by its role and base name, never by its path
   * (the path goes to the detail). When a directory that was recorded at a launch holds it (a session in the home
   * directory), the reason says so and the detail names the directory and the command that forgets it.
   */
  private hidden(named: string, file: string): IsolationError {
    const recorded = this.recordedFor(file);
    if (recorded !== undefined) return new IsolationError('failed', `${named} ${RECORDED_CAUSE}, so it was not started`, `${file}; ${recorded}`);
    return new IsolationError('failed', `${named} exists only in a directory that an agent may write, or runs code that lies in one, so it was not started`, file);
  }

  /** The refusal for a program that `find` does not return: named by its role and base name, never by its path (the path goes to the detail). */
  private refusal(binary: string, extra: readonly string[], purpose: string): IsolationError {
    const named = `${purpose} (${basename(binary)})`;
    const hidden = this.shadowed(binary, extra);
    if (hidden !== undefined) return this.hidden(named, hidden);
    if (binary.includes('/')) return new IsolationError('failed', `${named} is not an executable file at the configured path`, resolve(binary));
    return new IsolationError('failed', `${named} was not found as an executable on the trusted PATH of the app (the absolute entries outside the directories that an agent may write)`);
  }

  /**
   * The absolute file of `binary`. Throws an `IsolationError` with a fixed reason when it is not found, and when it
   * is found only where an agent may write.
   */
  require(binary: string, extra: readonly string[] = [], purpose = 'the host program'): string {
    const file = this.find(binary, extra);
    if (file !== undefined) return file;
    throw this.refusal(binary, extra, purpose);
  }

  /**
   * Throws for a program that a host-side process looks up itself, on the PATH that `path` gives it, when the first
   * file there runs code of an excluded directory, or when the program exists only in one. A missing one is not an
   * error here.
   */
  refuseHidden(binary: string, extra: readonly string[] = [], purpose = 'a program the launch needs'): void {
    const excluded = this.excludedWith(extra);
    const first = this.path(extra).split(delimiter).map((directory) => join(directory, binary)).find(executable);
    if (first !== undefined && runsExcludedCode(first, excluded)) throw this.hidden(`${purpose} (${basename(binary)})`, first);
    if (this.find(binary, extra) === undefined && this.shadowed(binary, extra) !== undefined) throw this.refusal(binary, extra, purpose);
  }

  /**
   * Throws when the program `binary` beside `file`, in the directory of `file` as it is spelled or in its real directory
   * (`shimDirectories`), runs code of an excluded directory, or lies in one. A shim runs `$basedir/node` before any
   * `node` of the PATH, so a `node` there is started whether or not the directory is on the PATH. A missing one is not
   * an error here.
   */
  refuseBeside(file: string, binary: string, extra: readonly string[] = [], purpose = 'a program the launch needs'): void {
    const excluded = this.excludedWith(extra);
    for (const directory of shimDirectories(file)) {
      const beside = join(directory, binary);
      if (executable(beside) && runsExcludedCode(beside, excluded)) throw this.hidden(`${purpose} (${basename(binary)})`, beside);
    }
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

let shared = new HostTools({ excluded: () => agentWritableDirectories({ writeDirs: [], claudeConfigDir: undefined }) });

/** The instance the app's modules use. The profile process sets it at start (`setHostTools`); until then it excludes the directories that hold no program for any profile (the defaults of `srt` and the default Claude directory). */
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
