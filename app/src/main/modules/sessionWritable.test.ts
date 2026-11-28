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

  it('records the working directories of the stored sessions at start when the profile uses a confining provider', async () => {
    const profile = { root: join(dir, 'root'), id: 'default' };
    new FileProfileStore({ root: profile.root, ownerId: profile.id }).create({ id: profile.id, name: 'Default', colour: '#5b7fa6' });
    const withProfile = async (): Promise<AppModules> => {
      app = await startAppModules({ dataDir: dir, dbPath: dbPath(), profile });
      return app;
    };
    await sessionInFolder(await withProfile());
    await stop();
    expect(rows(), 'under local the working directory is not recorded').not.toContain(work);
    new FileProfileStore({ root: profile.root, ownerId: profile.id }).updateSettings(profile.id, { isolation: { provider: 'srt', options: {} } });
    await withProfile();
    await stop();
    expect(rows(), 'the working directory of the stored session').toContain(work);
  });

  it('denies an srt session of the profile process the read of the profile database', async () => {
    const profile = { root: join(dir, 'root'), id: 'default' };
    new FileProfileStore({ root: profile.root, ownerId: profile.id }).create({ id: profile.id, name: 'Default', colour: '#5b7fa6', settings: { isolation: { provider: 'srt', options: {} } } });
    mkdirSync(join(dir, 'bin'));
    process.env['AGIDE_SRT_BIN'] = writeFakeSrt(join(dir, 'bin'));
    app = await startAppModules({ dataDir: dir, dbPath: dbPath(), profile });
    const sessionId = await sessionInFolder(app);
    const settings = join(dir, 'isolation', 'srt', sessionId, 'srt.json');
    const deadline = Date.now() + 8000;
    while (!existsSync(settings) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    const { denyRead } = (JSON.parse(readFileSync(settings, 'utf8')) as { filesystem: { denyRead: string[] } }).filesystem;
    expect(denyRead, 'the database file and its journal files').toEqual(expect.arrayContaining([dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`]));
  });
});
