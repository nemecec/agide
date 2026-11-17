import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileProfileRegistry } from './FileProfileRegistry';
import { FileProfileStore } from './FileProfileStore';
import { profilePaths, registryFile, rootPaths } from './paths';
import { describeProfileRegistryContract, describeProfileStoreContract, TestLiveness } from './profileContracts';
import { REGISTRY_STALE_MS, type ProfileRegistry } from './types';

const roots: string[] = [];
const freshRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'agide-profile-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describeProfileStoreContract('FileProfileStore', (ownerId) => new FileProfileStore({ root: freshRoot(), ownerId }));

describeProfileRegistryContract('FileProfileRegistry', (liveness) => {
  const root = freshRoot();
  const opened: ProfileRegistry[] = [];
  return {
    open: (profileId, pid) => {
      const registry = new FileProfileRegistry({ root, profileId, pid, liveness, pollMs: 100 });
      opened.push(registry);
      return registry;
    },
    cleanup: () => opened.forEach((r) => r.dispose()),
  };
});

const mode = (path: string): number => statSync(path).mode & 0o777;

describe('FileProfileStore on disk', () => {
  it('creates directories with mode 0700 and files with mode 0600', () => {
    const root = freshRoot();
    const store = new FileProfileStore({ root, ownerId: 'work' });
    store.create({ name: 'Work', colour: '#336699' });
    const paths = profilePaths(root, 'work');
    for (const dir of [paths.dir, paths.data, paths.claude, paths.tools.gh]) expect(mode(dir), `${dir} mode`).toBe(0o700);
    for (const file of [paths.definition, paths.settings, paths.tools.gitconfig, paths.tools.sshConfig]) expect(mode(file), `${file} mode`).toBe(0o600);
  });

  it('skips a directory without a valid definition', () => {
    const root = freshRoot();
    const store = new FileProfileStore({ root, ownerId: 'a' });
    store.create({ name: 'A', colour: '#336699' });
    mkdirSync(profilePaths(root, 'half').dir, { recursive: true });
    mkdirSync(profilePaths(root, 'bad').dir, { recursive: true });
    writeFileSync(profilePaths(root, 'bad').definition, '{"schema":1,"id":"other"');
    expect(store.list().map((p) => p.id), 'only the complete profile is listed').toEqual(['a']);
  });

  it('skips a symbolic-linked definition and a definition whose id differs from its directory', () => {
    const root = freshRoot();
    const store = new FileProfileStore({ root, ownerId: 'a' });
    store.create({ name: 'A', colour: '#336699' });
    mkdirSync(profilePaths(root, 'linked').dir, { recursive: true });
    symlinkSync(profilePaths(root, 'a').definition, profilePaths(root, 'linked').definition);
    mkdirSync(profilePaths(root, 'liar').dir, { recursive: true });
    writeFileSync(profilePaths(root, 'liar').definition, readFileSync(profilePaths(root, 'a').definition));
    expect(store.list().map((p) => p.id), 'link and mismatched id are skipped').toEqual(['a']);
  });

  it('gives two concurrent creations of one derived id different ids', () => {
    const root = freshRoot();
    const one = new FileProfileStore({ root, ownerId: 'x' });
    const two = new FileProfileStore({ root, ownerId: 'y' });
    const ids = [one.create({ name: 'Same', colour: '#336699' }).id, two.create({ name: 'Same', colour: '#336699' }).id];
    expect(new Set(ids).size, 'distinct ids').toBe(2);
  });

  it('leaves no directory behind when the input is refused', () => {
    const root = freshRoot();
    const store = new FileProfileStore({ root, ownerId: 'x' });
    expect(() => store.create({ name: 'ok', colour: 'red' }), 'invalid colour').toThrow();
    expect(existsSync(rootPaths(root).profiles) ? readdirSync(rootPaths(root).profiles) : [], 'no claimed directory remains').toEqual([]);
    expect(store.list(), 'nothing listed').toEqual([]);
  });

  it('persists settings changes across store instances and regenerates the git file', () => {
    const root = freshRoot();
    new FileProfileStore({ root, ownerId: 'w' }).create({ name: 'W', colour: '#336699' });
    const again = new FileProfileStore({ root, ownerId: 'w' });
    again.updateSettings('w', { tools: { mode: 'isolated', git: { userName: 'A B', userEmail: 'a@b.test' } } });
    expect(new FileProfileStore({ root, ownerId: 'w' }).readSettings('w').tools, 'stored identity').toMatchObject({ git: { userName: 'A B' } });
    expect(readFileSync(profilePaths(root, 'w').tools.gitconfig, 'utf8'), 'git file has the identity').toContain('email = "a@b.test"');
  });
});

describe('FileProfileRegistry on disk', () => {
  let root: string;
  let liveness: TestLiveness;
  const open: FileProfileRegistry[] = [];
  const registry = (profileId: string, pid: number, extra: { isKnownProfile?: (id: string) => boolean } = {}) => {
    const r = new FileProfileRegistry({ root, profileId, pid, liveness, pollMs: 100, ...extra });
    open.push(r);
    return r;
  };
  beforeEach(() => {
    root = freshRoot();
    liveness = new TestLiveness();
  });
  afterEach(() => open.splice(0).forEach((r) => r.dispose()));

  it('keeps the registry directory at 0700 and entries at 0600', () => {
    registry('a', 1).publish({ unread: 1 });
    expect(mode(rootPaths(root).registry), 'directory mode').toBe(0o700);
    expect(mode(registryFile(root, 'a')), 'entry mode').toBe(0o600);
  });

  it('stores only the fields of the entry, with no content', () => {
    registry('a', 7).publish({ unread: 4 });
    const entry = JSON.parse(readFileSync(registryFile(root, 'a'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(entry).sort(), 'entry fields').toEqual(['instanceId', 'pid', 'profileId', 'schema', 'unread', 'updatedAt']);
  });

  it('replaces the file in place of rewriting it, so a reader holding the old file sees complete content', () => {
    const a = registry('a', 1);
    a.publish({ unread: 1 });
    const hold = join(rootPaths(root).registry, 'hold.copy');
    linkSync(registryFile(root, 'a'), hold);
    a.publish({ unread: 2 });
    expect(JSON.parse(readFileSync(hold, 'utf8')).unread, 'old inode kept its full content').toBe(1);
    expect(JSON.parse(readFileSync(registryFile(root, 'a'), 'utf8')).unread, 'target has the new content').toBe(2);
    expect(readdirSync(rootPaths(root).registry).filter((n) => n.endsWith('.tmp')), 'no temporary file remains').toEqual([]);
  });

  it('ignores temporary files, symbolic links, oversized files, bad content and a file name that differs from the profile id', () => {
    const reader = registry('reader', 9);
    const dir = rootPaths(root).registry;
    const valid = { schema: 1, profileId: 'good', pid: 5, instanceId: 'abcdefgh', updatedAt: liveness.now().toISOString() };
    writeFileSync(join(dir, 'good.json.abc123.tmp'), JSON.stringify(valid));
    writeFileSync(join(dir, 'target.json'), JSON.stringify({ ...valid, profileId: 'target' }));
    symlinkSync(join(dir, 'target.json'), join(dir, 'link.json'));
    writeFileSync(join(dir, 'big.json'), JSON.stringify({ ...valid, profileId: 'big', pad: 'x'.repeat(5000) }));
    writeFileSync(join(dir, 'junk.json'), 'not json');
    writeFileSync(join(dir, 'liar.json'), JSON.stringify({ ...valid, profileId: 'someone' }));
    writeFileSync(join(dir, 'named.json'), JSON.stringify({ ...valid, profileId: 'named', name: 'Secret project' }));
    expect(lstatSync(join(dir, 'link.json')).isSymbolicLink(), 'fixture link').toBe(true);
    expect(reader.statuses().map((s) => s.profileId), 'only the plain valid entry counts').toEqual(['target']);
  });

  it('drops an entry whose profile has no definition', () => {
    const a = registry('a', 1, { isKnownProfile: (id) => id === 'a' });
    registry('ghost', 2).publish({});
    a.publish({});
    expect(a.statuses().map((s) => s.profileId), 'ghost entry dropped').toEqual(['a']);
  });

  it('shows a dead pid and an old entry as not running without deleting the file', () => {
    const a = registry('a', 1);
    const b = registry('b', 2);
    a.publish({});
    b.publish({});
    liveness.dead.add(1);
    expect(b.statuses().find((s) => s.profileId === 'a')?.running, 'dead pid').toBe(false);
    liveness.time += REGISTRY_STALE_MS + 1;
    expect(b.statuses().find((s) => s.profileId === 'b')?.running, 'old entry').toBe(false);
    expect(readdirSync(rootPaths(root).registry).sort(), 'both files remain').toEqual(['a.json', 'b.json']);
  });

  it('writes the own entry again on the heartbeat', async () => {
    const r = new FileProfileRegistry({ root, profileId: 'a', pid: 1, liveness, heartbeatMs: 30, pollMs: 1000 });
    open.push(r);
    r.publish({});
    const first = readFileSync(registryFile(root, 'a'), 'utf8');
    liveness.time += 1000;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(readFileSync(registryFile(root, 'a'), 'utf8'), 'updatedAt moved').not.toBe(first);
  });
});
