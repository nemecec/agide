import { chmodSync, existsSync, lstatSync, statSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDir } from './fsio';
import { ensureProfilesRoot } from './migration';
import { isUnderDataDir, partitionName } from './partition';
import { profilePaths, rootPaths } from './paths';
import { chooseProfile, profileIdFromArgv, readLastProfile, writeLastProfile } from './resolveProfile';
import { defaultSettings } from './schemas';
import { renderGitConfig, renderSshConfig } from './toolFiles';
import { FileProfileStore } from './FileProfileStore';

const roots: string[] = [];
const freshRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'agide-setup-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('milestone 1 migration', () => {
  it('moves the database and session inboxes into the default profile data directory', () => {
    const root = freshRoot();
    writeFileSync(join(root, 'app.db'), 'db');
    writeFileSync(join(root, 'app.db-wal'), 'wal');
    mkdirSync(join(root, 'session-events', 's1'), { recursive: true });
    writeFileSync(join(root, 'session-events', 's1', 'e.json'), '{}');
    expect(ensureProfilesRoot({ root, env: {} }).status, 'migration result').toBe('ready');
    const data = profilePaths(root, 'default').data;
    expect(readFileSync(join(data, 'app.db'), 'utf8'), 'database moved').toBe('db');
    expect(existsSync(join(data, 'session-events', 's1', 'e.json')), 'inbox moved').toBe(true);
    expect(existsSync(join(root, 'app.db')), 'source removed after the rename').toBe(false);
    expect(existsSync(rootPaths(root).migrateLock), 'lock removed').toBe(false);
    expect(existsSync(rootPaths(root).migrating), 'staging directory renamed away').toBe(false);
    expect(new FileProfileStore({ root, ownerId: 'default' }).list().map((p) => p.id), 'default profile listed').toEqual(['default']);
  });

  it('keeps a CLAUDE_CONFIG_DIR of the environment as the default login and otherwise the CLI default', () => {
    const withDir = freshRoot();
    ensureProfilesRoot({ root: withDir, env: { CLAUDE_CONFIG_DIR: '/cfg' } });
    expect(new FileProfileStore({ root: withDir, ownerId: 'default' }).readSettings('default').claudeConfig, 'stored directory').toEqual({ mode: 'directory', path: '/cfg' });
    const without = freshRoot();
    ensureProfilesRoot({ root: without, env: {} });
    expect(new FileProfileStore({ root: without, ownerId: 'default' }).readSettings('default').claudeConfig, 'CLI default').toEqual({ mode: 'cli-default' });
  });

  it('does nothing when profiles exist', () => {
    const root = freshRoot();
    mkdirSync(rootPaths(root).profiles);
    writeFileSync(join(root, 'app.db'), 'db');
    ensureProfilesRoot({ root, env: {} });
    expect(existsSync(join(root, 'app.db')), 'files left alone').toBe(true);
  });

  it('takes over the lock of a dead pid and restarts from a cleared staging directory', () => {
    const root = freshRoot();
    const paths = rootPaths(root);
    writeFileSync(paths.migrateLock, '999999');
    mkdirSync(join(paths.migrating, 'junk'), { recursive: true });
    ensureProfilesRoot({ root, env: {}, isAlive: (pid) => pid !== 999999 });
    expect(readdirSync(paths.profiles), 'only the default profile').toEqual(['default']);
  });

  it('puts back a lock that a live process created while a stale one was being taken over', () => {
    const root = freshRoot();
    const lock = rootPaths(root).migrateLock;
    writeFileSync(lock, '999999');
    const isAlive = (pid: number): boolean => {
      if (pid === 999999) {
        rmSync(lock);
        writeFileSync(lock, '4242');
        return false;
      }
      return true;
    };
    expect(() => ensureProfilesRoot({ root, env: {}, isAlive, waitMs: 150 }), 'the live holder keeps the lock').toThrow('did not finish');
    expect(readFileSync(lock, 'utf8'), 'the live process lock is still there').toBe('4242');
    expect(existsSync(rootPaths(root).profiles), 'no second migration ran').toBe(false);
  });

  it('moves the browser partitions of milestone 1 into the default profile', () => {
    const root = freshRoot();
    mkdirSync(join(root, 'Partitions', 'github'), { recursive: true });
    writeFileSync(join(root, 'Partitions', 'github', 'Cookies'), 'c');
    ensureProfilesRoot({ root, env: {} });
    expect(readFileSync(join(profilePaths(root, 'default').data, 'Partitions', 'github', 'Cookies'), 'utf8'), 'partition kept').toBe('c');
  });

  it('waits for a live lock holder and then times out', () => {
    const root = freshRoot();
    writeFileSync(rootPaths(root).migrateLock, '4242');
    expect(() => ensureProfilesRoot({ root, env: {}, isAlive: () => true, waitMs: 150 }), 'live holder never finishes').toThrow('did not finish');
  });

  it('reports a milestone 1 process that holds the root', () => {
    const root = freshRoot();
    symlinkSync('host-4242', join(root, 'SingletonLock'));
    expect(lstatSync(join(root, 'SingletonLock')).isSymbolicLink(), 'fixture').toBe(true);
    expect(ensureProfilesRoot({ root, env: {}, isAlive: () => true }).status, 'busy root').toBe('busy');
    expect(existsSync(rootPaths(root).profiles), 'nothing migrated').toBe(false);
  });

  it('migrates once when two processes start at the same time', () => {
    const root = freshRoot();
    writeFileSync(join(root, 'app.db'), 'db');
    const first = ensureProfilesRoot({ root, env: {} });
    const second = ensureProfilesRoot({ root, env: {} });
    expect([first.status, second.status], 'both ready').toEqual(['ready', 'ready']);
    expect(readFileSync(join(profilePaths(root, 'default').data, 'app.db'), 'utf8'), 'data kept').toBe('db');
  });
});

describe('profile selection', () => {
  const exists = (id: string): boolean => ['default', 'work'].includes(id);
  it('reads --profile in both forms', () => {
    expect(profileIdFromArgv(['x', '--profile=work']), 'equals form').toBe('work');
    expect(profileIdFromArgv(['x', '--profile', 'work']), 'separate form').toBe('work');
    expect(profileIdFromArgv(['x']), 'absent').toBeUndefined();
  });

  it('prefers the argument, then AGIDE_PROFILE, then the last profile, then default', () => {
    const root = freshRoot();
    expect(chooseProfile({ argv: [], env: {}, root, exists }).id, 'nothing set').toBe('default');
    writeLastProfile(root, 'work');
    expect(readLastProfile(root), 'last profile stored').toBe('work');
    expect(chooseProfile({ argv: [], env: {}, root, exists }).id, 'last profile').toBe('work');
    expect(chooseProfile({ argv: [], env: { AGIDE_PROFILE: 'default' }, root, exists }).id, 'environment beats last').toBe('default');
    expect(chooseProfile({ argv: ['--profile=work'], env: { AGIDE_PROFILE: 'default' }, root, exists }).id, 'argument beats environment').toBe('work');
  });

  it('opens default with a notice for an unknown or malformed id', () => {
    const root = freshRoot();
    for (const bad of ['nope', '../x']) {
      const choice = chooseProfile({ argv: [`--profile=${bad}`], env: {}, root, exists });
      expect(choice.id, `${bad} falls back`).toBe('default');
      expect(choice.notice, `${bad} gives a notice`).toContain('does not exist');
    }
  });
});

describe('generated tool files', () => {
  const paths = profilePaths('/r', 'w');
  const settings = (tools: object) => ({ ...defaultSettings({ isDefaultProfile: false, claudeConfigDir: paths.claude }), tools }) as never;

  it('makes git refuse to commit without an identity and clears credential helpers', () => {
    const text = renderGitConfig(settings({ mode: 'isolated' }), paths);
    expect(text, 'useConfigOnly').toContain('useConfigOnly = true');
    expect(text, 'no name line before the identity is known').not.toContain('name =');
    expect(text, 'empty helper entry first').toMatch(/helper =\n\thelper = !gh auth git-credential/);
    expect(text, 'ssh through the profile file').toContain(`ssh -F '/r/profiles/w/tools/ssh_config'`);
  });

  it('escapes quotes in the identity and refuses control characters', () => {
    const git = (userName: string) => settings({ mode: 'isolated', git: { userName, userEmail: 'a@b.test' } });
    expect(renderGitConfig(git('A "B"'), paths), 'quote escaped').toContain('name = "A \\"B\\""');
    expect(() => renderGitConfig(git('A\nB'), paths), 'newline refused').toThrow('control character');
  });

  it('offers no key when none is configured and only the named key otherwise', () => {
    const none = renderSshConfig(settings({ mode: 'isolated' }), paths);
    expect(none, 'no agent').toContain('IdentityAgent none');
    expect(none, 'identity file that does not exist inside the profile').toContain('/r/profiles/w/tools/no-identity');
    expect(none, 'only configured identities').toContain('IdentitiesOnly yes');
    const keyed = renderSshConfig(settings({ mode: 'isolated', ssh: { agentSocket: '/s', publicKeyFile: '/k.pub' } }), paths);
    expect(keyed, 'agent socket').toContain('IdentityAgent "/s"');
    expect(keyed, 'key file').toContain('IdentityFile "/k.pub"');
  });
});

describe('partition naming', () => {
  it('names partitions per service without a profile id', () => {
    expect(partitionName('jira'), 'service partition').toBe('persist:jira');
    expect(() => partitionName('Bad Name'), 'invalid name').toThrow();
  });
  it('tells whether a storage path lies under the data directory', () => {
    expect(isUnderDataDir('/d/Partitions/jira', '/d'), 'inside').toBe(true);
    expect(isUnderDataDir('/d/../x', '/d'), 'escape').toBe(false);
    expect(isUnderDataDir('/d', '/d'), 'the directory itself').toBe(false);
    expect(isUnderDataDir('/dd/x', '/d'), 'sibling with the same prefix').toBe(false);
  });
});

describe('directories that exist with a wider mode', () => {
  it('tightens a directory to 0700 when it is ensured', () => {
    const dir = join(freshRoot(), 'wide');
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    ensureDir(dir);
    expect(statSync(dir).mode & 0o777, 'mode after ensureDir').toBe(0o700);
  });
});
