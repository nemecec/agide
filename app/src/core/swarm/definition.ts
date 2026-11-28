import { z } from 'zod';

/** Tier names of 0037 section 5, from strongest to smallest. */
export const TIERS = ['strong', 'mid', 'small'] as const;
export const tierSchema = z.enum(TIERS);

/** `bypassPermissions` is not in the schema: only the start dialog can ask for it (0037 section 7.1). */
export const swarmModeSchema = z.enum(['plan', 'default', 'acceptEdits', 'auto']);

export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const agentNameSchema = z.string().regex(AGENT_NAME_PATTERN, 'a lower-case name of up to 32 letters, digits and dashes, starting with a letter');

export const agentSpecSchema = z
  .object({
    name: agentNameSchema,
    role: z.enum(['worker', 'reviewer', 'mechanical']).default('worker'),
    prompt: z.string().min(1).max(20_000),
    /** Absent: the role's default tier (`tiers.ts`). */
    tier: tierSchema.optional(),
    /** Overrides the tier's effort, never above the effort of the swarm's `maxTier`. */
    effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    stage: z.number().int().min(0).max(9).default(0),
    dependsOn: z.array(agentNameSchema).max(16).default([]),
    workspace: z.enum(['worktree', 'readonly', 'scratch']).default('worktree'),
    /** Globs relative to the repository root. */
    owns: z.array(z.string().min(1).max(200)).max(32).default([]),
    tools: z
      .object({
        /** Becomes `--tools`; absent keeps the CLI's default set. */
        available: z.array(z.string().max(64)).max(64).optional(),
        /** Becomes `permissions.deny` entries. */
        deny: z.array(z.string().max(200)).max(64).default([]),
      })
      .strict()
      // zod 4 returns a default as given, without parsing it, so the default is already complete.
      .default({ deny: [] }),
    permissionMode: swarmModeSchema.optional(),
    /** False adds `--strict-mcp-config`. */
    connectors: z.boolean().default(false),
    mayStartSwarms: z.boolean().default(false),
    budget: z
      .object({ usd: z.number().positive().max(100).optional(), maxTurnsPerMessage: z.number().int().min(1).max(200).optional() })
      .strict()
      .default({}),
  })
  .strict();

/** Why a swarm exists when it is more than a goal: a fix of a red base commit (0045 section 3.5). */
export const swarmPurposeSchema = z
  .object({
    kind: z.literal('base_fix'),
    commitId: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, 'a full git object id'),
    policyHash: z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 hash in hex'),
  })
  .strict();

export const swarmDefinitionSchema = z
  .object({
    version: z.literal(1),
    goal: z.string().min(1).max(2_000),
    purpose: swarmPurposeSchema.optional(),
    repository: z
      .object({ path: z.string().min(1), base: z.string().min(1).max(200).optional() })
      .strict()
      .optional(),
    permissionMode: swarmModeSchema.default('auto'),
    maxTier: tierSchema.default('strong'),
    failurePolicy: z.enum(['continue', 'stop-dependents', 'stop-swarm']).default('stop-dependents'),
    budget: z
      .object({
        usdTotal: z.number().positive().max(500),
        /** Absent: `min(usdTotal, 1.00)`. */
        usdPerAgent: z.number().positive().max(100).optional(),
        maxTurnsPerMessage: z.number().int().min(1).max(200).default(40),
        wallClockMinutes: z.number().int().min(1).max(1_440).default(60),
        /** Share of `usdTotal` kept for reviewer agents. Absent: `defaultReviewShare`. */
        reviewShare: z.number().min(0).max(0.8).optional(),
      })
      .strict(),
    agents: z.array(agentSpecSchema).min(1).max(16),
  })
  .strict();

/** The definition as a caller writes it (defaults may be absent). */
export type SwarmDefinitionInput = z.input<typeof swarmDefinitionSchema>;
/** The parsed definition with every default filled in. The app stores this copy with the swarm. */
export type SwarmDefinition = z.output<typeof swarmDefinitionSchema>;
export type AgentSpec = SwarmDefinition['agents'][number];
export type SwarmPurpose = z.output<typeof swarmPurposeSchema>;
export type Tier = z.output<typeof tierSchema>;
export type AgentRole = AgentSpec['role'];
export type Workspace = AgentSpec['workspace'];
export type FailurePolicy = SwarmDefinition['failurePolicy'];
export type SwarmMode = z.output<typeof swarmModeSchema>;
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

/** The review pot of a swarm with a `worktree` agent when its definition names none (0040 section 16); the other swarms keep none. */
export const DEFAULT_REVIEW_SHARE = 0.3;

export function defaultReviewShare(definition: Pick<SwarmDefinition, 'agents'>): number {
  return definition.agents.some((agent) => agent.workspace === 'worktree') ? DEFAULT_REVIEW_SHARE : 0;
}

/** One problem of a definition, with the field it concerns as a dotted path such as `agents.1.dependsOn`. */
export interface DefinitionIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * The checks beyond the schema that need nothing outside the definition (0037 section 1): unique names,
 * known dependencies, no cycle through `dependsOn` and the stage order, a repository for `worktree` and
 * `readonly` agents. The checks that read the repository, the tool list and the models list belong to the
 * manager (`manager/validate.ts`, owner w-manager).
 */
export function checkDefinitionGraph(definition: SwarmDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const index = new Map<string, number>();
  definition.agents.forEach((agent, position) => {
    if (index.has(agent.name)) issues.push({ path: `agents.${position}.name`, message: `the name ${agent.name} is used twice` });
    else index.set(agent.name, position);
  });
  definition.agents.forEach((agent, position) => {
    for (const dependency of agent.dependsOn) {
      if (!index.has(dependency)) issues.push({ path: `agents.${position}.dependsOn`, message: `${agent.name} depends on ${dependency}, which is not in the swarm` });
      else if (dependency === agent.name) issues.push({ path: `agents.${position}.dependsOn`, message: `${agent.name} depends on itself` });
    }
    if (agent.workspace !== 'scratch' && definition.repository === undefined) {
      issues.push({ path: `agents.${position}.workspace`, message: `${agent.name} needs a repository for a ${agent.workspace} workspace` });
    }
  });
  const cycle = findCycle(definition);
  if (cycle !== undefined) issues.push({ path: 'agents', message: `the dependencies form a cycle: ${cycle.join(' → ')}` });
  return issues;
}

/** Every agent depends on its `dependsOn` and on every agent of a lower stage. */
export function dependenciesOf(definition: SwarmDefinition, agent: AgentSpec): string[] {
  const lower = definition.agents.filter((other) => other.stage < agent.stage).map((other) => other.name);
  return [...new Set([...lower, ...agent.dependsOn])];
}

function findCycle(definition: SwarmDefinition): string[] | undefined {
  const byName = new Map(definition.agents.map((agent) => [agent.name, agent]));
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (name: string): string[] | undefined => {
    if (state.get(name) === 'done') return undefined;
    if (state.get(name) === 'visiting') return [...path.slice(path.indexOf(name)), name];
    const agent = byName.get(name);
    if (agent === undefined) return undefined;
    state.set(name, 'visiting');
    path.push(name);
    for (const dependency of dependenciesOf(definition, agent)) {
      const found = visit(dependency);
      if (found !== undefined) return found;
    }
    path.pop();
    state.set(name, 'done');
    return undefined;
  };
  for (const agent of definition.agents) {
    const found = visit(agent.name);
    if (found !== undefined) return found;
  }
  return undefined;
}
