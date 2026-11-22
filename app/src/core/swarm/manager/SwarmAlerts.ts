import type { InboxService, Urgency } from '../../inbox/index';
import type { NodeId } from '../../tree/types';
import type { SwarmId } from '../types';

type AlertAction = 'open' | 'raise-budget' | 'pause' | 'resume' | 'raise-and-resume' | 'leave';

/** The `alert` items of 0037 section 6.3. Each has a dedupe key, so a repeat coalesces into the open item. */
export class SwarmAlerts {
  constructor(private readonly inbox: InboxService) {}

  private post(folderId: NodeId | null, urgency: Urgency, dedupeKey: string, message: string, details: string, actions: readonly AlertAction[], swarmId: SwarmId): void {
    try {
      this.inbox.post({
        folderId,
        kind: 'alert',
        urgency,
        source: 'app',
        origin: 'swarm',
        message,
        details,
        textAuthor: 'app',
        payload: { actions, swarmId, estimate: true },
        dedupeKey,
      });
    } catch (error) {
      console.warn('swarm: alert failed', error);
    }
  }

  budgetShare(swarmId: SwarmId, folderId: NodeId | null, goal: string, spent: number, total: number): void {
    this.post(
      folderId,
      'normal',
      `swarm:budget:${swarmId}:80`,
      `A swarm used 80 percent of its budget`,
      `${goal}\n${spent.toFixed(2)} of ${total.toFixed(2)} USD, list-price equivalent, not billed.`,
      ['open', 'raise-budget', 'pause'],
      swarmId,
    );
  }

  stopped(swarmId: SwarmId, folderId: NodeId | null, goal: string, reason: 'swarm-budget' | 'wall-clock'): void {
    const what = reason === 'swarm-budget' ? 'reached its budget' : 'reached its time limit';
    this.post(folderId, 'high', `swarm:budget:${swarmId}:stop`, `A swarm stopped: it ${what}`, goal, ['open', 'raise-and-resume'], swarmId);
  }

  agentLimit(swarmId: SwarmId, folderId: NodeId | null, agent: string, reason: 'agent-budget' | 'turns'): void {
    const what = reason === 'agent-budget' ? 'its budget' : 'its turn limit';
    this.post(folderId, 'normal', `swarm:agent-limit:${swarmId}:${agent}`, `${agent} ended at ${what}`, '', ['open', 'raise-and-resume', 'leave'], swarmId);
  }

  rateLimit(window: string, resetsAt: string, status: string): void {
    const warning = status === 'allowed_warning';
    this.post(null, 'normal', `swarm:rate:${window}:${resetsAt}`, warning ? `The plan reports ${status} for the ${window} window; swarms keep running` : `The plan reports ${status}; swarms are paused`, '', warning ? ['open'] : ['open', 'resume'], '');
  }

  capWait(swarmId: SwarmId, folderId: NodeId | null, goal: string, agent: string): void {
    this.post(folderId, 'low', `swarm:cap:${swarmId}`, `${agent} waits for a free agent slot`, goal, ['open'], swarmId);
  }
}
