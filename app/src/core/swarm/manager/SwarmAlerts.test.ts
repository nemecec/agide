import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryInboxService } from '../../inbox/InMemoryInboxService';
import { InMemoryTreeService } from '../../tree/InMemoryTreeService';
import { SwarmAlerts } from './SwarmAlerts';

afterEach(() => vi.restoreAllMocks());

const rig = () => {
  const inbox = new InMemoryInboxService(new InMemoryTreeService());
  return { inbox, alerts: new SwarmAlerts(inbox) };
};

describe('SwarmAlerts', () => {
  it('words each alert for its cause and gives it a dedupe key that names the swarm', () => {
    const { inbox, alerts } = rig();
    alerts.budgetShare('s1', null, 'goal', 0.8, 1);
    alerts.stopped('s1', null, 'goal', 'swarm-budget');
    alerts.stopped('s2', null, 'goal', 'wall-clock');
    alerts.agentLimit('s1', null, 'a', 'agent-budget');
    alerts.agentLimit('s1', null, 'b', 'turns');
    alerts.capWait('s1', null, 'goal', 'c');
    alerts.rateLimit('five_hour', '2026-11-21T10:00:00Z', 'limited');
    const items = inbox.list({ kinds: ['alert'] });
    expect(
      items.map((item) => [item.dedupeKey, item.urgency]).sort(),
      'one item per cause with its urgency',
    ).toEqual(
      [
        ['swarm:budget:s1:80', 'normal'],
        ['swarm:budget:s1:stop', 'high'],
        ['swarm:budget:s2:stop', 'high'],
        ['swarm:agent-limit:s1:a', 'normal'],
        ['swarm:agent-limit:s1:b', 'normal'],
        ['swarm:cap:s1', 'low'],
        ['swarm:rate:five_hour:2026-11-21T10:00:00Z', 'normal'],
      ].sort(),
    );
    const messages = items.map((item) => item.message);
    expect(messages, 'the budget stop and the time stop say different things').toEqual(expect.arrayContaining(['A swarm stopped: it reached its budget', 'A swarm stopped: it reached its time limit']));
    expect(messages, 'the limits of an agent say which limit').toEqual(expect.arrayContaining(['a ended at its budget', 'b ended at its turn limit']));
  });

  it('coalesces a repeated alert into the open item', () => {
    const { inbox, alerts } = rig();
    alerts.capWait('s1', null, 'goal', 'c');
    alerts.capWait('s1', null, 'goal', 'c');
    expect(inbox.list({ kinds: ['alert'] }).length, 'the second post joins the first').toBe(1);
  });

  it('logs and goes on when the inbox refuses an alert', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const alerts = new SwarmAlerts({ post: () => { throw new Error('inbox full'); } } as never);
    expect(() => alerts.capWait('s1', null, 'goal', 'c'), 'a failing inbox does not stop the swarm').not.toThrow();
    expect(warn, 'the failure is logged').toHaveBeenCalledWith('swarm: alert failed', expect.any(Error));
  });
});
