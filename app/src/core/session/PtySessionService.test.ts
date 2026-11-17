import { mkdirSync, mkdtempSync, existsSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PtySessionService, type PtySessionServiceOptions } from './PtySessionService';
import { MemorySessionStore } from './SessionStore';
import type { SessionEvent, SessionInfo, SessionStatus } from './types';

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');
const FOLDER = 'folder-1';

interface Launch {
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

let dir: string;
let record: string;
let workdir: string;
let service: PtySessionService;
let events: SessionEvent[];

function start(options: Partial<PtySessionServiceOptions> = {}): PtySessionService {
  service = new PtySessionService({
    eventsDir: join(dir, 'events'),
    claudeBinary: FAKE_CLAUDE,
    baseEnv: { PATH: process.env['PATH'], FAKE_CLAUDE_RECORD: record, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONFIG_DIR: '/cfg' },
    submitDelayMs: 20,
    firstPromptDelayMs: 20,
    killTimeoutMs: 300,
    ...options,
  });
  events = [];
  service.subscribe((event) => events.push(event));
  return service;
}

function launches(): Launch[] {
  if (!existsSync(record)) return [];
  return readFileSync(record, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Launch);
}

async function until<T>(what: string, probe: () => T | undefined | false, timeoutMs = 8000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const output = (id: string) => events.flatMap((e) => (e.type === 'session.output' && e.sessionId === id ? [e.data] : [])).join('');
const statuses = (id: string): SessionStatus[] =>
  events.flatMap((e) => (e.type === 'session.status_changed' && e.session.id === id ? [e.session.status] : []));
const hooks = (id: string) => events.flatMap((e) => (e.type === 'session.hook' && e.sessionId === id ? [e.hookEvent] : []));
const idle = (id: string) => until('idle status', () => service.get(id)?.status === 'idle');
const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-test-'));
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'session-cwd-')));
  record = join(dir, 'launches.jsonl');
});

afterEach(async () => {
  await service?.shutdown();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

describe('launch', () => {
  it('passes the session id, an explicit permission mode, user setting sources and the hook settings', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir, permissionMode: 'acceptEdits' });
    await idle(session.id);
    const [launch] = launches();
    expect(launch?.args.slice(0, 4), 'session id and permission mode').toEqual(['--session-id', session.id, '--permission-mode', 'acceptEdits']);
    expect(launch?.args.join(' '), 'user setting sources').toContain('--setting-sources user');
    const settings = JSON.parse(launch?.args[launch.args.indexOf('--settings') + 1] ?? '{}') as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks), 'hooks in --settings').toEqual(expect.arrayContaining(['SessionStart', 'Stop', 'PermissionRequest']));
    expect(launch?.cwd, 'working directory').toBe(workdir);
  });

  it('uses the manual CLI mode for the default permission mode', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    expect(launches()[0]?.args.join(' '), 'permission mode argument').toContain('--permission-mode manual');
  });

  it('removes variables injected by a parent Claude Code session and keeps the config directory', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    expect(launches()[0]?.env, 'environment of the launched process').toEqual({ CLAUDE_CONFIG_DIR: '/cfg', TERM: 'xterm-256color' });
  });

  it('appends the integrator arguments, which receive the session', async () => {
    const seen: SessionInfo[] = [];
    start({ extraArgs: (info) => (seen.push(info), ['--mcp-config', `{"for":"${info.id}"}`]) });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    expect(launches()[0]?.args.slice(-2), 'extra arguments at the end').toEqual(['--mcp-config', `{"for":"${session.id}"}`]);
    expect(seen[0]?.folderId, 'folder passed to the hook point').toBe(FOLDER);
  });

  it('fails with launch_failed when the working directory does not exist', async () => {
    start();
    await expect(service.create({ folderId: FOLDER, cwd: join(dir, 'gone') }), 'create in a missing directory').rejects.toMatchObject({ code: 'launch_failed' });
  });

  it('fails with launch_failed and leaves no session when the binary does not exist', async () => {
    start({ claudeBinary: join(dir, 'missing') });
    await expect(service.create({ folderId: FOLDER, cwd: workdir }), 'create with a missing binary').rejects.toMatchObject({ code: 'launch_failed' });
    expect(service.list(), 'sessions after a failed launch').toEqual([]);
  });
});

describe('state from hook events', () => {
  it('goes from starting to idle on SessionStart, busy during a turn and back to idle on Stop', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    expect(session.status, 'status right after spawn').toBe('starting');
    await idle(session.id);
    service.sendText(session.id, 'hello');
    await until('turn end', () => statuses(session.id).length >= 3);
    expect(statuses(session.id), 'status sequence').toEqual(['idle', 'busy', 'idle']);
    expect(hooks(session.id), 'hook events in order').toEqual(['SessionStart', 'UserPromptSubmit', 'Stop']);
    expect(output(session.id), 'terminal output of the turn').toContain('echo: hello');
  });

  it('delivers the hook payload', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, 'hi');
    const stop = await until('Stop hook', () => events.find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop'));
    expect(stop, 'Stop hook event').toMatchObject({ payload: { session_id: session.id, last_assistant_message: 'echo: hi' } });
  });

  it('removes mcp.json after the first SessionStart and removes stale session directories at start', async () => {
    const sessionFilesDir = join(dir, 'sessions');
    mkdirSync(join(sessionFilesDir, 'stale'), { recursive: true });
    writeFileSync(join(sessionFilesDir, 'stale', 'mcp.json'), '{"token":"old"}');
    start({ sessionFilesDir, mcpConfig: () => ({ mcpServers: {} }) });
    expect(existsSync(join(sessionFilesDir, 'stale')), 'directory left by a crash is removed').toBe(false);
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    await until('mcp.json removed', () => !existsSync(join(sessionFilesDir, session.id, 'mcp.json')));
    expect(hooks(session.id), 'SessionStart arrived').toContain('SessionStart');
  });

  it('reports a failed create and a failed resume to onLaunchFailed', async () => {
    const failed: string[] = [];
    start({ onLaunchFailed: (session) => failed.push(session.id) });
    await expect(service.create({ folderId: FOLDER, cwd: join(workdir, 'missing') }), 'create in a missing directory').rejects.toThrow();
    expect(failed, 'one failure reported for the create').toHaveLength(1);
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, '/exit');
    await until('exited', () => service.get(session.id)?.status === 'exited');
    rmSync(workdir, { recursive: true, force: true });
    await expect(service.resume(session.id), 'resume in a removed directory').rejects.toThrow();
    expect(failed.at(-1), 'the failed resume names its session').toBe(session.id);
    expect(failed, 'one failure for the create and one for the resume').toHaveLength(2);
  });

  it('shows waiting while a permission request is open', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, '/perm');
    await until('waiting', () => service.get(session.id)?.status === 'waiting');
    await until('prompt text shown', () => output(session.id).includes('Allow?'));
    service.write(session.id, 'y\r');
    await until('answer echoed', () => output(session.id).includes('allowed'));
  });

  it('forwards subagent hooks without changing the status', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, '/subagent');
    await until('subagent hooks', () => hooks(session.id).includes('SubagentStop'));
    expect(hooks(session.id), 'subagent hooks').toEqual(expect.arrayContaining(['SubagentStart', 'SubagentStop']));
    expect(service.get(session.id)?.status, 'status after subagent hooks').toBe('idle');
  });

  it('types the create prompt once after the first SessionStart', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir, prompt: 'first prompt' });
    await until('turn end', () => hooks(session.id).includes('Stop'));
    expect(output(session.id), 'prompt echoed by the process').toContain('echo: first prompt');
    expect(hooks(session.id).filter((h) => h === 'UserPromptSubmit'), 'prompt submissions').toHaveLength(1);
  });

  it('types a multi-line prompt as one paste', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, 'line one\nline two');
    const stop = await until('Stop hook', () => events.find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop'));
    expect(stop, 'one submission carrying both lines').toMatchObject({ payload: { last_assistant_message: 'echo: line one\nline two' } });
  });

  it('keeps two prompts apart when sent in a row', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, 'one');
    service.sendText(session.id, 'two');
    await until('both turns', () => hooks(session.id).filter((h) => h === 'Stop').length === 2);
    expect(output(session.id), 'both echoes').toMatch(/echo: one[\s\S]*echo: two/);
  });
});

describe('exit and resume', () => {
  it('ends as exited with the exit code and emits session.exited', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, '/exit');
    const exited = await until('exit event', () => events.find((e) => e.type === 'session.exited'));
    expect(exited, 'exit event').toMatchObject({ exitCode: 0, signal: null, session: { id: session.id, status: 'exited' } });
    expect(hooks(session.id), 'SessionEnd hook drained before the exit event').toContain('SessionEnd');
    expect(() => service.write(session.id, 'x'), 'write to an exited session').toThrowError(/exited/);
  });

  it('starts a new process with --resume and the same id, and does not replay old hook events', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir, permissionMode: 'plan' });
    await idle(session.id);
    service.sendText(session.id, '/exit');
    await until('exited', () => service.get(session.id)?.status === 'exited');
    const hooksBefore = hooks(session.id).length;

    const resumed = await service.resume(session.id);
    expect(resumed.status, 'status right after resume').toBe('starting');
    expect(resumed, 'exit code of the previous process').not.toHaveProperty('exitCode');
    await idle(session.id);

    const [, second] = launches();
    expect(second?.args.slice(0, 4), 'resume flag, id and the mode of the first launch').toEqual(['--resume', session.id, '--permission-mode', 'plan']);
    expect(second?.args, 'no --session-id on resume').not.toContain('--session-id');
    expect(hooks(session.id).slice(hooksBefore), 'hook events of the second process only').toEqual(['SessionStart']);
  });

  it('refuses to resume a running session and to resume an unknown one', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    await expect(service.resume(session.id), 'resume of a running session').rejects.toMatchObject({ code: 'already_running' });
    await expect(service.resume('nope'), 'resume of an unknown session').rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists persisted sessions as exited after a restart and resumes them', async () => {
    const store = new MemorySessionStore();
    start({ store });
    const session = await service.create({ folderId: FOLDER, cwd: workdir, title: 'Kept' });
    await idle(session.id);
    await service.shutdown();

    start({ store });
    expect(service.list(), 'sessions after restart').toMatchObject([{ id: session.id, title: 'Kept', folderId: FOLDER, status: 'exited' }]);
    await service.resume(session.id);
    await idle(session.id);
    expect(launches().at(-1)?.args.slice(0, 2), 'launch after restart').toEqual(['--resume', session.id]);
  });
});

describe('close and kill', () => {
  it('ends the process, forgets the session and emits session.closed', async () => {
    const store = new MemorySessionStore();
    start({ store });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    await service.close(session.id);
    expect(service.get(session.id), 'session after close').toBeUndefined();
    expect(store.load(), 'persisted sessions after close').toEqual([]);
    expect(events.at(-1), 'last event').toEqual({ type: 'session.closed', sessionId: session.id });
    expect(events.map((e) => e.type), 'exit before close').toEqual(expect.arrayContaining(['session.exited']));
    expect(existsSync(join(dir, 'events', session.id)), 'hook inbox directory after close').toBe(false);
  });

  it('kills a process that ignores SIGTERM', async () => {
    start({ env: { FAKE_CLAUDE_IGNORE_TERM: '1' } });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    await service.close(session.id);
    const exited = events.find((e) => e.type === 'session.exited');
    expect(exited, 'exit event after SIGKILL').toMatchObject({ signal: 'SIGKILL' });
  });

  it('ends no process twice when close runs concurrently', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    await Promise.all([service.close(session.id), service.close(session.id)]);
    expect(events.filter((e) => e.type === 'session.closed'), 'closed events').toHaveLength(1);
  });

  it('closes an exited session', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, '/exit');
    await until('exited', () => service.get(session.id)?.status === 'exited');
    await service.close(session.id);
    expect(service.list(), 'sessions after closing an exited one').toEqual([]);
  });

  it('shutdown ends every process and keeps the sessions listed', async () => {
    start();
    const a = await service.create({ folderId: FOLDER, cwd: workdir });
    const b = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(a.id);
    await idle(b.id);
    await service.shutdown();
    expect(service.list().map((s) => s.status), 'status of both sessions').toEqual(['exited', 'exited']);
  });

  it('leaves no live process behind', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    const pid = (service as unknown as { entries: Map<string, { process?: { pid: number } }> }).entries.get(session.id)?.process?.pid;
    expect(pid, 'process id').toBeTypeOf('number');
    await service.close(session.id);
    expect(pidAlive(pid as number), 'process alive after close').toBe(false);
  });
});

describe('terminal', () => {
  it('passes the new size to the process on resize', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir, cols: 100, rows: 30 });
    await idle(session.id);
    expect(output(session.id), 'initial size').toContain('size=100x30');
    service.resize(session.id, 80, 24);
    await until('resized output', () => output(session.id).includes('size=80x24'));
  });

  it('rejects a size that is not a positive integer and a resize after exit', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    expect(() => service.resize(session.id, 0, 24), 'zero columns').toThrowError(RangeError);
    expect(() => service.resize(session.id, 80.5, 24), 'fractional columns').toThrowError(RangeError);
    service.sendText(session.id, '/exit');
    await until('exited', () => service.get(session.id)?.status === 'exited');
    expect(() => service.resize(session.id, 80, 24), 'resize after exit').toThrowError(/exited/);
  });

  it('keeps recent output so a reloaded renderer can redraw it', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.sendText(session.id, 'remember');
    await until('echo', () => output(session.id).includes('echo: remember'));
    expect(service.readOutput(session.id), 'buffered output').toContain('echo: remember');
  });

  it('writes raw input unchanged', async () => {
    start();
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    await idle(session.id);
    service.write(session.id, 'raw');
    service.write(session.id, '\r');
    await until('turn', () => output(session.id).includes('echo: raw'));
  });
});

describe('folder', () => {
  it('follows a moved leaf and persists the new folder', async () => {
    const store = new MemorySessionStore();
    start({ store });
    const session = await service.create({ folderId: FOLDER, cwd: workdir });
    service.setFolder(session.id, 'folder-2');
    expect(service.get(session.id)?.folderId, 'folder after move').toBe('folder-2');
    expect(store.load()[0]?.folderId, 'persisted folder').toBe('folder-2');
  });
});
