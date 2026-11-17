import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from './FakeProvider';
import { describeIsolationProviderContract } from './isolationProviderContract';
import { LocalProvider } from './LocalProvider';

const FAKE_CLAUDE = join(import.meta.dirname, '..', 'session', 'fixtures', 'fake-claude.mjs');

describeIsolationProviderContract('LocalProvider', (dir) => new LocalProvider({ sessionFilesDir: join(dir, 'sessions'), claudeBinary: FAKE_CLAUDE }));
describeIsolationProviderContract('FakeProvider', (dir) => new FakeProvider({ sessionFilesDir: join(dir, 'sessions') }));

const spec = (dir: string, claudeConfigDir: string | undefined) => ({
  key: { profileId: 'default' },
  profile: { claudeConfigDir, env: { PATH: '/bin', CLAUDECODE: '1', HOME: dir }, toolFiles: [] },
  workspace: { mode: 'bind' as const, hostPath: dir },
  network: { mode: 'unrestricted' as const },
  appEndpoint: { port: 1 },
});

describe('LocalProvider launch', () => {
  it('spawns the claude binary itself with the profile environment, scrubbed as milestone 1 does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-provider-'));
    try {
      const environment = await new LocalProvider({ sessionFilesDir: dir, claudeBinary: FAKE_CLAUDE }).prepare(spec(dir, '/profiles/work/claude'));
      const command = await environment.ptyCommand({ sessionId: 's1', cwd: dir, args: ['--session-id', 's1'], cols: 80, rows: 24 });
      expect(command.file, 'the binary is spawned directly').toBe(FAKE_CLAUDE);
      expect(command.cwd, 'working directory unchanged').toBe(dir);
      expect(command.env['CLAUDE_CONFIG_DIR'], 'profile Claude directory').toBe('/profiles/work/claude');
      expect(command.env['CLAUDECODE'], 'variables of a parent Claude session are removed').toBeUndefined();
      expect(command.env['TERM'], 'terminal type set').toBe('xterm-256color');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves CLAUDE_CONFIG_DIR unset for a profile on the CLI default login', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-provider-'));
    try {
      const environment = await new LocalProvider({ sessionFilesDir: dir, claudeBinary: FAKE_CLAUDE }).prepare(spec(dir, undefined));
      const command = await environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 });
      expect(command.env['CLAUDE_CONFIG_DIR'], 'no Claude directory variable').toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing binary in its check', async () => {
    const check = await new LocalProvider({ sessionFilesDir: '/nonexistent', claudeBinary: '/nonexistent/claude' }).check();
    expect(check.ok, 'check fails for a missing binary').toBe(false);
  });
});

describe('FakeProvider', () => {
  it('records the calls and fails at the step it is told to', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-provider-'));
    try {
      const fake = new FakeProvider({ sessionFilesDir: dir });
      const environment = await fake.prepare(spec(dir, undefined));
      fake.failAt.add('ptyCommand');
      await expect(environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 }), 'configured failure').rejects.toThrow(
        'fake provider fails at ptyCommand',
      );
      expect(fake.calls.map((call) => call.step), 'recorded steps').toEqual(['prepare', 'ptyCommand']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
