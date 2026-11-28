import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider } from '../isolation/FakeProvider';
import { PtySessionService, type PtySessionServiceOptions } from './PtySessionService';

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');
const TOKEN = 'bearer-token-that-must-stay-in-the-file';
const FOLDER = 'folder-1';

interface Launch {
  args: string[];
  mcpConfigFile?: { mode: number; content: string };
}

let dir: string;
let workdir: string;
let record: string;
let service: PtySessionService;

const mcpConfig = () => ({ mcpServers: { app: { type: 'http', url: 'http://127.0.0.1:1/mcp/x', headers: { Authorization: `Bearer ${TOKEN}` } } } });

function start(options: Partial<PtySessionServiceOptions> = {}): PtySessionService {
  service = new PtySessionService({
    eventsDir: join(dir, 'events'),
    sessionFilesDir: join(dir, 'sessions'),
    claudeBinary: FAKE_CLAUDE,
    baseEnv: { PATH: process.env['PATH'], FAKE_CLAUDE_RECORD: record },
    killTimeoutMs: 300,
    ...options,
  });
  return service;
}

const launches = (): Launch[] =>
  existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Launch) : [];

async function until(what: string, probe: () => unknown, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-provider-'));
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'session-provider-cwd-')));
  record = join(dir, 'launches.jsonl');
});
afterEach(async () => {
  await service?.shutdown();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

describe('MCP config of a session', () => {
  it('is passed as a 0600 file path, so the bearer token is not in the process arguments', async () => {
    start({ mcpConfig });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await until('launch record', () => launches().length > 0);
    const [launch] = launches();
    const path = launch?.args[(launch.args.indexOf('--mcp-config') ?? -1) + 1] ?? '';
    expect(path.startsWith(join(dir, 'sessions', session.id)), 'config file in the session directory').toBe(true);
    expect(launch?.args.join(' '), 'no token in the arguments').not.toContain(TOKEN);
    expect(launch?.mcpConfigFile?.content, 'the file holds the token').toContain(TOKEN);
    expect(launch?.mcpConfigFile?.mode, 'file mode').toBe(0o600);
    expect(statSync(join(dir, 'sessions', session.id)).mode & 0o777, 'session directory mode').toBe(0o700);
  });

  it('is left out for a session without an app MCP grant', async () => {
    start({ mcpConfig: () => undefined });
    await service.create({ folderId: FOLDER, cwd: workdir });
    await until('launch record', () => launches().length > 0);
    expect(launches()[0]?.args, 'no --mcp-config argument').not.toContain('--mcp-config');
  });

  it('is removed from the disk when the process exits', async () => {
    start({ mcpConfig });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await until('idle', () => service.get(session.id)?.status === 'idle');
    service.sendText(session.id, '/exit');
    await until('exit', () => service.get(session.id)?.status === 'exited');
    await until('config removal', () => !existsSync(join(dir, 'sessions', session.id)));
  });
});

describe('permission mode', () => {
  it('is the prompting mode unless the service is configured otherwise', async () => {
    start();
    await service.create({ folderId: FOLDER, cwd: workdir });
    await until('launch record', () => launches().length > 0);
    expect(launches()[0]?.args.join(' '), 'default mode argument').toContain('--permission-mode manual');
  });

  it('takes the configured default for a session that names none and keeps an explicit one', async () => {
    start({ defaultPermissionMode: 'auto' });
    await service.create({ folderId: FOLDER, cwd: workdir });
    await service.create({ folderId: FOLDER, cwd: workdir, permissionMode: 'plan' });
    await until('both launches', () => launches().length === 2);
    const modes = launches().map((launch) => launch.args[launch.args.indexOf('--permission-mode') + 1]);
    expect(modes.sort(), 'argument per session').toEqual(['auto', 'plan']);
  });
});

describe('launch through a provider', () => {
  it('asks the provider for the command, the session file and the environment, in order, and attaches the pid', async () => {
    const provider = new FakeProvider({
      sessionFilesDir: join(dir, 'sessions'),
      command: (launch, spec) => ({ file: FAKE_CLAUDE, args: [...launch.args], cwd: launch.cwd, env: { ...spec.profile.env, ...spec.profile.extraEnv } }),
    });
    start({
      provider,
      mcpConfig,
      profileId: 'work',
      profileLaunch: () => ({
        claudeConfigDir: '/profiles/work/claude',
        env: { PATH: process.env['PATH'] ?? '', FAKE_CLAUDE_RECORD: record },
        extraEnv: { GH_CONFIG_DIR: '/profiles/work/gh' },
        toolFiles: [],
      }),
    });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await until('launch record', () => launches().length > 0);
    expect(provider.calls.map((call) => call.step), 'provider steps').toEqual(['check', 'prepare', 'writeSessionFile', 'ptyCommand', 'attach']);
    expect(provider.calls.find((call) => call.step === 'prepare')?.detail, 'profile key').toEqual({ profileId: 'work' });
    await service.close(session.id);
    expect(provider.calls.map((call) => call.step), 'terminate and release on close').toEqual(expect.arrayContaining(['terminate', 'releaseSession']));
  });

  it('writes the names of the variables that do not reach the program to the log of the app, without their values', async () => {
    const provider = new FakeProvider({
      sessionFilesDir: join(dir, 'sessions'),
      command: (launch, spec) => ({ file: FAKE_CLAUDE, args: [...launch.args], cwd: launch.cwd, env: { ...spec.profile.env }, dropped: ['NOT_CARRIED', 'BASH_FUNC_x%%'] }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      start({ provider, profileLaunch: () => ({ claudeConfigDir: undefined, env: { PATH: process.env['PATH'] ?? '', FAKE_CLAUDE_RECORD: record, NOT_CARRIED: 'value-that-stays-out' }, toolFiles: [] }) });
      const session = await service.create({ folderId: FOLDER, cwd: workdir });
      await until('launch record', () => launches().length > 0);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines, 'one line with the session and the names').toContain(`session ${session.id}: variables of the launch that do not reach the program: NOT_CARRIED, BASH_FUNC_x%%`);
      expect(lines.some((line) => line.includes('value-that-stays-out')), 'no value').toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('reports a provider failure as launch_failed and leaves no session or file behind', async () => {
    const provider = new FakeProvider({ sessionFilesDir: join(dir, 'sessions') });
    provider.failAt.add('ptyCommand');
    start({ provider, mcpConfig });
    await expect(service.create({ folderId: FOLDER, cwd: workdir }), 'create with a failing provider').rejects.toMatchObject({ code: 'launch_failed' });
    expect(service.list(), 'no session').toEqual([]);
    expect(provider.calls.map((call) => call.step), 'session files released').toContain('releaseSession');
  });

  it('refuses to launch when the provider check fails', async () => {
    const provider = new FakeProvider({ sessionFilesDir: join(dir, 'sessions') });
    provider.failAt.add('check');
    start({ provider });
    await expect(service.create({ folderId: FOLDER, cwd: workdir }), 'create with a failing check').rejects.toMatchObject({ code: 'launch_failed' });
  });

  it('gives the process the profile Claude and gh directories and extra environment', async () => {
    start({
      profileLaunch: () => ({
        claudeConfigDir: '/profiles/work/claude',
        ghConfigDir: '/profiles/work/gh',
        env: { PATH: process.env['PATH'] ?? '', FAKE_CLAUDE_RECORD: record, CLAUDE_CONFIG_DIR: '/shell' },
        extraEnv: { FAKE_EXTRA: '1' },
        toolFiles: [],
      }),
    });
    await service.create({ folderId: FOLDER, cwd: workdir });
    await until('launch record', () => launches().length > 0);
    expect((launches()[0] as unknown as { env: Record<string, string> }).env['CLAUDE_CONFIG_DIR'], 'profile directory wins over the shell value').toBe('/profiles/work/claude');
  });
});
