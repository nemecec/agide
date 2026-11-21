import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';
import { checkDefinitionGraph, dependenciesOf, swarmDefinitionSchema, type AgentSpec, type DefinitionIssue, type SwarmDefinition } from '../definition';
import { resolveTier, type TierTable } from '../tiers';
import { SwarmError, type SwarmCaller } from '../types';
import type { SwarmWorkspaces } from '../workspace/SwarmWorkspaces';

/** The inputs of the checks that read outside the definition. */
export interface ValidationContext {
  readonly caller: SwarmCaller;
  readonly workspaces: SwarmWorkspaces;
  readonly tiers: TierTable;
  /** Repositories earlier task starts and swarms of this profile used; a session caller may name only these. */
  readonly knownRepositories: () => readonly string[];
  /** Model aliases of the `initialize` answer, once a process has answered it. */
  readonly knownModels: () => readonly string[] | undefined;
  /** Tool names of the first `system/init`, once a process has reported them. */
  readonly knownTools: () => readonly string[] | undefined;
}

export interface ValidatedDefinition {
  readonly definition: SwarmDefinition;
  readonly repository?: { readonly root: string; readonly commit: string };
  readonly warnings: readonly string[];
}

type Schema = { _zod: { def: { type: string; innerType?: Schema; element?: Schema } }; shape?: Record<string, Schema> };

function unwrap(schema: Schema | undefined): Schema | undefined {
  let current = schema;
  while (current !== undefined && ['default', 'optional', 'nullable'].includes(current._zod.def.type)) current = current._zod.def.innerType;
  return current;
}

/** The field names of the object a path points into, for the "known fields" hint. */
function fieldsAt(path: readonly PropertyKey[]): string[] | undefined {
  let current = unwrap(swarmDefinitionSchema as unknown as Schema);
  for (const segment of path) {
    if (current?.shape !== undefined) current = unwrap(current.shape[String(segment)]);
    else if (current?._zod.def.type === 'array') current = unwrap(current._zod.def.element);
    else return undefined;
  }
  return current?.shape === undefined ? undefined : Object.keys(current.shape);
}

const dotted = (path: readonly PropertyKey[]): string => path.map(String).join('.');

/** Turns zod issues into messages that name the field and, for a misspelt key, the fields that exist. */
export function schemaIssues(error: z.ZodError): DefinitionIssue[] {
  return error.issues.flatMap((issue): DefinitionIssue[] => {
    if (issue.code === 'unrecognized_keys') {
      const known = fieldsAt(issue.path);
      return issue.keys.map((key) => ({ path: dotted([...issue.path, key]), message: `unknown field${known === undefined ? '' : `; the fields here are ${known.join(', ')}`}` }));
    }
    return [{ path: dotted(issue.path) || 'definition', message: issue.message }];
  });
}

export function formatIssues(issues: readonly DefinitionIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
}

/** Parses a definition; every problem is reported at once, so one call tells the agent everything to fix. */
export function parseDefinition(input: unknown): SwarmDefinition {
  const parsed = swarmDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    const issues = schemaIssues(parsed.error);
    throw new SwarmError('invalid_input', formatIssues(issues), issues);
  }
  return parsed.data;
}

const GLOB_CHARS = /[*?[{]/;

/** The part of a glob before its first wildcard. */
export function literalPrefix(glob: string): string {
  const at = glob.search(GLOB_CHARS);
  return at < 0 ? glob : glob.slice(0, at);
}

export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]!;
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** True when the globs can claim a common path: one matches the other's literal prefix, or a tracked file matches both. */
export function ownsOverlap(first: readonly string[], second: readonly string[], tracked: readonly string[]): boolean {
  for (const a of first) {
    for (const b of second) {
      const left = globToRegExp(a);
      const right = globToRegExp(b);
      if (left.test(literalPrefix(b)) || right.test(literalPrefix(a))) return true;
      if (tracked.some((file) => left.test(file) && right.test(file))) return true;
    }
  }
  return false;
}

/** Pairs of agents that can run at the same time: neither depends on the other, directly or through stages. */
export function concurrentPairs(definition: SwarmDefinition, include: (agent: AgentSpec) => boolean): [AgentSpec, AgentSpec][] {
  const byName = new Map(definition.agents.map((agent) => [agent.name, agent]));
  const reach = new Map<string, Set<string>>();
  const closure = (agent: AgentSpec): Set<string> => {
    const known = reach.get(agent.name);
    if (known !== undefined) return known;
    const set = new Set<string>();
    reach.set(agent.name, set);
    for (const name of dependenciesOf(definition, agent)) {
      set.add(name);
      const dependency = byName.get(name);
      if (dependency !== undefined) for (const inner of closure(dependency)) set.add(inner);
    }
    return set;
  };
  const candidates = definition.agents.filter(include);
  const pairs: [AgentSpec, AgentSpec][] = [];
  candidates.forEach((first, index) => {
    for (const second of candidates.slice(index + 1)) {
      if (!closure(first).has(second.name) && !closure(second).has(first.name)) pairs.push([first, second]);
    }
  });
  return pairs;
}

const expandHome = (path: string): string => (path === '~' ? homedir() : path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path);

const realOrSame = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

async function repositoryIssues(definition: SwarmDefinition, context: ValidationContext, issues: DefinitionIssue[]): Promise<ValidatedDefinition['repository']> {
  const repository = definition.repository;
  if (repository === undefined) return undefined;
  let resolved: { root: string; commit: string };
  try {
    resolved = await context.workspaces.resolveRepository(expandHome(repository.path), repository.base);
  } catch (error) {
    const message = (error as Error).message;
    issues.push({ path: repository.base !== undefined && /not a commit|refused/.test(message) ? 'repository.base' : 'repository.path', message });
    return undefined;
  }
  if (context.caller.kind === 'session') {
    const known = context.knownRepositories().map(realOrSame);
    if (!known.includes(realOrSame(resolved.root))) {
      issues.push({
        path: 'repository.path',
        message: 'an agent may use only a repository that a task start or swarm of this profile used before; ask the user to start one in it first',
      });
    }
  }
  return resolved;
}

async function ownsIssues(
  definition: SwarmDefinition,
  repository: NonNullable<ValidatedDefinition['repository']>,
  context: ValidationContext,
  issues: DefinitionIssue[],
): Promise<void> {
  const position = (agent: AgentSpec): number => definition.agents.indexOf(agent);
  const pairs = concurrentPairs(definition, (agent) => agent.workspace === 'worktree');
  if (pairs.length === 0) return;
  const tracked = await context.workspaces.trackedFiles(repository.root, repository.commit).catch(() => []);
  for (const [first, second] of pairs) {
    const empty = [first, second].find((agent) => agent.owns.length === 0);
    if (empty !== undefined) {
      issues.push({
        path: `agents.${position(empty)}.owns`,
        message: `${empty.name} claims no paths but can run at the same time as ${empty === first ? second.name : first.name}; list the paths it owns, or make one depend on the other`,
      });
    } else if (ownsOverlap(first.owns, second.owns, tracked)) {
      issues.push({
        path: `agents.${position(second)}.owns`,
        message: `${first.name} and ${second.name} can run at the same time and their owns overlap; make the paths disjoint or make one depend on the other`,
      });
    }
  }
}

function modelIssues(definition: SwarmDefinition, context: ValidationContext, issues: DefinitionIssue[]): void {
  const offered = context.knownModels();
  if (offered === undefined) return;
  definition.agents.forEach((agent, position) => {
    const { model } = resolveTier(context.tiers, definition.maxTier, agent);
    if (!offered.includes(model))
      issues.push({ path: `agents.${position}.tier`, message: `the model alias ${model} is not offered by this login; offered: ${offered.join(', ')}` });
  });
}

function toolWarnings(definition: SwarmDefinition, context: ValidationContext): string[] {
  const known = context.knownTools();
  if (known === undefined) return [];
  const names = (entry: string): string => entry.replace(/\(.*$/, '');
  return definition.agents.flatMap((agent) =>
    (agent.tools.available ?? []).filter((tool) => !known.includes(names(tool))).map((tool) => `${agent.name}: the tool ${tool} is not in the CLI's tool list`),
  );
}

/**
 * The checks of 0037 section 1: the schema, the graph checks that need nothing outside the definition, and the
 * checks that read the repository, the models list and the tool list. Every problem is collected before the
 * refusal, so an agent can fix them in one go.
 */
export async function validateDefinition(input: unknown, context: ValidationContext): Promise<ValidatedDefinition> {
  const definition = parseDefinition(input);
  const issues: DefinitionIssue[] = checkDefinitionGraph(definition);
  const repository = await repositoryIssues(definition, context, issues);
  if (repository !== undefined) await ownsIssues(definition, repository, context, issues);
  modelIssues(definition, context, issues);
  if (issues.length > 0) throw new SwarmError('invalid_input', formatIssues(issues), issues);
  return { definition, ...(repository === undefined ? {} : { repository }), warnings: toolWarnings(definition, context) };
}
