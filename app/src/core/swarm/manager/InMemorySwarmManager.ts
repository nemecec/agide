import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../../events/EventBus';
import { isLooser, MODE_ORDER } from '../../permissions/modes';
import type { PermissionMode, SessionId } from '../../session/types';
import type { NodeId } from '../../tree/types';
import { defaultAgentBudget } from '../budget';
import { checkDefinitionGraph, dependenciesOf, swarmDefinitionSchema, type AgentSpec, type SwarmDefinition } from '../definition';
import { strictestMode } from '../policy';
import type { AgentLaunchSpec, AgentRuntime, RuntimeEvent } from '../runtime/types';
import { DEFAULT_SWARM_SETTINGS, type SwarmSettings } from '../settings';
import { resolveTier, type ResolvedTier } from '../tiers';
import {
  AGENT_RUN_STATES,
  ENDED_RUN_STATES,
  SwarmError,
  type AgentResult,
  type AgentRunState,
  type EndReason,
  type InterruptedBy,
  type OpenApproval,
  type QueueReason,
  type SwarmAgentStatus,
  type SwarmCaller,
  type SwarmEvent,
  type SwarmId,
  type SwarmManager,
  type SwarmResults,
  type SwarmStartRequest,
  type SwarmStartResult,
  type SwarmState,
  type SwarmStatus,
  type SwarmSummary,
} from '../types';

/** Folders for swarms. The persistent manager uses the tree; the in-memory one keeps its own parent map. */
export interface SwarmFolders {
  create(title: string, parentId: NodeId | null): NodeId;
  /** True when `nodeId` is `ancestorId` or below it. */
  isWithin(nodeId: NodeId, ancestorId: NodeId): boolean;
}

export class InMemorySwarmFolders implements SwarmFolders {
  private readonly parents = new Map<NodeId, NodeId | null>();
  private next = 1;

  /** Registers a folder created elsewhere, such as a caller's folder in a test. */
  add(id: NodeId, parentId: NodeId | null = null): NodeId {
    this.parents.set(id, parentId);
    return id;
  }

  create(_title: string, parentId: NodeId | null): NodeId {
    return this.add(`swarm-folder-${this.next++}`, parentId);
  }

  isWithin(nodeId: NodeId, ancestorId: NodeId): boolean {
    for (let current: NodeId | null | undefined = nodeId; current != null; current = this.parents.get(current)) {
      if (current === ancestorId) return true;
    }
    return false;
  }
}

export interface InMemorySwarmManagerDeps {
  readonly runtime: AgentRuntime;
  /** The profile-wide cap on live app-started processes (`agents.maxConcurrentAppStarted`). */
  readonly cap: () => number;
  readonly folders?: SwarmFolders;
  readonly settings?: () => SwarmSettings;
  /** Working directory of an agent. The in-memory manager creates no workspaces. */
  readonly cwdFor?: (swarmId: SwarmId, agent: AgentSpec) => string;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

interface AgentEntry {
  readonly spec: AgentSpec;
  readonly position: number;
  readonly tier: ResolvedTier;
  readonly permissionMode: PermissionMode;
  state: AgentRunState;
  reason?: EndReason | undefined;
  interruptedBy?: InterruptedBy | undefined;
  sessionId?: SessionId | undefined;
  /** How the agent ends when its process exits. */
  ending?: { state: AgentRunState; reason?: EndReason | undefined } | undefined;
  /** A message that waits for a slot to resume the agent with. */
  resumeWith?: string | undefined;
  turns: number;
  reportedUsd: number;
  segmentUsd: number;
  text?: string | undefined;
  readonly approvals: Map<string, OpenApproval>;
  readonly queuedAt: string;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
}

interface SwarmEntry {
  readonly id: SwarmId;
  readonly folderId: NodeId;
  readonly callerSessionId?: SessionId | undefined;
  readonly depth: number;
  readonly definition: SwarmDefinition;
  readonly agents: AgentEntry[];
  readonly warnings: string[];
  readonly createdAt: string;
  state: SwarmState;
  stopReason?: EndReason | undefined;
  endedAt?: string | undefined;
}

/**
 * A `SwarmManager` without persistence, budgets ledger, workspaces or inbox items: run states, stages and
 * dependencies, the cap with its queue, the failure policy, steering, scope and spawn depth. Passes
 * `describeSwarmManagerContract`.
 */
export class InMemorySwarmManager implements SwarmManager {
  private readonly swarms = new Map<SwarmId, SwarmEntry>();
  private readonly bySession = new Map<SessionId, { swarm: SwarmEntry; agent: AgentEntry }>();
  private readonly listeners = new Set<(event: SwarmEvent) => void>();
  private readonly folders: SwarmFolders;
  private readonly unsubscribe: Unsubscribe;

  constructor(private readonly deps: InMemorySwarmManagerDeps) {
    this.folders = deps.folders ?? new InMemorySwarmFolders();
    this.unsubscribe = deps.runtime.subscribe((event) => this.onRuntime(event));
  }

  async start(request: SwarmStartRequest, caller: SwarmCaller): Promise<SwarmStartResult> {
    const parsed = swarmDefinitionSchema.safeParse(request.definition);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SwarmError('invalid_input', `${issue?.path.join('.') || 'definition'}: ${issue?.message ?? 'invalid'}`, parsed.error.issues);
    }
    const definition = parsed.data;
    const issues = checkDefinitionGraph(definition);
    if (issues.length > 0) throw new SwarmError('invalid_input', `${issues[0]!.path}: ${issues[0]!.message}`, issues);
    if (request.bypass === true && caller.kind !== 'ui') throw new SwarmError('refused', 'only the start dialog can run a swarm in bypass mode');
    const settings = this.settings();
    let parentId: NodeId | null = request.parentFolderId ?? null;
    let depth = 0;
    let callerMode: PermissionMode = request.bypass === true ? 'bypassPermissions' : 'auto';
    if (caller.kind === 'session') {
      if (caller.swarmAgent !== undefined && !caller.swarmAgent.mayStartSwarms) throw new SwarmError('refused', 'this swarm agent may not start swarms');
      if (caller.depth >= settings.maxSpawnDepth) throw new SwarmError('limit_reached', `spawn depth ${caller.depth} is at the limit of ${settings.maxSpawnDepth}`);
      const active = [...this.swarms.values()].filter((swarm) => swarm.callerSessionId === caller.sessionId && (swarm.state === 'running' || swarm.state === 'paused'));
      if (active.length >= settings.maxActivePerSession) throw new SwarmError('limit_reached', `this session already has ${active.length} active swarms`);
      parentId = request.parentFolderId ?? caller.folderId;
      if (parentId === null || !this.folders.isWithin(parentId, caller.folderId)) throw new SwarmError('out_of_scope', 'the parent folder is outside the session folder');
      depth = caller.depth + 1;
      callerMode = caller.permissionMode;
    }
    const id = this.newId();
    const folderId = this.folders.create(definition.goal.split('\n')[0]!.slice(0, 120), parentId);
    const at = this.iso();
    const swarm: SwarmEntry = {
      id,
      folderId,
      callerSessionId: caller.kind === 'session' ? caller.sessionId : undefined,
      depth,
      definition,
      createdAt: at,
      state: 'running',
      warnings: [],
      agents: definition.agents.map((spec, position) => ({
        spec,
        position,
        tier: resolveTier(settings.tiers, definition.maxTier, spec),
        permissionMode: strictestMode(spec.permissionMode ?? definition.permissionMode, definition.permissionMode, callerMode),
        state: 'queued',
        turns: 0,
        reportedUsd: 0,
        segmentUsd: 0,
        approvals: new Map(),
        queuedAt: at,
      })),
    };
    const warnings = swarm.agents
      .filter((agent) => agent.tier.capped)
      .map((agent) => `${agent.spec.name} runs on ${agent.tier.tier} (${agent.tier.model}, ${agent.tier.effort}) under maxTier`);
    swarm.warnings.push(...warnings);
    this.swarms.set(id, swarm);
    this.emit({ type: 'swarm.changed', swarmId: id, state: 'running' });
    await this.schedule();
    return {
      swarmId: id,
      folderId,
      agents: swarm.agents.map((agent) => ({ name: agent.spec.name, state: agent.state, ...(agent.sessionId === undefined ? {} : { sessionId: agent.sessionId }) })),
      warnings,
    };
  }

  list(filter: { readonly states?: readonly SwarmState[]; readonly limit?: number }, caller: SwarmCaller): SwarmSummary[] {
    return [...this.swarms.values()]
      .filter((swarm) => this.visible(swarm, caller))
      .filter((swarm) => filter.states === undefined || filter.states.includes(swarm.state))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 20)
      .map((swarm) => ({
        id: swarm.id,
        folderId: swarm.folderId,
        goal: swarm.definition.goal,
        state: swarm.state,
        createdAt: swarm.createdAt,
        counts: Object.fromEntries(AGENT_RUN_STATES.map((state) => [state, swarm.agents.filter((agent) => agent.state === state).length])) as Record<AgentRunState, number>,
      }));
  }

  status(swarmId: SwarmId, caller: SwarmCaller): SwarmStatus {
    const swarm = this.find(swarmId, caller);
    const reported = swarm.agents.reduce((sum, agent) => sum + agent.reportedUsd + agent.segmentUsd, 0);
    const { budget } = swarm.definition;
    return {
      id: swarm.id,
      folderId: swarm.folderId,
      goal: swarm.definition.goal,
      ...(swarm.callerSessionId === undefined ? {} : { callerSessionId: swarm.callerSessionId }),
      depth: swarm.depth,
      state: swarm.state,
      ...(swarm.stopReason === undefined ? {} : { stopReason: swarm.stopReason }),
      definition: swarm.definition,
      budget: {
        usdTotal: budget.usdTotal,
        reviewUsd: budget.usdTotal * budget.reviewShare,
        reportedUsd: reported,
        estimatedUsd: 0,
        reservedUsd: 0,
        remainingUsd: Math.max(0, budget.usdTotal - reported),
        wallClockMs: 0,
        wallClockLimitMs: budget.wallClockMinutes * 60_000,
      },
      agents: swarm.agents.map((agent) => this.agentStatus(swarm, agent)),
      warnings: [...swarm.warnings],
      createdAt: swarm.createdAt,
      ...(swarm.endedAt === undefined ? {} : { endedAt: swarm.endedAt }),
    };
  }

  async send(swarmId: SwarmId, input: { readonly agent?: string; readonly message?: string; readonly now?: boolean }, caller: SwarmCaller): Promise<void> {
    const swarm = this.steerable(swarmId, caller);
    const text = this.messageText(input.message ?? 'Continue where you stopped.', caller);
    if (input.agent === undefined) {
      if (swarm.state === 'paused') this.setSwarm(swarm, 'running');
      for (const agent of swarm.agents.filter((entry) => entry.state === 'interrupted')) await this.continueAgent(swarm, agent, text, false);
      await this.schedule();
      return;
    }
    if (input.message === undefined) throw new SwarmError('invalid_input', 'message: a message to one agent is required');
    await this.continueAgent(swarm, this.agent(swarm, input.agent), text, input.now === true);
    await this.schedule();
  }

  async interrupt(swarmId: SwarmId, input: { readonly agent?: string }, caller: SwarmCaller): Promise<void> {
    const swarm = this.steerable(swarmId, caller);
    const by: InterruptedBy = input.agent === undefined ? 'pause' : caller.kind === 'ui' ? 'user' : 'caller';
    if (input.agent === undefined) {
      if (swarm.state === 'running') this.setSwarm(swarm, 'paused');
      await Promise.all(swarm.agents.filter((agent) => agent.state === 'running' || agent.state === 'waiting').map((agent) => this.interruptAgent(swarm, agent, by)));
      return;
    }
    const agent = this.agent(swarm, input.agent);
    if (agent.state === 'running' || agent.state === 'waiting') await this.interruptAgent(swarm, agent, by);
  }

  async stop(swarmId: SwarmId, input: { readonly agent?: string }, caller: SwarmCaller): Promise<void> {
    const swarm = this.steerable(swarmId, caller);
    const reason: EndReason = caller.kind === 'ui' ? 'user' : 'caller';
    if (input.agent === undefined) {
      await this.stopSwarm(swarm, reason);
      return;
    }
    await this.stopAgent(swarm, this.agent(swarm, input.agent), reason);
    this.applyFailurePolicy(swarm, this.agent(swarm, input.agent));
    this.settle(swarm);
    await this.schedule();
  }

  async results(swarmId: SwarmId, input: { readonly agent?: string; readonly patch?: boolean }, caller: SwarmCaller): Promise<SwarmResults> {
    const swarm = this.find(swarmId, caller);
    const agents = input.agent === undefined ? swarm.agents : [this.agent(swarm, input.agent)];
    return {
      swarmId,
      agents: agents.map((agent): AgentResult => ({
        name: agent.spec.name,
        state: agent.state,
        ...(agent.reason === undefined ? {} : { reason: agent.reason }),
        ...(agent.text === undefined ? {} : { text: agent.text }),
        commits: [],
        numstat: [],
        outsideOwns: [],
        overlapsWith: [],
        editedInputs: false,
      })),
    };
  }

  answerApproval(swarmId: SwarmId, agentName: string, requestId: string, decision: 'allow' | 'deny'): void {
    const swarm = this.find(swarmId, { kind: 'ui' });
    const agent = this.agent(swarm, agentName);
    const approval = agent.approvals.get(requestId);
    if (approval === undefined || agent.sessionId === undefined) throw new SwarmError('not_found', 'the request is no longer open');
    agent.approvals.delete(requestId);
    this.deps.runtime.answer(
      agent.sessionId,
      requestId,
      decision === 'allow' ? { behavior: 'allow', updatedInput: approval.request.input } : { behavior: 'deny', message: 'The user denied this call in Agide.' },
    );
    if (agent.approvals.size === 0 && agent.state === 'waiting') this.setAgent(swarm, agent, 'running');
  }

  subscribe(listener: (event: SwarmEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    for (const swarm of this.swarms.values()) {
      const live = swarm.agents.filter((agent) => agent.sessionId !== undefined && this.deps.runtime.isLive(agent.sessionId));
      await Promise.all(live.filter((agent) => agent.state === 'running' || agent.state === 'waiting').map((agent) => this.interruptAgent(swarm, agent, 'quit')));
      await Promise.all(live.map((agent) => this.deps.runtime.stop(agent.sessionId!)));
      if (swarm.state === 'running') this.setSwarm(swarm, 'paused');
    }
    this.unsubscribe();
  }

  private async continueAgent(swarm: SwarmEntry, agent: AgentEntry, text: string, now: boolean): Promise<void> {
    if (agent.sessionId !== undefined && this.deps.runtime.isLive(agent.sessionId)) {
      agent.ending = undefined;
      if (agent.state === 'interrupted') this.setAgent(swarm, agent, 'running');
      this.deps.runtime.send(agent.sessionId, text, { now });
      return;
    }
    if (agent.state === 'queued') throw new SwarmError('invalid_input', `${agent.spec.name} has not started yet`);
    if (agent.sessionId === undefined) throw new SwarmError('invalid_input', `${agent.spec.name} never started`);
    agent.resumeWith = text;
    agent.reason = undefined;
    agent.endedAt = undefined;
    this.setAgent(swarm, agent, 'queued');
    if (swarm.state !== 'running' && swarm.state !== 'paused') {
      swarm.endedAt = undefined;
      swarm.stopReason = undefined;
      this.setSwarm(swarm, 'running');
    }
  }

  private async interruptAgent(swarm: SwarmEntry, agent: AgentEntry, by: InterruptedBy): Promise<void> {
    agent.interruptedBy = by;
    this.setAgent(swarm, agent, 'interrupted');
    if (agent.sessionId !== undefined && this.deps.runtime.isLive(agent.sessionId)) await this.deps.runtime.interrupt(agent.sessionId);
  }

  private async stopAgent(swarm: SwarmEntry, agent: AgentEntry, reason: EndReason): Promise<void> {
    if (ENDED_RUN_STATES.includes(agent.state)) return;
    if (agent.sessionId !== undefined && this.deps.runtime.isLive(agent.sessionId)) {
      agent.ending = { state: 'stopped', reason };
      await this.deps.runtime.stop(agent.sessionId);
    } else {
      this.end(swarm, agent, 'stopped', reason);
    }
  }

  private async stopSwarm(swarm: SwarmEntry, reason: EndReason): Promise<void> {
    swarm.stopReason = reason;
    this.setSwarm(swarm, 'stopped');
    await Promise.all(swarm.agents.map((agent) => this.stopAgent(swarm, agent, reason)));
  }

  /** Starts ready agents up to the cap, oldest swarm first, then stage, then definition order. */
  private async schedule(): Promise<void> {
    const queue = [...this.swarms.values()]
      .filter((swarm) => swarm.state === 'running')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .flatMap((swarm) =>
        swarm.agents
          .filter((agent) => agent.state === 'queued' && this.queuedFor(swarm, agent) === 'slot')
          .sort((a, b) => a.spec.stage - b.spec.stage || a.position - b.position)
          .map((agent) => ({ swarm, agent })),
      );
    for (const { swarm, agent } of queue) {
      if (agent.state !== 'queued' || swarm.state !== 'running') continue;
      if (this.liveCount() >= this.deps.cap()) return;
      await this.launch(swarm, agent);
    }
  }

  private async launch(swarm: SwarmEntry, agent: AgentEntry): Promise<void> {
    const resume = agent.resumeWith;
    const sessionId = agent.sessionId ?? this.newId();
    const spec = this.launchSpec(swarm, agent, sessionId, resume ?? agent.spec.prompt);
    agent.sessionId = sessionId;
    agent.resumeWith = undefined;
    agent.startedAt ??= this.iso();
    agent.reportedUsd += agent.segmentUsd;
    agent.segmentUsd = 0;
    this.bySession.set(sessionId, { swarm, agent });
    this.setAgent(swarm, agent, 'running');
    try {
      if (resume === undefined) await this.deps.runtime.launch(spec);
      else await this.deps.runtime.resume(spec);
    } catch {
      this.end(swarm, agent, 'failed', 'spawn');
      this.applyFailurePolicy(swarm, agent);
      this.settle(swarm);
    }
  }

  private launchSpec(swarm: SwarmEntry, agent: AgentEntry, sessionId: SessionId, firstMessage: string): AgentLaunchSpec {
    const { definition } = swarm;
    const readonlyRules = agent.spec.workspace === 'readonly' ? ['Edit(**)', 'Write(**)', 'NotebookEdit(**)'] : [];
    return {
      sessionId,
      folderId: swarm.folderId,
      title: agent.spec.name,
      cwd: this.deps.cwdFor?.(swarm.id, agent.spec) ?? '.',
      model: agent.tier.model,
      effort: agent.tier.effort,
      permissionMode: agent.permissionMode,
      maxBudgetUsd: agent.spec.budget.usd ?? defaultAgentBudget(definition.budget.usdTotal, definition.budget.usdPerAgent),
      maxTurnsPerMessage: agent.spec.budget.maxTurnsPerMessage ?? definition.budget.maxTurnsPerMessage,
      connectors: agent.spec.connectors,
      ...(agent.spec.tools.available === undefined ? {} : { tools: agent.spec.tools.available }),
      denyRules: [...readonlyRules, ...agent.spec.tools.deny],
      addDirs: [],
      env: { CLAUDE_CODE_SUBAGENT_MODEL: agent.tier.model, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' },
      firstMessage,
    };
  }

  private onRuntime(event: RuntimeEvent): void {
    const found = this.bySession.get(event.sessionId);
    if (found === undefined) return;
    const { swarm, agent } = found;
    switch (event.type) {
      case 'init': {
        const reported = MODE_ORDER.find((mode) => mode === event.permissionMode);
        if (reported === undefined || isLooser(reported, agent.permissionMode)) {
          if (agent.ending?.reason === 'mode-mismatch') break;
          agent.ending = { state: 'failed', reason: 'mode-mismatch' };
          void this.deps.runtime.stop(event.sessionId).catch(() => undefined);
        } else if (reported !== agent.permissionMode) {
          const warning = `${agent.spec.name} runs in ${reported}, stricter than the requested ${agent.permissionMode}`;
          if (!swarm.warnings.includes(warning)) swarm.warnings.push(warning);
        }
        break;
      }
      case 'permission_request':
        agent.approvals.set(event.requestId, { requestId: event.requestId, request: event.request, openedAt: this.iso() });
        if (agent.state === 'running') this.setAgent(swarm, agent, 'waiting');
        break;
      case 'permission_cancelled':
        agent.approvals.delete(event.requestId);
        if (agent.approvals.size === 0 && agent.state === 'waiting') this.setAgent(swarm, agent, 'running');
        break;
      case 'result': {
        const { result } = event;
        agent.turns += result.numTurns;
        agent.segmentUsd = result.totalCostUsd;
        if (result.text !== undefined) agent.text = result.text;
        if (result.interrupted) break;
        if (!result.isError) {
          if (agent.state === 'running' && !this.deps.runtime.isBusy(event.sessionId)) {
            agent.ending = { state: 'done' };
            void this.deps.runtime.end(event.sessionId).catch(() => undefined);
          }
          break;
        }
        const reason: EndReason = result.subtype === 'error_max_budget_usd' ? 'agent-budget' : result.subtype === 'error_max_turns' ? 'turns' : 'error-result';
        agent.ending = { state: 'failed', reason };
        void this.deps.runtime.stop(event.sessionId).catch(() => undefined);
        break;
      }
      case 'exited': {
        agent.approvals.clear();
        const ending = agent.ending ?? (agent.state === 'interrupted' ? undefined : { state: 'failed' as const, reason: 'exit' as const });
        agent.ending = undefined;
        if (ending !== undefined) {
          this.end(swarm, agent, ending.state, ending.reason);
          if (ending.state !== 'done') this.applyFailurePolicy(swarm, agent);
        }
        this.settle(swarm);
        void this.schedule();
        break;
      }
      default:
        break;
    }
  }

  private applyFailurePolicy(swarm: SwarmEntry, failed: AgentEntry): void {
    if (failed.state === 'done') return;
    const policy = swarm.definition.failurePolicy;
    if (policy === 'continue') return;
    if (policy === 'stop-swarm') {
      if (swarm.state === 'running' || swarm.state === 'paused') void this.stopSwarm(swarm, 'policy');
      return;
    }
    const failedNames = new Set([failed.spec.name]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const agent of swarm.agents) {
        if (agent.state !== 'queued' || agent.sessionId !== undefined || failedNames.has(agent.spec.name)) continue;
        if (dependenciesOf(swarm.definition, agent.spec).some((name) => failedNames.has(name))) {
          this.end(swarm, agent, 'failed', 'dependency');
          failedNames.add(agent.spec.name);
          changed = true;
        }
      }
    }
  }

  private queuedFor(swarm: SwarmEntry, agent: AgentEntry): QueueReason | undefined {
    if (agent.state !== 'queued') return undefined;
    if (swarm.state === 'paused') return 'pause';
    if (agent.resumeWith !== undefined) return 'slot';
    const continueOnFailure = swarm.definition.failurePolicy === 'continue';
    const ready = dependenciesOf(swarm.definition, agent.spec).every((name) => {
      const dependency = swarm.agents.find((entry) => entry.spec.name === name)!;
      return dependency.state === 'done' || (continueOnFailure && ENDED_RUN_STATES.includes(dependency.state));
    });
    return ready ? 'slot' : 'dependencies';
  }

  private settle(swarm: SwarmEntry): void {
    if (swarm.state === 'stopped' || swarm.state === 'done' || swarm.state === 'failed') {
      if (swarm.state === 'stopped' && swarm.endedAt === undefined && swarm.agents.every((agent) => ENDED_RUN_STATES.includes(agent.state))) swarm.endedAt = this.iso();
      return;
    }
    if (!swarm.agents.every((agent) => ENDED_RUN_STATES.includes(agent.state))) return;
    swarm.endedAt = this.iso();
    this.setSwarm(swarm, swarm.agents.some((agent) => agent.state === 'failed') ? 'failed' : 'done');
  }

  private end(swarm: SwarmEntry, agent: AgentEntry, state: AgentRunState, reason?: EndReason): void {
    agent.reason = reason;
    agent.interruptedBy = undefined;
    agent.endedAt = this.iso();
    this.setAgent(swarm, agent, state);
  }

  private liveCount(): number {
    let count = 0;
    for (const swarm of this.swarms.values()) {
      for (const agent of swarm.agents) if (agent.sessionId !== undefined && this.deps.runtime.isLive(agent.sessionId)) count += 1;
    }
    return count;
  }

  private agentStatus(swarm: SwarmEntry, agent: AgentEntry): SwarmAgentStatus {
    const queuedFor = this.queuedFor(swarm, agent);
    return {
      name: agent.spec.name,
      position: agent.position,
      role: agent.spec.role,
      stage: agent.spec.stage,
      state: agent.state,
      ...(agent.reason === undefined ? {} : { reason: agent.reason }),
      ...(agent.interruptedBy === undefined ? {} : { interruptedBy: agent.interruptedBy }),
      ...(queuedFor === undefined ? {} : { queuedFor }),
      ...(agent.sessionId === undefined ? {} : { sessionId: agent.sessionId }),
      tier: agent.tier.tier,
      model: agent.tier.model,
      effort: agent.tier.effort,
      permissionMode: agent.permissionMode,
      workspace: agent.spec.workspace,
      turns: agent.turns,
      spend: { reportedUsd: agent.reportedUsd + agent.segmentUsd, estimatedUsd: 0, reservedUsd: 0, priced: true },
      openApprovals: [...agent.approvals.values()],
      queuedAt: agent.queuedAt,
      ...(agent.startedAt === undefined ? {} : { startedAt: agent.startedAt }),
      ...(agent.endedAt === undefined ? {} : { endedAt: agent.endedAt }),
    };
  }

  private visible(swarm: SwarmEntry, caller: SwarmCaller): boolean {
    if (caller.kind === 'ui') return true;
    if (caller.swarmAgent !== undefined) return swarm.id === caller.swarmAgent.swarmId || swarm.callerSessionId === caller.sessionId;
    return this.folders.isWithin(swarm.folderId, caller.folderId);
  }

  private find(swarmId: SwarmId, caller: SwarmCaller): SwarmEntry {
    const swarm = this.swarms.get(swarmId);
    if (swarm === undefined || !this.visible(swarm, caller)) throw new SwarmError('not_found', `no swarm ${swarmId}`);
    return swarm;
  }

  /** Steering is for the user and for the session that started the swarm; never for the swarm's own agents. */
  private steerable(swarmId: SwarmId, caller: SwarmCaller): SwarmEntry {
    const swarm = this.find(swarmId, caller);
    if (caller.kind === 'session' && swarm.callerSessionId !== caller.sessionId) throw new SwarmError('out_of_scope', 'only the session that started a swarm can steer it');
    return swarm;
  }

  private agent(swarm: SwarmEntry, name: string): AgentEntry {
    const agent = swarm.agents.find((entry) => entry.spec.name === name);
    if (agent === undefined) throw new SwarmError('not_found', `no agent ${name} in swarm ${swarm.id}`);
    return agent;
  }

  private messageText(message: string, caller: SwarmCaller): string {
    return caller.kind === 'ui' ? message : `Message from agent session ${caller.sessionId}:\n${message}`;
  }

  private setAgent(swarm: SwarmEntry, agent: AgentEntry, state: AgentRunState): void {
    if (state !== 'interrupted') agent.interruptedBy = undefined;
    if (agent.state === state) return;
    agent.state = state;
    this.emit({ type: 'swarm.agent_changed', swarmId: swarm.id, agent: agent.spec.name, state, ...(agent.sessionId === undefined ? {} : { sessionId: agent.sessionId }) });
  }

  private setSwarm(swarm: SwarmEntry, state: SwarmState): void {
    if (swarm.state === state) return;
    swarm.state = state;
    this.emit({ type: 'swarm.changed', swarmId: swarm.id, state });
  }

  private settings(): SwarmSettings {
    return this.deps.settings?.() ?? DEFAULT_SWARM_SETTINGS;
  }

  private newId(): string {
    return this.deps.newId?.() ?? randomUUID();
  }

  private iso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private emit(event: SwarmEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
