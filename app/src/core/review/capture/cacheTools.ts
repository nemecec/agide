import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * The cache and configuration-free subtrees of the tools a project check may use, and the variables that point each
 * tool at its clone (0040 section 6). A check never writes the real directories: every run clones the subtrees it
 * needs, and the tool is pointed at the clone. Toolchains (rustup, JDKs, sdkman, nvm, pyenv, Homebrew) are not
 * here: they stay real and read-only. A tool that is not in the table gets no redirection, and a write it needs
 * below the real home is refused by the sandbox.
 */

export interface HostPaths {
  readonly home: string;
  /** The environment the real locations are read from (for example `CARGO_HOME`); the check does not get it. */
  readonly env: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
}

/** What is known about the project before its check starts. */
export interface ProjectFacts {
  /** File names found at the checkout root and one directory below it. */
  readonly markers: ReadonlySet<string>;
  /** Words of the command lines of the check, as program names. */
  readonly words: ReadonlySet<string>;
  /** The Gradle wrapper distribution the project names, such as `gradle-9.8.2-bin`. */
  readonly gradleDistribution?: string | undefined;
}

export interface CachePart {
  /** The real directory. */
  readonly from: string;
  /** Where the clone goes, below the tool's clone directory. */
  readonly to: string;
}

export interface CacheTool {
  readonly id: string;
  /** Program names that select the tool when a command of the check names them. */
  readonly commands: readonly string[];
  /** File names at the project root that select the tool. */
  readonly markers: readonly string[];
  /** The tool binds a loopback port (Gradle's lock socket). Under `srt` that also lets the check connect to every loopback service of the host; only a command word of the policy asks for it (`needsLoopback`). */
  readonly loopback?: true;
  parts(host: HostPaths, project: ProjectFacts): readonly CachePart[];
  /** The variables that point the tool at `directory`, its clone directory; `current` is the check environment so far. */
  environment(directory: string, current: Readonly<Record<string, string>>): Record<string, string>;
}

/**
 * Names that are never cloned and never pointed at (credentials and settings that may hold them). The walk that
 * follows a clone removes them from the clone before the tool starts.
 */
export const EXCLUDED_FILES: readonly string[] = [
  'settings.xml',
  'settings-security.xml',
  'gradle.properties',
  'credentials',
  'credentials.toml',
  'config.toml',
  'keys.properties',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.netrc',
  '.pypirc',
  '.git-credentials',
];
export const EXCLUDED_DIRECTORIES: readonly string[] = ['.ssh', '.gnupg', 'develocity', 'enterprise'];

const inHome = (host: HostPaths, ...parts: string[]): string => join(host.home, ...parts);
const fromEnv = (host: HostPaths, name: string): string | undefined => {
  const value = host.env[name];
  return value === undefined || value === '' ? undefined : value;
};
const cacheHome = (host: HostPaths): string => fromEnv(host, 'XDG_CACHE_HOME') ?? inHome(host, '.cache');
const quoted = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);
const joined = (current: string | undefined, addition: string): string => [current, addition].filter((part) => part !== undefined && part !== '').join(' ');

export const GRADLE_DISTRIBUTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const gradle: CacheTool = {
  id: 'gradle',
  commands: ['gradle', 'gradlew'],
  markers: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew'],
  loopback: true,
  parts: (host, project) => {
    const root = fromEnv(host, 'GRADLE_USER_HOME') ?? inHome(host, '.gradle');
    const parts: CachePart[] = [{ from: join(root, 'caches', 'modules-2'), to: join('caches', 'modules-2') }];
    // The wrapper takes a lock file inside its distribution directory, so a read-only link does not work: the one distribution the project names is cloned.
    if (project.gradleDistribution !== undefined) parts.push({ from: join(root, 'wrapper', 'dists', project.gradleDistribution), to: join('wrapper', 'dists', project.gradleDistribution) });
    return parts;
  },
  // A daemon would outlive the process group of the check.
  environment: (directory, current) => ({ GRADLE_USER_HOME: directory, GRADLE_OPTS: joined(current['GRADLE_OPTS'], '-Dorg.gradle.daemon=false') }),
};

const maven: CacheTool = {
  id: 'maven',
  commands: ['mvn', 'mvnw'],
  markers: ['pom.xml', 'mvnw'],
  parts: (host) => [{ from: inHome(host, '.m2', 'repository'), to: 'repository' }],
  environment: (directory, current) => ({ MAVEN_OPTS: joined(current['MAVEN_OPTS'], `-Dmaven.repo.local=${quoted(join(directory, 'repository'))}`) }),
};

const cargo: CacheTool = {
  id: 'cargo',
  commands: ['cargo'],
  markers: ['Cargo.toml'],
  parts: (host) => {
    const root = fromEnv(host, 'CARGO_HOME') ?? inHome(host, '.cargo');
    return [
      { from: join(root, 'registry', 'cache'), to: join('registry', 'cache') },
      { from: join(root, 'registry', 'index'), to: join('registry', 'index') },
    ];
  },
  environment: (directory) => ({ CARGO_HOME: directory }),
};

const npm: CacheTool = {
  id: 'npm',
  commands: ['npm', 'npx'],
  markers: ['package.json', 'package-lock.json'],
  parts: (host) => [{ from: join(fromEnv(host, 'npm_config_cache') ?? inHome(host, '.npm'), '_cacache'), to: '_cacache' }],
  environment: (directory) => ({ npm_config_cache: directory }),
};

const pnpm: CacheTool = {
  id: 'pnpm',
  commands: ['pnpm', 'pnpx'],
  markers: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  parts: (host) => {
    const pnpmHome = fromEnv(host, 'PNPM_HOME');
    const store =
      fromEnv(host, 'pnpm_config_store_dir') ??
      fromEnv(host, 'npm_config_store_dir') ??
      (pnpmHome === undefined ? (host.platform === 'darwin' ? inHome(host, 'Library', 'pnpm', 'store') : join(fromEnv(host, 'XDG_DATA_HOME') ?? inHome(host, '.local', 'share'), 'pnpm', 'store')) : join(pnpmHome, 'store'));
    const cache =
      fromEnv(host, 'pnpm_config_cache_dir') ??
      fromEnv(host, 'npm_config_cache_dir') ??
      (host.platform === 'darwin' ? inHome(host, 'Library', 'Caches', 'pnpm') : join(cacheHome(host), 'pnpm'));
    // The metadata cache goes with the store: pnpm 11 checks even a frozen lock file against the package metadata it holds.
    return [
      { from: store, to: 'store' },
      { from: cache, to: 'cache' },
    ];
  },
  // pnpm 11 reads `pnpm_config_*` and ignores `npm_config_*`; the older versions read `npm_config_*`.
  environment: (directory) => {
    const store = join(directory, 'store');
    const cache = join(directory, 'cache');
    return { pnpm_config_store_dir: store, npm_config_store_dir: store, pnpm_config_cache_dir: cache, npm_config_cache_dir: cache };
  },
};

const pip: CacheTool = {
  id: 'pip',
  commands: ['pip', 'pip3'],
  markers: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'],
  parts: (host) => [{ from: fromEnv(host, 'PIP_CACHE_DIR') ?? (host.platform === 'darwin' ? inHome(host, 'Library', 'Caches', 'pip') : join(cacheHome(host), 'pip')), to: 'cache' }],
  environment: (directory) => ({ PIP_CACHE_DIR: join(directory, 'cache') }),
};

const uv: CacheTool = {
  id: 'uv',
  commands: ['uv', 'uvx'],
  markers: ['uv.lock', 'pyproject.toml'],
  parts: (host) => [{ from: fromEnv(host, 'UV_CACHE_DIR') ?? join(cacheHome(host), 'uv'), to: 'cache' }],
  environment: (directory) => ({ UV_CACHE_DIR: join(directory, 'cache') }),
};

const go: CacheTool = {
  id: 'go',
  commands: ['go'],
  markers: ['go.mod'],
  parts: (host) => {
    const gopath = fromEnv(host, 'GOPATH')?.split(':')[0] ?? inHome(host, 'go');
    return [
      { from: fromEnv(host, 'GOMODCACHE') ?? join(gopath, 'pkg', 'mod'), to: 'mod' },
      { from: fromEnv(host, 'GOCACHE') ?? (host.platform === 'darwin' ? inHome(host, 'Library', 'Caches', 'go-build') : join(cacheHome(host), 'go-build')), to: 'build' },
    ];
  },
  environment: (directory) => ({ GOMODCACHE: join(directory, 'mod'), GOCACHE: join(directory, 'build') }),
};

export const CACHE_TOOLS: readonly CacheTool[] = [gradle, maven, cargo, npm, pnpm, pip, uv, go];

/** The tools a check needs: those a command names or a marker file of the project points to. */
export function selectTools(tools: readonly CacheTool[], project: ProjectFacts): CacheTool[] {
  return tools.filter((tool) => tool.commands.some((name) => project.words.has(name)) || tool.markers.some((name) => project.markers.has(name)));
}

/**
 * Whether a command of the check names a tool that binds a loopback port. Only the command words decide, never the
 * marker files: the words come from the policy of the base commit, the markers from the checkout of the checkpoint,
 * which the agent wrote, and loopback reaches every TCP service of the host.
 */
export function needsLoopback(tools: readonly CacheTool[], project: ProjectFacts): boolean {
  return tools.some((tool) => tool.loopback === true && tool.commands.some((name) => project.words.has(name)));
}

/** Program names in command lines: every argument and every word of a script argument, with its directory part dropped. */
export function commandWords(argvs: readonly (readonly string[])[]): Set<string> {
  const words = new Set<string>();
  for (const argv of argvs) {
    for (const argument of argv) {
      words.add(basename(argument));
      for (const word of argument.split(/[^A-Za-z0-9_.-]+/)) if (word !== '') words.add(word);
    }
  }
  return words;
}

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'target', 'build', 'dist', '.gradle', 'vendor', '.venv']);
const WRAPPER_PROPERTIES = join('gradle', 'wrapper', 'gradle-wrapper.properties');

/** The distribution name of a `distributionUrl` line: its last path segment without `.zip`; undefined when it is not a plain name. */
export function gradleDistributionOf(properties: string): string | undefined {
  const line = properties.split(/\r?\n/).find((candidate) => /^\s*distributionUrl\s*[=:]/.test(candidate));
  if (line === undefined) return undefined;
  const value = line.replace(/^\s*distributionUrl\s*[=:]\s*/, '').replaceAll('\\', '');
  const name = basename(value.split('?')[0] ?? '').replace(/\.zip$/, '');
  return GRADLE_DISTRIBUTION_PATTERN.test(name) ? name : undefined;
}

const MAX_PROPERTIES_BYTES = 64 * 1024;

/** The text of a regular file of the checkout, which the agent wrote: never through a link, never a large file. */
async function readSmallFile(path: string): Promise<string | undefined> {
  const stat = await lstat(path).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.size > MAX_PROPERTIES_BYTES) return undefined;
  return readFile(path, 'utf8').catch(() => undefined);
}

/** Marker file names at the root and one level below, the Gradle wrapper distribution, and the words of the commands. */
export async function readProjectFacts(checkout: string, argvs: readonly (readonly string[])[]): Promise<ProjectFacts> {
  const markers = new Set<string>();
  const visit = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile()) markers.add(entry.name);
      else if (entry.isDirectory() && depth < 1 && !SKIPPED_DIRECTORIES.has(entry.name)) await visit(join(directory, entry.name), depth + 1);
    }
  };
  await visit(checkout, 0);
  const properties = await readSmallFile(join(checkout, WRAPPER_PROPERTIES));
  const gradleDistribution = properties === undefined ? undefined : gradleDistributionOf(properties);
  return { markers, words: commandWords(argvs), ...(gradleDistribution === undefined ? {} : { gradleDistribution }) };
}
