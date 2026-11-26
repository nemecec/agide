import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerProvider, ownerIdOf, type ContainerProviderOptions } from './ContainerProvider';
import { CONTAINER_RUN_FLAGS, containerName } from './dockerArgs';
import { fakeDockerClient } from './fakeDocker';
import { HostTools, hostDirectory, SYSTEM_DIRECTORIES } from './hostTools';
import { hookCommand } from '../session/hooks';
import { runInPty } from './ptyHarness';
import { containerTestsUnavailable, TEST_IMAGE } from './testRuntimes';
import { IsolationError, type EnvironmentSpec } from './types';

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

interface FakeDockerBehaviour {
  /** Subcommands that exit with status 1. */
  readonly failing?: readonly string[];
  /** Container ids that `ps` prints, one per line. */
  readonly containers?: readonly string[];
}

/** A `docker` executable that logs its arguments, prints the given container ids for `ps` and exits 0 except for the failing subcommands. */
function fakeDocker({ failing = [], containers = [] }: FakeDockerBehaviour = {}): { binary: string; calls: () => string[] } {
  const binary = join(dir, 'fake-docker');
  const log = join(dir, 'fake-docker-calls.log');
  const lines = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${log}'`,
    'case "$1" in',
    ...failing.map((subcommand) => `  ${subcommand}) exit 1 ;;`),
    `  ps) ${containers.length === 0 ? ':' : `printf '%s\\n' ${containers.join(' ')}`} ;;`,
    'esac',
  ];
  writeFileSync(binary, `${lines.join('\n')}\n`);
  chmodSync(binary, 0o755);
  return { binary, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

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

describe('ContainerProvider check with a fake docker', () => {
  const image = 'agide-fake-image:0';

  it('is ready when the engine answers and the image is local', async () => {
    const docker = fakeDocker();
    const check = await provider({ dockerBinary: docker.binary, image }).check();
    expect(check, 'check result').toEqual({ ok: true });
    expect(docker.calls(), 'the engine version, then the image by name').toEqual(['version --format {{.Server.Version}}', `image inspect --format {{.Id}} ${image}`]);
  });

  it('says that an image that is not local is missing and does not pull it', async () => {
    const docker = fakeDocker({ failing: ['image'] });
    const check = await provider({ dockerBinary: docker.binary, image }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: `The image ${image} is not present locally`, fix: expect.stringContaining('never pulls') });
    expect(docker.calls(), 'the image is looked up and nothing is pulled').toEqual(['version --format {{.Server.Version}}', `image inspect --format {{.Id}} ${image}`]);
  });

  it('does not look for the image when the engine is not running', async () => {
    const docker = fakeDocker({ failing: ['version'] });
    const check = await provider({ dockerBinary: docker.binary, image }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('not running') });
    expect(docker.calls(), 'only the engine is asked').toEqual(['version --format {{.Server.Version}}']);
  });
});

describe('ContainerProvider removeOrphans with a fake docker', () => {
  const ownerFilter = (owner: string): string => `ps -aq --filter label=${CONTAINER_RUN_FLAGS.ownerLabel}=${owner}`;

  it('removes the containers that carry the label of its owner', async () => {
    const docker = fakeDocker({ containers: ['c1', 'c2'] });
    await provider({ dockerBinary: docker.binary, ownerId: 'o1' }).removeOrphans();
    expect(docker.calls(), 'the owner label selects the containers and one forced removal takes them all').toEqual([ownerFilter('o1'), 'rm -f c1 c2']);
  });

  it('removes nothing when no container carries the label', async () => {
    const docker = fakeDocker();
    await provider({ dockerBinary: docker.binary, ownerId: 'o1' }).removeOrphans();
    expect(docker.calls(), 'the list is asked for and no removal follows').toEqual([ownerFilter('o1')]);
  });

  it('does not call docker without an owner, because it could not tell its containers from others', async () => {
    const docker = fakeDocker({ containers: ['c1'] });
    await provider({ dockerBinary: docker.binary }).removeOrphans();
    expect(docker.calls(), 'no docker call').toEqual([]);
  });

  it('lets start-up go on when docker fails', async () => {
    const docker = fakeDocker({ failing: ['ps'], containers: ['c1'] });
    await expect(provider({ dockerBinary: docker.binary, ownerId: 'o1' }).removeOrphans(), 'removeOrphans resolves').resolves.toBeUndefined();
    expect(docker.calls(), 'the list failed and nothing was removed').toEqual([ownerFilter('o1')]);
  });
});

describe('ContainerProvider terminate with a fake docker', () => {
  /** Above the process id range of any host: a signal that got past the recorder would find no process. */
  const CLIENT_PID = 2_147_000_000;

  /** Ends the session `s1` and returns the signals the provider sent, each with the docker calls made before it. */
  async function terminated(docker: ReturnType<typeof fakeDocker>, signal: 'SIGTERM' | 'SIGKILL', clientAttached = true): Promise<{ pid: number; signal: string | number | undefined; dockerCalls: string[] }[]> {
    const sent: { pid: number; signal: string | number | undefined; dockerCalls: string[] }[] = [];
    const recorder = vi.spyOn(process, 'kill').mockImplementation((pid, sentSignal) => {
      sent.push({ pid, signal: sentSignal, dockerCalls: docker.calls() });
      return true;
    });
    try {
      const environment = await provider({ dockerBinary: docker.binary }).prepare({ ...spec, key: { profileId: 'default', sessionId: 's1' } });
      if (clientAttached) environment.attach('s1', CLIENT_PID);
      await environment.terminate('s1', signal);
    } finally {
      recorder.mockRestore();
    }
    return sent;
  }

  it('signals the client with SIGTERM and leaves the removal of the container to the client', async () => {
    const docker = fakeDocker();
    const sent = await terminated(docker, 'SIGTERM');
    expect(sent, 'one SIGTERM to the client, with no docker call before it').toEqual([{ pid: CLIENT_PID, signal: 'SIGTERM', dockerCalls: [] }]);
    expect(docker.calls(), 'docker was not called').toEqual([]);
  });

  it('runs docker kill on the container before it signals the client with SIGKILL', async () => {
    const docker = fakeDocker();
    const sent = await terminated(docker, 'SIGKILL');
    expect(sent, 'one SIGKILL to the client, after docker kill').toEqual([{ pid: CLIENT_PID, signal: 'SIGKILL', dockerCalls: [`kill ${containerName('s1')}`] }]);
  });

  it('signals the client with SIGKILL even when docker kill fails', async () => {
    const docker = fakeDocker({ failing: ['kill'] });
    const sent = await terminated(docker, 'SIGKILL');
    expect(docker.calls(), 'docker kill was tried').toEqual([`kill ${containerName('s1')}`]);
    expect(sent.map((item) => [item.pid, item.signal]), 'the client was signalled').toEqual([[CLIENT_PID, 'SIGKILL']]);
  });

  it('runs docker kill for SIGKILL when no client is attached and signals no process', async () => {
    const docker = fakeDocker();
    const sent = await terminated(docker, 'SIGKILL', false);
    expect(docker.calls(), 'docker kill ran').toEqual([`kill ${containerName('s1')}`]);
    expect(sent, 'no process was signalled').toEqual([]);
  });
});

describe('ContainerProvider command', () => {
  /** The provider over a docker client that is a file of the test, so no engine is needed. */
  const fakeProvider = (extra: Partial<ContainerProviderOptions> = {}) => provider({ dockerBinary: fakeDockerClient(join(dir, 'client')), ...extra });

  it('builds docker run with the same-path mounts, the host alias and no secret or host variable in the arguments', async () => {
    const environment = await fakeProvider({ ownerId: 'o1' }).prepare(spec);
    const inbox = join(dir, 'inbox');
    environment.hookDelivery('s1', { inboxHostDir: inbox, httpPath: '/h', token: 't' });
    await environment.writeSessionFile('s1', 'mcp.json', '{"token":"secret-token"}');
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: ['--session-id', 's1'], cols: 80, rows: 24, env: { LAUNCH_VAR: 'l' } });
    const sessionDir = join(dir, 'sessions', 's1');
    expect(command.file, 'the docker client as an absolute file').toBe(join(dir, 'client', 'docker'));
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
    const environment = await fakeProvider({ ownerId: 'o1' }).prepare(spec);
    const launch = { sessionId: 's1', cwd: join(dir, 'work'), args: ['-p', '--session-id', 's1'], env: { LAUNCH_VAR: 'l' } };
    const command = await environment.processCommand?.(launch);
    const withTerminal = await environment.ptyCommand({ ...launch, cols: 80, rows: 24 });
    expect(command?.args.slice(0, 4), 'interactive without a terminal, removed, init').toEqual(['run', '-i', '--rm', '--init']);
    expect(command?.args.slice(4), 'everything after the flags is the PTY launch').toEqual(withTerminal.args.slice(4));
    expect(command?.args.slice(-4), 'image, command, launch arguments last').toEqual([TEST_IMAGE, 'claude', '-p', '--session-id', 's1'].slice(-4));
    expect(command?.env, 'same client environment').toEqual(withTerminal.env);
  });

  it('uses the provider Claude directory as CLAUDE_CONFIG_DIR even when the profile names another', async () => {
    const environment = await fakeProvider().prepare({ ...spec, profile: { ...spec.profile, claudeConfigDir: join(dir, 'profile-claude') } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    expect(command.env['CLAUDE_CONFIG_DIR'], 'the container has its own login').toBe(join(dir, 'claude'));
  });

  it('mounts the gh configuration read-only, because a token in it is readable inside the container', async () => {
    const gh = join(dir, 'gh');
    const environment = await fakeProvider().prepare({ ...spec, profile: { ...spec.profile, ghConfigDir: gh } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    expect(command.args, 'gh directory read-only').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${gh},dst=${gh},readonly`]));
  });

  it('mounts a tool file read-only and does not create its path as a directory', async () => {
    const toolFile = join(dir, 'gitconfig');
    const environment = await fakeProvider().prepare({ ...spec, profile: { ...spec.profile, toolFiles: [{ hostPath: toolFile, envVar: 'GIT_CONFIG_GLOBAL' }] } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    expect(command.args, 'tool file read-only').toEqual(expect.arrayContaining(['--mount', `type=bind,src=${toolFile},dst=${toolFile},readonly`]));
    expect(existsSync(toolFile), 'the file path stays as the host has it').toBe(false);
  });

  it('says that the inspector hook cannot run in the image, so the permission module leaves it out', () => {
    expect(provider().capabilities.inspectorHook, 'inspector unavailable').toBe('unavailable');
  });

  it('points the MCP endpoint at the host alias and gives the server the matching Host value', async () => {
    const environment = await fakeProvider().prepare(spec);
    expect(environment.mcpEndpoint('s1'), 'endpoint').toEqual({ url: 'http://host.docker.internal:4567/mcp/s1', hostHeader: 'host.docker.internal:4567' });
  });
});

describe('ContainerProvider host-side lookups against what the agent can write', () => {
  /** A `docker` the agent committed: it writes a marker when it runs. */
  const plant = (directory: string): string => {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'docker');
    writeFileSync(path, `#!/bin/sh\ntouch '${join(dir, 'planted')}'\nexit 0\n`, { mode: 0o755 });
    return path;
  };
  /** Looks only on the app PATH it is given, so a docker of the machine in a system directory cannot answer. */
  const tools = (appPath: string): HostTools => new HostTools({ appPath, fixedDirectories: [] });
  const planted = (): boolean => existsSync(join(dir, 'planted'));
  const unsafePath = (...entries: string[]): string => [relative(process.cwd(), join(dir, 'work', 'bin')), '', '.', 'bin', ...entries].join(':');

  it('starts the docker client of the trusted entry, with the trusted PATH and a working directory that holds nothing, whatever the profile PATH and the committed files say', async () => {
    plant(join(dir, 'work', 'bin'));
    plant(join(dir, 'work'));
    const trusted = fakeDockerClient(join(dir, 'client'));
    const environment = await provider({ dockerBinary: 'docker', hostTools: tools(unsafePath(join(dir, 'work', 'bin'), join(dir, 'client'))) }).prepare({ ...spec, profile: { ...spec.profile, env: { PATH: unsafePath(), HOME: '/Users/host' } } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    expect(command.file, 'the docker client outside the workspace').toBe(trusted);
    expect(command.env['PATH'], 'the PATH of the client holds the trusted entry and the system directories').toBe([join(dir, 'client'), ...SYSTEM_DIRECTORIES].join(':'));
    expect(command.cwd, 'the client starts where nothing the agent wrote is').toBe(hostDirectory());
    expect(command.args[command.args.indexOf('-w') + 1], 'the directory inside the container is the workspace').toBe(join(dir, 'work'));
    expect(planted(), 'the committed client did not run').toBe(false);
  });

  it('does the same for a process without a terminal and for a check', async () => {
    plant(join(dir, 'work', 'bin'));
    const trusted = fakeDockerClient(join(dir, 'client'));
    const environment = await provider({ dockerBinary: 'docker', hostTools: tools(unsafePath(join(dir, 'work', 'bin'), join(dir, 'client'))) }).prepare(spec);
    const process = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] });
    const tool = await environment.toolCommand({ key: 'c1', cwd: join(dir, 'work'), argv: ['true'], env: { CI: '1' }, network: 'none', writeDirs: [] });
    expect([process?.file, tool.file, process?.cwd, tool.cwd], 'the trusted client and the empty directory').toEqual([trusted, trusted, hostDirectory(), hostDirectory()]);
    expect(planted(), 'the committed client did not run').toBe(false);
  });

  it('refuses to start when the only docker client is in the workspace, found through an absolute, a relative or an empty entry', async () => {
    plant(join(dir, 'work'));
    for (const appPath of [join(dir, 'work'), relative(process.cwd(), join(dir, 'work')), ':', '.']) {
      const environment = await provider({ dockerBinary: 'docker', hostTools: tools(appPath) }).prepare(spec);
      const failure = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }).catch((error: unknown) => error);
      expect(failure, `PATH ${appPath}`).toBeInstanceOf(IsolationError);
    }
    expect(planted(), 'the committed client did not run').toBe(false);
  });

  it('says that Docker is not installed when the only client is one the agent can write, and runs none of the committed clients for the check or the cleanup', async () => {
    plant(join(dir, 'work'));
    const writable = provider({ dockerBinary: 'docker', hostTools: tools(join(dir, 'work')), ownerId: 'o1' });
    await writable.prepare(spec);
    expect(await writable.check(), 'check result').toMatchObject({ ok: false, reason: 'Docker is not installed' });
    await writable.removeOrphans();
    expect(planted(), 'the committed client did not run for the check or the cleanup').toBe(false);
  });

  /** A trusted directory with a copy of the fake docker that logs its calls, and a provider that finds docker on the planted directory of the workspace first. */
  const withPlanted = (options: Partial<ContainerProviderOptions> = {}) => {
    plant(join(dir, 'work', 'bin'));
    const docker = fakeDocker({ containers: ['c1'] });
    mkdirSync(join(dir, 'trusted'));
    writeFileSync(join(dir, 'trusted', 'docker'), readFileSync(docker.binary), { mode: 0o755 });
    return { docker, scoped: provider({ dockerBinary: 'docker', hostTools: tools(`${join(dir, 'work', 'bin')}:${join(dir, 'trusted')}`), ownerId: 'o1', image: 'agide-fake-image:0', ...options }) };
  };

  it('asks the client of the trusted entry, not the committed one, in the check of the provider', async () => {
    const { docker, scoped } = withPlanted();
    await scoped.prepare(spec);
    expect(await scoped.check(), 'the engine answers and the image is local').toEqual({ ok: true });
    expect(docker.calls().map((call) => call.split(' ')[0]), 'version and the image were asked of the trusted client').toEqual(['version', 'image']);
    expect(planted(), 'the committed client did not run').toBe(false);
  });

  it('removes the orphans through the client of the trusted entry, not the committed one', async () => {
    const { docker, scoped } = withPlanted();
    await scoped.prepare(spec);
    await scoped.removeOrphans();
    expect(docker.calls().map((call) => call.split(' ')[0]), 'the list and the removal went to the trusted client').toEqual(['ps', 'rm']);
    expect(planted(), 'the committed client did not run').toBe(false);
  });

  it('kills the container through the client of the trusted entry, not the committed one', async () => {
    const { docker, scoped } = withPlanted();
    const environment = await scoped.prepare(spec);
    await environment.terminate('s1', 'SIGKILL');
    expect(docker.calls().map((call) => call.split(' ')[0]), 'the kill went to the trusted client').toEqual(['kill']);
    expect(planted(), 'the committed client did not run').toBe(false);
  });

  it('does not take a docker client from a directory below a root of the agents workspaces or below the Claude directory of the provider', async () => {
    for (const root of [join(dir, 'agents', 'swarm', 'tree'), join(dir, 'claude', 'local')]) {
      plant(join(root, 'bin'));
      const scoped = provider({ dockerBinary: 'docker', hostTools: tools(join(root, 'bin')), agentRoots: [join(dir, 'agents')] });
      const environment = await scoped.prepare(spec);
      const failure = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }).catch((error: unknown) => error);
      expect(failure, `the only docker client is below ${relative(dir, root)}`).toBeInstanceOf(IsolationError);
    }
    expect(planted(), 'the committed client did not run').toBe(false);
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
