import { describe, expect, it } from 'vitest';
import { InMemoryNoticeDelivery } from './InMemoryNoticeDelivery';
import { ScriptedDeliverySessions } from './ScriptedDeliverySessions';
import type { Notice, NoticeDeliveryKind } from './types';

function rig() {
  const sessions = new ScriptedDeliverySessions();
  const delivery = new InMemoryNoticeDelivery(sessions);
  const reported: [string, NoticeDeliveryKind][] = [];
  const notice = (recordId: string, sessionId = 's1'): Notice => ({
    recordId,
    sessionId,
    noticeLine: `notice ${recordId}`,
    contextLine: `context ${recordId}`,
    onDelivered: (how) => reported.push([recordId, how]),
  });
  return { sessions, delivery, reported, notice };
}

describe('NoticeDelivery in memory', () => {
  it('types the notice into an idle PTY session at once', () => {
    const { sessions, delivery, reported, notice } = rig();
    sessions.set('s1', 'idle');
    delivery.enqueue(notice('r1'));
    expect(sessions.typed, 'the line was typed').toEqual([{ sessionId: 's1', line: 'notice r1' }]);
    expect(reported, 'the delivery is a notice').toEqual([['r1', 'notice']]);
  });

  it('writes the notice as a user message to an idle stream-json session', () => {
    const { sessions, delivery, reported, notice } = rig();
    sessions.set('s1', 'idle', 'stream-json');
    delivery.enqueue(notice('r1'));
    expect(sessions.written, 'the line went to stdin').toEqual([{ sessionId: 's1', line: 'notice r1' }]);
    expect(sessions.typed, 'nothing was typed').toEqual([]);
    expect(reported, 'the delivery is stdin').toEqual([['r1', 'stdin']]);
  });

  it('queues the notice for a session that is busy, waiting, starting, exited or unknown, and delivers it on flush once idle', () => {
    const { sessions, delivery, reported, notice } = rig();
    for (const status of ['busy', 'waiting', 'starting', 'exited'] as const) {
      sessions.set('s1', status);
      delivery.enqueue(notice(status));
      delivery.flush('s1');
    }
    delivery.enqueue(notice('unknown', 'nobody'));
    expect(sessions.typed, 'nothing is typed while the session is not idle').toEqual([]);
    sessions.set('s1', 'idle');
    delivery.flush('s1');
    expect(sessions.typed.length, 'every queued notice of the session is typed on flush').toBe(4);
    delivery.flush('s1');
    expect(sessions.typed.length, 'a delivered notice is not typed again').toBe(4);
    expect(reported.filter(([id]) => id === 'unknown'), 'the notice of an unknown session stays queued').toEqual([]);
  });

  it('replaces a queued notice of the same record and drops a cancelled one', () => {
    const { sessions, delivery, reported, notice } = rig();
    sessions.set('s1', 'busy');
    delivery.enqueue(notice('r1'));
    delivery.enqueue({ ...notice('r1'), noticeLine: 'again' });
    delivery.enqueue(notice('r2'));
    delivery.cancel('r2');
    sessions.set('s1', 'idle');
    delivery.flush('s1');
    expect(sessions.typed, 'one line for r1, the later one, and none for r2').toEqual([{ sessionId: 's1', line: 'again' }]);
    expect(reported, 'only r1 was reported').toEqual([['r1', 'notice']]);
  });

  it('hands the queued notices of a session to its next prompt as context', () => {
    const { sessions, delivery, reported, notice } = rig();
    sessions.set('s1', 'busy');
    delivery.enqueue(notice('r1'));
    delivery.enqueue(notice('r2', 's2'));
    expect(delivery.takeContext('s1'), 'the prompt takes the lines of its own session').toEqual([{ recordId: 'r1', contextLine: 'context r1' }]);
    expect(reported, 'the delivery is context').toEqual([['r1', 'context']]);
    expect(delivery.takeContext('s1'), 'a taken notice is gone').toEqual([]);
    sessions.set('s1', 'idle');
    delivery.flush('s1');
    expect(sessions.typed, 'the notice taken as context is not typed').toEqual([]);
  });

  it('reports failed when the terminal takes no input and does not queue it again', () => {
    const { sessions, delivery, reported, notice } = rig();
    sessions.set('s1', 'idle');
    sessions.failWith = new Error('closed');
    delivery.enqueue(notice('r1'));
    sessions.failWith = undefined;
    delivery.flush('s1');
    expect(reported, 'a failed delivery is reported once').toEqual([['r1', 'failed']]);
    expect(sessions.typed, 'nothing is typed after the failure').toEqual([]);
  });
});
