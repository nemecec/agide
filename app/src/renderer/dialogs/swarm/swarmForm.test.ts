import { describe, expect, it } from 'vitest';
import { definitionToForm, emptyAgent, emptyForm, formToDefinition, issueFor, issueLine, previewAgents, previewCommands, validateDefinition } from './swarmForm';
import { SWARM_TEMPLATES, templateForm } from './swarmTemplates';

const filled = () => ({ ...emptyForm(), goal: 'Add validation', agents: [{ ...emptyAgent(0), name: 'impl', prompt: 'Do it', workspace: 'scratch' as const }] });

describe('formToDefinition', () => {
  it('builds a definition the schema accepts from a filled form, leaving empty optional fields out', () => {
    const definition = formToDefinition(filled());
    expect(validateDefinition(definition).issues, 'no issues').toEqual([]);
    expect(definition, 'no repository, tier or owns when empty').toMatchObject({ version: 1, goal: 'Add validation', permissionMode: 'auto', budget: { usdTotal: 3, wallClockMinutes: 60, reviewShare: 0 } });
    expect(JSON.stringify(definition), 'optional keys are absent').not.toMatch(/repository|"tier"|owns|dependsOn|tools/);
  });

  it('turns lists and numbers of the fields into the types of the schema', () => {
    const definition = formToDefinition({
      ...filled(),
      repoPath: ' /repo ',
      base: 'main',
      usdPerAgent: '0.5',
      agents: [{ ...emptyAgent(0), name: 'impl', prompt: 'p', tier: 'small', stage: '2', owns: 'src/**\n\n test/** ', dependsOn: 'a, b', toolsAvailable: 'Read, Edit', toolsDeny: 'Bash(rm *)', budgetUsd: '0.25' }],
    }) as { repository: unknown; budget: unknown; agents: unknown[] };
    expect(definition.repository, 'repository trimmed with its base').toEqual({ path: '/repo', base: 'main' });
    expect(definition.budget, 'per-agent budget as a number').toMatchObject({ usdPerAgent: 0.5 });
    expect(definition.agents[0], 'agent lists and numbers').toMatchObject({ tier: 'small', stage: 2, owns: ['src/**', 'test/**'], dependsOn: ['a', 'b'], tools: { available: ['Read', 'Edit'], deny: ['Bash(rm *)'] }, budget: { usd: 0.25 } });
  });

  it('keeps text that is not a number as text, so the schema names the field', () => {
    const result = validateDefinition(formToDefinition({ ...filled(), usdTotal: 'lots' }));
    expect(issueFor(result.issues, 'budget.usdTotal'), 'message on the total').toMatch(/number/i);
  });

  it('adds connectors to every agent when the switch is on', () => {
    const definition = formToDefinition({ ...filled(), connectors: true }) as { agents: { connectors?: boolean }[] };
    expect(definition.agents[0]?.connectors, 'connectors on the agent').toBe(true);
  });
});

describe('round trip between the form and the JSON', () => {
  it('returns every key of a definition, including the ones the form has no field for', () => {
    const source = {
      version: 1,
      goal: 'g',
      repository: { path: '/repo', base: 'main' },
      permissionMode: 'plan',
      maxTier: 'mid',
      failurePolicy: 'stop-swarm',
      budget: { usdTotal: 5, usdPerAgent: 1, wallClockMinutes: 30, reviewShare: 0.2, maxTurnsPerMessage: 12 },
      agents: [
        { name: 'impl', role: 'worker', prompt: 'p', effort: 'high', mayStartSwarms: true, permissionMode: 'plan', stage: 0, workspace: 'worktree', owns: ['src/**'], budget: { usd: 0.5, maxTurnsPerMessage: 7 }, tools: { available: ['Read'], deny: ['Bash(rm *)'] } },
        { name: 'review', role: 'reviewer', prompt: 'r', stage: 1, workspace: 'readonly', dependsOn: ['impl'] },
      ],
    };
    const back = formToDefinition(definitionToForm(source));
    expect(back, 'the same document comes back').toEqual(source);
  });

  it('falls back to defaults for values the form cannot hold', () => {
    const form = definitionToForm({ permissionMode: 'bypassPermissions', agents: [{ role: 'boss', tier: 'huge', workspace: 'moon' }, 'junk'] });
    expect(form.permissionMode, 'unknown mode becomes auto').toBe('auto');
    expect(form.agents[0], 'unknown role, tier and workspace').toMatchObject({ name: 'agent-1', role: 'worker', tier: 'default', workspace: 'worktree' });
    expect(form.agents, 'a non-object agent still gets a row').toHaveLength(2);
    expect(definitionToForm(7).agents, 'a non-object definition gives an empty agent list').toEqual([]);
  });
});

describe('validateDefinition', () => {
  it('reports schema problems with their paths', () => {
    const result = validateDefinition({ version: 1, goal: '', budget: { usdTotal: 3 }, agents: [{ name: 'Bad Name', prompt: 'x' }] });
    expect(issueFor(result.issues, 'goal'), 'goal issue').toBeDefined();
    expect(issueFor(result.issues, 'agents.0.name'), 'name issue').toMatch(/lower-case/);
    expect(result.definition, 'no definition when invalid').toBeUndefined();
  });

  it('reports the graph checks: duplicate names, missing repository and cycles', () => {
    const base = { version: 1, goal: 'g', budget: { usdTotal: 1 } };
    expect(validateDefinition({ ...base, agents: [{ name: 'a', prompt: 'p', workspace: 'scratch' }, { name: 'a', prompt: 'p', workspace: 'scratch' }] }).issues[0]?.message, 'duplicate').toMatch(/used twice/);
    expect(validateDefinition({ ...base, agents: [{ name: 'a', prompt: 'p' }] }).issues[0]?.message, 'worktree without repository').toMatch(/needs a repository/);
    expect(
      validateDefinition({ ...base, agents: [{ name: 'a', prompt: 'p', workspace: 'scratch', dependsOn: ['b'] }, { name: 'b', prompt: 'p', workspace: 'scratch', dependsOn: ['a'] }] }).issues.map((issue) => issue.message).join(' '),
      'cycle',
    ).toMatch(/cycle/);
  });

  it('finds an issue on a path or below it and prints one line per issue', () => {
    const issues = [{ path: 'agents.1.name', message: 'bad' }];
    expect(issueFor(issues, 'agents.1'), 'a path above').toBe('bad');
    expect(issueFor(issues, 'agents.2'), 'another agent').toBeUndefined();
    expect(issueLine(issues[0]!), 'with path').toBe('agents.1.name: bad');
    expect(issueLine({ path: '', message: 'bad' }), 'without path').toBe('bad');
  });
});

describe('preview', () => {
  it('lists the commands per workspace and the model, effort and strictest mode per agent', () => {
    const { definition } = validateDefinition({
      version: 1,
      goal: 'g',
      repository: { path: '/repo', base: 'main' },
      maxTier: 'mid',
      permissionMode: 'acceptEdits',
      budget: { usdTotal: 1 },
      agents: [
        { name: 'impl', prompt: 'p', tier: 'strong' },
        { name: 'look', prompt: 'p', role: 'reviewer', workspace: 'readonly', permissionMode: 'plan', stage: 1 },
        { name: 'notes', prompt: 'p', role: 'mechanical', workspace: 'scratch' },
      ],
    });
    expect(previewCommands(definition!), 'commands').toEqual(['git worktree add -b agide/swarm-<id>/impl -- <path> main', 'git worktree add --detach -- <path> main', 'mkdir <swarm data>/notes']);
    const agents = previewAgents(definition!);
    expect(agents.map((agent) => [agent.name, agent.model, agent.mode, agent.capped]), 'lowered by maxTier and the strictest mode').toEqual([
      ['impl', 'sonnet', 'acceptEdits', true],
      ['look', 'sonnet', 'plan', true],
      ['notes', 'haiku', 'acceptEdits', false],
    ]);
  });

  it('runs from HEAD when the definition names no base', () => {
    const { definition } = validateDefinition({ version: 1, goal: 'g', repository: { path: '/repo' }, budget: { usdTotal: 1 }, agents: [{ name: 'a', prompt: 'p' }] });
    expect(previewCommands(definition!)[0], 'default base').toContain(' HEAD');
  });
});

describe('templates', () => {
  it('give forms that become valid once a repository is named where one is needed', () => {
    for (const template of SWARM_TEMPLATES) {
      const form = templateForm(template);
      const withRepo = form.repoPath === '' && form.agents.some((agent) => agent.workspace !== 'scratch') ? { ...form, repoPath: '/repo' } : form;
      const result = validateDefinition(formToDefinition(withRepo));
      expect(result.issues.map(issueLine), `template ${template.id} is valid with its repository`).toEqual([]);
    }
  });
});
