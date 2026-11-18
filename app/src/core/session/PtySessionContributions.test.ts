import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider } from '../isolation/FakeProvider';
import type { ClaudeLaunch } from '../isolation/types';
import type { LaunchContext, LaunchContributor } from './launchContributions';
import { PtySessionService } from './PtySessionService';
import { MemorySessionStore } from './SessionStore';

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');
const FOLDER = 'folder-1';

let dir: string;
let workdir: string;
let record: string;
let service: PtySessionService | undefined;

const mcpConfig = () => ({ mcpServers: { app: { type: 'http', url: 'http://127.0.0.1:1/mcp/x', headers: { Authorization: 'Bearer t' } } } });

interface Launch {
  args: string[];
  mcpConfigFile?: { content: string };
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

function provider(): FakeProvider {
  return new FakeProvider({
    sessionFilesDir: join(dir, 'sessions'),
    command: (launch, spec) => ({ file: FAKE_CLAUDE, args: [...launch.args], cwd: launch.cwd, env: { ...spec.profile.env, ...launch.env } }),
  });
}

function start(fake: FakeProvider, contributors: readonly LaunchContributor[], store = new MemorySessionStore()): PtySessionService {
  service = new PtySessionService({
    eventsDir: join(dir, 'events'),
    provider: fake,
    store,
    mcpConfig,
    profileLaunch: () => ({ claudeConfigDir: undefined, env: { PATH: process.env['PATH'] ?? '', FAKE_CLAUDE_RECORD: record }, toolFiles: [] }),
    contributors: () => contributors,
    killTimeoutMs: 300,
  });
  return service;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-contrib-'));
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'session-contrib-cwd-')));
  record = join(dir, 'launches.jsonl');
});
afterEach(async () => {
  await service?.shutdown();
  service = undefined;
  rmSync(dir, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

describe('launch contributions', () => {
  it('reach the settings, arguments, environment, MCP config and session files of every launch', async () => {
    const contexts: LaunchContext[] = [];
    const fake = provider();
    start(fake, [
      {
        id: 'permissions',
        contribute: async (context) => {
          contexts.push(context);
          const gate = await context.writeSessionFile('gate.json', '{"classes":[]}');
          return {
            settings: { permissions: { ask: ['Bash(git push *)'] }, hooks: { PreToolUse: [{ type: 'command', command: `inspect ${gate}` }] } },
            replacesBaseHooks: ['PreToolUse'],
            env: { GIT_CONFIG_COUNT: '0' },
          };
        },
      },
      { id: 'browser', contribute: (context) => ({ args: ['--no-chrome'], mcpServers: { 'agide-browser': { type: 'http', url: `${context.mcpUrl}/browser` } } }) },
    ]);
    const session = await service!.create({ folderId: FOLDER, cwd: workdir, permissionMode: 'auto' });
    await until('launch record', () => launches().length > 0);
    const [launch] = launches();
    const settings = JSON.parse(launch?.args[(launch?.args.indexOf('--settings') ?? 0) + 1] ?? '{}') as {
      permissions: { ask: string[] };
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(settings.permissions.ask, 'contributed ask rule').toEqual(['Bash(git push *)']);
    expect(settings.hooks['PreToolUse']?.[0]?.hooks[0]?.command, 'inspector replaces the base PreToolUse command').toMatch(/^inspect .*gate\.json$/);
    expect(launch?.args, 'contributed argument').toContain('--no-chrome');
    expect(JSON.parse(launch?.mcpConfigFile?.content ?? '{}'), 'browser server next to app').toMatchObject({
      mcpServers: { app: { type: 'http' }, 'agide-browser': { type: 'http' } },
    });
    const ptyCall = fake.calls.find((call) => call.step === 'ptyCommand')?.detail as ClaudeLaunch;
    expect(ptyCall.env, 'contributed variable in the launch').toEqual({ GIT_CONFIG_COUNT: '0' });
    expect(contexts[0], 'context names the session, mode and provider').toMatchObject({
      session: { id: session.id },
      resume: false,
      permissionMode: 'auto',
      provider: { id: 'fake' },
    });
  });

  it('fail the launch when a contributor fails, so a session never starts without its rules', async () => {
    start(provider(), [{ id: 'permissions', contribute: () => Promise.reject(new Error('class table unreadable')) }]);
    await expect(service!.create({ folderId: FOLDER, cwd: workdir }), 'create').rejects.toMatchObject({ code: 'launch_failed' });
    expect(service!.list(), 'no session left').toEqual([]);
  });
});

describe('stop and permission mode', () => {
  it('stop ends the process and keeps the session for a resume with the stored mode', async () => {
    const store = new MemorySessionStore();
    start(provider(), [], store);
    const session = await service!.create({ folderId: FOLDER, cwd: workdir, permissionMode: 'default' });
    await until('idle', () => service!.get(session.id)?.status === 'idle');
    service!.setPermissionMode(session.id, 'acceptEdits');
    await service!.stop(session.id);
    await until('exited', () => service!.get(session.id)?.status === 'exited');
    expect(service!.get(session.id)?.permissionMode, 'mode kept on the session').toBe('acceptEdits');
    expect(store.load()[0]?.permissionMode, 'mode persisted').toBe('acceptEdits');
    await service!.resume(session.id);
    await until('second launch', () => launches().length === 2);
    const resumed = launches()[1]?.args ?? [];
    expect(resumed[resumed.indexOf('--permission-mode') + 1], 'resume passes the stored mode').toBe('acceptEdits');
  });
});
