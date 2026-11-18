import { describe, expect, it } from 'vitest';
import { alertActionSession, topSessionId } from './alertAction';
import type { RankedSubject } from './types';

const ranked = (subject: RankedSubject['subject']): RankedSubject => ({ subject, weightedTokensPerMinute: 1, share: 0.5, lastActivityAt: 0 });

describe('topSessionId', () => {
  it('takes the first ranked session and skips agents ranked above it', () => {
    const list = [ranked({ kind: 'agent', ref: { sessionId: 'a', agentKey: 'x' } }), ranked({ kind: 'session', sessionId: 's2' }), ranked({ kind: 'session', sessionId: 's3' })];
    expect(topSessionId(list), 'first session').toBe('s2');
  });

  it('is undefined for an empty ranking and for a ranking of agents only', () => {
    expect(topSessionId([]), 'empty').toBeUndefined();
    expect(topSessionId([ranked({ kind: 'agent', ref: { sessionId: 'a', agentKey: 'x' } })]), 'agents only').toBeUndefined();
  });
});

describe('alertActionSession', () => {
  it('uses the top session for pause-top whatever the alert names', () => {
    expect(alertActionSession({ subject: { kind: 'session', sessionId: 's1' } }, 'pause-top', 's9'), 'top wins').toBe('s9');
    expect(alertActionSession({}, 'pause-top', undefined), 'no top session').toBeUndefined();
  });

  it('uses the session of the alert subject for pause and stop', () => {
    expect(alertActionSession({ subject: { kind: 'session', sessionId: 's1' } }, 'stop', 's9'), 'session subject').toBe('s1');
  });

  it('uses the session of the agent when the subject is an agent', () => {
    expect(alertActionSession({ subject: { kind: 'agent', ref: { sessionId: 's4', agentKey: 'k' } } }, 'pause', 's9'), 'agent subject').toBe('s4');
  });

  it('gives no session for a payload without a subject, so the command refuses', () => {
    expect(alertActionSession(undefined, 'pause', 's9'), 'no payload').toBeUndefined();
    expect(alertActionSession({ actions: ['pause'] }, 'stop', 's9'), 'no subject').toBeUndefined();
    expect(alertActionSession('text', 'stop', 's9'), 'payload that is not an object').toBeUndefined();
  });
});
