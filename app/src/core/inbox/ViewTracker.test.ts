import { describe, expect, it } from 'vitest';
import { InMemoryTreeService } from '../tree/InMemoryTreeService';
import { InMemoryInboxService } from './InMemoryInboxService';
import { ViewTracker, type Timers } from './ViewTracker';

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    setTimeout: (work) => {
      pending.set(++next, work);
      return next;
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
  };
  return { timers, fire: () => [...pending.values()].splice(0).forEach((work) => work()), count: () => pending.size };
}

const setup = () => {
  const inbox = new InMemoryInboxService(new InMemoryTreeService());
  const fake = fakeTimers();
  const tracker = new ViewTracker(inbox, fake.timers);
  const post = (kind: 'status' | 'approval', origin: string) =>
    inbox.post({ folderId: null, kind, source: 'hook', origin, sessionId: 's1', message: 'm', textAuthor: 'agent', dedupeKey: origin }).item;
  return { inbox, fake, tracker, post };
};

describe('ViewTracker', () => {
  it('counts a session as viewed only after it stayed in view, then resolves status items and marks approvals seen', () => {
    const { inbox, fake, tracker, post } = setup();
    const status = post('status', 'hook:Stop');
    const approval = post('approval', 'hook:PermissionRequest');
    tracker.set('s1');
    expect(tracker.isInView('s1'), 'not yet').toBe(false);
    expect(inbox.get(status.id)?.state, 'not resolved before the delay').toBe('new');
    fake.fire();
    expect(tracker.isInView('s1'), 'in view').toBe(true);
    expect(inbox.get(status.id)?.resolution, 'status viewed').toBe('viewed');
    expect(inbox.get(approval.id)?.state, 'approval seen, not done').toBe('seen');
  });

  it('cancels the wait when the user leaves the session first', () => {
    const { inbox, fake, tracker, post } = setup();
    const status = post('status', 'hook:Stop');
    tracker.set('s1');
    tracker.set(undefined);
    expect(fake.count(), 'timer cleared').toBe(0);
    expect(inbox.get(status.id)?.state, 'untouched').toBe('new');
  });

  it('applies the rule again to an item that arrives during the view', () => {
    const { inbox, fake, tracker, post } = setup();
    tracker.set('s1');
    fake.fire();
    const status = post('status', 'hook:Stop');
    tracker.refresh();
    expect(inbox.get(status.id)?.state, 'resolved on refresh').toBe('done');
  });
});
