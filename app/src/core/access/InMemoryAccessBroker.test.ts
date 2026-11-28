import { describe, expect, it, vi } from 'vitest';
import { InMemoryNoticeDelivery, ScriptedDeliverySessions } from '../inbox/delivery/index';
import { InMemoryInboxService } from '../inbox/InMemoryInboxService';
import { InMemoryTreeService } from '../tree/InMemoryTreeService';
import { describeAccessBrokerContract } from './accessBrokerContract';
import { InMemoryAccessBroker } from './InMemoryAccessBroker';

describeAccessBrokerContract('InMemoryAccessBroker', () => {
  const tree = new InMemoryTreeService();
  const inbox = new InMemoryInboxService(tree);
  const sessions = new ScriptedDeliverySessions();
  const delivery = new InMemoryNoticeDelivery(sessions);
  const folder = tree.createFolder({ title: 'P' });
  const leaf = tree.createLeaf({ title: 'Note', parentId: folder.id, surfaceType: 'note', surfaceId: 'n1' });
  const settings = { waitSeconds: 115, requestHours: 24 };
  const ended = new Set<string>();
  const broker = new InMemoryAccessBroker({
    inbox,
    delivery,
    settings: () => settings,
    sessionTitle: (sessionId) => `Build ${sessionId}`,
    isLive: (sessionId) => !ended.has(sessionId),
  });
  return {
    broker,
    inbox,
    delivery,
    sessions,
    folderId: folder.id,
    nodeId: leaf.id,
    settings,
    endSession: (sessionId) => {
      ended.add(sessionId);
      broker.sessionEnded(sessionId);
    },
    startSession: (sessionId) => void ended.delete(sessionId),
    loseProcess: (sessionId) => void ended.add(sessionId),
  };
});

describe('InMemoryAccessBroker without a running process', () => {
  it('creates no quiet deny for a session whose process is gone, also when nobody told the broker', async () => {
    vi.useFakeTimers();
    try {
      const tree = new InMemoryTreeService();
      const inbox = new InMemoryInboxService(tree);
      const folder = tree.createFolder({ title: 'P' });
      const leaf = tree.createLeaf({ title: 'Note', parentId: folder.id, surfaceType: 'note', surfaceId: 'n1' });
      let live = true;
      const broker = new InMemoryAccessBroker({
        inbox,
        delivery: new InMemoryNoticeDelivery(new ScriptedDeliverySessions()),
        settings: () => ({ waitSeconds: 0, requestHours: 24 }),
        sessionTitle: () => undefined,
        isLive: () => live,
      });
      broker.register({ action: 'note.read', offered: () => ['once'], detail: () => Promise.resolve({ targetTitle: 'Plan' }), perform: () => Promise.resolve('x') });
      const target = { kind: 'note' as const, id: 't1', nodeId: leaf.id };
      const result = await broker.request({ kind: 'mcp', sessionId: 's1', folderId: folder.id }, 'note.read', target, {}, new AbortController().signal);
      expect(result, 'the call returned a request id').toMatchObject({ access: 'pending' });
      expect(inbox.list({ kinds: ['approval'] })[0]?.message, 'a session without a title is named in general').toBe('A session asks to read a note');
      live = false;
      await broker.decide(inbox.list({ kinds: ['approval'] })[0]?.id ?? '', { deny: true });
      expect(broker.check('s1', 'note.read', target), 'a denial for a session without a process is no quiet deny').toBe('ask');
      expect(broker.grants(), 'no grant exists').toEqual([]);
      broker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
