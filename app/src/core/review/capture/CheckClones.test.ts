import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statfsSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APFS_TYPE, CheckClones, cloneCommand, CloneError, cloneRefusal, cloneWithCp, filesystemOf, probeCloneable, prune, removeTree, type CloneFunction, type CloneRequest } from './CheckClones';
import type { CacheTool, ProjectFacts } from './cacheTools';
import { removeTempDirs, tempDir, write } from './gitFixtures';

afterEach(() => removeTempDirs());

const copy: CloneFunction = async (source, destination) => cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
const never = new AbortController().signal;

const project = (markers: string[] = ['package.json'], words: string[] = []): ProjectFacts => ({ markers: new Set(markers), words: new Set(words) });

interface Rig {
  readonly home: string;
  readonly root: string;
  readonly clones: CheckClones;
  readonly calls: { source: string; destination: string }[];
  request(patch?: Partial<CloneRequest>, facts?: ProjectFacts): CloneRequest;
}

function rig(options: { clone?: CloneFunction; tools?: readonly CacheTool[]; maxFiles?: number; maxMilliseconds?: number; probe?: (source: string) => Promise<string | undefined>; deviceOf?: (path: string) => Promise<number> } = {}): Rig {
  const home = tempDir('clones-home');
  write(join(home, '.npm', '_cacache', 'content', 'entry'), 'cached\n');
  const root = join(tempDir('clones-root'), 'clones');
  const calls: Rig['calls'] = [];
  const clones = new CheckClones({
    root,
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    limits: { ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }), ...(options.maxMilliseconds === undefined ? {} : { maxMilliseconds: options.maxMilliseconds }) },
    clone: async (source, destination, signal) => {
      calls.push({ source, destination });
      await (options.clone ?? copy)(source, destination, signal);
    },
    probe: async (source) => options.probe?.(source),
    ...(options.deviceOf === undefined ? {} : { deviceOf: options.deviceOf }),
    platform: 'darwin',
  });
  return { home, root, clones, calls, request: (patch = {}, facts = project()) => ({ host: { home, env: {} }, project: facts, current: { PATH: '/bin' }, signal: never, ...patch }) };
}

describe('creating the clones of a run', () => {
  it('clones the cache subtree of a selected tool into the directory of the run and points the tool at it', async () => {
    const r = rig();
    const run = await r.clones.create('chk_one', r.request());
    expect(run.directory, 'the directory of the run is below the root').toBe(join(r.root, 'chk_one'));
    expect(run.tools, 'npm was selected by package.json').toEqual(['npm']);
    expect(readFileSync(join(run.directory, 'npm', '_cacache', 'content', 'entry'), 'utf8'), 'the clone holds the cache').toBe('cached\n');
    expect(run.environment, 'npm is pointed at its clone').toEqual({ npm_config_cache: join(run.directory, 'npm') });
    expect(run.files, 'the files of the clone are counted').toBe(1);
    expect(r.calls.map((call) => call.source), 'the clone function got the real cache').toEqual([join(realpathSync(r.home), '.npm', '_cacache')]);
  });

  it('gives every run a directory of its own, so the checkpoint run and the base run share nothing', async () => {
    const r = rig();
    const first = await r.clones.create('chk_a', r.request());
    const second = await r.clones.create('chk_b', r.request());
    expect(first.directory === second.directory, 'two directories').toBe(false);
    writeFileSync(join(first.directory, 'npm', '_cacache', 'content', 'entry'), 'poisoned\n');
    writeFileSync(join(first.directory, 'npm', '.npmrc'), 'script-shell=evil\n');
    expect(readFileSync(join(second.directory, 'npm', '_cacache', 'content', 'entry'), 'utf8'), 'a write in one clone does not reach the other').toBe('cached\n');
    expect(existsSync(join(second.directory, 'npm', '.npmrc')), 'nor a new file').toBe(false);
    expect(readFileSync(join(r.home, '.npm', '_cacache', 'content', 'entry'), 'utf8'), 'nor the real cache').toBe('cached\n');
  });

  it('selects no tool and clones nothing for a project that uses none', async () => {
    const r = rig();
    const run = await r.clones.create('chk_none', r.request({}, project(['README.md'])));
    expect([run.tools, run.environment, run.files, r.calls], 'nothing selected, nothing cloned').toEqual([[], {}, 0, []]);
    expect(existsSync(run.directory), 'the directory of the run exists, since it is the writable place').toBe(true);
  });

  it('starts a tool with an empty clone directory when the real cache does not exist', async () => {
    const r = rig();
    const run = await r.clones.create('chk_cargo', r.request({}, project(['Cargo.toml'])));
    expect(run.tools, 'cargo was selected').toEqual(['cargo']);
    expect(readdirSync(join(run.directory, 'cargo')), 'its directory is empty').toEqual([]);
    expect(run.environment['CARGO_HOME'], 'and CARGO_HOME points at it').toBe(join(run.directory, 'cargo'));
    expect(r.calls, 'nothing was cloned').toEqual([]);
  });

  it('does not fail the run when the directory cannot be removed, and leaves it to the sweep', async () => {
    const root = join(tempDir('clones-stuck'), 'clones');
    let stuck = true;
    const clones = new CheckClones({ root, clone: copy, probe: async () => undefined, removeTree: async (path) => (stuck ? Promise.reject(new Error('directory not empty')) : removeTree(path)) });
    const run = await clones.create('chk_stuck', { host: { home: tempDir('clones-home2'), env: {} }, project: project(['README.md']), current: {}, signal: never });
    await expect(run.remove(), 'the run is not failed by a directory that stays').resolves.toBeUndefined();
    expect(existsSync(run.directory), 'the directory stays').toBe(true);
    stuck = false;
    await clones.sweep();
    expect(existsSync(run.directory), 'the next sweep removes it').toBe(false);
  });

  it('removes its directory, and a second remove is harmless', async () => {
    const r = rig();
    const run = await r.clones.create('chk_gone', r.request());
    await run.remove();
    expect(existsSync(run.directory), 'the directory is gone').toBe(false);
    await expect(run.remove(), 'a second remove').resolves.toBeUndefined();
  });

  it('clones from the real directory that a link leads to', async () => {
    const r = rig();
    const target = tempDir('clones-elsewhere');
    write(join(target, '_cacache', 'entry'), 'elsewhere\n');
    const linked = tempDir('clones-linkhome');
    symlinkSync(target, join(linked, '.npm'));
    await r.clones.create('chk_link', r.request({ host: { home: linked, env: {} } }));
    expect(r.calls[0]!.source, 'the clone starts from the resolved path, not from the link').toBe(join(realpathSync(target), '_cacache'));
  });
});

describe('what a clone holds', () => {
  const plant = (home: string): void => {
    const cache = join(home, '.npm', '_cacache');
    write(join(cache, 'keep', 'file'), 'keep\n');
    for (const name of ['settings.xml', 'settings-security.xml', 'gradle.properties', 'credentials', 'credentials.toml', 'config.toml', 'keys.properties', '.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '.pypirc', '.git-credentials']) write(join(cache, 'deep', name), 'secret-shaped content is never needed\n');
    for (const name of ['.ssh', '.gnupg', 'develocity', 'enterprise']) write(join(cache, 'deep', name, 'key'), 'x\n');
    const outside = tempDir('clones-outside');
    write(join(outside, 'real'), 'outside\n');
    symlinkSync(outside, join(cache, 'link-to-directory'));
    symlinkSync(join(outside, 'real'), join(cache, 'link-to-file'));
    execFileSync('mkfifo', [join(cache, 'a-pipe')]);
  };

  it('never contains an excluded file or directory, a link or a special file', async () => {
    const r = rig();
    plant(r.home);
    const run = await r.clones.create('chk_clean', r.request());
    const left: string[] = [];
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        left.push(path.slice(run.directory.length + 1));
        if (lstatSync(path).isDirectory()) walk(path);
      }
    };
    walk(run.directory);
    expect(left.sort(), 'only the plain files and the directories that hold them').toEqual(['npm', 'npm/_cacache', 'npm/_cacache/content', 'npm/_cacache/content/entry', 'npm/_cacache/deep', 'npm/_cacache/keep', 'npm/_cacache/keep/file']);
    expect(run.files, 'the count is the files that remain').toBe(2);
  });

  it('prunes a tree in place and counts what remains', async () => {
    const dir = tempDir('prune');
    write(join(dir, 'a', 'settings.xml'), 'x');
    write(join(dir, 'a', 'b.jar'), 'x');
    write(join(dir, 'c.jar'), 'x');
    expect(await prune(dir), 'two jars remain').toBe(2);
    expect(existsSync(join(dir, 'a', 'settings.xml')), 'the settings file is gone').toBe(false);
  });

  it('removes a tree with read-only directories, as a Go module cache has', async () => {
    const dir = tempDir('readonly');
    write(join(dir, 'mod', 'inner', 'f'), 'x');
    chmodSync(join(dir, 'mod', 'inner', 'f'), 0o444);
    chmodSync(join(dir, 'mod', 'inner'), 0o555);
    chmodSync(join(dir, 'mod'), 0o555);
    await removeTree(join(dir, 'mod'));
    expect(existsSync(join(dir, 'mod')), 'the tree is gone').toBe(false);
  });
});

describe('when a clone cannot be made', () => {
  it('rejects with the clone error and removes the directory, with no copy instead', async () => {
    const r = rig({
      clone: async () => {
        throw new CloneError('cp could not clone: cross-device');
      },
    });
    await expect(r.clones.create('chk_fail', r.request()), 'the error reaches the caller').rejects.toThrow('cp could not clone: cross-device');
    expect(existsSync(join(r.root, 'chk_fail')), 'the partial directory is gone').toBe(false);
  });

  it('wraps an unexpected error', async () => {
    const r = rig({
      clone: async () => {
        throw new Error('disk full');
      },
    });
    await expect(r.clones.create('chk_full', r.request()), 'the cause is named').rejects.toThrow('the cache clone failed: disk full');
  });

  it('refuses a cache on another volume without calling the clone function', async () => {
    const r = rig({ probe: async (source) => `${source}: it is on another volume than the clone directory` });
    await expect(r.clones.create('chk_volume', r.request()), 'the reason names the tool').rejects.toThrow(/the npm cache cannot be cloned: .*another volume/);
    expect(r.calls, 'nothing was cloned').toEqual([]);
    expect(existsSync(join(r.root, 'chk_volume')), 'the directory is gone').toBe(false);
  });

  it('refuses a cache that holds another volume below its root, which cp -c would copy, without calling the clone function', async () => {
    const r = rig({ deviceOf: async (path) => (path.endsWith(join('content', 'mounted')) ? 99 : 1) });
    write(join(r.home, '.npm', '_cacache', 'content', 'mounted', 'inner', 'file'), 'x');
    await expect(r.clones.create('chk_nested', r.request()), 'the reason names the tool and the mount point below the cache').rejects.toThrow(/the npm cache holds another volume below it \(content\/mounted\)/);
    expect(r.calls, 'nothing was cloned').toEqual([]);
    expect(existsSync(join(r.root, 'chk_nested')), 'the directory is gone').toBe(false);
  });

  it('clones a cache whose directories are all on the device of its root', async () => {
    const r = rig({ deviceOf: async () => 7 });
    write(join(r.home, '.npm', '_cacache', 'content', 'deeper', 'file'), 'x');
    const made = await r.clones.create('chk_one_volume', r.request());
    expect(made.tools, 'the npm cache was cloned').toEqual(['npm']);
  });

  it('refuses a cache over the file limit without calling the clone function', async () => {
    const r = rig({ maxFiles: 2 });
    for (const name of ['a', 'b', 'c']) write(join(r.home, '.npm', '_cacache', 'many', name), name);
    await expect(r.clones.create('chk_big', r.request()), 'the limit is named').rejects.toThrow(/too large to clone \(more than 2 files\)/);
    expect(r.calls, 'nothing was cloned').toEqual([]);
  });

  it('gives up after the time limit', async () => {
    const r = rig({ maxMilliseconds: 50, clone: (_source, _destination, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
    await expect(r.clones.create('chk_slow', r.request()), 'the limit is named').rejects.toThrow('the caches were not cloned within 50 ms');
    expect(existsSync(join(r.root, 'chk_slow')), 'the directory is gone').toBe(false);
  });

  it('stops when the check is cancelled during the clone', async () => {
    const controller = new AbortController();
    const r = rig({
      clone: (_source, _destination, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
          controller.abort();
        }),
    });
    await expect(r.clones.create('chk_cancel', r.request({ signal: controller.signal })), 'the cancel is named').rejects.toThrow('cancelled while its caches were cloned');
  });

  it('does not start a clone after a cancel that came earlier', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = rig();
    await expect(r.clones.create('chk_early', r.request({ signal: controller.signal })), 'a cancelled run').rejects.toThrow('cancelled');
    expect(r.calls, 'nothing was cloned').toEqual([]);
  });
});

describe('the sweep at start', () => {
  it('removes what a killed app left in the root and keeps the directory of a live run', async () => {
    const r = rig();
    write(join(r.root, 'chk_old', 'npm', '_cacache', 'entry'), 'left\n');
    write(join(r.root, 'stray-file'), 'x');
    const live = await r.clones.create('chk_live', r.request());
    await r.clones.sweep();
    expect(readdirSync(r.root).sort(), 'only the live run remains').toEqual(['chk_live']);
    await live.remove();
    await r.clones.sweep();
    expect(readdirSync(r.root), 'nothing remains').toEqual([]);
  });

  it('does nothing when the root does not exist', async () => {
    const r = rig();
    await expect(r.clones.sweep(), 'no root, no error').resolves.toBeUndefined();
  });
});

describe('the clone call', () => {
  it('names the program per platform and has none for the others', () => {
    expect(cloneCommand('darwin', '/a', '/b'), 'macOS clones with cp -c').toEqual({ file: '/bin/cp', args: ['-cR', '--', '/a', '/b'] });
    expect(cloneCommand('linux', '/a', '/b'), 'Linux demands a reflink').toEqual({ file: 'cp', args: ['-R', '--reflink=always', '--', '/a', '/b'] });
    expect(cloneCommand('win32', '/a', '/b'), 'no clone elsewhere').toBeUndefined();
  });

  const one = { sourceDevice: 1, destinationDevice: 1, sourceFilesystem: '/dev/disk3s5', destinationFilesystem: '/dev/disk3s5' };

  it.each([
    [{ ...one, destinationDevice: 2, platform: 'darwin', destinationType: APFS_TYPE }, 'another volume'],
    [{ ...one, platform: 'darwin', destinationType: 25 }, 'not APFS'],
    [{ ...one, sourceFilesystem: '/dev/disk3s1s1', platform: 'darwin', destinationType: APFS_TYPE }, 'another volume'],
  ] as const)('refuses %j', (facts, why) => {
    expect(cloneRefusal(facts), 'the reason; the last case is the sealed system volume that reports the device number of the data volume').toContain(why);
  });

  it('accepts one APFS volume, and any volume type on other platforms when the device is the same', () => {
    expect(cloneRefusal({ ...one, platform: 'darwin', destinationType: APFS_TYPE }), 'APFS on macOS').toBeUndefined();
    expect(cloneRefusal({ ...one, platform: 'linux', destinationType: 0 }), 'one device on Linux').toBeUndefined();
  });

  it('reads the filesystem of a path from df and fails closed when it cannot', async () => {
    const dir = tempDir('df-probe');
    expect(await filesystemOf(dir), 'two paths of one directory name one filesystem').toBe(await filesystemOf(join(dir, '.')));
    await expect(filesystemOf(join(dir, 'missing')), 'a missing path is no answer').rejects.toBeInstanceOf(CloneError);
  });

  it.skipIf(process.platform !== 'darwin')('refuses a cache on the sealed system volume although its device number equals the data volume', async () => {
    const data = tempDir('probe-data');
    const system = '/usr/share/man';
    const same = statSync(system).dev === statSync(data).dev;
    const refusal = await probeCloneable(system, data);
    // Where the two volumes report different device numbers the first rule refuses; where they report the same, the filesystem name does.
    expect(refusal, `the system volume is not the data volume (device numbers equal: ${same})`).toContain('another volume');
  });

  it('fails when the source does not exist, without a copy', async () => {
    const dir = tempDir('clone-missing');
    await expect(cloneWithCp(join(dir, 'missing'), join(dir, 'to'), never), 'cp fails').rejects.toBeInstanceOf(CloneError);
    expect(existsSync(join(dir, 'to')), 'nothing was made').toBe(false);
  });

  it('refuses a cache on this machine only when the volumes differ', async () => {
    const a = tempDir('probe-a');
    const b = tempDir('probe-b');
    const refusal = await probeCloneable(a, b);
    const apfs = process.platform !== 'darwin' || statfsSync(b).type === APFS_TYPE;
    expect(refusal === undefined, 'two temporary directories share a volume; macOS needs APFS for them').toBe(apfs);
  });

  it.skipIf(process.platform !== 'darwin' || statfsSync(tempDir('apfs-check')).type !== APFS_TYPE)('clones a tree with the real cp on APFS and leaves the source untouched', async () => {
    const dir = tempDir('clone-real');
    write(join(dir, 'src', 'sub', 'file'), 'content\n');
    const before = statSync(join(dir, 'src', 'sub', 'file')).mtimeMs;
    await cloneWithCp(join(dir, 'src'), join(dir, 'dst'), never);
    writeFileSync(join(dir, 'dst', 'sub', 'file'), 'changed\n');
    expect(readFileSync(join(dir, 'src', 'sub', 'file'), 'utf8'), 'a write to the clone leaves the source alone').toBe('content\n');
    expect(statSync(join(dir, 'src', 'sub', 'file')).mtimeMs, 'and its time').toBe(before);
  });
});
