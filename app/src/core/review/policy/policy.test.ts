import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, sh, write, type Repo } from '../capture/gitFixtures';
import { mergeOverlay } from './mergePolicy';
import { GitPolicyLoader } from './GitPolicyLoader';
import { DEFAULT_REVIEW_POLICY, POLICY_MAX_BYTES, POLICY_PATH, reviewPolicySchema, type UserPolicy } from './schema';

let repo: Repo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
});

const loader = new GitPolicyLoader();
const commit = (r: Repo, files: Record<string, string>, message: string): string => {
  for (const [path, content] of Object.entries(files)) write(join(r.main, path), content);
  sh(r.main, ['add', '-A']);
  sh(r.main, ['commit', '-q', '--no-verify', '-m', message]);
  return sh(r.main, ['rev-parse', 'HEAD']).trim();
};
const load = (r: Repo, base: string, overlay?: UserPolicy) => loader.load({ repoPath: r.main, commonDir: r.commonDir }, base, overlay);
const policyJson = (extra: Record<string, unknown> = {}): string => JSON.stringify({ version: 1, check: { command: ['pnpm', 'test'] }, ...extra });

describe('reading the policy from the base commit', () => {
  it('uses the default policy and source default when the file is missing', async () => {
    repo = makeRepo({ 'a.txt': 'x\n' });
    const snapshot = await load(repo, repo.base);
    expect([snapshot.source, snapshot.projectJson, snapshot.errors], 'a missing file is the default').toEqual(['default', null, null]);
    expect(snapshot.effective, 'the default policy has the schema defaults and no check').toEqual(DEFAULT_REVIEW_POLICY);
    expect(snapshot.effective.check, 'no check command').toBeUndefined();
  });

  it('reads and validates the file of the base commit', async () => {
    repo = makeRepo({ [POLICY_PATH]: policyJson({ retryLimit: 1, paths: { sensitive: ['src/auth/**'] } }) });
    const snapshot = await load(repo, repo.base);
    expect(snapshot.source, 'the file was read').toBe('base');
    expect(snapshot.effective.check?.command, 'the check command of the file').toEqual(['pnpm', 'test']);
    expect([snapshot.effective.retryLimit, snapshot.effective.paths.sensitive], 'fields of the file with defaults for the rest').toEqual([1, ['src/auth/**']]);
    expect(snapshot.hash, 'the hash is a SHA-256').toMatch(/^[0-9a-f]{64}$/);
  });

  it('never reads the work tree: a later commit and an uncommitted edit do not change the policy of the base', async () => {
    repo = makeRepo({ [POLICY_PATH]: policyJson({ retryLimit: 1 }) });
    const first = await load(repo, repo.base);
    commit(repo, { [POLICY_PATH]: policyJson({ retryLimit: 5 }) }, 'agent branch edits the policy');
    writeFileSync(join(repo.main, POLICY_PATH), policyJson({ retryLimit: 0, check: { command: ['true'] } }));
    const again = await load(repo, repo.base);
    expect(again.hash, 'the policy of the base commit is the same after edits elsewhere').toBe(first.hash);
    expect(again.effective.retryLimit, 'the base value holds').toBe(1);
    expect(again.effective.check?.command, 'the edited check command is not used').toEqual(['pnpm', 'test']);
  });

  it('reads another policy from another base commit', async () => {
    repo = makeRepo({ [POLICY_PATH]: policyJson({ retryLimit: 1 }) });
    const second = commit(repo, { [POLICY_PATH]: policyJson({ retryLimit: 4 }) }, 'second');
    expect((await load(repo, second)).effective.retryLimit, 'the file of the chosen base').toBe(4);
  });

  it.each([
    ['not JSON', '{ nope'],
    ['an unknown key', JSON.stringify({ version: 1, surprise: true })],
    ['a shell string as the command', JSON.stringify({ version: 1, check: { command: 'pnpm test' } })],
    ['a wrong version', JSON.stringify({ version: 2 })],
    ['an unknown class in outward', JSON.stringify({ version: 1, outward: { 'no.such.class': 'allow' } })],
  ])('treats %s as invalid, uses the default policy and keeps the issues', async (_name, content) => {
    repo = makeRepo({ [POLICY_PATH]: content });
    const snapshot = await load(repo, repo.base);
    expect(snapshot.source, 'a malformed file is invalid').toBe('invalid');
    expect(snapshot.errors?.length, 'the issues are kept').toBeGreaterThan(0);
    expect(snapshot.effective, 'the default policy applies').toEqual(DEFAULT_REVIEW_POLICY);
  });

  it('refuses a file that is a symbolic link, without reading its target', async () => {
    repo = makeRepo({ 'real.json': policyJson() });
    mkdirSync(join(repo.main, '.agide'));
    symlinkSync('../real.json', join(repo.main, POLICY_PATH));
    sh(repo.main, ['add', '-A']);
    sh(repo.main, ['commit', '-q', '--no-verify', '-m', 'link']);
    const snapshot = await load(repo, sh(repo.main, ['rev-parse', 'HEAD']).trim());
    expect([snapshot.source, snapshot.effective.check], 'a link counts as malformed and its target is ignored').toEqual(['invalid', undefined]);
    expect(snapshot.errors?.[0], 'the issue names the kind').toContain('symbolic link');
  });

  it('refuses a file over the size limit and one that is not UTF-8', async () => {
    repo = makeRepo({ [POLICY_PATH]: JSON.stringify({ version: 1, notes: 'x'.repeat(POLICY_MAX_BYTES) }) });
    expect((await load(repo, repo.base)).errors?.[0], 'a large file is malformed').toContain('the limit');
    writeFileSync(join(repo.main, POLICY_PATH), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    sh(repo.main, ['add', '-A']);
    sh(repo.main, ['commit', '-q', '--no-verify', '-m', 'not utf8']);
    const snapshot = await load(repo, sh(repo.main, ['rev-parse', 'HEAD']).trim());
    expect(snapshot.errors?.[0], 'bytes that are not UTF-8 are malformed').toContain('UTF-8');
  });

  it('warns about reason ids in rungs that the catalogue does not know', async () => {
    repo = makeRepo({ [POLICY_PATH]: policyJson({ rungs: { 'made.up_id': 'D', 'deps.changed': 'D' } }) });
    const snapshot = await load(repo, repo.base);
    expect(snapshot.warnings, 'one warning for the unknown id').toEqual(['rungs: made.up_id is not a reason id and is ignored']);
  });
});

describe('policy fields the agents are not yet bound by', () => {
  it('warns that outward and deployCommands are read and not applied, and stays silent without them', async () => {
    repo = makeRepo({ [POLICY_PATH]: policyJson({ outward: { 'slack.send': 'deny' } }) });
    expect((await load(repo, repo.base)).warnings.join(' '), 'outward is named').toContain('outward and deployCommands are read but not applied');
    repo = makeRepo({ [POLICY_PATH]: policyJson({ deployCommands: ['./deploy.sh'] }) });
    expect((await load(repo, repo.base)).warnings.join(' '), 'deployCommands is named').toContain('not applied');
    repo = makeRepo({ [POLICY_PATH]: policyJson({}) });
    expect((await load(repo, repo.base)).warnings, 'a policy without them has no warning').toEqual([]);
  });
});

describe('the user-level overlay only tightens', () => {
  const project = reviewPolicySchema.parse({
    version: 1,
    check: { command: ['pnpm', 'test'], network: 'development', timeoutSeconds: 900 },
    retryLimit: 3,
    paths: { sensitive: ['a/**'], tests: ['t/**'] },
    thresholds: { small: { lines: 100, files: 5 }, dirs: 6, accumulate: 4 },
    rungs: { 'deps.changed': 'C', 'secret.added': 'E' },
    reviewer: { tier: 'mid', effortB: 'medium', timeoutMinutes: 20, maxTurns: 40, usdPerRun: 3, dailyBudgetUsd: 10 },
    outward: { 'slack.send': 'notify' },
    deployCommands: ['./deploy.sh'],
  });
  const merged = (overlay: UserPolicy) => mergeOverlay(project, overlay);

  it('takes the smaller of a number and the smaller of each size field', () => {
    const result = merged({ retryLimit: 1, thresholds: { small: { lines: 500, files: 2 }, dirs: 2, accumulate: 9 }, reviewer: { timeoutMinutes: 5, maxTurns: 90, usdPerRun: 1, dailyBudgetUsd: 20 } });
    expect(result.retryLimit, 'a lower retry limit tightens').toBe(1);
    expect(result.thresholds.small, 'lines keep the project value, files the lower user value').toEqual({ lines: 100, files: 2 });
    expect([result.thresholds.dirs, result.thresholds.accumulate], 'a lower directory threshold tightens, a higher accumulation does not loosen').toEqual([2, 4]);
    expect([result.reviewer.timeoutMinutes, result.reviewer.maxTurns, result.reviewer.usdPerRun, result.reviewer.dailyBudgetUsd], 'budgets and limits take the smaller value').toEqual([5, 40, 1, 10]);
  });

  it('takes the higher rung per id and adds ids', () => {
    const result = merged({ rungs: { 'deps.changed': 'B', 'secret.added': 'A', 'tests.missing': 'D' } });
    expect(result.rungs, 'a lower user rung changes nothing, a new id is added').toEqual({ 'deps.changed': 'C', 'secret.added': 'E', 'tests.missing': 'D' });
    expect(merged({ rungs: { 'deps.changed': 'E' } }).rungs['deps.changed'], 'a higher user rung wins').toBe('E');
  });

  it('does not lower a catalogue default for an id the project does not name', () => {
    const result = mergeOverlay(DEFAULT_REVIEW_POLICY, { rungs: { 'tests.missing': 'A', 'check.none': 'A', 'size.large': 'D' } });
    expect(result.rungs, 'lower rungs keep the defaults, a higher one is taken').toEqual({ 'tests.missing': 'B', 'check.none': 'B', 'size.large': 'D' });
  });

  it('unites the globs and the deploy commands and never narrows the test globs', () => {
    const result = merged({ paths: { sensitive: ['b/**'], tests: ['extra/**'] }, deployCommands: ['./other.sh'] });
    expect(result.paths.sensitive, 'union of sensitive globs').toEqual(['a/**', 'b/**']);
    expect(result.paths.tests, 'union with the project test globs').toEqual(['t/**', 'extra/**']);
    expect(result.deployCommands, 'union of deploy commands').toEqual(['./deploy.sh', './other.sh']);
    const fromDefault = mergeOverlay(DEFAULT_REVIEW_POLICY, { paths: { tests: ['extra/**'] } });
    expect(fromDefault.paths.tests?.includes('**/*.test.*'), 'a user test glob adds to the default globs instead of replacing them').toBe(true);
  });

  it('takes the stronger tier and effort and the stricter outward mode', () => {
    const result = merged({ reviewer: { tier: 'strong', effortB: 'high', effortHuman: 'high' }, outward: { 'slack.send': 'approve', 'github.approve': 'allow' } });
    expect([result.reviewer.tier, result.reviewer.effortB], 'the stronger of project and user').toEqual(['strong', 'high']);
    expect(result.outward['slack.send'], 'approve is stricter than notify').toBe('approve');
    expect(result.outward['github.approve'], 'allow is applied when the project says nothing').toBe('allow');
    expect(merged({ reviewer: { tier: 'mid' }, outward: { 'slack.send': 'allow' } }).outward['slack.send'], 'a looser user mode does not loosen the project').toBe('notify');
    expect(merged({ reviewer: { effortB: 'medium' } }).reviewer.effortB, 'a weaker effort does not weaken the project').toBe('medium');
  });

  it('keeps the project check and lets network none win; the user check applies only without a project check', () => {
    expect(merged({ check: { command: ['other'], network: 'none' } }).check, 'the project command stays, the network becomes none').toMatchObject({ command: ['pnpm', 'test'], network: 'none', timeoutSeconds: 900 });
    expect(merged({ check: { command: ['other'] } }).check?.network, 'a user check that says nothing about the network keeps the project value').toBe('development');
    const sealed = reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'], network: 'none' } });
    expect(mergeOverlay(sealed, { check: { command: ['other'] } }).check?.network, 'a silent user check does not open the network of the project').toBe('none');
    expect(mergeOverlay(sealed, { check: { command: ['other'], network: 'development' } }).check?.network, 'a user check cannot open the network of the project').toBe('none');
    const withoutCheck = mergeOverlay(DEFAULT_REVIEW_POLICY, { check: { command: ['make', 'test'] } });
    expect(withoutCheck.check, 'the user command with the defaults of the schema').toMatchObject({ command: ['make', 'test'], timeoutSeconds: 600, network: 'none', env: [] });
  });

  it('leaves the project policy as it is without an overlay and marks it in the snapshot', async () => {
    expect(mergeOverlay(project, undefined), 'no overlay, no change').toBe(project);
    repo = makeRepo({ [POLICY_PATH]: JSON.stringify({ version: 1, retryLimit: 4 }) });
    const snapshot = await load(repo, repo.base, { retryLimit: 1 });
    expect([snapshot.effective.retryLimit, snapshot.userJson], 'the overlay as applied is stored next to the effective policy').toEqual([1, JSON.stringify({ retryLimit: 1 })]);
    const project2 = await load(repo, repo.base);
    expect(project2.hash === snapshot.hash, 'the overlay changes the effective policy hash').toBe(false);
  });

  it('keeps the policy and reports an overlay that does not validate', async () => {
    repo = makeRepo({ [POLICY_PATH]: JSON.stringify({ version: 1, retryLimit: 4 }) });
    const snapshot = await load(repo, repo.base, { retryLimit: 99 } as unknown as UserPolicy);
    expect(snapshot.effective.retryLimit, 'an invalid overlay is ignored').toBe(4);
    expect(snapshot.errors?.[0], 'the issue says it came from the overlay').toContain('user overlay');
  });
});
