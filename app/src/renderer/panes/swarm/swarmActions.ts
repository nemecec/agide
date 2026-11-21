import { api } from '../../api';

/** Runs a swarm command as the user; resolves with the message of a failure, or undefined on success. */
export async function runSwarm(id: string, input: Record<string, unknown>): Promise<string | undefined> {
  const result = await api().invoke(id, input);
  return result.ok ? undefined : result.error.message;
}

export const pauseSwarm = (swarmId: string) => runSwarm('swarm_interrupt', { swarmId });
export const resumeSwarm = (swarmId: string) => runSwarm('swarm_send', { swarmId });
export const stopSwarm = (swarmId: string) => runSwarm('swarm_stop', { swarmId });
export const interruptAgent = (swarmId: string, agent: string) => runSwarm('swarm_interrupt', { swarmId, agent });
export const stopAgent = (swarmId: string, agent: string) => runSwarm('swarm_stop', { swarmId, agent });
export const sendToAgent = (swarmId: string, agent: string, message: string, now: boolean) => runSwarm('swarm_send', { swarmId, agent, message, now });
export const answerApproval = (swarmId: string, agent: string, requestId: string, decision: 'allow' | 'deny' | 'always') => runSwarm('swarm_approval_answer', { swarmId, agent, requestId, decision });
