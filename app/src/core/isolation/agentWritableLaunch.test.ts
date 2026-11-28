import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execGit } from '../review/capture/guardedGit';
import { GitMerger } from '../review/manager/GitMerger';
import { GhPullRequestReader } from '../tasks/GhPullRequestReader';
import { samplePullRequest } from '../tasks/fixtures/fakeGh';
import { AgentWritableRegistry } from './agentWritable';
import { ContainerProvider } from './ContainerProvider';
import { writeFakeSrt } from './fakeSrt';
import { findExecutable } from './hostLaunch';
import { HostTools, setHostTools } from './hostTools';
import { LocalProvider } from './LocalProvider';
import { NODE_INSTALL_FIX, SrtProvider, srtToolEnvironment } from './SrtProvider';
import { findTestSrt, srtTestsUnavailable } from './testRuntimes';
import type { EnvironmentSpec, IsolationError, ToolLaunch } from './types';
import { AgentWritableStore } from './agentWritableStore';
import { openStore } from '../store/Store';

/**
 * A session whose working directory lies outside the task base. The agent plants `git`, `gh`, `docker`, `srt` and
 * `node` in a directory of its workspace, and an absolute entry of the PATH of the app leads there (`pnpm exec`, a
 * direnv `PATH_add`). Once a launch has made the directory known, none of the programs may start from it.
 */

const PROGRAMS = ['git', 'gh', 'docker', 'srt', 'node'];

let dir: string;
let outside: string;
let appPath: string;
let restore: () => void;
let registry: AgentWritableRegistry;
let spec: EnvironmentSpec;

const markers = (): string[] => (existsSync(join(dir, 'markers')) ? readdirSync(join(dir, 'markers')) : []);
const executable = (path: string, body: string): void => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};
const realGit = findExecutable('git') ?? '/usr/bin/git';

/** Tools over the shared registry and no fixed directory, so a program of the machine never answers. */
const toolsOver = (): HostTools => new HostTools({ appPath, fixedDirectories: [], excluded: () => registry.directories() });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'writable-launch-')));
  outside = join(dir, 'outside');
  mkdirSync(join(dir, 'markers'));
  mkdirSync(join(outside, 'bin'), { recursive: true });
  for (const name of PROGRAMS) executable(join(outside, 'bin', name), `#!/bin/sh\ntouch '${join(dir, 'markers', name)}'\nexit 0\n`);
  mkdirSync(join(dir, 'trusted'));
  writeFakeSrt(join(dir, 'trusted'));
  executable(join(dir, 'trusted', 'node'), '#!/bin/sh\nexit 0\n');
  executable(join(dir, 'trusted', 'docker'), '#!/bin/sh\nexit 0\n');
  executable(join(dir, 'trusted', 'git'), `#!/bin/sh\nexec '${realGit}' "$@"\n`);
  executable(join(dir, 'trusted', 'gh'), `#!/bin/sh\nprintf '%s' '${JSON.stringify(samplePullRequest())}'\n`);
  appPath = [join(outside, 'bin'), join(dir, 'trusted'), dirname(process.execPath)].join(':');
  registry = new AgentWritableRegistry(() => ({ claudeConfigDir: join(dir, 'claude'), agentRoots: [join(dir, 'agents')] }));
  restore = setHostTools(toolsOver());
  spec = {
    key: { profileId: 'default', sessionId: 's1' },
    profile: { claudeConfigDir: join(dir, 'claude'), env: { PATH: '/usr/bin:/bin' }, toolFiles: [] },
    workspace: { mode: 'bind', hostPath: outside },
    network: { mode: 'unrestricted' },
    appEndpoint: { port: 4567 },
  };
});
afterEach(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

const srtProvider = (tools: HostTools = toolsOver()) => new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary: 'srt', settingsDir: join(dir, 'srt'), claudeBinary: '/bin/sh', hostTools: tools, writable: registry });

const checkLaunch = (): ToolLaunch => ({ key: 'check-1', cwd: join(dir, 'agents', 'checkout'), argv: ['sh', '-c', 'echo tests failed; exit 1'], env: { PATH: '/usr/bin:/bin' }, network: 'none', writeDirs: [] });

/** Runs the command of a check the way the executor does and returns its status and output. */
const runCheck = (command: { file: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }) => {
  mkdirSync(join(dir, 'agents', 'checkout'), { recursive: true });
  return spawnSync(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, encoding: 'utf8' });
};

describe('a session outside the task base', () => {
  it('leaves the directory in the lookup until a launch has made it known: the registry holds what is known, never more', () => {
    expect(toolsOver().find('git'), 'nothing has registered the directory yet').toBe(join(outside, 'bin', 'git'));
  });

  it('puts the workspace out of the lookup of every host-side program once the provider prepared the environment', async () => {
    await srtProvider().prepare(spec);
    const tools = toolsOver();
    expect(PROGRAMS.map((name) => tools.find(name)), 'each program comes from the trusted directory').toEqual(PROGRAMS.map((name) => join(dir, 'trusted', name)));
  });

  it('runs the git of a trusted directory for the capture and for a merge, and no stand-in', async () => {
    await srtProvider().prepare(spec);
    const { stdout } = await execGit(['--version'], { env: {}, timeoutMs: 20_000 });
    expect(stdout.toString('utf8'), 'the real git answered the capture call').toContain('git version');
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) => spawnSync(realGit, args, { cwd: repo, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't.invalid' } });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const outcome = await new GitMerger(() => ({})).merge({ repoPath: repo, commonDir: join(repo, '.git'), target: 'main', goal: 'g', steps: [], dryRun: true });
    expect(outcome.ok, 'the merger resolved the branch through the trusted git').toBe(true);
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  it('runs the gh of a trusted directory for the pull request reader', async () => {
    await srtProvider().prepare(spec);
    const pr = await new GhPullRequestReader({ env: () => ({}) }).read({ kind: 'pull-request', host: 'github.com', owner: 'acme', repo: 'app', number: 1 });
    expect([pr.title, markers()], 'the trusted gh answered and no stand-in ran').toEqual([samplePullRequest().title, []]);
  });

  it('starts the docker client of a trusted directory for the check of the container provider', async () => {
    const provider = new ContainerProvider({ sessionFilesDir: join(dir, 'sessions'), dockerBinary: 'docker', image: 'agide-fake-image:0', claudeConfigDir: join(dir, 'claude'), user: '1000:1000', hostTools: toolsOver(), writable: registry });
    await provider.prepare(spec);
    expect(await provider.check(), 'the engine answers and the image is local').toEqual({ ok: true });
    await provider.removeOrphans();
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  it.each([
    ['a fresh instance', false],
    ['a warm instance that found the stand-ins before the directory was known', true],
  ])('starts the srt of a trusted directory for a check with %s and the failing check reads as failed', async (_name, warm) => {
    const tools = toolsOver();
    if (warm) for (const name of ['srt', 'node']) expect(tools.find(name), `the warm instance kept the ${name} of the workspace`).toBe(join(outside, 'bin', name));
    await srtProvider(tools).prepare(spec);
    const command = await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: tools }).toolCommand(checkLaunch());
    expect(command.file, 'the trusted srt').toBe(join(dir, 'trusted', 'srt'));
    const finished = runCheck(command);
    expect([finished.status, finished.stdout.trim()], 'the check failed as its program did').toEqual([1, 'tests failed']);
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  it('refuses to start the check when the only srt and node are the stand-ins of the workspace', async () => {
    rmSync(join(dir, 'trusted', 'srt'));
    rmSync(join(dir, 'trusted', 'node'));
    await srtProvider().prepare(spec);
    await expect(srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: toolsOver() }).toolCommand(checkLaunch()), 'no trusted srt').rejects.toThrow('exists only in a directory that an agent may write');
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  const sandboxed = srtTestsUnavailable() === undefined ? it : it.skip;
  sandboxed('starts the real srt for a failing check and runs none of the stand-ins of the workspace, with a fresh and with a warm instance', async () => {
    const realSrt = findTestSrt()!;
    appPath = [join(outside, 'bin'), dirname(realSrt), dirname(process.execPath), '/usr/bin', '/bin'].join(':');
    rmSync(join(outside, 'bin', 'srt'));
    for (const tools of [toolsOver(), (() => { const warmed = toolsOver(); warmed.find('node'); return warmed; })()]) {
      await srtProvider(tools).prepare(spec);
      const command = await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: tools }).toolCommand(checkLaunch());
      expect(command.file, 'the real srt').toBe(realSrt);
      const finished = runCheck(command);
      expect([finished.status, finished.stdout.includes('tests failed')], `the failing check reads as failed: ${finished.stderr}`).toEqual([1, true]);
    }
    expect(markers(), 'no stand-in ran outside the sandbox').toEqual([]);
  }, 60_000);
});

describe('a session outside the task base, after it was closed and the app started again', () => {
  /** One start of the profile process: a registry over the profile database, with nothing from the session store, and tools over it. */
  const restart = (): { tools: HostTools; close: () => void } => {
    const db = openStore(join(dir, 'app.db'));
    const durable = new AgentWritableRegistry(() => ({ claudeConfigDir: join(dir, 'claude'), agentRoots: [join(dir, 'agents')] }), new AgentWritableStore(db));
    registry = durable;
    return { tools: toolsOver(), close: () => db.close() };
  };

  /** The first start: the provider launches the session in the workspace outside the task base, then the session is closed and the process ends. */
  const launchAndClose = async (): Promise<void> => {
    const first = restart();
    const environment = await srtProvider(first.tools).prepare(spec);
    await environment.processCommand?.({ sessionId: 's1', cwd: outside, args: [] });
    await environment.releaseSession('s1');
    first.close();
  };

  it('still refuses git, gh, docker, srt and node of the workspace', async () => {
    await launchAndClose();
    const second = restart();
    try {
      expect(PROGRAMS.map((name) => second.tools.find(name)), 'each program comes from the trusted directory').toEqual(PROGRAMS.map((name) => join(dir, 'trusted', name)));
      expect(second.tools.path().split(':'), 'the host-side PATH leaves the directory out').not.toContain(join(outside, 'bin'));
      const finished = runCheck(await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: second.tools }).toolCommand(checkLaunch()));
      expect([finished.status, finished.stdout.trim()], 'the failing check reads as failed').toEqual([1, 'tests failed']);
      expect(markers(), 'no stand-in ran').toEqual([]);
    } finally {
      second.close();
    }
  });

  const sandboxed = srtTestsUnavailable() === undefined ? it : it.skip;
  sandboxed('starts the real srt for a failing check and runs none of the stand-ins', async () => {
    const realSrt = findTestSrt()!;
    appPath = [join(outside, 'bin'), dirname(realSrt), dirname(process.execPath), '/usr/bin', '/bin'].join(':');
    rmSync(join(outside, 'bin', 'srt'));
    await launchAndClose();
    const second = restart();
    try {
      const command = await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: second.tools }).toolCommand(checkLaunch());
      expect(command.file, 'the real srt').toBe(realSrt);
      const finished = runCheck(command);
      expect([finished.status, finished.stdout.includes('tests failed')], `the failing check reads as failed: ${finished.stderr}`).toEqual([1, true]);
      expect(markers(), 'no stand-in ran outside the sandbox').toEqual([]);
    } finally {
      second.close();
    }
  }, 60_000);
});

describe('an entry of extraWritePaths that is removed while the app runs', () => {
  it('stays out of the lookup and the host-side PATH, also of a new instance of the tools', async () => {
    let extra: string[] = [outside];
    registry = new AgentWritableRegistry(() => ({ claudeConfigDir: join(dir, 'claude'), extraWritePaths: extra, agentRoots: [join(dir, 'agents')] }));
    expect(toolsOver().find('git'), 'the entry is excluded while the options name it').toBe(join(dir, 'trusted', 'git'));
    extra = [];
    const fresh = toolsOver();
    expect([fresh.find('git'), fresh.path().split(':').includes(join(outside, 'bin'))], 'after the removal: the trusted git, and the directory is not on the PATH').toEqual([join(dir, 'trusted', 'git'), false]);
  });
});

describe('what each provider adds to the registry', () => {
  const sub = (name: string): string => join(dir, name);

  it('the srt provider adds the workspace, the Claude directory, the working directory and the inbox of the launch, and the directories of a check', async () => {
    const environment = await srtProvider().prepare({ ...spec, workspace: { mode: 'bind', hostPath: sub('work') } });
    expect(registry.directories(), 'the workspace and the Claude directory after prepare').toEqual(expect.arrayContaining([sub('work'), sub('claude')]));
    environment.hookDelivery('s1', { inboxHostDir: sub('inbox'), httpPath: '/h', token: 't' });
    await environment.processCommand?.({ sessionId: 's1', cwd: sub('elsewhere'), args: [] });
    expect(registry.directories(), 'the inbox and the working directory after the launch').toEqual(expect.arrayContaining([sub('inbox'), sub('elsewhere')]));
    await environment.toolCommand({ ...checkLaunch(), cwd: sub('checkout'), writeDirs: [sub('clones')] });
    expect(registry.directories(), 'the checkout and the clones after a check start').toEqual(expect.arrayContaining([sub('checkout'), sub('clones')]));
  });

  it('the srt provider adds the extraWritePaths it was built with when it is built, which its sessions may write whatever the profile says later', () => {
    new SrtProvider({ sessionFilesDir: sub('sessions'), srtBinary: 'srt', settingsDir: sub('srt'), claudeBinary: '/bin/sh', hostTools: toolsOver(), writable: registry, extraWritePaths: [sub('cargo')] });
    expect(registry.directories(), 'the entry of the options the provider was built from').toContain(sub('cargo'));
  });

  it('the container provider adds its Claude directory when it is built, the workspace at prepare and every writable mount of a launch', async () => {
    const provider = new ContainerProvider({ sessionFilesDir: sub('sessions'), dockerBinary: 'docker', image: 'agide-fake-image:0', claudeConfigDir: sub('container-claude'), user: '1000:1000', hostTools: toolsOver(), writable: registry });
    expect(registry.directories(), 'the Claude directory that the containers mount writable').toContain(sub('container-claude'));
    const environment = await provider.prepare({ ...spec, workspace: { mode: 'bind', hostPath: sub('work') } });
    expect(registry.directories(), 'the workspace').toContain(sub('work'));
    environment.hookDelivery('s1', { inboxHostDir: sub('inbox'), httpPath: '/h', token: 't' });
    await environment.processCommand?.({ sessionId: 's1', cwd: sub('work'), args: [] });
    expect(registry.directories(), 'the inbox mount').toContain(sub('inbox'));
    await environment.toolCommand({ ...checkLaunch(), cwd: sub('checkout'), writeDirs: [sub('clones')] });
    expect(registry.directories(), 'the mounts of a check').toEqual(expect.arrayContaining([sub('checkout'), sub('clones')]));
  });

  it('the local provider adds nothing, also for a session in the home directory: its agent writes with the rights of the user', async () => {
    const before = registry.directories();
    const provider = new LocalProvider({ sessionFilesDir: sub('sessions'), claudeBinary: '/bin/sh', hostTools: toolsOver() });
    for (const place of [homedir(), dir]) {
      const environment = await provider.prepare({ ...spec, key: { profileId: 'default', sessionId: place }, workspace: { mode: 'bind', hostPath: place } });
      environment.hookDelivery('s1', { inboxHostDir: sub('inbox'), httpPath: '/h', token: 't' });
      await environment.processCommand?.({ sessionId: 's1', cwd: place, args: [] });
    }
    expect(registry.directories(), 'the set is what it was').toEqual(before);
    expect(toolsOver().find('node'), 'the directory of the session is not excluded: the first node of the PATH is used').toBe(join(outside, 'bin', 'node'));
  });
});

describe('a session whose working directory holds the tool directories, such as the home directory', () => {
  const sub = (name: string): string => join(dir, name);
  /** One start of the profile process over the database file: the registry, tools that explain a refusal by the recorded rows, and the providers of the test. */
  const start = () => {
    const db = openStore(join(dir, 'app.db'));
    const durable = new AgentWritableRegistry(() => ({ claudeConfigDir: join(dir, 'claude'), agentRoots: [join(dir, 'agents')] }), new AgentWritableStore(db));
    registry = durable;
    const tools = new HostTools({ appPath, fixedDirectories: [], excluded: () => durable.directories(), recorded: (paths) => durable.recordedHolding(paths) });
    return { db, tools, srt: srtProvider(tools) };
  };

  it('is recorded by the srt provider, and the provider status, a session and a check name the cause, the directory and the command that forgets it', async () => {
    executable(join(dir, 'trusted', 'claude'), '#!/bin/sh\nexit 0\n');
    appPath = join(dir, 'trusted');
    const first = start();
    try {
      // An earlier session in the directory of the tools, then one in its parent: in memory the parent stands for both, the table holds both rows.
      await first.srt.prepare({ ...spec, key: { profileId: 'default', sessionId: 'tools' }, workspace: { mode: 'bind', hostPath: join(dir, 'trusted') } });
      const environment = await first.srt.prepare({ ...spec, workspace: { mode: 'bind', hostPath: dir } });
      await environment.processCommand?.({ sessionId: 's1', cwd: dir, args: [] }).catch(() => undefined);
      expect(new AgentWritableStore(first.db).load(), 'the session directory is a row').toContain(dir);
      const status = await first.srt.check();
      expect(status, 'the status names the cause').toMatchObject({ ok: false, reason: 'The sandbox runtime (srt) lies in a directory that an earlier agent launch made writable (such as the home directory)' });
      const fix = status.ok ? '' : (status.fix ?? '');
      expect(fix, 'the way out names both recorded directories, also the one that memory leaves out, and the command').toContain(`recorded as writable by an agent: ${dir}, ${join(dir, 'trusted')}; after checking that it holds nothing an agent wrote, quit the app and run: sqlite3 '${join(dir, 'app.db')}' "DELETE FROM agent_writable_directories WHERE path IN ('${dir}', '${join(dir, 'trusted')}')"`);
      const local = await new LocalProvider({ sessionFilesDir: sub('local-sessions'), claudeBinary: join(dir, 'trusted', 'claude'), hostTools: first.tools }).check();
      expect(local, 'the local provider names the cause for the Claude CLI').toMatchObject({ ok: false, reason: 'The Claude CLI lies in a directory that an earlier agent launch made writable (such as the home directory)', fix });
      const refused = await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: first.tools }).toolCommand(checkLaunch()).then(() => undefined, (error: unknown) => error as IsolationError);
      expect([refused?.message, refused?.message.includes('/')], 'the reason of a check: the cause, no path').toEqual(['the sandbox runtime (srt) lies in a directory that an earlier agent launch made writable (such as the home directory), so it was not started', false]);
      expect(refused?.detail, 'the detail of the check log: the file and the way out').toBe(`${join(dir, 'trusted', 'srt')}; ${fix}`);
    } finally {
      first.db.close();
    }
    const command = /quit the app and run: (.*)$/.exec((await (async () => { const again = start(); try { const status = await again.srt.check(); return status.ok ? '' : (status.fix ?? ''); } finally { again.db.close(); } })()))?.[1] ?? '';
    expect(spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' }).status, `the command runs: ${command}`).toBe(0);
    const second = start();
    try {
      expect(await second.srt.check(), 'after the row is forgotten the trusted srt is used again').toEqual({ ok: true });
    } finally {
      second.db.close();
    }
  });

  it('names node the same way when srt lies outside the directory and the only node inside it', async () => {
    rmSync(join(dir, 'trusted', 'node'));
    appPath = [join(outside, 'bin'), join(dir, 'trusted')].join(':');
    const first = start();
    try {
      await first.srt.prepare({ ...spec, workspace: { mode: 'bind', hostPath: outside } });
      const status = await first.srt.check();
      expect(status, 'the cause for node').toMatchObject({ ok: false, reason: 'The program that runs the sandbox runtime (node) lies in a directory that an earlier agent launch made writable (such as the home directory), so it was not started' });
      expect(status.ok ? '' : status.fix, 'the way out names the directory').toContain(`recorded as writable by an agent: ${outside};`);
    } finally {
      first.db.close();
    }
  });

  it('gives the generic reason and the install step when nothing recorded holds the program: node of the srt provider, the Claude CLI of the local provider', async () => {
    rmSync(join(dir, 'trusted', 'node'));
    mkdirSync(join(dir, 'cargo', 'bin'), { recursive: true });
    executable(join(dir, 'cargo', 'bin', 'node'), '#!/bin/sh\nexit 0\n');
    executable(join(dir, 'cargo', 'bin', 'claude'), '#!/bin/sh\nexit 0\n');
    appPath = [join(dir, 'cargo', 'bin'), join(dir, 'trusted')].join(':');
    registry = new AgentWritableRegistry(() => ({ claudeConfigDir: join(dir, 'claude'), extraWritePaths: [join(dir, 'cargo')] }));
    const tools = new HostTools({ appPath, fixedDirectories: [], excluded: () => registry.directories(), recorded: (paths) => registry.recordedHolding(paths) });
    expect(await srtProvider(tools).check(), 'node of the profile').toEqual({ ok: false, reason: 'The program that runs the sandbox runtime (node) exists only in a directory that an agent may write, or runs code that lies in one, so it was not started', fix: NODE_INSTALL_FIX });
    expect(await new LocalProvider({ sessionFilesDir: join(dir, 'local-sessions'), claudeBinary: 'claude', hostTools: tools }).check(), 'the Claude CLI of the profile').toEqual({ ok: false, reason: 'The Claude CLI lies in a directory that an agent may write', fix: 'Install Claude Code in a directory that no agent may write, or set AGIDE_CLAUDE_BIN.' });
  });

  it('keeps the generic reason when the profile names the directory that holds srt, which forgetting a row would not change', async () => {
    appPath = join(dir, 'trusted');
    let extra = [join(dir, 'trusted')];
    registry = new AgentWritableRegistry(() => ({ claudeConfigDir: join(dir, 'claude'), extraWritePaths: extra }));
    const named = new HostTools({ appPath, fixedDirectories: [], excluded: () => registry.directories(), recorded: (paths) => registry.recordedHolding(paths) });
    expect(await srtProvider(named).check(), 'the profile names the directory').toMatchObject({ ok: false, reason: 'The sandbox runtime (srt), or the code it runs, lies in a directory that an agent may write' });
    extra = [];
    await Promise.resolve();
    expect(await srtProvider(named).check(), 'once the profile no longer names it, it is a recorded directory').toMatchObject({ ok: false, reason: 'The sandbox runtime (srt) lies in a directory that an earlier agent launch made writable (such as the home directory)' });
  });
});
