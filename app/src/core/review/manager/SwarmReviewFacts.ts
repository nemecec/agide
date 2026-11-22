import type { SessionId } from '../../session/types';
import { SwarmError, type SwarmCaller, type SwarmId, type SwarmStatus } from '../../swarm/index';
import type { PersistentSwarmManager } from '../../swarm/manager/PersistentSwarmManager';
import type { NodeId } from '../../tree/types';
import type { CaptureAgentFacts, Delivery, ReviewSwarmFacts, ReviewSwarmView, SendBackChannel } from '../types';

const UI: SwarmCaller = { kind: 'ui' };
const COMMIT_LIKE = /^[0-9a-f]{7,64}$/;
const BRANCH_LIKE = /^[A-Za-z0-9._/-]+$/;

/** `definition.repository.base` names a local branch when it is not a commit id, `HEAD` or a revision expression. */
function branchName(base: string | undefined): string | undefined {
  if (base === undefined || base === 'HEAD' || COMMIT_LIKE.test(base) || !BRANCH_LIKE.test(base)) return undefined;
  return base;
}

export interface SwarmReviewFactsOptions {
  /** True when `folderId` is `scope` or below it in the tree. */
  readonly isWithin: (folderId: NodeId, scope: NodeId) => boolean;
}

/** What the review manager and the capture service read from the swarm manager (0041). */
export class SwarmReviewFacts implements ReviewSwarmFacts {
  constructor(
    private readonly manager: PersistentSwarmManager,
    private readonly options: SwarmReviewFactsOptions,
  ) {}

  agentOf(sessionId: SessionId): ReturnType<ReviewSwarmFacts['agentOf']> {
    const found = this.manager.agentOf(sessionId);
    if (found === undefined) return undefined;
    const workspace = this.status(found.swarmId)?.agents.find((agent) => agent.name === found.agent)?.workspace;
    return workspace === undefined ? undefined : { swarmId: found.swarmId, agent: found.agent, workspace };
  }

  callerSessionOf(swarmId: SwarmId): SessionId | undefined {
    return this.status(swarmId)?.callerSessionId;
  }

  folderOf(swarmId: SwarmId): NodeId | undefined {
    const folder = this.status(swarmId)?.folderId;
    return folder === undefined || folder === '' ? undefined : folder;
  }

  inScope(folderId: NodeId, scope: NodeId): boolean {
    return this.options.isWithin(folderId, scope);
  }

  swarm(swarmId: SwarmId): ReviewSwarmView | undefined {
    const status = this.status(swarmId);
    const inputs = this.manager.reviewInputs(swarmId);
    if (status === undefined || inputs === undefined) return undefined;
    const repository = inputs.repoRoot !== undefined && inputs.baseCommit !== undefined ? { path: inputs.repoRoot, baseCommit: inputs.baseCommit } : undefined;
    const defaultTarget = branchName(status.definition.repository?.base);
    return {
      goal: status.goal,
      ...(defaultTarget === undefined ? {} : { defaultTarget }),
      ...(repository === undefined ? {} : { repository }),
      agents: status.definition.agents.map((spec) => {
        const agent = status.agents.find((candidate) => candidate.name === spec.name);
        return { name: spec.name, stage: spec.stage, workspace: spec.workspace, state: agent?.state ?? 'queued', task: spec.prompt, owns: spec.owns };
      }),
    };
  }

  captureFacts(swarmId: SwarmId, agent: string): CaptureAgentFacts | undefined {
    const status = this.status(swarmId);
    const found = status?.agents.find((candidate) => candidate.name === agent);
    const inputs = this.manager.reviewInputs(swarmId)?.agents.get(agent);
    if (found === undefined || found.sessionId === undefined || inputs === undefined) return undefined;
    return {
      sessionId: found.sessionId,
      workspace: found.workspace,
      ...(found.workspace === 'worktree' && found.cwd !== undefined ? { worktreePath: found.cwd } : {}),
      tier: found.tier,
      ...(inputs.resultText === undefined ? {} : { resultText: inputs.resultText.slice(0, 8_000) }),
      telemetry: {
        endState: found.state === 'done' || found.state === 'failed' || found.state === 'stopped' || found.state === 'interrupted' ? found.state : 'running',
        ...(found.reason === undefined ? {} : { endReason: found.reason }),
        turns: found.turns,
        retries: inputs.retries,
        denials: inputs.denials,
        deniedTools: [...inputs.deniedTools],
        toolErrors: inputs.errors,
        spendUsd: found.spend.reportedUsd,
        backgroundStopped: 0,
      },
    };
  }

  private status(swarmId: SwarmId): SwarmStatus | undefined {
    try {
      return this.manager.status(swarmId, UI);
    } catch (error) {
      if (error instanceof SwarmError) return undefined;
      throw error;
    }
  }
}

/** Sends a send-back through the swarm manager's `send`, as the app (0040 section 14). */
export class SwarmSendBack implements SendBackChannel {
  constructor(private readonly manager: PersistentSwarmManager) {}

  async deliver(swarmId: SwarmId, agent: string, message: string): Promise<Delivery> {
    try {
      await this.manager.send(swarmId, { agent, message }, UI);
      return { delivered: true };
    } catch (error) {
      if (error instanceof SwarmError) return { delivered: false, why: error.message };
      throw error;
    }
  }
}
