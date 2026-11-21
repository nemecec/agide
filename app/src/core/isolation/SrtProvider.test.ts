import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInPty } from './ptyHarness';
import { SrtProvider } from './SrtProvider';
import { findTestSrt, srtTestsUnavailable } from './testRuntimes';
import type { EnvironmentSpec } from './types';

let dir: string;
let spec: EnvironmentSpec;
const srtBinary = findTestSrt() ?? 'srt';
const provider = (claudeBinary: string, extra: Partial<ConstructorParameters<typeof SrtProvider>[0]> = {}) =>
  new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary, settingsDir: join(dir, 'srt'), claudeBinary, ...extra });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'srt-provider-')));
  spec = {
    key: { profileId: 'default' },
    profile: { claudeConfigDir: join(dir, 'claude'), env: { PATH: process.env['PATH'] ?? '' }, toolFiles: [] },
    workspace: { mode: 'bind', hostPath: join(dir, 'work') },
    network: { mode: 'allowlist', allow: [{ host: 'example.com' }] },
    appEndpoint: { port: 4567 },
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SrtProvider check', () => {
  it('names the missing runtime and the install step when srt is not installed', async () => {
    const check = await provider('/bin/sh', { srtBinary: 'agide-no-such-srt' }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('not installed'), fix: expect.stringContaining('@anthropic-ai/sandbox-runtime') });
  });

  it('names a configured srt path that is not executable', async () => {
    const check = await provider('/bin/sh', { srtBinary: join(dir, 'missing-srt') }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('is not executable') });
  });

  it('fails when claude is missing', async () => {
    const check = await provider(join(dir, 'missing-claude'), { srtBinary: '/bin/sh' }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('missing-claude') });
  });
});

describe('SrtProvider command', () => {
  it('runs srt with a per-session settings file, the separator and then claude with its arguments', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    environment.hookDelivery('s1', { inboxHostDir: join(dir, 'inbox'), httpPath: '/h', token: 't' });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: ['--session-id', 's1'], cols: 80, rows: 24 });
    const settingsPath = join(dir, 'srt', 's1', 'srt.json');
    expect(command.file, 'srt is the spawned file').toBe(srtBinary);
    expect(command.args, 'settings, separator, claude, arguments').toEqual(['-s', settingsPath, '--', '/bin/claude-stand-in', '--session-id', 's1']);
    expect(statSync(settingsPath).mode & 0o777, 'settings file mode').toBe(0o600);
    expect(statSync(join(dir, 'srt', 's1')).mode & 0o777, 'settings directory mode').toBe(0o700);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { filesystem: { allowWrite: string[] }; network: { allowedDomains: string[] } };
    expect(settings.filesystem.allowWrite, 'workspace, hook inbox and profile Claude directory').toEqual(expect.arrayContaining([join(dir, 'work'), join(dir, 'inbox'), join(dir, 'claude')]));
    expect(settings.network.allowedDomains, 'policy host').toContain('example.com');
  });

  it('gives a process without a terminal the same srt command as the PTY launch', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    const launch = { sessionId: 's1', cwd: join(dir, 'work'), args: ['-p', '--session-id', 's1'], env: { LAUNCH_VAR: 'l' } };
    const command = await environment.processCommand?.(launch);
    expect(command?.args, 'settings, separator, claude, arguments').toEqual(['-s', join(dir, 'srt', 's1', 'srt.json'), '--', '/bin/claude-stand-in', '-p', '--session-id', 's1']);
    expect(command?.env['LAUNCH_VAR'], 'launch variable').toBe('l');
    expect(command, 'same as the PTY command').toEqual(await environment.ptyCommand({ ...launch, cols: 80, rows: 24 }));
  });

  it('removes the settings file on release', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    await environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 });
    await environment.releaseSession('s1');
    expect(() => statSync(join(dir, 'srt', 's1')), 'settings directory is gone').toThrow();
  });

  it('refuses a clone workspace', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare({ ...spec, workspace: { mode: 'clone', remoteUrl: 'u', ref: 'r' } });
    await expect(environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 }), 'clone workspace').rejects.toThrow('host directory');
  });
});

describe('SrtProvider terminate', () => {
  it('ends the children of an attached process group on SIGKILL, which killing the leader alone would not', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    const pidFile = join(dir, 'child.pid');
    const leader = spawn('/bin/sh', ['-c', `sleep 30 & echo $! > ${pidFile}; wait`], { detached: true, stdio: 'ignore' });
    const exited = new Promise((resolve) => leader.once('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const child = Number(readFileSync(pidFile, 'utf8'));
    environment.attach('s1', leader.pid ?? -1);
    await environment.terminate('s1', 'SIGKILL');
    await exited;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const alive = (() => {
      try {
        process.kill(child, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(alive, 'the child of the group is gone').toBe(false);
  });
});

const sandboxed = srtTestsUnavailable() === undefined ? describe : describe.skip;

sandboxed(`SrtProvider under the real sandbox runtime${srtTestsUnavailable() === undefined ? '' : ` [unavailable: ${srtTestsUnavailable()}]`}`, () => {
  const probeScript = (): string => {
    const path = join(dir, 'probe-claude.sh');
    writeFileSync(
      path,
      [
        '#!/bin/sh',
        'touch "$1/inside" 2>/dev/null; echo "inside=$?"',
        'touch "$2/outside" 2>/dev/null; echo "outside=$?"',
        'curl -sS --max-time 8 -o /dev/null https://example.org 2>&1 | head -c 200; echo "denied-done"',
        'curl -sS --max-time 8 -o /dev/null "http://127.0.0.1:$3/" 2>&1; echo "loopback=$?"',
        '[ -t 0 ] && echo "tty=yes"',
        'echo "end"',
      ].join('\n'),
    );
    chmodSync(path, 0o755);
    return path;
  };

  it('enforces the write policy, the network allowlist and the loopback and PTY settings it generates', async () => {
    const workspace = join(dir, 'work');
    const outside = join(dir, 'outside');
    for (const path of [workspace, outside]) spawn('mkdir', ['-p', path]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const server = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const environment = await provider(probeScript()).prepare({ ...spec, workspace: { mode: 'bind', hostPath: workspace } });
      const command = await environment.ptyCommand({ sessionId: 's1', cwd: workspace, args: [workspace, outside, String(port)], cols: 80, rows: 24 });
      const run = runInPty(command);
      await run.until(/end/, 30_000);
      const output = run.output();
      expect(output, 'a write inside the workspace works').toContain('inside=0');
      expect(output, 'a write outside the allowed paths is refused').toMatch(/outside=[1-9]/);
      expect(output, 'a host outside the allowlist is refused by the proxy').toContain('403');
      expect(output, 'the loopback server is reachable (allowLocalBinding)').toContain('loopback=0');
      expect(output, 'the process has a terminal (allowPty)').toContain('tty=yes');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);

  it('ends the sandboxed process on SIGTERM through terminate', async () => {
    const script = join(dir, 'sleeper.sh');
    writeFileSync(script, `#!/bin/sh\necho "$$" > ${join(dir, 'inner.pid')}\necho ready\nexec sleep 30\n`);
    chmodSync(script, 0o755);
    const environment = await provider(script, { extraWritePaths: [dir] }).prepare({ ...spec, workspace: { mode: 'bind', hostPath: dir } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 });
    const run = runInPty(command);
    await run.until(/ready/);
    const inner = Number(readFileSync(join(dir, 'inner.pid'), 'utf8'));
    environment.attach('s1', run.pid);
    await environment.terminate('s1', 'SIGTERM');
    await run.exited;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const alive = (() => {
      try {
        process.kill(inner, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(alive, 'the process inside srt ended').toBe(false);
  }, 30_000);
});

sandboxed('SrtProvider in a session launch', () => {
  const FAKE_CLAUDE = join(import.meta.dirname, '..', 'session', 'fixtures', 'fake-claude.mjs');

  it('starts a session through the session service, delivers hooks through the inbox and takes input, and reports the start latency against the local provider', async () => {
    const { PtySessionService } = await import('../session/PtySessionService');
    const { LocalProvider } = await import('./LocalProvider');
    const times: Record<string, number> = {};
    for (const name of ['local', 'srt', 'local', 'srt']) {
      const workdir = join(dir, `cwd-${name}`);
      spawn('mkdir', ['-p', workdir]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const chosen = name === 'srt' ? provider(FAKE_CLAUDE, { extraWritePaths: [dir] }) : new LocalProvider({ sessionFilesDir: join(dir, 'local-sessions'), claudeBinary: FAKE_CLAUDE });
      const service = new PtySessionService({
        eventsDir: join(dir, `events-${name}`),
        provider: chosen,
        baseEnv: { PATH: process.env['PATH'], FAKE_CLAUDE_RECORD: join(dir, 'launches.jsonl') },
        killTimeoutMs: 500,
      });
      try {
        let printed = '';
        service.subscribe((event) => {
          if (event.type === 'session.output') printed += event.data;
        });
        const started = Date.now();
        const session = await service.create({ folderId: 'f', cwd: workdir });
        const deadline = Date.now() + 20_000;
        while (service.get(session.id)?.status !== 'idle') {
          if (Date.now() > deadline) throw new Error(`${name}: no idle status; output: ${service.get(session.id)?.status}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        times[`${name}${times[name] === undefined ? '' : '-2'}`] = Date.now() - started;
        service.sendText(session.id, 'hi');
        const end = Date.now() + 10_000;
        while (!printed.includes('echo: hi') && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(printed, `${name}: the typed line reaches the process and is echoed`).toContain('echo: hi');
        const idleAgain = Date.now() + 10_000;
        while (service.get(session.id)?.status !== 'idle' && Date.now() < idleAgain) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(service.get(session.id)?.status, `${name}: the Stop hook arrived through the inbox`).toBe('idle');
      } finally {
        await service.shutdown();
      }
    }
    console.info(`[latency] session create to idle, ms: ${JSON.stringify(times)}`);
    expect(Object.keys(times).length, 'both providers started').toBe(4);
  }, 90_000);
});
