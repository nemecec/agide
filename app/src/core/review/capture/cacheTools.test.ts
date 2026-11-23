import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CACHE_TOOLS, commandWords, EXCLUDED_DIRECTORIES, EXCLUDED_FILES, gradleDistributionOf, needsLoopback, readProjectFacts, selectTools, type CacheTool, type HostPaths, type ProjectFacts } from './cacheTools';
import { removeTempDirs, tempDir, write } from './gitFixtures';
import { symlinkSync } from 'node:fs';

afterEach(() => removeTempDirs());

const tool = (id: string): CacheTool => CACHE_TOOLS.find((candidate) => candidate.id === id)!;
const host = (patch: Partial<HostPaths> = {}): HostPaths => ({ home: '/h', env: {}, platform: 'darwin', ...patch });
const facts = (patch: Partial<ProjectFacts> = {}): ProjectFacts => ({ markers: new Set(), words: new Set(), ...patch });

describe('the tool table', () => {
  it('has one entry per tool with the ids the design names', () => {
    expect(CACHE_TOOLS.map((entry) => entry.id), 'gradle, maven, cargo, npm, pnpm, pip, uv and go').toEqual(['gradle', 'maven', 'cargo', 'npm', 'pnpm', 'pip', 'uv', 'go']);
  });

  it('clones the Gradle module cache only and points GRADLE_USER_HOME at the clone, with no daemon', () => {
    const gradle = tool('gradle');
    expect(gradle.parts(host(), facts()), 'modules-2 only: no gradle.properties, no init.d, no keys').toEqual([{ from: '/h/.gradle/caches/modules-2', to: 'caches/modules-2' }]);
    expect(gradle.environment('/c/gradle', {}), 'the user home of Gradle and the daemon switch').toEqual({ GRADLE_USER_HOME: '/c/gradle', GRADLE_OPTS: '-Dorg.gradle.daemon=false' });
    expect(gradle.environment('/c/gradle', { GRADLE_OPTS: '-Xmx1g' })['GRADLE_OPTS'], 'listed options stay').toBe('-Xmx1g -Dorg.gradle.daemon=false');
  });

  it('clones the wrapper distribution the project names, since a read-only link fails on the lock file', () => {
    expect(tool('gradle').parts(host({ env: { GRADLE_USER_HOME: '/g' } }), facts({ gradleDistribution: 'gradle-9.8.2-bin' })), 'the module cache and the one distribution below the real Gradle home').toEqual([
      { from: '/g/caches/modules-2', to: 'caches/modules-2' },
      { from: '/g/wrapper/dists/gradle-9.8.2-bin', to: 'wrapper/dists/gradle-9.8.2-bin' },
    ]);
  });

  it('sets the Maven repository with -Dmaven.repo.local and keeps what MAVEN_OPTS holds', () => {
    const maven = tool('maven');
    expect(maven.parts(host(), facts()), 'the repository, not settings.xml').toEqual([{ from: '/h/.m2/repository', to: 'repository' }]);
    expect(maven.environment('/c/maven', {}), 'the local repository property').toEqual({ MAVEN_OPTS: '-Dmaven.repo.local=/c/maven/repository' });
    expect(maven.environment('/c/maven', { MAVEN_OPTS: '-Xmx1g' })['MAVEN_OPTS'], 'appended').toBe('-Xmx1g -Dmaven.repo.local=/c/maven/repository');
    expect(maven.environment('/c/my dir', {})['MAVEN_OPTS'], 'a path with a space is quoted').toBe('-Dmaven.repo.local="/c/my dir/repository"');
  });

  it('clones the Cargo registry cache and index only and points CARGO_HOME at the clone', () => {
    const cargo = tool('cargo');
    expect(cargo.parts(host(), facts()), 'registry/cache and registry/index: no registry/src, credentials or config.toml').toEqual([
      { from: '/h/.cargo/registry/cache', to: 'registry/cache' },
      { from: '/h/.cargo/registry/index', to: 'registry/index' },
    ]);
    expect(cargo.parts(host({ env: { CARGO_HOME: '/cg' } }), facts())[0]!.from, 'a CARGO_HOME of the host is the source').toBe('/cg/registry/cache');
    expect(cargo.environment('/c/cargo', {}), 'only CARGO_HOME; RUSTUP_HOME and PATH are not touched').toEqual({ CARGO_HOME: '/c/cargo' });
  });

  it('clones the npm content cache and sets npm_config_cache', () => {
    expect(tool('npm').parts(host(), facts()), '_cacache of the npm cache').toEqual([{ from: '/h/.npm/_cacache', to: '_cacache' }]);
    expect(tool('npm').parts(host({ env: { npm_config_cache: '/n' } }), facts())[0]!.from, 'a cache of the host').toBe('/n/_cacache');
    expect(tool('npm').environment('/c/npm', {}), 'the variable').toEqual({ npm_config_cache: '/c/npm' });
  });

  it.each([
    ['darwin', {}, '/h/Library/pnpm/store'],
    ['linux', {}, '/h/.local/share/pnpm/store'],
    ['linux', { XDG_DATA_HOME: '/x' }, '/x/pnpm/store'],
    ['darwin', { PNPM_HOME: '/p' }, '/p/store'],
    ['darwin', { npm_config_store_dir: '/s' }, '/s'],
    ['darwin', { pnpm_config_store_dir: '/t', npm_config_store_dir: '/s' }, '/t'],
  ] as const)('finds the pnpm store on %s with %j', (platform, env, expected) => {
    expect(tool('pnpm').parts(host({ platform, env }), facts())[0], 'the whole store is the first source').toEqual({ from: expected, to: 'store' });
  });

  it.each([
    ['darwin', {}, '/h/Library/Caches/pnpm'],
    ['linux', {}, '/h/.cache/pnpm'],
    ['linux', { XDG_CACHE_HOME: '/x' }, '/x/pnpm'],
    ['darwin', { pnpm_config_cache_dir: '/pc', npm_config_cache_dir: '/nc' }, '/pc'],
    ['darwin', { npm_config_cache_dir: '/nc' }, '/nc'],
  ] as const)('clones the pnpm metadata cache found on %s with %j', (platform, env, expected) => {
    expect(tool('pnpm').parts(host({ platform, env }), facts())[1], 'the metadata cache is the second source').toEqual({ from: expected, to: 'cache' });
  });

  it('points pnpm at the cloned store and the cloned metadata cache, under the names of pnpm 11 and of the older versions', () => {
    expect(tool('pnpm').environment('/c/pnpm', {}), 'the store directory and the cache directory').toEqual({ pnpm_config_store_dir: '/c/pnpm/store', npm_config_store_dir: '/c/pnpm/store', pnpm_config_cache_dir: '/c/pnpm/cache', npm_config_cache_dir: '/c/pnpm/cache' });
  });

  it.each([
    ['darwin', {}, '/h/Library/Caches/pip'],
    ['linux', {}, '/h/.cache/pip'],
    ['linux', { XDG_CACHE_HOME: '/x' }, '/x/pip'],
    ['darwin', { PIP_CACHE_DIR: '/pc' }, '/pc'],
  ] as const)('finds the pip cache on %s with %j', (platform, env, expected) => {
    expect(tool('pip').parts(host({ platform, env }), facts()), 'the pip cache').toEqual([{ from: expected, to: 'cache' }]);
    expect(tool('pip').environment('/c/pip', {}), 'PIP_CACHE_DIR').toEqual({ PIP_CACHE_DIR: '/c/pip/cache' });
  });

  it('finds the uv cache and sets UV_CACHE_DIR', () => {
    expect(tool('uv').parts(host(), facts()), 'the default').toEqual([{ from: '/h/.cache/uv', to: 'cache' }]);
    expect(tool('uv').parts(host({ env: { UV_CACHE_DIR: '/u' } }), facts()), 'the host setting').toEqual([{ from: '/u', to: 'cache' }]);
    expect(tool('uv').environment('/c/uv', {}), 'the variable').toEqual({ UV_CACHE_DIR: '/c/uv/cache' });
  });

  it.each([
    ['darwin', {}, ['/h/go/pkg/mod', '/h/Library/Caches/go-build']],
    ['linux', {}, ['/h/go/pkg/mod', '/h/.cache/go-build']],
    ['linux', { GOPATH: '/gp:/other', XDG_CACHE_HOME: '/x' }, ['/gp/pkg/mod', '/x/go-build']],
    ['darwin', { GOMODCACHE: '/gm', GOCACHE: '/gc' }, ['/gm', '/gc']],
  ] as const)('finds the Go caches on %s with %j', (platform, env, expected) => {
    expect(tool('go').parts(host({ platform, env }), facts()).map((part) => part.from), 'module cache and build cache').toEqual(expected);
    expect(tool('go').environment('/c/go', {}), 'both variables').toEqual({ GOMODCACHE: '/c/go/mod', GOCACHE: '/c/go/build' });
  });

  it('ignores an empty variable of the host', () => {
    expect(tool('cargo').parts(host({ env: { CARGO_HOME: '' } }), facts())[0]!.from, 'the default home is used').toBe('/h/.cargo/registry/cache');
  });

  it('never names a credential or configuration file as a source, and lists the excluded names', () => {
    const sources = CACHE_TOOLS.flatMap((entry) => entry.parts(host(), facts({ gradleDistribution: 'gradle-1-bin' })).map((part) => part.from));
    for (const name of [...EXCLUDED_FILES, ...EXCLUDED_DIRECTORIES]) expect(sources.some((source) => source.split('/').includes(name)), `no source is or lies below ${name}`).toBe(false);
    expect(EXCLUDED_FILES, 'the names of the design').toEqual(expect.arrayContaining(['settings.xml', 'settings-security.xml', 'gradle.properties', 'credentials', 'credentials.toml', 'config.toml', '.npmrc', '.netrc', '.pypirc', '.git-credentials']));
    expect(EXCLUDED_DIRECTORIES, 'ssh and the Develocity key directories').toEqual(expect.arrayContaining(['.ssh', 'develocity', 'enterprise']));
  });
});

describe('selecting the tools of a check', () => {
  const selected = (patch: Partial<ProjectFacts>): string[] => selectTools(CACHE_TOOLS, facts(patch)).map((entry) => entry.id);

  it('selects by marker files', () => {
    expect(selected({ markers: new Set(['Cargo.toml', 'package.json']) }), 'cargo and npm').toEqual(['cargo', 'npm']);
    expect(selected({ markers: new Set(['pnpm-lock.yaml']) }), 'pnpm').toEqual(['pnpm']);
    expect(selected({ markers: new Set(['build.gradle.kts']) }), 'gradle').toEqual(['gradle']);
    expect(selected({ markers: new Set(['pyproject.toml']) }), 'pip and uv').toEqual(['pip', 'uv']);
  });

  it('selects by the program a command names', () => {
    expect(selected({ words: commandWords([['sh', '-c', './gradlew test && cargo test']]) }), 'a script that names two tools').toEqual(['gradle', 'cargo']);
    expect(selected({ words: commandWords([['/opt/homebrew/bin/mvn', 'verify']]) }), 'a path to a program').toEqual(['maven']);
  });

  it('selects nothing for a project and commands that use no known tool', () => {
    expect(selected({ markers: new Set(['Makefile']), words: commandWords([['make', 'test']]) }), 'make alone').toEqual([]);
  });
});

describe('needsLoopback', () => {
  it('follows the command words only, not the marker files of the checkout', () => {
    expect(needsLoopback(CACHE_TOOLS, facts({ markers: new Set(['build.gradle', 'gradlew']), words: commandWords([['node', 'test.js']]) })), 'Gradle markers and a command that is not Gradle').toBe(false);
    expect(needsLoopback(CACHE_TOOLS, facts({ words: commandWords([['sh', '-c', './gradlew test']]) })), 'a script that runs the wrapper').toBe(true);
    expect(needsLoopback(CACHE_TOOLS, facts({ words: commandWords([['npm', 'test']]) })), 'a tool that does not bind a loopback port').toBe(false);
  });
});

describe('command words', () => {
  it('splits arguments into program names and drops directories', () => {
    const words = commandWords([['sh', '-c', 'cd app && ./gradlew --offline test; pnpm -r run build'], ['/usr/bin/env', 'node']]);
    expect([...words].filter((word) => ['gradlew', 'pnpm', 'node', 'env', 'build'].includes(word)).sort(), 'the programs of the script and the argv').toEqual(['build', 'env', 'gradlew', 'node', 'pnpm']);
  });
});

describe('the Gradle wrapper distribution', () => {
  it.each([
    ['distributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.2-bin.zip', 'gradle-9.8.2-bin'],
    ['distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://example.test/dist/gradle-8.14-all.zip?x=1\n', 'gradle-8.14-all'],
    ['distributionUrl: https://x/gradle-7.6.zip', 'gradle-7.6'],
  ])('reads the name from %j', (properties, expected) => {
    expect(gradleDistributionOf(properties), 'the directory name below wrapper/dists').toBe(expected);
  });

  it.each(['', 'distributionBase=GRADLE_USER_HOME', 'distributionUrl=https\\://x/..zip', 'distributionUrl=https\\://x/.hidden.zip', 'distributionUrl=https\\://x/a b.zip'])('refuses %j', (properties) => {
    expect(gradleDistributionOf(properties), 'no usable name').toBeUndefined();
  });

  it('reads the markers, the commands and the distribution of a checkout', async () => {
    const checkout = tempDir('facts');
    write(join(checkout, 'package.json'), '{}');
    write(join(checkout, 'app', 'Cargo.toml'), '');
    write(join(checkout, 'app', 'deep', 'pom.xml'), '');
    write(join(checkout, 'node_modules', 'x', 'build.gradle'), '');
    write(join(checkout, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://x/gradle-9.8.2-bin.zip\n');
    const project = await readProjectFacts(checkout, [['pnpm', 'test']]);
    expect([...project.markers].sort(), 'files at the root and one level below; not deeper, not in node_modules').toEqual(['Cargo.toml', 'package.json']);
    expect([project.words.has('pnpm'), project.gradleDistribution], 'words and the distribution').toEqual([true, 'gradle-9.8.2-bin']);
  });

  it('does not read a wrapper properties file that is a link or too large', async () => {
    const linked = tempDir('facts-link');
    const target = tempDir('facts-target');
    write(join(target, 'p.properties'), 'distributionUrl=https\\://x/gradle-9.8.2-bin.zip\n');
    write(join(linked, 'gradle', 'wrapper', 'x'), '');
    symlinkSync(join(target, 'p.properties'), join(linked, 'gradle', 'wrapper', 'gradle-wrapper.properties'));
    expect((await readProjectFacts(linked, [])).gradleDistribution, 'a link is not followed').toBeUndefined();
    const large = tempDir('facts-large');
    write(join(large, 'gradle', 'wrapper', 'gradle-wrapper.properties'), `distributionUrl=https\\://x/gradle-9.8.2-bin.zip\n${'#'.repeat(70_000)}`);
    expect((await readProjectFacts(large, [])).gradleDistribution, 'a large file is not read').toBeUndefined();
    expect((await readProjectFacts(join(large, 'missing'), [])).markers.size, 'a missing checkout has no markers').toBe(0);
  });
});
