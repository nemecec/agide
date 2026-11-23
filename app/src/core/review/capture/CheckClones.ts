import { execFile } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { CACHE_TOOLS, EXCLUDED_DIRECTORIES, EXCLUDED_FILES, needsLoopback, selectTools, type CachePart, type CacheTool, type HostPaths, type ProjectFacts } from './cacheTools';

/**
 * Per-run clones of the cache subtrees a check needs (0040 section 6). Each run, the checkpoint run and the base run
 * alike, gets its own directory with APFS clones (`clonefile`, through `cp -c`) of those subtrees; the tool is
 * pointed at it, and the directory is removed when the run ends. Nothing a run writes reaches the real caches, another
 * run or a later capture. A clone that cannot be made is an error; there is no copy and no shared cache instead.
 */

export interface CloneLimits {
  /** Regular files in one subtree; a larger subtree is not cloned. */
  readonly maxFiles: number;
  /** Time for all clones of one run. */
  readonly maxMilliseconds: number;
}

export const DEFAULT_CLONE_LIMITS: CloneLimits = { maxFiles: 200_000, maxMilliseconds: 120_000 };

/** The APFS value of `f_type` that `statfs` reports on macOS. */
export const APFS_TYPE = 26;

export class CloneError extends Error {
  override readonly name = 'CloneError';

  /** Text from outside the app, such as the stderr of `cp` or a path inside the real cache. It goes to the log of the run and never into the reason that a reviewer reads. */
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Clones the directory `source` to the new path `destination`. Rejects when it cannot clone; never copies instead. */
export type CloneFunction = (source: string, destination: string, signal: AbortSignal) => Promise<void>;

/** The program that clones a tree on a platform without falling back to a copy; undefined when the platform has none. */
export function cloneCommand(platform: NodeJS.Platform, source: string, destination: string): { file: string; args: string[] } | undefined {
  if (platform === 'darwin') return { file: '/bin/cp', args: ['-cR', '--', source, destination] };
  if (platform === 'linux') return { file: 'cp', args: ['-R', '--reflink=always', '--', source, destination] };
  return undefined;
}

export const cloneWithCp: CloneFunction = (source, destination, signal) => {
  const command = cloneCommand(process.platform, source, destination);
  if (command === undefined) return Promise.reject(new CloneError(`cloning is not supported on ${process.platform}`));
  return new Promise<void>((resolve, reject) => {
    execFile(command.file, command.args, { signal, timeout: 0 }, (error, _stdout, stderr) => {
      if (error === null) resolve();
      else if (signal.aborted) reject(signal.reason);
      else reject(new CloneError('cp -c could not clone a cache', `${command.file} ${command.args.join(' ')}: ${stderr.trim() || error.message}`.slice(0, 2_000)));
    });
  });
};

/**
 * Why `source` cannot be cloned into the directory `destinationRoot`, or undefined when it can: both must be on one
 * volume, and on macOS that volume must be APFS. `cp -c` copies when it cannot clone, so the check comes first. The
 * volume is the filesystem that `df` names, not `st_dev`: on macOS the sealed system volume and the data volume
 * report the same `st_dev`, and `clonefile` fails between them with `EXDEV`.
 */
export type CloneProbe = (source: string, destinationRoot: string) => Promise<string | undefined>;

export interface VolumeFacts {
  readonly sourceDevice: number;
  readonly destinationDevice: number;
  /** The filesystem each path is on, as `df -P` names it. */
  readonly sourceFilesystem: string;
  readonly destinationFilesystem: string;
  readonly platform: NodeJS.Platform;
  /** `f_type` of the destination volume. */
  readonly destinationType: number;
}

export function cloneRefusal(facts: VolumeFacts): string | undefined {
  if (facts.sourceDevice !== facts.destinationDevice || facts.sourceFilesystem !== facts.destinationFilesystem) return 'it is on another volume than the clone directory';
  if (facts.platform === 'darwin' && facts.destinationType !== APFS_TYPE) return 'the volume of the clone directory is not APFS';
  return undefined;
}

/** The filesystem of an absolute path: the first column of `df -P`. */
export function filesystemOf(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('df', ['-P', path], (error, stdout) => {
      const line = stdout.trim().split('\n').pop() ?? '';
      const match = /^(.+?)\s+\d+\s+\d+\s+\d+\s+\d+%\s/.exec(line);
      if (error !== null || match === null) reject(new CloneError(`the filesystem of ${path} could not be read`));
      else resolve(match[1]!);
    });
  });
}

export const probeCloneable: CloneProbe = async (source, destinationRoot) => {
  const [from, to, sourceFilesystem, destinationFilesystem] = await Promise.all([stat(source), stat(destinationRoot), filesystemOf(source), filesystemOf(destinationRoot)]);
  const refusal = cloneRefusal({ sourceDevice: from.dev, destinationDevice: to.dev, sourceFilesystem, destinationFilesystem, platform: process.platform, destinationType: statfsSync(destinationRoot).type });
  return refusal === undefined ? undefined : `${source}: ${refusal}`;
};

export interface CheckClonesOptions {
  /** The directory below which each run gets its own directory; it holds nothing else and is swept at start. */
  readonly root: string;
  readonly tools?: readonly CacheTool[];
  readonly limits?: Partial<CloneLimits>;
  readonly clone?: CloneFunction;
  readonly probe?: CloneProbe;
  /** The device of a path, as `lstat` reports it; a directory with another device than the cache root is a mount point. */
  readonly deviceOf?: DeviceOf;
  readonly platform?: NodeJS.Platform;
  readonly removeTree?: (path: string) => Promise<void>;
}

export interface CloneRequest {
  readonly host: Pick<HostPaths, 'home' | 'env'>;
  readonly project: ProjectFacts;
  /** The check environment so far; tools that add to a variable (`MAVEN_OPTS`) build on it. */
  readonly current: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface RunClones {
  /** The run's own directory: the only place besides the checkout and the temporary directory that the check may write. */
  readonly directory: string;
  /** The variables that point the tools at their clones. */
  readonly environment: Readonly<Record<string, string>>;
  /** The tools that have a clone directory. */
  readonly tools: readonly string[];
  /** A command of the policy names a tool that binds a loopback port: the sandbox then admits loopback connections. */
  readonly loopback: boolean;
  /** Regular files in the clones. */
  readonly files: number;
  readonly milliseconds: number;
  /** Removes the directory; safe to call twice. */
  remove(): Promise<void>;
}

/** What the check executor needs of the clones. */
export interface CloneService {
  create(runId: string, request: CloneRequest): Promise<RunClones>;
}

export class CheckClones implements CloneService {
  private readonly live = new Set<string>();
  private readonly tools: readonly CacheTool[];
  private readonly limits: CloneLimits;
  private readonly clone: CloneFunction;
  private readonly probe: CloneProbe;
  private readonly deviceOf: DeviceOf;
  private readonly platform: NodeJS.Platform;
  private readonly removeTree: (path: string) => Promise<void>;

  constructor(private readonly options: CheckClonesOptions) {
    this.tools = options.tools ?? CACHE_TOOLS;
    this.limits = { ...DEFAULT_CLONE_LIMITS, ...options.limits };
    this.clone = options.clone ?? cloneWithCp;
    this.probe = options.probe ?? probeCloneable;
    this.deviceOf = options.deviceOf ?? deviceOfPath;
    this.platform = options.platform ?? process.platform;
    this.removeTree = options.removeTree ?? removeTree;
  }

  /** Removes what an earlier run of the app left, such as clones of a check that was killed. Call it at start, before any run. */
  async sweep(): Promise<void> {
    const entries = await readdir(this.options.root).catch(() => []);
    for (const name of entries) if (!this.live.has(name)) await this.removeTree(join(this.options.root, name));
  }

  async create(runId: string, request: CloneRequest): Promise<RunClones> {
    const directory = join(this.options.root, runId);
    this.live.add(runId);
    // A process that left the process group of the check can still write into the directory while it goes. The check is not lost for that: what stays is removed by the sweep at the next start.
    const remove = async (): Promise<void> => {
      await this.removeTree(directory).catch(() => undefined);
      this.live.delete(runId);
    };
    const started = Date.now();
    try {
      await mkdir(this.options.root, { recursive: true, mode: 0o700 });
      await mkdir(directory, { mode: 0o700 });
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.limits.maxMilliseconds)]);
      const host: HostPaths = { ...request.host, platform: this.platform };
      const selected = selectTools(this.tools, request.project);
      let files = 0;
      const environment: Record<string, string> = {};
      for (const tool of selected) {
        const toolDirectory = join(directory, tool.id);
        await mkdir(toolDirectory, { mode: 0o700 });
        for (const part of tool.parts(host, request.project)) files += await this.clonePart(tool, toolDirectory, part, signal);
        Object.assign(environment, tool.environment(toolDirectory, { ...request.current, ...environment }));
      }
      return { directory, environment, tools: selected.map((tool) => tool.id), loopback: needsLoopback(selected, request.project), files, milliseconds: Date.now() - started, remove };
    } catch (error) {
      await remove();
      if (error instanceof CloneError) throw error;
      if (request.signal.aborted) throw new CloneError('the check was cancelled while its caches were cloned');
      if (error instanceof Error && error.name === 'TimeoutError') throw new CloneError(`the caches were not cloned within ${this.limits.maxMilliseconds} ms`);
      // The message of a file system error names a path in the real cache, and an agent that can write the cache chooses such names: only the code reaches the reason.
      const code = (error as NodeJS.ErrnoException).code;
      throw new CloneError(`the cache clone failed (${typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unknown error'})`, (error as Error).message.slice(0, 2_000));
    }
  }

  /** Clones one subtree and returns its file count; a subtree that does not exist is skipped, since the tool then starts with an empty cache. */
  private async clonePart(tool: CacheTool, toolDirectory: string, part: CachePart, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted();
    const source = await realpath(part.from).catch(() => undefined);
    if (source === undefined || !(await stat(source)).isDirectory()) return 0;
    const refusal = await this.probe(source, this.options.root);
    if (refusal !== undefined) throw new CloneError(`the ${tool.id} cache cannot be cloned: ${refusal}`);
    const counted = await countFiles(source, this.limits.maxFiles, this.deviceOf).catch((error: unknown) => {
      if (error instanceof MountBelowRoot) throw new CloneError(`the ${tool.id} cache holds another volume below it; \`cp -c\` would copy it`, `the other volume is at ${relative(source, error.path)}`);
      throw error;
    });
    if (counted > this.limits.maxFiles) throw new CloneError(`the ${tool.id} cache is too large to clone (more than ${this.limits.maxFiles} files)`);
    const destination = join(toolDirectory, part.to);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try {
      await this.clone(source, destination, signal);
    } catch (error) {
      if (error instanceof CloneError && error.detail !== undefined) throw new CloneError(`cp -c could not clone the ${tool.id} cache`, error.detail);
      throw error;
    }
    return prune(destination);
  }
}

export type DeviceOf = (path: string) => Promise<number>;

const deviceOfPath: DeviceOf = async (path) => (await lstat(path)).dev;

/** A directory below the cache root is a mount point: the probe looked at the root only, and `cp -c` copies the volume that is mounted there. */
class MountBelowRoot extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

/** Regular files below `directory`, counting stops once the count passes `limit`. Rejects with `MountBelowRoot` for a directory on another device than `directory`. */
async function countFiles(directory: string, limit: number, deviceOf: DeviceOf): Promise<number> {
  const rootDevice = await deviceOf(directory);
  let count = 0;
  const pending = [directory];
  for (let next = pending.pop(); next !== undefined && count <= limit; next = pending.pop()) {
    for (const entry of await readdir(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) {
        if ((await deviceOf(path)) !== rootDevice) throw new MountBelowRoot(path);
        pending.push(path);
      } else if (entry.isFile()) count++;
    }
  }
  return count;
}

const isExcluded = (name: string, directory: boolean): boolean => (directory ? EXCLUDED_DIRECTORIES : EXCLUDED_FILES).includes(name);

/**
 * Removes from a fresh clone what must not be in it: links (a link inside a clone could lead to a real directory),
 * special files and the excluded names. Returns the regular files that remain.
 */
export async function prune(directory: string): Promise<number> {
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isExcluded(entry.name, true)) await removeTree(path);
      else files += await prune(path);
    } else if (entry.isFile() && !isExcluded(entry.name, false)) files++;
    else await rm(path, { force: true });
  }
  return files;
}

/** Removes a tree whose directories may be read-only (a Go module cache is). Resolves when the path is gone. */
export async function removeTree(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    await new Promise<void>((resolve) => execFile('chmod', ['-R', 'u+rwX', '--', path], () => resolve()));
    await rm(path, { recursive: true, force: true });
  }
}
