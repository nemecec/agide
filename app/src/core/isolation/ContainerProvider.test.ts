import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContainerProvider, ownerIdOf, type ContainerProviderOptions } from './ContainerProvider';
import { containerName } from './dockerArgs';
import { hookCommand } from '../session/hooks';
import { runInPty } from './ptyHarness';
import { containerTestsUnavailable, TEST_IMAGE } from './testRuntimes';
import type { EnvironmentSpec } from './types';

let dir: string;
let spec: EnvironmentSpec;
const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
const provider = (extra: Partial<ContainerProviderOptions> = {}) =>
  new ContainerProvider({
    sessionFilesDir: join(dir, 'sessions'),
    dockerBinary: 'docker',
    image: TEST_IMAGE,
    claudeConfigDir: join(dir, 'claude'),
    user,
    ...extra,
  });
const containerExists = (name: string): boolean => execFileSync('docker', ['ps', '-aq', '--filter', `name=^${name}$`], { encoding: 'utf8' }).trim() !== '';

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'container-provider-')));
  mkdirSync(join(dir, 'work'));
  spec = {
    key: { profileId: 'default' },
    profile: { claudeConfigDir: join(dir, 'claude'), env: { PATH: process.env['PATH'] ?? '', HOME: '/Users/host', AWS_SECRET: 'host-secret' }, extraEnv: { PROFILE_VAR: 'p' }, toolFiles: [] },
    workspace: { mode: 'bind', hostPath: join(dir, 'work') },
    network: { mode: 'unrestricted' },
    appEndpoint: { port: 4567 },
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ContainerProvider check', () => {
  it('says that Docker is not installed and where to get it', async () => {
    const check = await provider({ dockerBinary: 'agide-no-such-docker' }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: 'Docker is not installed', fix: expect.stringContaining('Docker Desktop') });
  });

  it('says that the engine is not running when the docker command fails', async () => {
    const fake = join(dir, 'docker');
    writeFileSync(fake, '#!/bin/sh\nexit 1\n');
    chmodSync(fake, 0o755);
    const check = await provider({ dockerBinary: fake }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('not running') });
  });

  it.skipIf(containerTestsUnavailable() !== undefined)('says that an image that is not local is missing, and does not pull it', async () => {
    const image = 'agide-no-such-image:0';
    const check = await provider({ image }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: `The image ${image} is not present locally`, fix: expect.stringContaining('never pulls') });
    const found = execFileSync('docker', ['images', '-q', image], { encoding: 'utf8' }).trim();
    expect(found, 'the check left no image behind').toBe('');
  });
});

describe('ContainerProvider command', () => {
  it('builds docker run with the same-path mounts, the host alias and no secret or host variable in the arguments', async () => {
    const environment = await provider({ ownerId: 'o1' }).prepare(spec);
    const inbox = join(dir, 'inbox');
    environment.hookDelivery('s1', { inboxHostDir: inbox, httpPath: '/h', token: 't' });
    await environment.writeSessionFile('s1', 'mcp.json', '{"token":"secret-token"}');
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: ['--session-id', 's1'], cols: 80, rows: 24, env: { LAUNCH_VAR: 'l' } });
    const sessionDir = join(dir, 'sessions', 's1');
    expect(command.file, 'docker client').toBe('docker');
    expect(command.args.slice(0, 4), 'interactive, removed, init').toEqual(['run', '-it', '--rm', '--init']);
    expect(command.args, 'workspace').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${join(dir, 'work')},dst=${join(dir, 'work')}`]));
    expect(command.args, 'session directory read-only').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${sessionDir},dst=${sessionDir},readonly`]));
    expect(command.args, 'hook inbox').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${inbox},dst=${inbox}`]));
    expect(command.args, 'provider Claude directory').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${join(dir, 'claude')},dst=${join(dir, 'claude')}`]));
    expect(command.args, 'host alias').toEqual(expect.arrayContaining(['--add-host', 'host.docker.internal:host-gateway']));
    expect(command.args.slice(-4), 'image, command, launch arguments last').toEqual([TEST_IMAGE, 'claude', '--session-id', 's1']);
    expect(command.args, 'profile and launch variables enter by name').toEqual(expect.arrayContaining(['-e', 'PROFILE_VAR', '-e', 'LAUNCH_VAR']));
    expect(command.args, 'host HOME is replaced').toEqual(expect.arrayContaining(['-e', 'HOME=/tmp']));
    expect(command.args.includes('AWS_SECRET'), 'a host credential variable does not enter').toBe(false);
    expect(JSON.stringify(command.args), 'no secret in the arguments').not.toContain('secret-token');
    expect(command.env['PROFILE_VAR'], 'values travel in the client environment').toBe('p');
  });

  it('runs a process without a terminal as docker run -i, with the mounts and variables of the PTY launch', async () => {
    const environment = await provider({ ownerId: 'o1' }).prepare(spec);
    const launch = { sessionId: 's1', cwd: join(dir, 'work'), args: ['-p', '--session-id', 's1'], env: { LAUNCH_VAR: 'l' } };
    const command = await environment.processCommand?.(launch);
    const withTerminal = await environment.ptyCommand({ ...launch, cols: 80, rows: 24 });
    expect(command?.args.slice(0, 4), 'interactive without a terminal, removed, init').toEqual(['run', '-i', '--rm', '--init']);
    expect(command?.args.slice(4), 'everything after the flags is the PTY launch').toEqual(withTerminal.args.slice(4));
    expect(command?.args.slice(-4), 'image, command, launch arguments last').toEqual([TEST_IMAGE, 'claude', '-p', '--session-id', 's1'].slice(-4));
    expect(command?.env, 'same client environment').toEqual(withTerminal.env);
  });

  it('uses the provider Claude directory as CLAUDE_CONFIG_DIR even when the profile names another', async () => {
    const environment = await provider().prepare({ ...spec, profile: { ...spec.profile, claudeConfigDir: join(dir, 'profile-claude') } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    expect(command.env['CLAUDE_CONFIG_DIR'], 'the container has its own login').toBe(join(dir, 'claude'));
  });

  it('mounts the gh configuration read-only, because a token in it is readable inside the container', async () => {
    const gh = join(dir, 'gh');
    const environment = await provider().prepare({ ...spec, profile: { ...spec.profile, ghConfigDir: gh } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    expect(command.args, 'gh directory read-only').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${gh},dst=${gh},readonly`]));
  });

  it('says that the inspector hook cannot run in the image, so the permission module leaves it out', () => {
    expect(provider().capabilities.inspectorHook, 'inspector unavailable').toBe('unavailable');
  });

  it('points the MCP endpoint at the host alias and gives the server the matching Host value', async () => {
    const environment = await provider().prepare(spec);
    expect(environment.mcpEndpoint('s1'), 'endpoint').toEqual({ url: 'http://host.docker.internal:4567/mcp/s1', hostHeader: 'host.docker.internal:4567' });
  });
});

const docker = containerTestsUnavailable() === undefined ? describe : describe.skip;

docker(`ContainerProvider on Docker with ${TEST_IMAGE}${containerTestsUnavailable() === undefined ? '' : ` [unavailable: ${containerTestsUnavailable()}]`}`, () => {
  const script = (body: string): string[] => ['sh', '-c', body, 'claude'];

  it('runs the stand-in as the host user with the mounts, writes the hook payload to the inbox and reaches the host MCP server with the token', async () => {
    let seen: { auth: string | undefined; host: string | undefined } | undefined;
    const server = createServer((req, res) => {
      seen = { auth: req.headers.authorization, host: req.headers.host };
      res.end('mcp-ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const inbox = join(dir, 'inbox');
    try {
      const environment = await provider({
        command: script(
          [
            'echo "ready uid=$(id -u) home=$HOME cfg=$CLAUDE_CONFIG_DIR"',
            'echo hello > "$PWD/from-container"; echo "workspace-write=$?"',
            'echo x > "$(dirname "$2")/blocked" 2>/dev/null; echo "session-dir-write=$?"',
            'echo x > "$CLAUDE_CONFIG_DIR/login"; echo "config-write=$?"',
            'printf \'{"hook_event_name":"SessionStart"}\' | sh -c "$1"; echo "hook=$?"',
            `wget -q -T 5 -O - --header "Authorization: Bearer $(cat "$2")" http://host.docker.internal:${port}/ ; echo " mcp=$?"`,
            'echo end',
          ].join('; '),
        ),
      }).prepare({ ...spec, appEndpoint: { port } });
      environment.hookDelivery('s1', { inboxHostDir: inbox, httpPath: '/h', token: 't' });
      const mcpPath = await environment.writeSessionFile('s1', 'mcp.json', 'per-session-token');
      const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [hookCommand(inbox), mcpPath], cols: 80, rows: 24 });
      const run = runInPty(command);
      const readyMs = await run.until(/ready uid=/, 30_000);
      await run.until(/end/, 30_000);
      await run.exited;
      const output = run.output();
      console.info(`[latency] container start to first output: ${readyMs} ms`);
      expect(output, 'runs as the host user').toContain(`uid=${user.split(':')[0]}`);
      expect(output, 'HOME is the container one, CLAUDE_CONFIG_DIR the provider directory').toContain(`home=/tmp cfg=${join(dir, 'claude')}`);
      expect(output, 'workspace is writable').toContain('workspace-write=0');
      expect(readFileSync(join(dir, 'work', 'from-container'), 'utf8'), 'file written in the container is on the host').toBe('hello\n');
      expect(statSync(join(dir, 'work', 'from-container')).uid, 'owned by the host user').toBe(process.getuid?.());
      expect(output, 'the session directory is read-only').toMatch(/session-dir-write=[1-9]/);
      expect(output, 'the provider Claude directory is writable').toContain('config-write=0');
      expect(output, 'the hook command succeeds').toContain('hook=0');
      expect(existsSync(inbox) && statSync(inbox).isDirectory(), 'inbox exists on the host').toBe(true);
      expect(output, 'MCP request answered through the host alias').toContain('mcp-ok');
      expect(seen?.auth, 'the per-session token arrived').toBe('Bearer per-session-token');
      expect(seen?.host, 'Host header is the alias').toBe(`host.docker.internal:${port}`);
      await environment.releaseSession('s1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 90_000);

  it('removes the container when the client gets SIGTERM, and with docker kill on SIGKILL when SIGTERM is ignored', async () => {
    for (const [signal, body] of [
      ['SIGTERM', 'echo ready; exec sleep 60'],
      ['SIGKILL', "trap '' TERM INT; echo ready; while true; do sleep 1; done"],
    ] as const) {
      const environment = await provider({ command: script(body) }).prepare({ ...spec, key: { profileId: 'default', sessionId: `t-${signal.toLowerCase()}` } });
      const sessionId = `t-${signal.toLowerCase()}`;
      const command = await environment.ptyCommand({ sessionId, cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
      const run = runInPty(command);
      await run.until(/ready/, 30_000);
      expect(containerExists(containerName(sessionId)), `${signal}: container runs`).toBe(true);
      environment.attach(sessionId, run.pid);
      await environment.terminate(sessionId, signal);
      await run.exited;
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(containerExists(containerName(sessionId)), `${signal}: container is gone`).toBe(false);
    }
  }, 90_000);

  it('removes only the containers of its owner at start-up', async () => {
    const owner = `test-${Date.now()}`;
    const mine = provider({ ownerId: owner, command: script('echo ready; exec sleep 60') });
    const environment = await mine.prepare({ ...spec, key: { profileId: 'default', sessionId: 'orphan' } });
    const command = await environment.ptyCommand({ sessionId: 'orphan', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    const run = runInPty(command);
    await run.until(/ready/, 30_000);
    process.kill(run.pid, 'SIGKILL');
    await run.exited;
    expect(containerExists(containerName('orphan')), 'SIGKILL of the client leaves the container').toBe(true);
    await provider({ ownerId: ownerIdOf('another-data-dir') }).removeOrphans();
    expect(containerExists(containerName('orphan')), 'another owner leaves it alone').toBe(true);
    await mine.removeOrphans();
    expect(containerExists(containerName('orphan')), 'its owner removes it').toBe(false);
  }, 60_000);
});
