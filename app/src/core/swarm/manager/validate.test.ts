import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIERS } from '../tiers';
import type { SwarmCaller } from '../types';
import { Git } from '../workspace/git';
import { SwarmWorkspaces } from '../workspace/SwarmWorkspaces';
import { concurrentPairs, globToRegExp, literalPrefix, ownsOverlap, parseDefinition, validateDefinition, type ValidationContext } from './validate';
import { gitTestEnv, makeRepo } from './testRig';

const UI: SwarmCaller = { kind: 'ui' };
const SESSION: SwarmCaller = { kind: 'session', sessionId: 's', folderId: 'f', depth: 0, permissionMode: 'auto' };
const base = (extra: object = {}) => ({ version: 1, goal: 'g', budget: { usdTotal: 1 }, agents: [{ name: 'a', prompt: 'p', workspace: 'scratch' }], ...extra });

describe('definition validation', () => {
  let repo: ReturnType<typeof makeRepo>;
  let context: ValidationContext;
  beforeEach(() => {
    repo = makeRepo();
    const workspaces = new SwarmWorkspaces({ git: new Git(undefined, gitTestEnv), dataRoot: `${repo.dir}-data`, worktreeBase: `${repo.dir}-wt`, appRoot: `${repo.dir}-app` });
    context = { caller: UI, workspaces, tiers: DEFAULT_TIERS, knownRepositories: () => [], knownModels: () => undefined, knownTools: () => undefined };
  });
  afterEach(() => rmSync(repo.dir, { recursive: true, force: true }));

  const issuesOf = async (input: unknown, override: Partial<ValidationContext> = {}): Promise<{ path: string; message: string }[]> => {
    try {
      await validateDefinition(input, { ...context, ...override });
    } catch (error) {
      return (error as { details: { path: string; message: string }[] }).details;
    }
    return [];
  };

  it('reports every schema problem at once with its path, and names the fields that exist for an unknown key', async () => {
    const issues = await issuesOf({ version: 1, goal: '', budget: { usdTotal: 1, dollars: 3 }, agents: [{ name: 'Bad Name', prompt: 'p', tears: 1 }] });
    const byPath = Object.fromEntries(issues.map((issue) => [issue.path, issue.message]));
    expect(Object.keys(byPath).sort(), 'one issue per problem, each with its path').toEqual(['agents.0.name', 'agents.0.tears', 'budget.dollars', 'goal']);
    expect(byPath['budget.dollars'], 'the fields of the budget object are listed').toContain('usdTotal, usdPerAgent, maxTurnsPerMessage, wallClockMinutes, reviewShare');
    expect(byPath['agents.0.tears'], 'the fields of an agent are listed').toContain('dependsOn');
    expect(byPath['agents.0.name'], 'the pattern is explained').toContain('lower-case');
  });

  it('refuses bypassPermissions in the definition and says which values exist', () => {
    expect(() => parseDefinition(base({ permissionMode: 'bypassPermissions' })), 'bypass is not in the schema').toThrow(/permissionMode: .*plan.*acceptEdits.*auto/s);
  });

  it('names the agent, the dependency and the cycle in graph problems', async () => {
    const issues = await issuesOf(
      base({
        agents: [
          { name: 'a', prompt: 'p', workspace: 'scratch', dependsOn: ['b'] },
          { name: 'b', prompt: 'p', workspace: 'scratch', dependsOn: ['a', 'zed'] },
        ],
      }),
    );
    expect(issues.map((issue) => issue.message).join('\n'), 'unknown dependency and cycle').toMatch(
      /b depends on zed, which is not in the swarm[\s\S]*cycle: a → b → a|cycle: b → a → b/,
    );
  });

  it('resolves the repository and base once and refuses a base that starts with a dash or is unknown', async () => {
    const ok = await validateDefinition(base({ repository: { path: repo.dir, base: 'main' }, agents: [{ name: 'a', prompt: 'p' }] }), context);
    expect(ok.repository, 'the base is resolved to a commit id').toEqual({ root: repo.dir, commit: repo.commit });
    expect((await issuesOf(base({ repository: { path: repo.dir, base: '--output=x' } })))[0], 'a dash base').toMatchObject({
      path: 'repository.base',
      message: expect.stringContaining('refused'),
    });
    expect((await issuesOf(base({ repository: { path: repo.dir, base: 'nope' } })))[0], 'an unknown base').toMatchObject({ path: 'repository.base' });
    expect((await issuesOf(base({ repository: { path: '/nonexistent-dir-for-swarm-test' } })))[0], 'a path that is no repository').toMatchObject({ path: 'repository.path' });
  });

  it('lets a session use only repositories the profile used before, and the user any repository', async () => {
    const definition = base({ repository: { path: repo.dir }, agents: [{ name: 'a', prompt: 'p' }] });
    expect(await issuesOf(definition), 'the user').toEqual([]);
    expect((await issuesOf(definition, { caller: SESSION }))[0], 'a session with an unknown repository').toMatchObject({
      path: 'repository.path',
      message: expect.stringContaining('used before'),
    });
    expect(await issuesOf(definition, { caller: SESSION, knownRepositories: () => [repo.dir] }), 'a known repository').toEqual([]);
  });

  it('refuses overlapping owns of agents that can run at the same time and names the pair', async () => {
    const two = (a: string[], b: string[], extra: object = {}) =>
      base({
        repository: { path: repo.dir },
        agents: [
          { name: 'one', prompt: 'p', owns: a },
          { name: 'two', prompt: 'p', owns: b, ...extra },
        ],
      });
    expect(await issuesOf(two(['src/a.ts'], ['src/b.ts'])), 'disjoint files').toEqual([]);
    expect((await issuesOf(two(['src/**'], ['src/b.ts'])))[0]?.message, 'a glob over a file').toMatch(/one and two.*overlap/);
    expect((await issuesOf(two(['src/*.ts'], ['src/b.ts'])))[0]?.message, 'a glob that matches the same tracked file').toMatch(/overlap/);
    expect(await issuesOf(two(['src/**'], ['src/b.ts'], { dependsOn: ['one'] })), 'a dependency makes them sequential').toEqual([]);
    expect(await issuesOf(two(['src/**'], ['src/b.ts'], { stage: 1 })), 'a later stage makes them sequential').toEqual([]);
    expect((await issuesOf(two([], ['src/b.ts'])))[0], 'an empty owns next to a concurrent worktree agent').toMatchObject({
      path: 'agents.0.owns',
      message: expect.stringContaining('claims no paths'),
    });
    expect(await issuesOf(base({ repository: { path: repo.dir }, agents: [{ name: 'solo', prompt: 'p' }] })), 'an empty owns for the only worktree agent').toEqual([]);
  });

  it('checks tier aliases against the models list and warns about unknown tools', async () => {
    const definition = base({ agents: [{ name: 'a', prompt: 'p', workspace: 'scratch', tier: 'strong', tools: { available: ['Read', 'Bash(git *)', 'Telepathy'] } }] });
    expect((await issuesOf(definition, { knownModels: () => ['sonnet', 'haiku'] }))[0], 'fable is not offered').toMatchObject({
      path: 'agents.0.tier',
      message: expect.stringContaining('fable'),
    });
    const validated = await validateDefinition(definition, { ...context, knownModels: () => ['fable'], knownTools: () => ['Read', 'Bash'] });
    expect(validated.warnings, 'a tool outside the CLI list warns; a rule suffix is ignored').toEqual(["a: the tool Telepathy is not in the CLI's tool list"]);
  });
});

describe('owns matching', () => {
  it('turns globs into path matchers', () => {
    expect(globToRegExp('src/**/*.ts').test('src/x/y/z.ts'), 'a deep match').toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/z.ts'), 'a zero-depth match').toBe(true);
    expect(globToRegExp('src/*.ts').test('src/x/z.ts'), 'a star stops at a slash').toBe(false);
    expect(globToRegExp('a?.md').test('ab.md'), 'a question mark').toBe(true);
    expect(globToRegExp('a.b').test('axb'), 'a dot is literal').toBe(false);
    expect(literalPrefix('src/signup/**'), 'the prefix before a wildcard').toBe('src/signup/');
    expect(literalPrefix('README.md'), 'a literal path is its own prefix').toBe('README.md');
    expect(ownsOverlap(['docs/**'], ['src/**'], []), 'disjoint directories').toBe(false);
    expect(ownsOverlap(['src/x*'], ['src/xy'], []), 'a glob over a literal that is only a prefix match').toBe(true);
  });

  it('pairs agents that can run together', () => {
    const definition = parseDefinition({
      version: 1,
      goal: 'g',
      budget: { usdTotal: 1 },
      agents: [
        { name: 'a', prompt: 'p', workspace: 'scratch' },
        { name: 'b', prompt: 'p', workspace: 'scratch' },
        { name: 'c', prompt: 'p', workspace: 'scratch', dependsOn: ['a'] },
        { name: 'd', prompt: 'p', workspace: 'scratch', stage: 1 },
      ],
    });
    expect(
      concurrentPairs(definition, () => true).map(([x, y]) => `${x.name}${y.name}`),
      'a and b, b and c; d waits for the lower stage',
    ).toEqual(['ab', 'bc']);
  });
});
