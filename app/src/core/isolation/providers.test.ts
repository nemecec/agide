import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from './FakeProvider';
import { describeIsolationProviderContract } from './isolationProviderContract';
import { ContainerProvider } from './ContainerProvider';
import { HostTools } from './hostTools';
import { LocalProvider } from './LocalProvider';
import { IsolationProviders } from './providerRegistry';
import { SrtProvider } from './SrtProvider';
import { containerTestsUnavailable, findTestSrt, srtTestsUnavailable, TEST_IMAGE } from './testRuntimes';

const FAKE_CLAUDE = join(import.meta.dirname, '..', 'session', 'fixtures', 'fake-claude.mjs');

describeIsolationProviderContract('LocalProvider', (dir) => new LocalProvider({ sessionFilesDir: join(dir, 'sessions'), claudeBinary: FAKE_CLAUDE }));
describeIsolationProviderContract('FakeProvider', (dir) => new FakeProvider({ sessionFilesDir: join(dir, 'sessions') }));
describeIsolationProviderContract(
  'SrtProvider',
  (dir) => new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary: findTestSrt() ?? 'srt', settingsDir: join(dir, 'srt'), claudeBinary: FAKE_CLAUDE }),
  srtTestsUnavailable() === undefined ? {} : { unavailable: srtTestsUnavailable() as string },
);
describeIsolationProviderContract(
  'ContainerProvider',
  (dir) =>
    new ContainerProvider({
      sessionFilesDir: join(dir, 'sessions'),
      dockerBinary: 'docker',
      image: TEST_IMAGE,
      claudeConfigDir: join(dir, 'claude'),
      user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    }),
  containerTestsUnavailable() === undefined ? {} : { unavailable: containerTestsUnavailable() as string },
);

describe('IsolationProviders', () => {
  it('creates each provider once, offers local first and refuses an id without a factory', () => {
    let created = 0;
    const providers = new IsolationProviders(() => {
      created += 1;
      return new FakeProvider({ sessionFilesDir: '/nonexistent' });
    });
    providers.register('srt', () => new SrtProvider({ sessionFilesDir: '/nonexistent/s', srtBinary: 'srt', settingsDir: join(tmpdir(), 'isolation-registry-test') }));
    expect(providers.get('local'), 'same instance on every call').toBe(providers.get('local'));
    expect(created, 'local factory ran once').toBe(1);
    expect(providers.ids(), 'local first, then registered ids').toEqual(['local', 'srt']);
    expect(() => providers.get('openshell'), 'unknown provider').toThrow('not available');
    const first = providers.get('srt');
    providers.reset('srt');
    expect(providers.get('srt'), 'a reset provider is built again from its factory').not.toBe(first);
  });
});

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

  it('gives a process without a terminal the same command as the PTY launch, with the launch variables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-provider-'));
    try {
      const environment = await new LocalProvider({ sessionFilesDir: dir, claudeBinary: FAKE_CLAUDE }).prepare(spec(dir, '/profiles/work/claude'));
      const launch = { sessionId: 's1', cwd: dir, args: ['-p', '--session-id', 's1'], env: { LAUNCH_VAR: 'l' } };
      const command = await environment.processCommand?.(launch);
      expect(command, 'same command as the PTY launch').toEqual(await environment.ptyCommand({ ...launch, cols: 80, rows: 24 }));
      expect(command?.args, 'arguments unchanged').toEqual(['-p', '--session-id', 's1']);
      expect(command?.env['LAUNCH_VAR'], 'launch variable').toBe('l');
      expect(command?.env['CLAUDE_CONFIG_DIR'], 'profile login directory').toBe('/profiles/work/claude');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a clone workspace for a process without a terminal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-provider-'));
    try {
      const environment = await new LocalProvider({ sessionFilesDir: dir, claudeBinary: FAKE_CLAUDE }).prepare({ ...spec(dir, undefined), workspace: { mode: 'clone', remoteUrl: 'u', ref: 'r' } });
      await expect(environment.processCommand?.({ sessionId: 's1', cwd: dir, args: [] }), 'clone workspace').rejects.toMatchObject({ code: 'unsupported' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts the claude that the host tools found outside the workspace, never one that the workspace or a relative PATH entry holds', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'local-provider-')));
    try {
      const planted = join(dir, 'work', 'bin');
      mkdirSync(planted, { recursive: true });
      mkdirSync(join(dir, 'trusted'));
      for (const path of [join(planted, 'claude'), join(dir, 'work', 'claude')]) writeFileSync(path, `#!/bin/sh\ntouch '${join(dir, 'planted')}'\n`, { mode: 0o755 });
      writeFileSync(join(dir, 'trusted', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
      chmodSync(join(dir, 'trusted', 'claude'), 0o755);
      const tools = (appPath: string) => new HostTools({ appPath, fixedDirectories: [] });
      const launch = { sessionId: 's1', cwd: join(dir, 'work'), args: [] };
      const found = await new LocalProvider({ sessionFilesDir: join(dir, 'sessions'), claudeBinary: 'claude', hostTools: tools(['bin', '', '.', planted, join(dir, 'trusted')].join(':')) }).prepare({ ...spec(dir, undefined), workspace: { mode: 'bind', hostPath: join(dir, 'work') } });
      expect((await found.processCommand?.(launch))?.file, 'the claude of the trusted entry').toBe(join(dir, 'trusted', 'claude'));
      const hidden = await new LocalProvider({ sessionFilesDir: join(dir, 'sessions'), claudeBinary: 'claude', hostTools: tools(['bin', '', '.', planted].join(':')) }).prepare({ ...spec(dir, undefined), workspace: { mode: 'bind', hostPath: join(dir, 'work') } });
      await expect(hidden.processCommand?.(launch), 'the only claude is in the workspace').rejects.toThrow('exists only in a directory that an agent may write');
      const relativeOnly = await new LocalProvider({ sessionFilesDir: join(dir, 'sessions'), claudeBinary: 'claude', hostTools: tools(['bin', '.'].join(':')) }).prepare({ ...spec(dir, undefined), workspace: { mode: 'bind', hostPath: join(dir, 'work') } });
      await expect(relativeOnly.processCommand?.({ ...launch, cwd: join(dir, 'work') }), 'a relative entry finds nothing').rejects.toThrow('was not found as an executable');
      expect(existsSync(join(dir, 'planted')), 'no planted claude ran').toBe(false);
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

  it('records the command of a process without a terminal, builds it from the launch and fails when told to', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-provider-'));
    try {
      const fake = new FakeProvider({ sessionFilesDir: dir });
      const environment = await fake.prepare(spec(dir, undefined));
      const command = await environment.processCommand?.({ sessionId: 's1', cwd: dir, args: ['-p'], env: { A: '1' } });
      expect(command, 'built from the launch').toMatchObject({ file: 'claude', args: ['-p'], cwd: dir, env: { A: '1' } });
      fake.failAt.add('processCommand');
      await expect(environment.processCommand?.({ sessionId: 's1', cwd: dir, args: [] }), 'configured failure').rejects.toThrow('fake provider fails at processCommand');
      expect(fake.calls.map((call) => call.step), 'recorded steps').toEqual(['prepare', 'processCommand', 'processCommand']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hands a configured command function the launch of a process without a terminal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-provider-'));
    try {
      const fake = new FakeProvider({ sessionFilesDir: dir, command: (launch) => ({ file: 'stand-in', args: [launch.sessionId], cwd: launch.cwd, env: {} }) });
      const environment = await fake.prepare(spec(dir, undefined));
      expect(await environment.processCommand?.({ sessionId: 's9', cwd: dir, args: [] }), 'function result').toMatchObject({ file: 'stand-in', args: ['s9'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
