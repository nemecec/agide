import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnvironmentSpec, IsolationProvider } from './types';

const SECRET = 'token-that-must-stay-in-files';

export interface ContractRunOptions {
  /**
   * Set while the provider is a stub: the suite is skipped and its title carries `[pending <owner>]`, so the
   * test report shows which provider still has to pass it.
   */
  readonly pending?: string;
  /** Set when the provider's third-party software is missing on this machine: the suite is skipped with the reason. */
  readonly unavailable?: string;
}

/**
 * Behaviour every `IsolationProvider` must show on this machine. `create(dir)` returns a provider whose host
 * state lives under `dir`. Providers that need third-party software run this suite only where it is installed.
 */
export function describeIsolationProviderContract(name: string, create: (dir: string) => IsolationProvider, options: ContractRunOptions = {}): void {
  const marker = options.pending === undefined ? (options.unavailable === undefined ? '' : ` [unavailable: ${options.unavailable}]`) : ` [pending ${options.pending}]`;
  const suite = marker === '' ? describe : describe.skip;
  suite(`${name} (IsolationProvider contract)${marker}`, () => {
    let dir: string;
    let spec: EnvironmentSpec;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'isolation-contract-'));
      spec = {
        key: { profileId: 'default' },
        profile: { claudeConfigDir: join(dir, 'claude'), env: { PATH: process.env['PATH'] ?? '', AGIDE_TEST: '1' }, toolFiles: [] },
        workspace: { mode: 'bind', hostPath: dir },
        network: { mode: 'unrestricted' },
        appEndpoint: { port: 4567 },
      };
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('passes its own prerequisite check', async () => {
      expect(await create(dir).check(), 'check result').toEqual({ ok: true });
    });

    it('returns the same environment for the same key and another for another session', async () => {
      const provider = create(dir);
      const first = await provider.prepare(spec);
      const again = await provider.prepare(spec);
      const other = await provider.prepare({ ...spec, key: { profileId: 'default', sessionId: 's2' } });
      expect(again.id, 'same key, same environment').toBe(first.id);
      expect(other.id, 'per-session key, another environment').not.toBe(first.id);
      expect(first.provider, 'environment names its provider').toBe(provider.id);
    });

    it('writes session files 0600 in a 0700 directory, readable through the environment', async () => {
      const environment = await create(dir).prepare(spec);
      const envPath = await environment.writeSessionFile('s1', 'mcp.json', `{"token":"${SECRET}"}`);
      const hostPath = environment.paths.toHost(envPath);
      expect(hostPath, 'session file maps to a host path').toBeDefined();
      expect(statSync(hostPath ?? '').mode & 0o777, 'file mode').toBe(0o600);
      expect(statSync(join(hostPath ?? '', '..')).mode & 0o777, 'directory mode').toBe(0o700);
      expect(new TextDecoder().decode(await environment.readFile(envPath)), 'content read back').toContain(SECRET);
    });

    it('refuses a session id that would leave the session directory', async () => {
      const environment = await create(dir).prepare(spec);
      await expect(environment.writeSessionFile('../escape', 'mcp.json', '{}'), 'path separator in the id').rejects.toThrow();
    });

    it('removes the session files on release and on dispose', async () => {
      const environment = await create(dir).prepare(spec);
      const released = environment.paths.toHost(await environment.writeSessionFile('s1', 'settings.json', '{}')) ?? '';
      const disposed = environment.paths.toHost(await environment.writeSessionFile('s2', 'settings.json', '{}')) ?? '';
      await environment.releaseSession('s1');
      expect(() => statSync(released), 'released session file is gone').toThrow();
      await environment.dispose();
      expect(() => statSync(disposed), 'disposed session file is gone').toThrow();
    });

    it('removes one session file and tightens a session directory that exists with a wider mode', async () => {
      const environment = await create(dir).prepare(spec);
      const path = environment.paths.toHost(await environment.writeSessionFile('s1', 'mcp.json', '{}')) ?? '';
      await environment.removeSessionFile('s1', 'mcp.json');
      expect(() => statSync(path), 'the file is gone').toThrow();
      await environment.removeSessionFile('s1', 'mcp.json');
      const sessionDir = join(path, '..');
      chmodSync(sessionDir, 0o755);
      chmodSync(join(sessionDir, '..'), 0o755);
      const again = environment.paths.toHost(await environment.writeSessionFile('s1', 'settings.json', '{}')) ?? '';
      expect(statSync(join(again, '..')).mode & 0o777, 'session directory tightened').toBe(0o700);
      expect(statSync(join(again, '..', '..')).mode & 0o777, 'root of the session directories tightened').toBe(0o700);
    });

    it('builds a PTY command that ends with the launch arguments and carries no secret', async () => {
      const environment = await create(dir).prepare(spec);
      const settingsPath = await environment.writeSessionFile('s1', 'settings.json', `{"token":"${SECRET}"}`);
      const args = ['--session-id', 's1', '--settings', settingsPath];
      const command = await environment.ptyCommand({ sessionId: 's1', cwd: dir, args, cols: 80, rows: 24 });
      expect(command.args.slice(-args.length), 'launch arguments come last, in order').toEqual(args);
      expect(JSON.stringify(command), 'the command holds no token').not.toContain(SECRET);
    });

    it('offers a hook delivery the provider declares and an MCP endpoint on the app port', async () => {
      const provider = create(dir);
      const environment = await provider.prepare(spec);
      const inbox = join(dir, 'inbox');
      const delivery = environment.hookDelivery('s1', { inboxHostDir: inbox, httpPath: '/hooks/s1', token: SECRET });
      expect(provider.capabilities.hookTransports, 'delivery kind is declared').toContain(delivery.kind);
      if (delivery.kind === 'inbox-dir') expect(environment.paths.toHost(delivery.dir), 'inbox maps to the host inbox').toBe(inbox);
      const endpoint = environment.mcpEndpoint('s1');
      expect(endpoint.url, 'per-session MCP path').toMatch(/\/mcp\/s1$/);
      expect(endpoint.url.includes(':4567') || endpoint.hostHeader.includes('4567'), 'endpoint reaches the app port').toBe(true);
    });

    it('adds the launch variables to the command environment and keeps the profile Claude directory', async () => {
      const environment = await create(dir).prepare(spec);
      const command = await environment.ptyCommand({
        sessionId: 's1',
        cwd: dir,
        args: [],
        cols: 80,
        rows: 24,
        env: { AGIDE_LAUNCH: 'yes', CLAUDE_CONFIG_DIR: '/elsewhere' },
      });
      expect(command.env['AGIDE_LAUNCH'], 'launch variable').toBe('yes');
      expect(command.env['CLAUDE_CONFIG_DIR'], 'a launch variable cannot move the login').toBe(environment.paths.toEnv(join(dir, 'claude')));
    });

    it('writes and removes the gate and digest files like the other session files', async () => {
      const environment = await create(dir).prepare(spec);
      for (const name of ['gate.json', 'digest.json'] as const) {
        const path = environment.paths.toHost(await environment.writeSessionFile('s1', name, '{}')) ?? '';
        expect(statSync(path).mode & 0o777, `${name} mode`).toBe(0o600);
        await environment.removeSessionFile('s1', name);
        expect(() => statSync(path), `${name} removed`).toThrow();
      }
    });

    it('ends an attached process on terminate', async () => {
      const environment = await create(dir).prepare(spec);
      const child = spawn('sleep', ['30'], { stdio: 'ignore' });
      const exited = new Promise<NodeJS.Signals | null>((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
      environment.attach('s1', child.pid ?? -1);
      await environment.terminate('s1', 'SIGTERM');
      expect(await exited, 'the process ended on SIGTERM').toBe('SIGTERM');
    });

    it('maps workspace paths there and back', async () => {
      const environment = await create(dir).prepare(spec);
      const hostPath = join(dir, 'src', 'index.ts');
      expect(environment.paths.toHost(environment.paths.toEnv(hostPath)), 'round trip of a workspace path').toBe(hostPath);
    });
  });
}
