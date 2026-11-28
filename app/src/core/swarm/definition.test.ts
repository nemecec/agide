import { describe, expect, it } from 'vitest';
import { checkDefinitionGraph, dependenciesOf, swarmDefinitionSchema } from './definition';
import { strictestMode } from './policy';
import { resolveSwarmSettings, swarmSettingsSchema } from './settings';
import { DEFAULT_TIERS, resolveTier } from './tiers';

const example = {
  version: 1,
  goal: 'Add input validation to the signup form, with tests, and review it',
  repository: { path: '~/src/shop', base: 'main' },
  budget: { usdTotal: 3, reviewShare: 0.3 },
  agents: [
    { name: 'impl', prompt: 'Add validation for email and password in src/signup. Commit when done.', tier: 'mid', owns: ['src/signup/**'] },
    { name: 'tests', role: 'mechanical', prompt: 'Write tests for the validation rules in test/signup.', owns: ['test/signup/**'] },
    { name: 'review', role: 'reviewer', stage: 1, workspace: 'readonly', prompt: 'Review the changes of impl and tests. Report findings; do not edit.' },
  ],
};

describe('swarm purpose', () => {
  const fix = { kind: 'base_fix', commitId: 'a'.repeat(40), policyHash: 'b'.repeat(64) };

  it('is absent by default and accepts a fix of a base commit', () => {
    expect(swarmDefinitionSchema.parse(example).purpose, 'a definition without a purpose has none').toBeUndefined();
    expect(swarmDefinitionSchema.parse({ ...example, purpose: fix }).purpose, 'the purpose is kept').toEqual(fix);
  });

  it.each([
    ['another kind', { ...fix, kind: 'other' }],
    ['a branch name as the commit', { ...fix, commitId: 'main' }],
    ['a short policy hash', { ...fix, policyHash: 'abc' }],
    ['an unknown key', { ...fix, extra: true }],
    ['a missing policy hash', { kind: 'base_fix', commitId: 'a'.repeat(40) }],
  ])('refuses %s', (_name, purpose) => {
    expect(swarmDefinitionSchema.safeParse({ ...example, purpose }).success, 'the purpose is refused').toBe(false);
  });
});

describe('swarm definition schema', () => {
  it('accepts the example of 0037 and fills the defaults', () => {
    const parsed = swarmDefinitionSchema.parse(example);
    expect(parsed, 'swarm defaults').toMatchObject({
      permissionMode: 'auto',
      maxTier: 'strong',
      failurePolicy: 'stop-dependents',
      budget: { maxTurnsPerMessage: 40, wallClockMinutes: 60 },
    });
    expect(parsed.agents[0], 'agent defaults').toMatchObject({
      role: 'worker',
      stage: 0,
      dependsOn: [],
      workspace: 'worktree',
      tools: { deny: [] },
      connectors: false,
      mayStartSwarms: false,
      budget: {},
    });
    expect(checkDefinitionGraph(parsed), 'no graph issue').toEqual([]);
  });

  it('refuses bypass, unknown keys and bad names', () => {
    expect(swarmDefinitionSchema.safeParse({ ...example, permissionMode: 'bypassPermissions' }).success, 'bypass on the swarm').toBe(false);
    expect(swarmDefinitionSchema.safeParse({ ...example, agents: [{ ...example.agents[0], permissionMode: 'bypassPermissions' }] }).success, 'bypass on an agent').toBe(false);
    expect(swarmDefinitionSchema.safeParse({ ...example, allow: ['Bash(*)'] }).success, 'an allow list').toBe(false);
    expect(swarmDefinitionSchema.safeParse({ ...example, agents: [{ ...example.agents[0], name: 'Impl' }] }).success, 'an upper-case name').toBe(false);
  });

  it('names duplicate names, unknown dependencies, cycles through stages and missing repositories', () => {
    const parse = (agents: unknown[], extra: object = {}) => swarmDefinitionSchema.parse({ version: 1, goal: 'g', budget: { usdTotal: 1 }, agents, ...extra });
    expect(
      checkDefinitionGraph(
        parse([
          { name: 'a', prompt: 'x', workspace: 'scratch' },
          { name: 'a', prompt: 'y', workspace: 'scratch' },
        ]),
      ).map((i) => i.path),
      'duplicate',
    ).toEqual(['agents.1.name']);
    expect(checkDefinitionGraph(parse([{ name: 'a', prompt: 'x', workspace: 'scratch', dependsOn: ['zz'] }]))[0]?.message, 'unknown').toContain('zz');
    const cycle = checkDefinitionGraph(
      parse([
        { name: 'a', prompt: 'x', workspace: 'scratch', dependsOn: ['b'] },
        { name: 'b', prompt: 'y', workspace: 'scratch', stage: 1 },
      ]),
    );
    expect(cycle.map((i) => i.message).join(' '), 'a stage-0 agent depending on a stage-1 agent is a cycle').toContain('cycle');
    expect(checkDefinitionGraph(parse([{ name: 'a', prompt: 'x' }]))[0]?.path, 'worktree without repository').toBe('agents.0.workspace');
  });

  it('makes every agent depend on the agents of lower stages', () => {
    const parsed = swarmDefinitionSchema.parse(example);
    expect(dependenciesOf(parsed, parsed.agents[2]!), 'the reviewer').toEqual(['impl', 'tests']);
    expect(dependenciesOf(parsed, parsed.agents[0]!), 'a stage-0 agent').toEqual([]);
  });
});

describe('tiers', () => {
  it('maps roles to tiers and caps tier and effort at maxTier', () => {
    expect(resolveTier(DEFAULT_TIERS, 'strong', { role: 'reviewer' }), 'reviewer').toEqual({ tier: 'strong', model: 'fable', effort: 'high', capped: false });
    expect(resolveTier(DEFAULT_TIERS, 'strong', { role: 'worker' }), 'worker').toMatchObject({ model: 'sonnet', effort: 'medium' });
    expect(resolveTier(DEFAULT_TIERS, 'mid', { role: 'reviewer' }), 'reviewer under mid').toEqual({ tier: 'mid', model: 'sonnet', effort: 'medium', capped: true });
    expect(resolveTier(DEFAULT_TIERS, 'small', { role: 'mechanical', effort: 'high' }), 'effort above the maxTier row').toEqual({
      tier: 'small',
      model: 'haiku',
      effort: 'low',
      capped: true,
    });
  });
});

describe('effective permission mode', () => {
  it('picks the strictest mode', () => {
    expect(strictestMode('auto', 'acceptEdits', 'default'), 'default is stricter than acceptEdits and auto').toBe('default');
    expect(strictestMode('bypassPermissions', 'auto'), 'auto over bypass').toBe('auto');
    expect(strictestMode('plan', 'bypassPermissions'), 'plan is the strictest').toBe('plan');
  });
});

describe('swarm settings', () => {
  it('reads absent keys as the defaults and replaces single tier rows', () => {
    expect(resolveSwarmSettings(undefined), 'defaults').toMatchObject({
      approvalTimeoutMinutes: 60,
      interruptedKeepSeconds: 300,
      maxSpawnDepth: 1,
      maxActivePerSession: 2,
      tiers: DEFAULT_TIERS,
    });
    const parsed = swarmSettingsSchema.parse({ tiers: { strong: { model: 'opus', effort: 'xhigh' } } });
    expect(resolveSwarmSettings(parsed).tiers, 'one row replaced').toEqual({ ...DEFAULT_TIERS, strong: { model: 'opus', effort: 'xhigh' } });
    expect(swarmSettingsSchema.safeParse({ maxSpawnDepth: 3 }).success, 'depth above 2').toBe(false);
  });
});
