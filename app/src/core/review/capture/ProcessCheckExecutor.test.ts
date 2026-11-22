import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from '../policy/schema';
import type { CheckRecord } from '../schemas';
import type { CheckRequest } from '../types';
import { ProcessCheckExecutor, type CheckEnvironment, type CheckExecutorDeps } from './ProcessCheckExecutor';
import { cacheEnvironment, checkCacheDirectory, checkEnvironment, isScrubbedName } from './checkEnv';
import { srtToolEnvironment } from '../../isolation/index';
import { makeRepo, removeTempDirs, sh, write, tempDir, type Repo } from './gitFixtures';
import { OutputRing } from './outputRing';
import type { ToolLaunch } from '../../isolation/types';

let repo: Repo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
  removeTempDirs();
});

const POLICY_HASH = 'f'.repeat(64);

interface Setup {
  readonly repo: Repo;
  readonly checkpoint: string;
  readonly launches: ToolLaunch[];
  readonly executor: ProcessCheckExecutor;
  readonly request: (command: string[], patch?: Partial<NonNullable<ReviewPolicy['check']>>, changesetId?: string) => CheckRequest;
  readonly scratch: string;
}

function setup(options: { files?: Record<string, string>; checkpointFiles?: Record<string, string>; environment?: CheckEnvironment; maxConcurrent?: number; baseCheck?: CheckRecord } = {}): Setup {
  repo = makeRepo({ '.gitignore': 'stub.txt\n', 'base.txt': 'base\n', ...options.files });
  for (const [path, content] of Object.entries(options.checkpointFiles ?? { 'agent.txt': 'agent\n' })) write(join(repo.main, path), content);
  sh(repo.main, ['add', '-A']);
  sh(repo.main, ['commit', '-q', '--no-verify', '-m', 'checkpoint']);
  const checkpoint = sh(repo.main, ['rev-parse', 'HEAD']).trim();
  const launches: ToolLaunch[] = [];
  const environment: CheckEnvironment = options.environment ?? {
    kind: 'ready',
    environment: {
      toolCommand: async (launch) => {
        launches.push(launch);
        const [file = '', ...args] = launch.argv;
        return { file, args, cwd: launch.cwd, env: { ...launch.env } };
      },
    },
    profileEnv: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', KEEP_ME: 'yes' },
    enforcesNetwork: true,
  };
  const scratch = tempDir('check-scratch');
  const deps: CheckExecutorDeps = {
    environment: async () => environment,
    checkoutRoot: (swarmId, runId) => join(repo!.root, 'checks', swarmId, runId),
    dataDir: join(repo.root, 'data'),
    cacheDirectory: (swarmId) => checkCacheDirectory(join(repo!.root, 'data'), swarmId),
    store: { baseCheck: () => options.baseCheck },
    maxConcurrent: () => options.maxConcurrent ?? 1,
  };
  const executor = new ProcessCheckExecutor(deps);
  const r = repo;
  return {
    repo: r,
    checkpoint,
    launches,
    executor,
    scratch,
    request: (command, patch = {}, changesetId = 'cs_aaaaaaaaaaaaaaaa') => ({
      changesetId,
      swarmId: 'sw1',
      commonDir: r.commonDir,
      checkpointCommit: checkpoint,
      baseCommit: r.base,
      policyHash: POLICY_HASH,
      policy: { ...DEFAULT_REVIEW_POLICY, check: { command, timeoutSeconds: 600, network: 'none', env: [], ...patch } },
    }),
  };
}

const sleeping = (pidFile: string): string[] => ['sh', '-c', `sleep 30 & echo $! > '${pidFile}'; wait`];
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const worktrees = (r: Repo): number => sh(r.main, ['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).length;

describe('running the check', () => {
  it('runs the command in a fresh checkout of the checkpoint and reports a pass with the output', async () => {
    const s = setup();
    const result = await s.executor.run(s.request(['sh', '-c', 'test -f agent.txt && echo checked-ok']));
    expect(result.checkpoint, 'the command passed').toMatchObject({ outcome: 'passed', exitCode: 0, target: 'checkpoint', commitId: s.checkpoint, changesetId: 'cs_aaaaaaaaaaaaaaaa' });
    expect(result.checkpoint.outputTail, 'the output tail').toContain('checked-ok');
    expect(result.base, 'a passing check has no base run').toBeUndefined();
    expect(existsSync(join(repo!.root, 'data', result.checkpoint.outputPath!)), 'the log file exists under the data directory').toBe(true);
    expect(worktrees(repo!), 'the checkout was removed again').toBe(1);
  });

  it('passes the launch to the provider: checkout as working directory, network, no inherited secrets', async () => {
    const s = setup();
    await s.executor.run(s.request(['sh', '-c', 'true'], { network: 'development' }));
    expect(s.launches[0], 'the launch the provider got').toMatchObject({ argv: ['sh', '-c', 'true'], network: 'development' });
    expect(s.launches[0]!.cwd.startsWith(join(repo!.root, 'checks', 'sw1')), 'the working directory is a checkout under the check root').toBe(true);
  });

  it('gives each run a private temporary directory that is writable, named by TMPDIR and removed with the run', async () => {
    const s = setup();
    const record = join(s.scratch, 'tmpdir');
    const result = await s.executor.run(s.request(['sh', '-c', `test -d "$TMPDIR" && touch "$TMPDIR/probe" && echo "$TMPDIR" > '${record}'`]));
    expect(result.checkpoint.outcome, 'the command wrote into its temporary directory').toBe('passed');
    const tmp = readFileSync(record, 'utf8').trim();
    const launch = s.launches[0]!;
    expect([launch.env['TMP'], launch.env['TEMP'], launch.env['TMPDIR']], 'all three names point to the directory').toEqual([tmp, tmp, tmp]);
    expect(launch.writeDirs, 'the provider may write there').toContain(tmp);
    expect(launch.writeDirs.includes(launch.cwd), 'the checkout itself is added by the provider').toBe(false);
    expect(existsSync(tmp), 'the directory is gone after the run').toBe(false);
  });

  it('lets a confined check write only its checkout, its temporary directory and the cache directory of the swarm', async () => {
    const s = setup();
    await s.executor.run(s.request(['sh', '-c', 'true'], { setup: ['sh', '-c', 'true'] }));
    const cache = checkCacheDirectory(join(repo!.root, 'data'), 'sw1');
    for (const launch of s.launches) {
      expect(launch.writeDirs.length, 'the temporary directory and the cache directory').toBe(2);
      expect(launch.writeDirs[1], 'the cache directory of the swarm').toBe(cache);
      expect(launch.writeDirs.some((dir) => dir === '/' || dir === process.env['HOME']), 'no broad directory is writable').toBe(false);
    }
  });

  it('points the home directory and the cache variables of the package managers into the cache directory', async () => {
    const s = setup();
    await s.executor.run(s.request(['sh', '-c', 'true']));
    const cache = checkCacheDirectory(join(repo!.root, 'data'), 'sw1');
    const env = s.launches[0]!.env;
    for (const [name, value] of Object.entries(cacheEnvironment(cache))) expect(env[name], `${name} is set from the cache environment`).toBe(value);
    for (const name of ['HOME', 'XDG_CACHE_HOME', 'npm_config_cache', 'PNPM_HOME', 'CARGO_HOME']) expect(env[name]!.startsWith(`${cache}/`), `${name} points below the cache directory`).toBe(true);
    expect(env['HOME'], 'the profile home directory is replaced even when the profile sets it').not.toBe(process.env['HOME']);
  });

  it('keeps the cache directory between runs of a swarm', async () => {
    const s = setup();
    const first = await s.executor.run(s.request(['sh', '-c', 'mkdir -p "$npm_config_cache" && echo cached > "$npm_config_cache/entry"']));
    expect(first.checkpoint.outcome, 'the first run wrote into the cache').toBe('passed');
    const second = await s.executor.run(s.request(['sh', '-c', 'test -f "$npm_config_cache/entry"']));
    expect(second.checkpoint.outcome, 'the second run finds what the first left').toBe('passed');
  });

  it('keeps the home directory of the profile and sets no cache directory for a check that is not confined', async () => {
    const s = setup({
      environment: {
        kind: 'ready',
        environment: { toolCommand: async (launch) => ({ file: launch.argv[0]!, args: launch.argv.slice(1), cwd: launch.cwd, env: { ...launch.env } }) },
        profileEnv: { PATH: process.env['PATH'] ?? '', HOME: '/home/profile' },
        enforcesNetwork: false,
      },
    });
    const dump = join(s.scratch, 'home.txt');
    await s.executor.run(s.request(['sh', '-c', `echo "$HOME" > '${dump}'`]));
    expect(readFileSync(dump, 'utf8').trim(), 'the profile home directory').toBe('/home/profile');
  });

  it('gives srt write access to the checkout, the temporary directory and the cache directory only', async () => {
    let allowWrite: string[] = [];
    let inside: string[] = [];
    const settingsDir = join(tempDir('srt-settings'), 'srt');
    const srt = srtToolEnvironment({ srtBinary: 'srt', settingsDir });
    const s = setup({
      environment: {
        kind: 'ready',
        environment: {
          toolCommand: async (launch) => {
            await srt.toolCommand(launch);
            inside = [launch.cwd, ...launch.writeDirs].flatMap((dir) => [dir, realpathSync(dir)]);
            allowWrite = (JSON.parse(readFileSync(join(settingsDir, launch.key, 'srt.json'), 'utf8')) as { filesystem: { allowWrite: string[] } }).filesystem.allowWrite;
            return { file: launch.argv[0]!, args: launch.argv.slice(1), cwd: launch.cwd, env: { ...launch.env } };
          },
          release: (key) => srt.release(key),
        },
        profileEnv: { PATH: process.env['PATH'] ?? '' },
        enforcesNetwork: true,
      },
    });
    await s.executor.run(s.request(['sh', '-c', 'true']));
    expect(allowWrite.length > 0 && allowWrite.every((entry) => inside.some((dir) => entry === dir || entry.startsWith(`${dir}/`))), `every writable path of the srt settings is one of the checkout, the temporary directory or the cache directory: ${allowWrite.join(', ')}`).toBe(true);
  });

  it('releases what the environment left for every launch key when the run ends', async () => {
    const released: string[] = [];
    const keys: string[] = [];
    const s = setup({
      environment: {
        kind: 'ready',
        environment: {
          toolCommand: async (launch) => {
            keys.push(launch.key);
            return { file: 'sh', args: ['-c', 'true'], cwd: launch.cwd, env: {} };
          },
          release: (key) => void released.push(key),
        },
        profileEnv: {},
        enforcesNetwork: true,
      },
    });
    await s.executor.run(s.request(['sh', '-c', 'true'], { setup: ['sh', '-c', 'true'] }));
    expect(keys.length, 'a setup and a command launch').toBe(2);
    expect(released, 'each key is released').toEqual(keys);
  });

  it('runs the setup command first in the same checkout', async () => {
    const s = setup();
    const order = join(s.scratch, 'order');
    const ok = await s.executor.run(s.request(['sh', '-c', `echo command >> '${order}'`], { setup: ['sh', '-c', `echo setup >> '${order}'`] }));
    expect(readFileSync(order, 'utf8'), 'setup before command').toBe('setup\ncommand\n');
    expect(ok.checkpoint.outcome, 'both passed').toBe('passed');
  });

  it('ends not_run with the exit code and no base run when the setup fails, since the code was not tested', async () => {
    const s = setup();
    const order = join(s.scratch, 'order');
    const failing = await s.executor.run(s.request(['sh', '-c', `echo command >> '${order}'`], { setup: ['sh', '-c', 'exit 7'] }));
    expect([failing.checkpoint.outcome, failing.checkpoint.exitCode], 'a failed setup is not a failed test run').toEqual(['not_run', 7]);
    expect(failing.checkpoint.notRunReason, 'the reason names the phase and the exit code').toBe('the setup command failed with exit 7; the check command did not run');
    expect(failing.base, 'no base run makes the failure look old').toBeUndefined();
    expect(existsSync(order), 'the command did not run after the failed setup').toBe(false);
  });

  it('does not see ignored files of the agent worktree: a planted stub cannot make the check pass', async () => {
    const s = setup();
    const worktree = s.repo.worktree('agent');
    write(join(worktree, 'stub.txt'), 'planted\n');
    expect(existsSync(join(worktree, 'stub.txt')), 'the stub exists in the agent worktree').toBe(true);
    const result = await s.executor.run(s.request(['sh', '-c', 'test -f stub.txt']));
    expect([result.checkpoint.outcome, result.checkpoint.exitCode], 'the stub is not in the fresh checkout').toEqual(['failed', 1]);
  });
});

describe('base comparison', () => {
  it('runs the base when the check failed and keeps both results', async () => {
    const s = setup();
    const result = await s.executor.run(s.request(['sh', '-c', 'test ! -f agent.txt']));
    expect([result.checkpoint.outcome, result.base?.outcome, result.base?.target, result.base?.commitId, result.base?.changesetId], 'fails on the checkpoint, passes on the base').toEqual(['failed', 'passed', 'base', s.repo.base, null]);
  });

  it('reports a failure that the base shows too', async () => {
    const s = setup();
    const result = await s.executor.run(s.request(['sh', '-c', 'exit 1']));
    expect([result.checkpoint.outcome, result.base?.outcome], 'fails on both').toEqual(['failed', 'failed']);
  });

  it('ends not_run without a base run when a confined check fails with a sandbox denial', async () => {
    const s = setup();
    const result = await s.executor.run(s.request(['sh', '-c', 'echo "npm ERR! Error: EPERM: operation not permitted, mkdir /home/x/.npm" >&2; exit 1']));
    expect([result.checkpoint.outcome, result.checkpoint.exitCode], 'the failure is a denial, not a test result').toEqual(['not_run', 1]);
    expect(result.checkpoint.notRunReason, 'the reason says what the sandbox denied').toContain('the sandbox denied a file access');
    expect(result.base, 'no base run turns the denial into check.failed_on_base').toBeUndefined();
  });

  it('keeps a plain failure with the words of a denial a failure when the check is not confined', async () => {
    const s = setup({
      environment: {
        kind: 'ready',
        environment: { toolCommand: async (launch) => ({ file: launch.argv[0]!, args: launch.argv.slice(1), cwd: launch.cwd, env: { ...launch.env } }) },
        profileEnv: { PATH: process.env['PATH'] ?? '' },
        enforcesNetwork: false,
      },
    });
    const result = await s.executor.run(s.request(['sh', '-c', 'echo EPERM >&2; exit 1']));
    expect(result.checkpoint.outcome, 'nothing confined the check, so the output is a test result').toBe('failed');
  });

  it('reuses the stored base run for the same base and policy', async () => {
    const stored: CheckRecord = { id: 'chk_stored', changesetId: null, target: 'base', commitId: 'a'.repeat(40), policyHash: POLICY_HASH, command: ['x'], outcome: 'failed', notRunReason: null, exitCode: 1, signal: null, durationMs: 1, outputPath: null, outputTail: '', truncated: false, startedAt: 't', endedAt: 't' };
    const s = setup({ baseCheck: stored });
    const result = await s.executor.run(s.request(['sh', '-c', 'exit 1']));
    expect(result.base, 'the stored record is returned and no second process started').toBe(stored);
    expect(s.launches.length, 'one launch only, for the checkpoint').toBe(1);
  });
});

describe('limits', () => {
  it('ends a check at the timeout and leaves no process of its group', async () => {
    const s = setup();
    const pidFile = join(s.scratch, 'pid');
    const started = Date.now();
    const result = await s.executor.run(s.request(sleeping(pidFile), { timeoutSeconds: 1 }));
    expect(result.checkpoint.outcome, 'timed out').toBe('timed_out');
    expect(Date.now() - started, 'ended near the limit, not after the sleep').toBeLessThan(10_000);
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(alive(pid), 'the sleeping child of the check is gone').toBe(false);
    expect(result.base, 'a timeout is not compared with the base').toBeUndefined();
  }, 20_000);

  it('cuts output over the cap and flags it', async () => {
    const s = setup();
    const result = await s.executor.run(s.request(['sh', '-c', 'yes abcdefghij | head -c 3000000']));
    expect(result.checkpoint.truncated, 'bytes were dropped').toBe(true);
    expect(result.checkpoint.outputTail!.length, 'the tail is at most 8,000 characters').toBeLessThanOrEqual(8_000);
    const size = statSync(join(repo!.root, 'data', result.checkpoint.outputPath!)).size;
    expect(size, 'the log keeps about 1 MiB').toBeLessThan(1_100_000);
    expect(size, 'and not less than the first 64 KiB and the last 960 KiB').toBeGreaterThan(1_000_000);
    expect(readFileSync(join(repo!.root, 'data', result.checkpoint.outputPath!), 'utf8'), 'the log says where it dropped bytes').toContain('bytes omitted');
  });

  it('keeps the first and the last bytes of a stream', () => {
    const ring = new OutputRing(4, 6);
    ring.push(Buffer.from('abcdefghij'));
    ring.push(Buffer.from('klmnop'));
    expect(ring.contents().toString().replace(/\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n/, '|'), 'head of 4 and tail of 6').toBe('abcd|klmnop');
    expect(ring.truncated, 'something was dropped').toBe(true);
    const small = new OutputRing(4, 6);
    small.push(Buffer.from('abc'));
    expect([small.contents().toString(), small.truncated], 'short output is whole').toEqual(['abc', false]);
  });

  it('keeps the failure message in the tail of output just over the head size', () => {
    const ring = new OutputRing(8, 64);
    ring.push(Buffer.from('progress FAIL: important\n'));
    expect(ring.tailText(20), 'the tail spans the head and the rest').toBe('ess FAIL: important\n');
    expect(ring.tailText(100), 'all of a short stream').toBe('progress FAIL: important\n');
  });
});

describe('not run', () => {
  it('is not run without a command in the policy', async () => {
    const s = setup();
    const request = { ...s.request(['x']), policy: DEFAULT_REVIEW_POLICY };
    const result = await s.executor.run(request);
    expect([result.checkpoint.outcome, result.checkpoint.notRunReason], 'no command').toEqual(['not_run', 'the policy has no check command']);
  });

  it('is not run when the environment is unavailable, with the reason', async () => {
    const s = setup({ environment: { kind: 'unavailable', why: 'the sandbox runtime is not installed' } });
    const result = await s.executor.run(s.request(['true']));
    expect([result.checkpoint.outcome, result.checkpoint.notRunReason], 'local with the Bash sandbox on and no srt').toEqual(['not_run', 'the sandbox runtime is not installed']);
    expect(s.launches, 'nothing started').toEqual([]);
  });

  it('is not run when the program does not start', async () => {
    const s = setup();
    const result = await s.executor.run(s.request(['/no/such/program']));
    expect(result.checkpoint.outcome, 'a spawn error').toBe('not_run');
    expect(result.checkpoint.notRunReason, 'the reason names the failure').toContain('did not start');
  });

  it('says in the log that a provider does not enforce the network limit', async () => {
    const s = setup({
      environment: { kind: 'ready', environment: { toolCommand: async (launch) => ({ file: launch.argv[0]!, args: launch.argv.slice(1), cwd: launch.cwd, env: { ...launch.env } }) }, profileEnv: { PATH: process.env['PATH'] ?? '' }, enforcesNetwork: false },
    });
    const result = await s.executor.run(s.request(['sh', '-c', 'true']));
    expect(result.checkpoint.outputTail, 'the note is at the top of the output').toContain('does not enforce the network limit');
  });
});

describe('cancel and queue', () => {
  it('ends a running check and its process group', async () => {
    const s = setup();
    const pidFile = join(s.scratch, 'pid');
    const running = s.executor.run(s.request(sleeping(pidFile)));
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    await s.executor.cancel('cs_aaaaaaaaaaaaaaaa');
    const result = await running;
    expect([result.checkpoint.outcome, result.checkpoint.notRunReason], 'cancelled checks end not_run').toEqual(['not_run', 'the check was cancelled']);
    expect(alive(Number(readFileSync(pidFile, 'utf8').trim())), 'the child is gone').toBe(false);
  }, 20_000);

  it('queues checks beyond the limit and lets a cancel drop one that never started', async () => {
    const s = setup({ maxConcurrent: 1 });
    const marker = join(s.scratch, 'second-ran');
    const first = s.executor.run(s.request(['sh', '-c', 'sleep 1'], {}, 'cs_1111111111111111'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = s.executor.run(s.request(['sh', '-c', `touch '${marker}'`], {}, 'cs_2222222222222222'));
    const third = s.executor.run(s.request(['sh', '-c', 'true'], {}, 'cs_3333333333333333'));
    await s.executor.cancel('cs_2222222222222222');
    expect((await second).checkpoint.outcome, 'the cancelled queued check').toBe('not_run');
    expect((await third).checkpoint.outcome, 'the next one runs once the first ended').toBe('passed');
    expect((await first).checkpoint.outcome, 'the first finished').toBe('passed');
    expect(existsSync(marker), 'the cancelled check never ran').toBe(false);
  }, 20_000);

  it('runs queued checks one after the other under a limit of one', async () => {
    const s = setup({ maxConcurrent: 1 });
    const log = join(s.scratch, 'log');
    const command = (name: string): string[] => ['sh', '-c', `echo start-${name} >> '${log}'; sleep 0.3; echo end-${name} >> '${log}'`];
    await Promise.all([s.executor.run(s.request(command('a'), {}, 'cs_aaaaaaaaaaaaaaa1')), s.executor.run(s.request(command('b'), {}, 'cs_aaaaaaaaaaaaaaa2'))]);
    expect(readFileSync(log, 'utf8').split('\n').filter(Boolean), 'no overlap').toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  }, 20_000);
});

describe('environment of the check', () => {
  const profile = { PATH: '/usr/bin:/bin', HOME: '/home/x', KEEP_ME: 'yes', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_SSE_PORT: '1', GH_TOKEN: 't', GITHUB_ACTIONS: 'x', AWS_PROFILE: 'p', DEPLOY_TOKEN: 's', API_KEY: 'k', DB_SECRET: 's', DB_PASSWORD: 'p', EXTRA_TOKEN: 'allowed' };

  it('drops agent credentials and names that look like secrets, sets CI and copies the listed names that are not scrubbed', () => {
    const env = checkEnvironment({ ...profile, LISTED_PLAIN: 'v' }, ['EXTRA_TOKEN', 'ANTHROPIC_API_KEY', 'GH_TOKEN', 'LISTED_PLAIN', 'NOT_THERE']);
    expect(Object.keys(env).sort(), 'what stays').toEqual(['CI', 'HOME', 'KEEP_ME', 'LISTED_PLAIN', 'PATH']);
    expect(env['CI'], 'CI is set').toBe('1');
    expect([env['EXTRA_TOKEN'], env['ANTHROPIC_API_KEY'], env['GH_TOKEN']], 'a policy listing a scrubbed name does not bring it back').toEqual([undefined, undefined, undefined]);
  });

  it.each(['CLAUDE_CODE_X', 'ANTHROPIC_BASE_URL', 'GH_HOST', 'GITHUB_TOKEN', 'AWS_REGION', 'X_TOKEN', 'X_KEY', 'X_SECRET', 'X_PASSWORD'])('scrubs %s', (name) => {
    expect(isScrubbedName(name), `${name} is scrubbed`).toBe(true);
  });

  it.each(['PATH', 'HOME', 'KEYBOARD', 'TOKENIZER', 'LANG'])('keeps %s', (name) => {
    expect(isScrubbedName(name), `${name} is kept`).toBe(false);
  });

  it('gives the running command the scrubbed environment', async () => {
    const s = setup({
      environment: {
        kind: 'ready',
        environment: { toolCommand: async (launch) => ({ file: launch.argv[0]!, args: launch.argv.slice(1), cwd: launch.cwd, env: { ...launch.env } }) },
        profileEnv: { PATH: process.env['PATH'] ?? '', ANTHROPIC_API_KEY: 'secret-1', GH_TOKEN: 'secret-2', KEEP_ME: 'yes', LISTED_NAME: 'allowed' },
        enforcesNetwork: true,
      },
    });
    const dump = join(s.scratch, 'env.txt');
    await s.executor.run(s.request(['sh', '-c', `env > '${dump}'`], { env: ['LISTED_NAME', 'GH_TOKEN'] }));
    const seen = readFileSync(dump, 'utf8');
    expect(seen.includes('secret-1') || seen.includes('secret-2'), 'no credential reached the process').toBe(false);
    expect([seen.includes('KEEP_ME=yes'), seen.includes('CI=1'), seen.includes('LISTED_NAME=allowed')], 'kept, CI and the listed name').toEqual([true, true, true]);
  });
});
