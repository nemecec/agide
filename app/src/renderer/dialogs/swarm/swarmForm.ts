import { checkDefinitionGraph, swarmDefinitionSchema, type SwarmDefinition } from '../../../core/swarm/definition';
import { DEFAULT_TIERS, resolveTier } from '../../../core/swarm/tiers';
import { strictestMode } from '../../../core/swarm/policy';
import type { PermissionMode } from '../../../core/session/types';

export type Role = 'worker' | 'reviewer' | 'mechanical';
export type TierChoice = 'default' | 'strong' | 'mid' | 'small';
export type WorkspaceChoice = 'worktree' | 'readonly' | 'scratch';
export type ModeChoice = 'plan' | 'default' | 'acceptEdits' | 'auto';

export interface AgentRow {
  readonly name: string;
  readonly role: Role;
  readonly tier: TierChoice;
  readonly workspace: WorkspaceChoice;
  readonly stage: string;
  readonly prompt: string;
  /** One glob per line. */
  readonly owns: string;
  /** Comma separated names. */
  readonly dependsOn: string;
  /** Comma separated tool names; empty keeps the default set. */
  readonly toolsAvailable: string;
  /** One rule per line. */
  readonly toolsDeny: string;
  readonly budgetUsd: string;
  /** Keys of the agent the form has no field for (effort, mayStartSwarms, and so on); they survive a round trip. */
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface SwarmForm {
  readonly goal: string;
  readonly repoPath: string;
  readonly base: string;
  readonly permissionMode: ModeChoice;
  readonly usdTotal: string;
  readonly usdPerAgent: string;
  readonly wallClockMinutes: string;
  readonly reviewShare: string;
  readonly connectors: boolean;
  readonly agents: readonly AgentRow[];
  /** Keys of the swarm the form has no field for (maxTier, failurePolicy, per-message turn limit). */
  readonly extra: Readonly<Record<string, unknown>>;
}

export const MODE_CHOICES: readonly ModeChoice[] = ['auto', 'acceptEdits', 'default', 'plan'];

export function emptyAgent(index: number): AgentRow {
  return { name: `agent-${index + 1}`, role: 'worker', tier: 'default', workspace: 'worktree', stage: '0', prompt: '', owns: '', dependsOn: '', toolsAvailable: '', toolsDeny: '', budgetUsd: '', extra: {} };
}

export const emptyForm = (): SwarmForm => ({
  goal: '',
  repoPath: '',
  base: '',
  permissionMode: 'auto',
  usdTotal: '3',
  usdPerAgent: '',
  wallClockMinutes: '60',
  reviewShare: '0',
  connectors: false,
  agents: [emptyAgent(0)],
  extra: {},
});

const lines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
const words = (text: string): string[] => text.split(',').map((word) => word.trim()).filter((word) => word !== '');
const number = (text: string): number | string => {
  const trimmed = text.trim();
  return trimmed === '' || Number.isNaN(Number(trimmed)) ? trimmed : Number(trimmed);
};

/** The definition the form describes, as the value `swarm_start` takes. Text that is not a number stays text, so the schema names it. */
export function formToDefinition(form: SwarmForm): Record<string, unknown> {
  const { maxTurnsPerMessage, ...otherExtra } = form.extra as { maxTurnsPerMessage?: unknown } & Record<string, unknown>;
  return {
    version: 1,
    goal: form.goal.trim(),
    ...(form.repoPath.trim() === '' ? {} : { repository: { path: form.repoPath.trim(), ...(form.base.trim() === '' ? {} : { base: form.base.trim() }) } }),
    permissionMode: form.permissionMode,
    ...otherExtra,
    budget: {
      usdTotal: number(form.usdTotal),
      ...(form.usdPerAgent.trim() === '' ? {} : { usdPerAgent: number(form.usdPerAgent) }),
      wallClockMinutes: number(form.wallClockMinutes),
      reviewShare: number(form.reviewShare),
      ...(maxTurnsPerMessage === undefined ? {} : { maxTurnsPerMessage }),
    },
    agents: form.agents.map((agent) => {
      const available = words(agent.toolsAvailable);
      const deny = lines(agent.toolsDeny);
      const owns = lines(agent.owns);
      const dependsOn = words(agent.dependsOn);
      const extraBudget = (agent.extra['budget'] ?? {}) as Record<string, unknown>;
      const budget = { ...extraBudget, ...(agent.budgetUsd.trim() === '' ? {} : { usd: number(agent.budgetUsd) }) };
      const { budget: _budget, tools: _tools, ...extra } = agent.extra;
      return {
        name: agent.name.trim(),
        role: agent.role,
        prompt: agent.prompt,
        ...(agent.tier === 'default' ? {} : { tier: agent.tier }),
        stage: number(agent.stage),
        workspace: agent.workspace,
        ...(owns.length === 0 ? {} : { owns }),
        ...(dependsOn.length === 0 ? {} : { dependsOn }),
        ...(available.length === 0 && deny.length === 0 ? {} : { tools: { ...(available.length === 0 ? {} : { available }), deny } }),
        ...(Object.keys(budget).length === 0 ? {} : { budget }),
        ...(form.connectors ? { connectors: true } : {}),
        ...extra,
      };
    }),
  };
}

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

const KNOWN_AGENT_KEYS = new Set(['name', 'role', 'prompt', 'tier', 'stage', 'workspace', 'owns', 'dependsOn', 'tools', 'budget', 'connectors']);
const KNOWN_SWARM_KEYS = new Set(['version', 'goal', 'repository', 'permissionMode', 'budget', 'agents']);

/** The form for a definition typed as JSON. Keys without a field go to `extra`, so the JSON comes back as it was. */
export function definitionToForm(value: unknown): SwarmForm {
  const source = record(value);
  const repository = record(source['repository']);
  const budget = record(source['budget']);
  const agents = Array.isArray(source['agents']) ? source['agents'].map(record) : [];
  const mode = text(source['permissionMode'], 'auto') as ModeChoice;
  return {
    goal: text(source['goal']),
    repoPath: text(repository['path']),
    base: text(repository['base']),
    permissionMode: MODE_CHOICES.includes(mode) ? mode : 'auto',
    usdTotal: text(budget['usdTotal']),
    usdPerAgent: text(budget['usdPerAgent']),
    wallClockMinutes: text(budget['wallClockMinutes'], '60'),
    reviewShare: text(budget['reviewShare'], '0'),
    connectors: agents.length > 0 && agents.every((agent) => agent['connectors'] === true),
    extra: {
      ...Object.fromEntries(Object.entries(source).filter(([key]) => !KNOWN_SWARM_KEYS.has(key))),
      ...(budget['maxTurnsPerMessage'] === undefined ? {} : { maxTurnsPerMessage: budget['maxTurnsPerMessage'] }),
    },
    agents: agents.map((agent, index) => {
      const tools = record(agent['tools']);
      const agentBudget = record(agent['budget']);
      const { usd: _usd, ...budgetRest } = agentBudget;
      return {
        name: text(agent['name'], emptyAgent(index).name),
        role: (['worker', 'reviewer', 'mechanical'].includes(text(agent['role'])) ? text(agent['role']) : 'worker') as Role,
        tier: (['strong', 'mid', 'small'].includes(text(agent['tier'])) ? text(agent['tier']) : 'default') as TierChoice,
        workspace: (['worktree', 'readonly', 'scratch'].includes(text(agent['workspace'])) ? text(agent['workspace']) : 'worktree') as WorkspaceChoice,
        stage: text(agent['stage'], '0'),
        prompt: text(agent['prompt']),
        owns: list(agent['owns']).join('\n'),
        dependsOn: list(agent['dependsOn']).join(', '),
        toolsAvailable: list(tools['available']).join(', '),
        toolsDeny: list(tools['deny']).join('\n'),
        budgetUsd: text(agentBudget['usd']),
        extra: {
          ...Object.fromEntries(Object.entries(agent).filter(([key]) => !KNOWN_AGENT_KEYS.has(key))),
          ...(Object.keys(budgetRest).length === 0 ? {} : { budget: budgetRest }),
        },
      };
    }),
  };
}

export interface FormIssue {
  readonly path: string;
  readonly message: string;
}

export interface Validation {
  readonly definition?: SwarmDefinition;
  readonly issues: readonly FormIssue[];
}

/** The schema and the graph checks of the definition: the messages that the manager would answer with, before anything starts. */
export function validateDefinition(value: unknown): Validation {
  const parsed = swarmDefinitionSchema.safeParse(value);
  if (!parsed.success) return { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
  const graph = checkDefinitionGraph(parsed.data);
  return graph.length > 0 ? { issues: graph } : { definition: parsed.data, issues: [] };
}

/** The message of the first issue on `path`, or on a path below it. */
export function issueFor(issues: readonly FormIssue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`))?.message;
}

/** One line per issue for the notice above the footer: the path, then the message. */
export const issueLine = (issue: FormIssue): string => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`);

export interface PreviewAgent {
  readonly name: string;
  readonly tier: string;
  readonly model: string;
  readonly effort: string;
  readonly mode: PermissionMode;
  readonly capped: boolean;
}

/** Each agent's model, effort and mode as the app will launch it, with the default tier table and the strictest mode (0037 sections 5 and 7). */
export function previewAgents(definition: SwarmDefinition): PreviewAgent[] {
  return definition.agents.map((agent) => {
    const resolved = resolveTier(DEFAULT_TIERS, definition.maxTier, agent);
    return { name: agent.name, tier: resolved.tier, model: resolved.model, effort: resolved.effort, mode: strictestMode(definition.permissionMode, agent.permissionMode ?? definition.permissionMode), capped: resolved.capped };
  });
}

/** The commands the app runs before the agents start, one per workspace (0037 section 4.1). */
export function previewCommands(definition: SwarmDefinition): string[] {
  const base = definition.repository?.base ?? 'HEAD';
  return definition.agents.flatMap((agent) => {
    if (agent.workspace === 'worktree') return [`git worktree add -b agide/swarm-<id>/${agent.name} -- <path> ${base}`];
    if (agent.workspace === 'readonly') return [`git worktree add --detach -- <path> ${base}`];
    return [`mkdir <swarm data>/${agent.name}`];
  });
}
