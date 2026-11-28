import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCheckEnvironment } from '../review/capture/checkEnvironment';
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

/** A session of the srt provider launched in the workspace outside the task base: the launch records the workspace. */
const launchSrt = async (tools: HostTools = toolsOver()): Promise<void> => {
  const environment = await srtProvider(tools).prepare(spec);
  await environment.processCommand?.({ sessionId: 's1', cwd: outside, args: [] });
};

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

  it('puts the workspace out of the lookup of every host-side program once the provider launched a session there', async () => {
    await launchSrt();
    const tools = toolsOver();
    expect(PROGRAMS.map((name) => tools.find(name)), 'each program comes from the trusted directory').toEqual(PROGRAMS.map((name) => join(dir, 'trusted', name)));
  });

  it('runs the git of a trusted directory for the capture and for a merge, and no stand-in', async () => {
    await launchSrt();
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
    await launchSrt();
    const pr = await new GhPullRequestReader({ env: () => ({}) }).read({ kind: 'pull-request', host: 'github.com', owner: 'acme', repo: 'app', number: 1 });
    expect([pr.title, markers()], 'the trusted gh answered and no stand-in ran').toEqual([samplePullRequest().title, []]);
  });

  it('starts the docker client of a trusted directory for the check of the container provider', async () => {
    const provider = new ContainerProvider({ sessionFilesDir: join(dir, 'sessions'), dockerBinary: 'docker', image: 'agide-fake-image:0', claudeConfigDir: join(dir, 'claude'), user: '1000:1000', hostTools: toolsOver(), writable: registry });
    await (await provider.prepare(spec)).processCommand?.({ sessionId: 's1', cwd: outside, args: [] });
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
    await launchSrt(tools);
    const command = await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: tools }).toolCommand(checkLaunch());
    expect(command.file, 'the trusted srt').toBe(join(dir, 'trusted', 'srt'));
    const finished = runCheck(command);
    expect([finished.status, finished.stdout.trim()], 'the check failed as its program did').toEqual([1, 'tests failed']);
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  it('refuses to start the check when the only srt and node are the stand-ins of the workspace', async () => {
    await launchSrt();
    rmSync(join(dir, 'trusted', 'srt'));
    rmSync(join(dir, 'trusted', 'node'));
    await expect(srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: toolsOver() }).toolCommand(checkLaunch()), 'no trusted srt').rejects.toThrow('exists only in a directory that an agent may write');
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  const sandboxed = srtTestsUnavailable() === undefined ? it : it.skip;
  sandboxed('starts the real srt for a failing check and runs none of the stand-ins of the workspace, with a fresh and with a warm instance', async () => {
    const realSrt = findTestSrt()!;
    appPath = [join(outside, 'bin'), dirname(realSrt), dirname(process.execPath), '/usr/bin', '/bin', join(dir, 'trusted')].join(':');
    rmSync(join(outside, 'bin', 'srt'));
    for (const tools of [toolsOver(), (() => { const warmed = toolsOver(); warmed.find('node'); return warmed; })()]) {
      await launchSrt(tools);
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
    appPath = [join(outside, 'bin'), dirname(realSrt), dirname(process.execPath), '/usr/bin', '/bin', join(dir, 'trusted')].join(':');
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

describe('a local session outside the task base', () => {
  const work = (): string => join(dir, 'work');
  /** Plants srt, node and git in the workspace after the launch, as its agent can, on the only entry of the app PATH. */
  const plantAfterLaunch = (): void => {
    for (const name of ['srt', 'node', 'git']) executable(join(work(), 'bin', name), `#!/bin/sh\ntouch '${join(dir, 'markers', name)}'\nexit 0\n`);
  };
  /** Launches a local session in the workspace, then plants; returns tools over the registry, set as the shared instance, and the function that puts the previous one back. */
  const launchThenPlant = async (bashSandbox: boolean) => {
    mkdirSync(join(work(), 'bin'), { recursive: true });
    appPath = join(work(), 'bin');
    const tools = toolsOver();
    const back = setHostTools(tools);
    const provider = new LocalProvider({ sessionFilesDir: join(dir, 'sessions'), claudeBinary: '/bin/sh', hostTools: tools, writable: registry, bashSandbox: () => bashSandbox });
    const environment = await provider.prepare({ ...spec, workspace: { mode: 'bind', hostPath: work() } });
    await environment.processCommand?.({ sessionId: 's1', cwd: work(), args: [] });
    plantAfterLaunch();
    return { tools, back };
  };

  it('with the Bash sandbox on: a check and a capture start none of the srt, node and git that the agent planted in its workspace', async () => {
    const { tools, back } = await launchThenPlant(true);
    try {
      const environment = resolveCheckEnvironment({ provider: 'local', bashSandbox: true, profileEnv: {}, srt: { binary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: tools } });
      expect(environment, 'the check ends not_run: no srt outside the workspace').toEqual({ kind: 'unavailable', why: 'the sandbox runtime exists only in a directory that an agent may write' });
      await expect(srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: tools }).toolCommand(checkLaunch()), 'a check start').rejects.toThrow('exists only in a directory that an agent may write');
      await expect(execGit(['--version'], { env: {}, timeoutMs: 20_000 }), 'the git of the capture').rejects.toThrow('exists only in a directory that an agent may write');
      expect(markers(), 'no stand-in ran').toEqual([]);
    } finally {
      back();
    }
  });

  it('with the Bash sandbox off: nothing is recorded, and the check of the profile runs unconfined, as the agent did', async () => {
    const before = registry.directories();
    const { tools, back } = await launchThenPlant(false);
    try {
      expect(registry.directories(), 'the set is what it was').toEqual(before);
      expect(tools.find('srt'), 'the workspace is not excluded').toBe(join(work(), 'bin', 'srt'));
      const environment = resolveCheckEnvironment({ provider: 'local', bashSandbox: false, profileEnv: {}, srt: { binary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: tools } });
      expect(environment.kind === 'ready' && environment.enforcesNetwork, 'a plain check: no srt is looked up and no confinement is claimed').toBe(false);
    } finally {
      back();
    }
  });
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

  it('the srt provider adds the Claude directory at prepare, the workspace, the working directory and the inbox at the launch, and the directories of a check', async () => {
    const environment = await srtProvider().prepare({ ...spec, workspace: { mode: 'bind', hostPath: sub('work') } });
    expect([registry.directories().includes(sub('claude')), registry.directories().includes(sub('work'))], 'after prepare: the Claude directory, not yet the workspace').toEqual([true, false]);
    environment.hookDelivery('s1', { inboxHostDir: sub('inbox'), httpPath: '/h', token: 't' });
    await environment.processCommand?.({ sessionId: 's1', cwd: sub('elsewhere'), args: [] });
    expect(registry.directories(), 'the workspace, the inbox and the working directory after the launch').toEqual(expect.arrayContaining([sub('work'), sub('inbox'), sub('elsewhere')]));
    await environment.toolCommand({ ...checkLaunch(), cwd: sub('checkout'), writeDirs: [sub('clones')] });
    expect(registry.directories(), 'the checkout and the clones after a check start').toEqual(expect.arrayContaining([sub('checkout'), sub('clones')]));
  });

  it('the srt provider adds the extraWritePaths it was built with when it is built, which its sessions may write whatever the profile says later', () => {
    new SrtProvider({ sessionFilesDir: sub('sessions'), srtBinary: 'srt', settingsDir: sub('srt'), claudeBinary: '/bin/sh', hostTools: toolsOver(), writable: registry, extraWritePaths: [sub('cargo')] });
    expect(registry.directories(), 'the entry of the options the provider was built from').toContain(sub('cargo'));
  });

  it('the container provider adds its Claude directory when it is built and every writable mount of a launch, the workspace among them', async () => {
    const provider = new ContainerProvider({ sessionFilesDir: sub('sessions'), dockerBinary: 'docker', image: 'agide-fake-image:0', claudeConfigDir: sub('container-claude'), user: '1000:1000', hostTools: toolsOver(), writable: registry });
    expect(registry.directories(), 'the Claude directory that the containers mount writable').toContain(sub('container-claude'));
    const environment = await provider.prepare({ ...spec, workspace: { mode: 'bind', hostPath: sub('work') } });
    expect(registry.directories(), 'not the workspace before a launch').not.toContain(sub('work'));
    environment.hookDelivery('s1', { inboxHostDir: sub('inbox'), httpPath: '/h', token: 't' });
    await environment.processCommand?.({ sessionId: 's1', cwd: sub('work'), args: [] });
    expect(registry.directories(), 'the workspace and the inbox mount').toEqual(expect.arrayContaining([sub('work'), sub('inbox')]));
    await environment.toolCommand({ ...checkLaunch(), cwd: sub('checkout'), writeDirs: [sub('clones')] });
    expect(registry.directories(), 'the mounts of a check').toEqual(expect.arrayContaining([sub('checkout'), sub('clones')]));
  });

  it('the local provider adds the workspace, the working directory and the inbox of a launch while the Bash sandbox of the profile is on', async () => {
    let sandbox = false;
    const provider = new LocalProvider({ sessionFilesDir: sub('sessions'), claudeBinary: '/bin/sh', hostTools: toolsOver(), writable: registry, bashSandbox: () => sandbox });
    const environment = await provider.prepare({ ...spec, workspace: { mode: 'bind', hostPath: sub('work') } });
    environment.hookDelivery('s1', { inboxHostDir: sub('inbox'), httpPath: '/h', token: 't' });
    await environment.processCommand?.({ sessionId: 's1', cwd: sub('elsewhere'), args: [] });
    expect(registry.directories(), 'nothing while the Bash sandbox is off').not.toEqual(expect.arrayContaining([sub('work')]));
    sandbox = true;
    await environment.processCommand?.({ sessionId: 's1', cwd: sub('elsewhere'), args: [] });
    expect(registry.directories(), 'the workspace, the working directory and the inbox once it is on').toEqual(expect.arrayContaining([sub('work'), sub('elsewhere'), sub('inbox')]));
  });

  it('the local provider adds nothing without the Bash sandbox, also for a session in the home directory: its agent writes with the rights of the user', async () => {
    const before = registry.directories();
    const provider = new LocalProvider({ sessionFilesDir: sub('sessions'), claudeBinary: '/bin/sh', hostTools: toolsOver(), writable: registry, bashSandbox: () => false });
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

  it('refuses an srt session there before it records anything, so the status and a check keep the srt and node of that directory', async () => {
    appPath = join(dir, 'trusted');
    const first = start();
    try {
      const environment = await first.srt.prepare({ ...spec, workspace: { mode: 'bind', hostPath: dir } });
      const refused = await environment.processCommand?.({ sessionId: 's1', cwd: dir, args: [] }).then(() => undefined, (error: unknown) => error as IsolationError);
      expect([refused?.message, refused?.detail], 'the fixed reason names the program, the detail its file').toEqual(['the directory of this session holds the srt that the app starts outside any sandbox, where its agent could replace it, so the session was not started', join(dir, 'trusted', 'srt')]);
      expect(new AgentWritableStore(first.db).load(), 'no row for the refused launch').not.toContain(dir);
      expect(await first.srt.check(), 'the provider can still be used').toEqual({ ok: true });
      const command = await srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: first.tools }).toolCommand(checkLaunch());
      expect(command.file, 'a check starts the srt of that directory').toBe(join(dir, 'trusted', 'srt'));
    } finally {
      first.db.close();
    }
  });

  it('refuses a local session there while the Bash sandbox is on, and records nothing', async () => {
    appPath = join(dir, 'trusted');
    const first = start();
    try {
      const local = new LocalProvider({ sessionFilesDir: sub('local-sessions'), claudeBinary: '/bin/sh', hostTools: first.tools, writable: registry, bashSandbox: () => true });
      const environment = await local.prepare({ ...spec, workspace: { mode: 'bind', hostPath: dir } });
      await expect(environment.processCommand?.({ sessionId: 's1', cwd: dir, args: [] }), 'the launch is refused: the directory holds git, srt and the other host programs').rejects.toThrow(/^the directory of this session holds the (git|gh|docker|node|srt) that the app starts outside any sandbox/);
      expect(new AgentWritableStore(first.db).load(), 'no row for the refused launch').not.toContain(dir);
    } finally {
      first.db.close();
    }
  });

  it('names the cause, the directories and the command that forgets them for rows that an earlier build or a stored session left, in the provider status, a session and a check', async () => {
    executable(join(dir, 'trusted', 'claude'), '#!/bin/sh\nexit 0\n');
    appPath = join(dir, 'trusted');
    // Rows of a directory of the tools and of its parent: in memory the parent stands for both, the table holds both.
    const seed = openStore(join(dir, 'app.db'));
    new AgentWritableStore(seed).record([join(dir, 'trusted'), dir]);
    seed.close();
    const first = start();
    try {
      const status = await first.srt.check();
      expect(status, 'the status names the cause').toMatchObject({ ok: false, reason: 'The sandbox runtime (srt) lies in a directory that an earlier agent launch made writable (such as the home directory)' });
      const fix = status.ok ? '' : (status.fix ?? '');
      expect(fix, 'the way out names both recorded directories, also the one that memory leaves out, and the command, each part one shell word').toContain(`recorded as writable by an agent: ${dir}, ${join(dir, 'trusted')}; after checking that it holds nothing an agent wrote, quit the app and run: sqlite3 '${join(dir, 'app.db')}' 'DELETE FROM agent_writable_directories WHERE path IN ('\\''${dir}'\\'', '\\''${join(dir, 'trusted')}'\\'')'`);
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
      expect(await second.srt.check(), 'after the rows are forgotten the trusted srt is used again').toEqual({ ok: true });
    } finally {
      second.db.close();
    }
  });

  it('names node the same way when srt lies outside the recorded directory and the only node inside it', async () => {
    rmSync(join(dir, 'trusted', 'node'));
    appPath = [join(outside, 'bin'), join(dir, 'trusted')].join(':');
    const seed = openStore(join(dir, 'app.db'));
    new AgentWritableStore(seed).record([outside]);
    seed.close();
    const first = start();
    try {
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
