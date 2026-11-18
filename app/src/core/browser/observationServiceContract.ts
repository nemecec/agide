import { describe, expect, it } from 'vitest';
import type { Caller } from '../commands/types';
import type { BrowserEvent, NewObservationLogEntry, ObservationService } from './types';

const ui: Caller = { kind: 'ui' };
const agent: Caller = { kind: 'mcp', sessionId: 's1', folderId: 'f1' };
const entry = (overrides: Partial<NewObservationLogEntry> = {}): NewObservationLogEntry => ({
  sessionId: 's1',
  folderId: 'f1',
  nodeId: 'n1',
  kind: 'read_page',
  origin: 'https://github.com',
  bytes: 120,
  outcome: 'ok',
  ...overrides,
});

/** Behaviour every `ObservationService` shows (0026 section 6). `create(now)` gets a controlled clock. */
export function describeObservationServiceContract(name: string, create: (now: () => Date) => ObservationService): void {
  describe(`${name} (ObservationService contract)`, () => {
    let clock = new Date('2026-11-17T10:00:00Z');
    const now = () => clock;

    it('starts each surface at its service default: off for Slack and Discord, on demand elsewhere', () => {
      const service = create(now);
      service.register('gh', 'github');
      service.register('sl', 'slack');
      service.register('dc', 'discord');
      expect(service.mode('gh'), 'github').toBe('on-demand');
      expect(service.mode('sl'), 'slack').toBe('off');
      expect(service.mode('dc'), 'discord').toBe('off');
    });

    it('lets only the user change a switch and reports the change', () => {
      const service = create(now);
      const events: BrowserEvent[] = [];
      service.subscribe((event) => events.push(event));
      service.register('gh', 'github');
      expect(() => service.setMode('gh', 'live', agent), 'agent widens its view').toThrow(expect.objectContaining({ code: 'not_user' }));
      expect(service.mode('gh'), 'unchanged after the refusal').toBe('on-demand');
      service.setMode('gh', 'off', ui);
      expect(service.mode('gh'), 'user switched it off').toBe('off');
      expect(events, 'one change event').toEqual([{ type: 'browser.observation_changed', surfaceId: 'gh', mode: 'off' }]);
      service.setMode('gh', 'off', ui);
      expect(events.length, 'no event when nothing changes').toBe(1);
    });

    it('refuses surfaces it did not record, so a forged leaf has no switch', () => {
      const service = create(now);
      expect(() => service.mode('forged'), 'mode of an unknown surface').toThrow(expect.objectContaining({ code: 'not_found' }));
      expect(() => service.setMode('forged', 'live', ui), 'switch of an unknown surface').toThrow(expect.objectContaining({ code: 'not_found' }));
      service.register('gh', 'github');
      service.forget('gh');
      expect(() => service.mode('gh'), 'forgotten surface').toThrow(expect.objectContaining({ code: 'not_found' }));
    });

    it('keeps the origin only in the access log', () => {
      const service = create(now);
      for (const origin of ['https://github.com/acme/app/pull/1', 'https://github.com?token=x', 'https://github.com#a', 'not a url', 'about:blank']) {
        expect(() => service.record(entry({ origin })), origin).toThrow(expect.objectContaining({ code: 'invalid' }));
      }
      expect(service.record(entry({ origin: 'http://127.0.0.1:8080' })).origin, 'origin with a port').toBe('http://127.0.0.1:8080');
    });

    it('lists entries newest first, filtered by node and session, and prunes old ones', () => {
      const service = create(now);
      service.record(entry({ nodeId: 'a' }));
      clock = new Date('2026-11-17T11:00:00Z');
      service.record(entry({ nodeId: 'b', sessionId: 's2' }));
      service.record(entry({ nodeId: 'a', kind: 'screenshot' }));
      expect(service.log().map((logged) => logged.nodeId), 'newest first').toEqual(['a', 'b', 'a']);
      expect(service.log({ nodeId: 'a' }).map((logged) => logged.kind), 'by node').toEqual(['screenshot', 'read_page']);
      expect(service.log({ sessionId: 's2' }).length, 'by session').toBe(1);
      expect(service.log({ limit: 1 }).length, 'limit').toBe(1);
      expect(service.prune(new Date('2026-11-17T10:30:00Z')), 'entries before the cut').toBe(1);
      expect(service.log().length, 'left after prune').toBe(2);
      clock = new Date('2026-11-17T10:00:00Z');
    });
  });
}
