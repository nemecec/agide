import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import * as pty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWritableRegistry, agentWritableDirectories, defaultClaudePaths, claudeTempDir, MEMORY_RETRY_MS, sessionWriteAllowances, srtDefaultWritePaths, type AgentWritableMemory } from './agentWritable';
import { ContainerProvider } from './ContainerProvider';
import { HostTools, INCOMPLETE_FIX } from './hostTools';
import { LocalProvider } from './LocalProvider';
import { createProfileHostTools } from './profileHostTools';
import { SrtProvider } from './SrtProvider';
import { resolveCheckEnvironment } from '../review/capture/checkEnvironment';
import { isWithinAny } from './hostLaunch';
import { AGENT_WRITABLE_MODULE, AgentWritableStore } from './agentWritableStore';
import { buildSrtSettings } from './srtSettings';
import { migrate, openStore } from '../store/Store';

const base = { writeDirs: ['/work/project', '/work/inbox'], claudeConfigDir: '/data/claude', home: '/home/u', uid: 501, platform: 'darwin' as const };

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-writable-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sessionWriteAllowances', () => {
  it('holds the launch directories, the Claude configuration, the CLI temp directory and the extra write paths, in this order', () => {
    expect(sessionWriteAllowances({ ...base, extraWritePaths: ['/cache'] }), 'the parts of the allowance').toEqual(['/work/project', '/work/inbox', '/data/claude', '/private/tmp/claude-501', '/cache']);
  });

  it('names the default login files when the profile has no Claude configuration directory', () => {
    expect(sessionWriteAllowances({ ...base, claudeConfigDir: undefined }), 'the CLI default').toEqual(expect.arrayContaining(['/home/u/.claude', '/home/u/.claude.json']));
    expect(claudeTempDir(7, 'linux'), 'the Linux temp directory').toBe('/tmp/claude-7');
  });
});

describe('srtDefaultWritePaths', () => {
  it('names what srt makes writable whatever its settings say: /tmp/claude, /private/tmp/claude, ~/.npm/_logs and ~/.claude/debug (sandbox-utils.js of 0.0.83)', () => {
    expect(srtDefaultWritePaths('/home/u'), 'SANDBOX_OWN_WRITE_PATHS and HOME_CONVENIENCE_WRITE_DIRS').toEqual(['/tmp/claude', '/private/tmp/claude', '/home/u/.npm/_logs', '/home/u/.claude/debug']);
  });
});

describe('agentWritableDirectories', () => {
  it('always holds the Claude configuration of the default login, also for a profile with a directory of its own', () => {
    expect(agentWritableDirectories(base), 'the directory and the file beside it').toEqual(expect.arrayContaining(['/home/u/.claude', '/home/u/.claude.json', '/data/claude']));
  });

  it('adds the defaults of srt and the roots of the agents to the allowances of a session', () => {
    const set = agentWritableDirectories({ ...base, extraWritePaths: ['/cache'], agentRoots: ['/home/u/Agide'] });
    expect(set, 'allowances, srt defaults, agent roots').toEqual(expect.arrayContaining(['/work/project', '/data/claude', '/private/tmp/claude-501', '/cache', '/tmp/claude', '/private/tmp/claude', '/home/u/.npm/_logs', '/home/u/.claude/debug', '/home/u/Agide']));
  });

  it('holds every path that buildSrtSettings lets a session write, in both spellings, so the settings and the host-side lookup cannot drift', () => {
    mkdirSync(join(dir, 'real', 'work'), { recursive: true });
    symlinkSync(join(dir, 'real'), join(dir, 'linked'));
    const input = { writeDirs: [join(dir, 'linked', 'work')], claudeConfigDir: join(dir, 'claude'), extraWritePaths: [join(dir, 'cache')], home: dir, uid: 501, platform: 'darwin' as const };
    const set = agentWritableDirectories(input);
    const { allowWrite } = buildSrtSettings({ ...input, network: { mode: 'unrestricted' } }).filesystem;
    expect(allowWrite.length, 'the settings allow something').toBeGreaterThan(0);
    for (const path of allowWrite) expect(isWithinAny(path, set), `${path} is allowed by the settings and excluded from the host-side lookup`).toBe(true);
    expect(allowWrite, 'the link and its target are both allowed').toEqual(expect.arrayContaining([join(dir, 'linked', 'work'), join(dir, 'real', 'work')]));
  });

  it('holds the default login directory when the profile names none', () => {
    const input = { writeDirs: [], claudeConfigDir: undefined, home: dir, uid: 501, platform: 'darwin' as const };
    const set = agentWritableDirectories(input);
    for (const path of buildSrtSettings({ ...input, network: { mode: 'unrestricted' } }).filesystem.allowWrite) expect(isWithinAny(path, set), `${path} is excluded`).toBe(true);
  });

  it('lists a directory once', () => {
    const set = agentWritableDirectories({ ...base, writeDirs: ['/data/claude', '/data/claude'], agentRoots: ['/data/claude'] });
    expect(set.filter((path) => path === '/data/claude'), 'one entry').toHaveLength(1);
  });
});

describe('AgentWritableRegistry', () => {
  const source = { claudeConfigDir: '/data/claude', home: '/home/u', uid: 501, platform: 'darwin' as const };

  it('holds what its source says before anything is added: the allowances, the defaults of srt and the roots', () => {
    const registry = new AgentWritableRegistry(() => ({ ...source, extraWritePaths: ['/cache'], agentRoots: ['/home/u/Agide'] }));
    expect(registry.directories(), 'the set of a profile without a launch').toEqual(expect.arrayContaining(['/data/claude', '/cache', '/home/u/Agide', '/tmp/claude', '/home/u/.npm/_logs']));
  });

  it('holds every directory that was added, made absolute, and ignores an undefined and an empty one', () => {
    const registry = new AgentWritableRegistry(() => source);
    registry.add(['/work/outside', undefined, '', 'relative/dir']);
    const set = registry.directories();
    expect(set, 'the added directory').toContain('/work/outside');
    expect(set, 'a relative one against the working directory of the app').toContain(join(process.cwd(), 'relative', 'dir'));
    expect(set.filter((path) => path === process.cwd() || path === ''), 'nothing for the undefined and the empty entry').toEqual([]);
    expect(set.filter((path) => !isAbsolute(path)), 'no entry is relative').toEqual([]);
  });

  it('never removes a directory: the set only grows during the life of the process', () => {
    const registry = new AgentWritableRegistry(() => source);
    registry.add(['/work/a']);
    registry.add(['/work/b']);
    expect(registry.directories(), 'both directories stay').toEqual(expect.arrayContaining(['/work/a', '/work/b']));
  });

  it('reads its source once per turn of the event loop, so a new entry applies at the next lookup, and keeps an entry that the profile no longer names', async () => {
    let extra = ['/cache/one'];
    let claude = '/data/claude';
    let roots = ['/base/one'];
    const registry = new AgentWritableRegistry(() => ({ ...source, claudeConfigDir: claude, extraWritePaths: extra, agentRoots: roots }));
    registry.add(['/work/a']);
    expect(registry.directories(), 'the first values').toEqual(expect.arrayContaining(['/cache/one', '/data/claude', '/base/one']));
    extra = ['/cache/two'];
    claude = '/data/other-claude';
    roots = ['/base/two'];
    expect(registry.directories(), 'within the same turn the source is not read again').not.toContain('/cache/two');
    await Promise.resolve();
    expect(registry.directories(), 'the new values join the set, and the first values and the added directory stay: an agent may have planted a program there').toEqual(expect.arrayContaining(['/cache/one', '/cache/two', '/data/claude', '/data/other-claude', '/base/one', '/base/two', '/work/a']));
  });

  it('has the Claude directory of the CLI default and nothing from a launch when it is built without a source', () => {
    expect(new AgentWritableRegistry().directories(), 'the default login directory and the defaults of srt').toEqual(expect.arrayContaining([join(homedir(), '.claude'), '/tmp/claude']));
  });
});

describe('AgentWritableRegistry with the profile database', () => {
  const source = { claudeConfigDir: '/data/claude', home: '/home/u', uid: 501, platform: 'darwin' as const };
  const database = (): string => join(dir, 'app.db');

  /** One start of the profile process: a registry over the database file, with the options of that start. */
  const start = <T>(options: { extraWritePaths?: string[]; agentRoots?: string[] }, run: (registry: AgentWritableRegistry) => T): T => {
    const db = openStore(database());
    try {
      return run(new AgentWritableRegistry(() => ({ ...source, ...options }), new AgentWritableStore(db)));
    } finally {
      db.close();
    }
  };

  it('keeps a launch directory, an extra write path and a task base across a restart in which the profile names none of them', () => {
    start({ extraWritePaths: ['/cache/removed'], agentRoots: ['/base/first'] }, (registry) => {
      registry.add(['/outside/workspace']);
      registry.directories();
    });
    const after = start({ agentRoots: ['/base/second'] }, (registry) => registry.directories());
    expect(after, 'the workspace of a closed session, the removed entry and the earlier task base are still in the set').toEqual(expect.arrayContaining(['/outside/workspace', '/cache/removed', '/base/first', '/base/second']));
  });

  it('records each directory once and adds rows only', () => {
    const db = openStore(database());
    try {
      const store = new AgentWritableStore(db);
      const registry = new AgentWritableRegistry(() => source, store);
      registry.add(['/w/a', '/w/a']);
      registry.add(['/w/a', '/w/b']);
      registry.directories();
      registry.directories();
      const rows = store.load();
      expect(rows.filter((path) => path === '/w/a'), 'one row for a directory added twice').toHaveLength(1);
      expect(rows, 'what the source said is recorded as well').toEqual(expect.arrayContaining(['/w/a', '/w/b', '/data/claude', ...defaultClaudePaths('/home/u')]));
    } finally {
      db.close();
    }
  });

  it('adds its table to a database that a build without it made, and keeps the tables that are there', () => {
    const db = openStore(database());
    migrate(db, 'session', [{ version: 1, sql: 'CREATE TABLE sessions (id TEXT PRIMARY KEY)' }]);
    db.prepare('INSERT INTO sessions (id) VALUES (?)').run('s1');
    db.close();
    const reopened = openStore(database());
    try {
      expect(new AgentWritableStore(reopened).load(), 'the new table is there and empty').toEqual([]);
      expect(reopened.prepare('SELECT version FROM schema_versions WHERE module = ?').get(AGENT_WRITABLE_MODULE), 'the module is at its first version').toEqual({ version: 1 });
      expect(reopened.prepare('SELECT id FROM sessions').all(), 'the rows of the other module stay').toEqual([{ id: 's1' }]);
    } finally {
      reopened.close();
    }
  });
});

describe('AgentWritableRegistry keeps the set small', () => {
  const source = (agentRoots: string[] = []) => () => ({ claudeConfigDir: join(dir, 'claude'), home: join(dir, 'home'), uid: 501, platform: 'darwin' as const, agentRoots });
  const withStore = <T>(run: (store: AgentWritableStore) => T): T => {
    const db = openStore(join(dir, 'app.db'));
    try {
      return run(new AgentWritableStore(db));
    } finally {
      db.close();
    }
  };

  it('adds no row for a thousand launches below the task base, and none for their inboxes below the directory of the inboxes', () => {
    withStore((store) => {
      const registry = new AgentWritableRegistry(source([join(dir, 'base')]), store);
      registry.add([join(dir, 'data', 'session-events')]);
      const before = store.load();
      for (let index = 0; index < 1000; index++) registry.add([join(dir, 'base', 'swarms', `s${index}`, 'agent'), join(dir, 'base', 'work', `w${index}`), join(dir, 'data', 'session-events', `session-${index}`)]);
      expect(store.load(), 'no row was added').toEqual(before);
      expect(registry.directories().filter((path) => path.startsWith(dir) && !path.startsWith(join(dir, 'home')) && !path.startsWith(join(dir, 'claude'))).sort(), 'the task base and the directory of the inboxes stand for all of them').toEqual([join(dir, 'base'), join(dir, 'data', 'session-events')]);
    });
  });

  it('skips a child of a row, lets a parent take the place of its children in memory, keeps a sibling, and judges a link by its real path', () => {
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
    mkdirSync(join(dir, 'sibling'));
    mkdirSync(join(dir, 'elsewhere'));
    symlinkSync(join(dir, 'a', 'b'), join(dir, 'link'));
    withStore((store) => {
      const registry = new AgentWritableRegistry(source(), store);
      registry.add([join(dir, 'a', 'b')]);
      registry.add([join(dir, 'a', 'b', 'c'), join(dir, 'link'), join(dir, 'sibling')]);
      const rows = store.load();
      expect([rows.includes(join(dir, 'a', 'b')), rows.includes(join(dir, 'sibling'))], 'the row and its sibling are recorded').toEqual([true, true]);
      expect(rows.filter((path) => path === join(dir, 'a', 'b', 'c') || path === join(dir, 'link')), 'the child and the link into the row add nothing').toEqual([]);
      registry.add([join(dir, 'a')]);
      const set = registry.directories();
      expect([set.includes(join(dir, 'a')), set.includes(join(dir, 'sibling')), set.includes(join(dir, 'a', 'b'))], 'in memory the parent takes the place of its child, the sibling stays').toEqual([true, true, false]);
      expect(store.load(), 'the rows of the child and the parent both stay in the table').toEqual(expect.arrayContaining([join(dir, 'a'), join(dir, 'a', 'b')]));
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'a', 'out'));
      registry.add([join(dir, 'a', 'out')]);
      expect(store.load(), 'a link below a row that leads out of the set is recorded by its real path').toContain(join(dir, 'elsewhere'));
      expect(store.load(), 'and not by its spelling below the row').not.toContain(join(dir, 'a', 'out'));
    });
  });

  it('keeps a directory as it is spelled and as its real path, so a link that is changed later does not take it out', () => {
    mkdirSync(join(dir, 'first'));
    mkdirSync(join(dir, 'second'));
    symlinkSync(join(dir, 'first'), join(dir, 'workspace'));
    withStore((store) => {
      new AgentWritableRegistry(source(), store).add([join(dir, 'workspace')]);
      expect(store.load(), 'both spellings').toEqual(expect.arrayContaining([join(dir, 'workspace'), join(dir, 'first')]));
    });
    rmSync(join(dir, 'workspace'));
    symlinkSync(join(dir, 'second'), join(dir, 'workspace'));
    const after = withStore((store) => new AgentWritableRegistry(source(), store).directories());
    expect(after, 'the directory the agent wrote stays in the set after the link moved').toContain(join(dir, 'first'));
  });

  it('drops the rows that another row contains when it loads the database, and keeps them in the table', () => {
    withStore((store) => store.record([join(dir, 'x', 'y', 'z'), join(dir, 'x', 'y'), join(dir, 'x'), join(dir, 'w')]));
    withStore((store) => {
      const set = new AgentWritableRegistry(source(), store).directories();
      expect(set.filter((path) => path.startsWith(join(dir, 'x')) || path.startsWith(join(dir, 'w'))).sort(), 'the outermost rows in memory').toEqual([join(dir, 'w'), join(dir, 'x')]);
      expect(store.load(), 'every row stays in the table').toEqual(expect.arrayContaining([join(dir, 'x', 'y', 'z'), join(dir, 'x', 'y')]));
    });
  });

  it('computes the real path of each directory of the set once per lookup, so a lookup over a few hundred rows stays fast', () => {
    const rows = Array.from({ length: 300 }, (_, index) => join(dir, 'rows', `missing-${index}`));
    const registry = new AgentWritableRegistry(source());
    registry.add(rows);
    const path = Array.from({ length: 6 }, (_, index) => join(dir, `path-${index}`));
    for (const entry of path) mkdirSync(entry);
    writeFileSync(join(path[5]!, 'git'), '#!/bin/sh\n');
    chmodSync(join(path[5]!, 'git'), 0o755);
    const tools = new HostTools({ appPath: path.join(':'), fixedDirectories: [], excluded: () => registry.directories() });
    const native = vi.spyOn(realpathSync, 'native');
    try {
      const started = performance.now();
      expect(tools.find('git'), 'the program is found').toBe(join(path[5]!, 'git'));
      tools.path();
      const elapsed = performance.now() - started;
      expect(native.mock.calls.length, 'about two real paths for each missing row (the row, then its parent), not two for each row at each comparison').toBeLessThan(rows.length * 4);
      expect(elapsed, 'one lookup over the set').toBeLessThan(1500);
    } finally {
      native.mockRestore();
    }
  });
});

describe('AgentWritableRegistry when its memory fails', () => {
  const source = () => ({ claudeConfigDir: '/data/claude', home: '/home/u', uid: 501, platform: 'darwin' as const });

  /** A memory over an array whose reads and writes fail while `failing` says so. */
  const flaky = () => {
    const state = { failing: { load: false, record: false }, rows: [] as string[] };
    const memory: AgentWritableMemory = {
      load: () => {
        if (state.failing.load) throw new Error('no such table: agent_writable_directories');
        return [...state.rows];
      },
      record: (paths) => {
        if (state.failing.record) throw new Error('database is locked');
        state.rows.push(...paths);
      },
    };
    return { state, memory };
  };

  it('keeps a directory whose write failed out of the lookup, writes it at a later lookup after the wait, and reports the failure once', () => {
    const { state, memory } = flaky();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let now = 1_000;
      const registry = new AgentWritableRegistry(source, memory, () => now);
      state.failing.record = true;
      registry.add(['/w/u']);
      registry.add(['/w/v']);
      expect(registry.directories(), 'both directories are excluded from memory').toEqual(expect.arrayContaining(['/w/u', '/w/v']));
      expect(state.rows.filter((path) => path.startsWith('/w/')), 'nothing was written').toEqual([]);
      now += MEMORY_RETRY_MS;
      registry.directories();
      expect(state.rows.filter((path) => path.startsWith('/w/')), 'the write after the wait fails again').toEqual([]);
      state.failing.record = false;
      registry.directories();
      registry.add(['/w/u']);
      expect(state.rows.filter((path) => path.startsWith('/w/')), 'no write before the next wait is over').toEqual([]);
      now += MEMORY_RETRY_MS;
      registry.directories();
      expect(state.rows.filter((path) => path.startsWith('/w/')).sort(), 'both are written at the next lookup').toEqual(['/w/u', '/w/v']);
      expect(warn.mock.calls.length, 'one report for the two failed writes').toBe(1);
      expect(String(warn.mock.calls[0]?.[0]), 'the report names the database error and no directory').not.toContain('/w/');
    } finally {
      warn.mockRestore();
    }
  });

  it('is incomplete while the database cannot be read, and takes in its rows when a later read succeeds', () => {
    const { state, memory } = flaky();
    state.rows.push('/stored/before');
    state.failing.load = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let now = 1_000;
      const registry = new AgentWritableRegistry(source, memory, () => now);
      registry.add(['/w/new']);
      expect([registry.directories().includes('/w/new'), registry.directories().includes('/stored/before'), registry.complete()], 'the new directory is excluded, the stored one is not known yet, the set is incomplete').toEqual([true, false, false]);
      expect(String(warn.mock.calls[0]?.[0]), 'the report says that only the fixed directories are searched').toContain('the app looks for programs in the system and install directories only');
      state.failing.load = false;
      now += MEMORY_RETRY_MS;
      expect(registry.complete(), 'complete after the wait').toBe(true);
      expect(registry.directories(), 'the stored rows join the set').toEqual(expect.arrayContaining(['/stored/before', '/w/new']));
      expect(state.rows, 'and what was learned meanwhile is written').toContain('/w/new');
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the lookup to the fixed directories while the database cannot be read: a program in a directory that the table holds is not used, by name, by path or through the PATH of a host process', () => {
    const { state, memory } = flaky();
    const planted = join(dir, 'planted');
    for (const place of [join(planted, 'bin'), join(dir, 'fixed')]) {
      mkdirSync(place, { recursive: true });
      writeFileSync(join(place, 'git'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    state.rows.push(planted);
    state.failing.load = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let now = 1_000;
      const registry = new AgentWritableRegistry(source, memory, () => now);
      const tools = new HostTools({ appPath: join(planted, 'bin'), fixedDirectories: [join(dir, 'fixed')], excluded: () => registry.directories(), complete: () => registry.complete() });
      expect([tools.find('git'), tools.find(join(planted, 'bin', 'git')), tools.path().split(':').includes(join(planted, 'bin')), tools.directories().includes(join(planted, 'bin'))], 'the git of the fixed directory; the planted one neither by name nor by path; the PATH of a host process and the lookup list leave the entry out').toEqual([join(dir, 'fixed', 'git'), undefined, false, false]);
      rmSync(join(dir, 'fixed', 'git'));
      expect(() => tools.require('git'), 'the reason says why nothing was found').toThrow('the host program (git) was not started: the directories that agents may write could not be read from the profile database');
      state.failing.load = false;
      now += MEMORY_RETRY_MS;
      expect([tools.find('git'), tools.incomplete()], 'after a read: the table excludes the planted directory').toEqual([undefined, false]);
    } finally {
      warn.mockRestore();
    }
  });

  it('names the unread table in the status of each provider and in the reason of a check, through the tools of the profile', async () => {
    const { state, memory } = flaky();
    state.failing.load = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { tools, writable } = createProfileHostTools({ options: () => ({}), claudeConfigDir: () => undefined, agentRoots: [], memory });
      expect(tools.incomplete(), 'the tools of the profile read the state of the registry').toBe(true);
      const host = { hostTools: tools, writable };
      const srt = await new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary: 'agide-no-such-srt', settingsDir: join(dir, 'srt'), claudeBinary: '/bin/sh', ...host }).check();
      const local = await new LocalProvider({ sessionFilesDir: join(dir, 'local'), claudeBinary: 'agide-no-such-claude', hostTools: tools }).check();
      const container = await new ContainerProvider({ sessionFilesDir: join(dir, 'container'), dockerBinary: 'agide-no-such-docker', image: 'i', claudeConfigDir: join(dir, 'claude'), user: '1:1', ...host }).check();
      const cause = 'the directories that agents may write could not be read from the profile database, so only the system and install directories are searched';
      expect([srt, local, container], 'each status names the cause').toEqual([
        { ok: false, reason: `The sandbox runtime (srt) was not found: ${cause}`, fix: INCOMPLETE_FIX },
        { ok: false, reason: `The Claude CLI was not found: ${cause}`, fix: INCOMPLETE_FIX },
        { ok: false, reason: `Docker was not found: ${cause}`, fix: INCOMPLETE_FIX },
      ]);
      expect(resolveCheckEnvironment({ provider: 'srt', bashSandbox: false, profileEnv: {}, srt: { binary: 'agide-no-such-srt', settingsDir: join(dir, 'checks'), hostTools: tools } }), 'a check ends not_run with the cause').toEqual({ kind: 'unavailable', why: `the sandbox runtime was not found: ${cause}` });
    } finally {
      warn.mockRestore();
    }
  });

  it('writes a directory to a database file that another connection held locked, once the lock is gone', () => {
    const holder = openStore(join(dir, 'app.db'));
    const db = openStore(join(dir, 'app.db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      db.exec('PRAGMA busy_timeout = 10');
      const store = new AgentWritableStore(db);
      let now = 1_000;
      const registry = new AgentWritableRegistry(source, store, () => now);
      holder.exec('BEGIN IMMEDIATE');
      registry.add(['/w/locked']);
      expect(registry.directories(), 'excluded while the database is locked').toContain('/w/locked');
      holder.exec('COMMIT');
      expect(store.load(), 'not written yet').not.toContain('/w/locked');
      now += MEMORY_RETRY_MS;
      registry.directories();
      expect(store.load(), 'written after the lock').toContain('/w/locked');
    } finally {
      warn.mockRestore();
      db.close();
      holder.close();
    }
  });
});

describe('AgentWritableStore of a damaged database', () => {
  it('makes its table again when the version table names it and the table is missing', () => {
    const db = openStore(join(dir, 'app.db'));
    try {
      new AgentWritableStore(db);
      db.exec('DROP TABLE agent_writable_directories');
      const store = new AgentWritableStore(db);
      expect(store.load(), 'the table is there and empty').toEqual([]);
      store.record(['/w/a']);
      expect(store.load(), 'and takes rows').toEqual(['/w/a']);
    } finally {
      db.close();
    }
  });

  it('does not throw for a database that cannot be written, and leaves load to report the missing table', () => {
    const db = openStore(join(dir, 'app.db'));
    try {
      db.exec('PRAGMA query_only = ON');
      expect(() => new AgentWritableStore(db), 'the constructor never throws').not.toThrow();
      expect(() => new AgentWritableStore(db).load(), 'load says what is wrong').toThrow('no such table');
    } finally {
      db.close();
    }
  });

  it('does not throw for a version that this build does not know, and leaves load to report it', () => {
    const db = openStore(join(dir, 'app.db'));
    try {
      db.prepare('INSERT INTO schema_versions (module, version) VALUES (?, ?)').run(AGENT_WRITABLE_MODULE, 99);
      expect(() => new AgentWritableStore(db), 'the constructor never throws').not.toThrow();
    } finally {
      db.close();
    }
  });

  it('names the database file and quotes the whole statement as one shell word in the command that forgets them, and has none for a database in memory', () => {
    const db = openStore(join(dir, 'app.db'));
    const memory = openStore(':memory:');
    try {
      expect(new AgentWritableStore(db).forgetCommand(['/x/a!b', "/x/it's"]), 'single quotes for the shell around the database and the statement; a quote inside is closed, escaped and opened again').toBe(
        `sqlite3 '${join(dir, 'app.db')}' 'DELETE FROM agent_writable_directories WHERE path IN ('\\''/x/a!b'\\'', '\\''/x/it'\\'''\\''s'\\'')'`,
      );
      expect(new AgentWritableStore(memory).forgetCommand(['/x']), 'no file').toBeUndefined();
    } finally {
      db.close();
      memory.close();
    }
  });

  const sqlite = existsSync('/usr/bin/sqlite3') ? it : it.skip;
  /** Directory names with a quote, a space, `!`, `$` and a backtick, which a shell must not change. */
  const awkward = (): string[] => [join(dir, "it's here"), join(dir, 'a!b'), join(dir, '$HOME `id`'), join(dir, 'q"r')];

  sqlite.each([
    ['a plain /bin/sh', undefined],
    ['an interactive zsh', '/bin/zsh'],
    ['an interactive bash', '/bin/bash'],
  ])('forgets exactly the rows it names when the command runs in %s, where `!` would expand inside double quotes', async (_name, interactive) => {
    const setup = openStore(join(dir, 'app.db'));
    const store = new AgentWritableStore(setup);
    store.record([...awkward(), join(dir, 'kept')]);
    const command = store.forgetCommand(awkward()) ?? '';
    setup.close();
    const env = { PATH: '/usr/bin:/bin', HOME: dir, TERM: 'xterm' };
    if (interactive === undefined) {
      expect(spawnSync('/bin/sh', ['-c', command], { env, encoding: 'utf8', timeout: 20_000 }).status, 'the command exits 0').toBe(0);
    } else {
      // The shell reads the line from a terminal, as it does when the user pastes it; a line it rejects leaves it waiting, which the timer ends.
      const shell = pty.spawn(interactive, interactive.endsWith('bash') ? ['--norc', '--noprofile', '-i'] : ['-f', '-i'], { cwd: dir, env, cols: 200, rows: 24 });
      let output = '';
      const ended = new Promise<void>((resolve) => shell.onExit(() => resolve()));
      let sent = false;
      shell.onData((data) => {
        output += data;
        if (!sent) {
          sent = true;
          shell.write(`${command}; exit\r`);
        }
      });
      const timer = setTimeout(() => shell.kill('SIGKILL'), 15_000);
      await ended;
      clearTimeout(timer);
      expect(output, 'the shell did not reject the line').not.toMatch(/event not found|no such event/);
    }
    const check = openStore(join(dir, 'app.db'));
    try {
      expect(new AgentWritableStore(check).load(), 'only the row that was not named is left').toEqual([join(dir, 'kept')]);
    } finally {
      check.close();
    }
  }, 30_000);
});
