import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Caller } from '../../core/commands/index';
import { AgentWritableStore } from '../../core/isolation/agentWritableStore';
import { writeFakeSrt } from '../../core/isolation/fakeSrt';
import { FileProfileStore } from '../../core/profile/index';
import { openStore } from '../../core/store/index';
import { startAppModules, type AppModules } from '../appForTests';

/** The registry of agent-writable directories as the session module wires it: the directory of the inboxes, the sessions of the store, a damaged table. */

const FAKE_CLAUDE = join(import.meta.dirname, '..', '..', 'core', 'session', 'fixtures', 'fake-claude.mjs');
const ui: Caller = { kind: 'ui' };

let dir: string;
let work: string;
let app: AppModules | undefined;
const saved = { ...process.env };

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'session-writable-')));
  work = realpathSync(mkdtempSync(join(tmpdir(), 'session-writable-work-')));
  process.env['AGIDE_CLAUDE_BIN'] = FAKE_CLAUDE;
  process.env['AGIDE_SESSION_CWD'] = work;
  process.env['AGIDE_TASK_BASE'] = join(dir, 'tasks');
  process.env['FAKE_CLAUDE_RECORD'] = join(dir, 'launches.jsonl');
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const dbPath = (): string => join(dir, 'app.db');
const start = async (): Promise<AppModules> => {
  app = await startAppModules({ dataDir: dir, dbPath: dbPath() });
  return app;
};
const stop = async (): Promise<void> => {
  await app?.close();
  app = undefined;
};
/** Deletes rows through a connection of the test, where no sqlite3 program is installed. */
const forgetRows = (paths: readonly string[]): void => {
  const db = openStore(dbPath());
  try {
    for (const path of paths) db.prepare('DELETE FROM agent_writable_directories WHERE path = ?').run(path);
  } finally {
    db.close();
  }
};
const rows = (): string[] => {
  const db = openStore(dbPath());
  try {
    return new AgentWritableStore(db).load();
  } finally {
    db.close();
  }
};

async function sessionInFolder(running: AppModules): Promise<string> {
  const folder = await running.commands.invoke('ui_create_folder', { title: 'A' }, ui);
  if (!folder.ok) throw new Error(folder.error.message);
  const created = await running.commands.invoke('session_create', { folderId: (folder.value as { id: string }).id, cwd: work }, ui);
  if (!created.ok) throw new Error(created.error.message);
  return (created.value as { sessionId: string }).sessionId;
}

describe('the session module and the registry of agent-writable directories', () => {
  it('starts with a database whose table is missing while the version table names it, and makes the table again', async () => {
    const db = openStore(dbPath());
    new AgentWritableStore(db);
    db.exec('DROP TABLE agent_writable_directories');
    db.close();
    await start();
    await stop();
    expect(rows(), 'the table is there again and holds the directory of the inboxes').toContain(join(dir, 'session-events'));
  });

  it('records the directory of the hook inboxes once, and no working directory of a session under the local provider, also after a restart', async () => {
    await sessionInFolder(await start());
    await stop();
    await start();
    await stop();
    const recorded = rows();
    expect(recorded.filter((path) => path.startsWith(join(dir, 'session-events'))), 'one row for every inbox').toEqual([join(dir, 'session-events')]);
    expect(recorded, 'the working directory of the local session').not.toContain(work);
  });

  /** A profile below `<dir>/root` whose settings the test changes between starts. */
  const profile = { root: '', id: 'default' };
  const withProfile = async (): Promise<AppModules> => {
    app = await startAppModules({ dataDir: dir, dbPath: dbPath(), profile });
    return app;
  };
  const makeProfile = (): void => {
    profile.root = join(dir, 'root');
    new FileProfileStore({ root: profile.root, ownerId: profile.id }).create({ id: profile.id, name: 'Default', colour: '#5b7fa6' });
  };
  const useProvider = (provider: 'local' | 'srt'): void => {
    new FileProfileStore({ root: profile.root, ownerId: profile.id }).updateSettings(profile.id, { isolation: { provider, options: {} } });
  };
  /** The check of the srt provider in the status of the running app. */
  const srtCheck = async (running: AppModules): Promise<{ ok: boolean; reason?: string; fix?: string }> => {
    const status = await running.commands.invoke('isolation_status', {}, ui);
    if (!status.ok) throw new Error(status.error.message);
    return (status.value as { providers: { id: string; check: { ok: boolean; reason?: string; fix?: string } }[] }).providers.find((row) => row.id === 'srt')!.check;
  };
  /** The state of a database that a build without the table of agent-writable directories wrote. */
  const dropTable = (): void => {
    const db = openStore(dbPath());
    db.exec('DROP TABLE agent_writable_directories');
    db.close();
  };

  it('records nothing for a local session in a directory that holds srt, so srt stays usable after the switch and a restart', async () => {
    makeProfile();
    mkdirSync(join(work, 'bin'));
    process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(work, 'bin'));
    await sessionInFolder(await withProfile());
    await stop();
    useProvider('srt');
    expect(await srtCheck(await withProfile()), 'srt is usable under the srt profile').toEqual({ ok: true });
    await stop();
    expect(rows(), 'the working directory of the local session is no row').not.toContain(work);
  });

  it('adds the sessions that a build without the table stored once, at the start that makes the table, and the printed command forgets them for good', async () => {
    makeProfile();
    mkdirSync(join(work, 'bin'));
    process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(work, 'bin'));
    await sessionInFolder(await withProfile());
    await stop();
    dropTable();
    useProvider('srt');
    const refused = await srtCheck(await withProfile());
    await stop();
    expect([refused.ok, refused.reason], 'the stored session of unknown provider was added under the srt profile, and the status names the cause').toEqual([false, 'The sandbox runtime (srt) lies in a directory that an earlier agent launch made writable (such as the home directory)']);
    expect(rows(), 'the row').toContain(work);
    const command = /quit the app and run: (.*)$/.exec(refused.fix ?? '')?.[1] ?? '';
    if (existsSync('/usr/bin/sqlite3')) expect(spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).status, `the printed command runs: ${command}`).toBe(0);
    else forgetRows([work]);
    expect(await srtCheck(await withProfile()), 'after a restart the row stays forgotten and srt is usable').toEqual({ ok: true });
    await stop();
    expect(rows(), 'no row came back from the stored session').not.toContain(work);
  });

  it('never adds the sessions that a build without the table stored when the profile uses local at the start that makes the table', async () => {
    makeProfile();
    await sessionInFolder(await withProfile());
    await stop();
    dropTable();
    await withProfile();
    await stop();
    useProvider('srt');
    await withProfile();
    await stop();
    expect(rows(), 'the working directory of the stored session').not.toContain(work);
  });

  it('records the working directory of a local session when the Bash sandbox of the profile is on, and refuses one in a directory that holds the configured srt', async () => {
    profile.id = 'work';
    makeProfile();
    mkdirSync(join(dir, 'bin'));
    process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(dir, 'bin'));
    try {
      await sessionInFolder(await withProfile());
      await stop();
      expect(rows(), 'the working directory of the local session under the Bash sandbox').toContain(work);
      const holding = realpathSync(mkdtempSync(join(tmpdir(), 'session-writable-holding-')));
      try {
        mkdirSync(join(holding, 'bin'));
        process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(holding, 'bin'));
        process.env['AGIDE_SESSION_CWD'] = holding;
        const running = await withProfile();
        const folder = await running.commands.invoke('ui_create_folder', { title: 'B' }, ui);
        if (!folder.ok) throw new Error(folder.error.message);
        const created = await running.commands.invoke('session_create', { folderId: (folder.value as { id: string }).id, cwd: holding }, ui);
        expect(created.ok ? '' : created.error.message, 'the launch is refused with the fixed reason').toContain('the directory of this session holds the srt that the app starts outside any sandbox');
        await stop();
        expect(rows(), 'no row for the refused launch').not.toContain(holding);
      } finally {
        rmSync(holding, { recursive: true, force: true });
      }
    } finally {
      profile.id = 'default';
    }
  });

  it('keeps the working directory of an srt session recorded at its launch across a restart', async () => {
    makeProfile();
    useProvider('srt');
    mkdirSync(join(dir, 'bin'));
    process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(dir, 'bin'));
    await sessionInFolder(await withProfile());
    const deadline = Date.now() + 8000;
    while (!rows().includes(work) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    await stop();
    await withProfile();
    await stop();
    expect(rows(), 'the row of the launch').toContain(work);
  });

  it('denies an srt session of the profile process the read of the profile database and of the database of every profile', async () => {
    makeProfile();
    useProvider('srt');
    mkdirSync(join(dir, 'bin'));
    process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(dir, 'bin'));
    const sessionId = await sessionInFolder(await withProfile());
    const settings = join(dir, 'isolation', 'srt', sessionId, 'srt.json');
    const deadline = Date.now() + 8000;
    while (!existsSync(settings) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    const { denyRead } = (JSON.parse(readFileSync(settings, 'utf8')) as { filesystem: { denyRead: string[] } }).filesystem;
    expect(denyRead, 'the database file and its journal files').toEqual(expect.arrayContaining([dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`, `${dbPath()}-journal`]));
    expect(denyRead, 'the databases of every profile below the profiles directory of the app root').toEqual(expect.arrayContaining(['', '-wal', '-shm', '-journal'].map((suffix) => join(profile.root, 'profiles', '*', 'data', `app.db${suffix}`))));
  });
});
