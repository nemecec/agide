import { beforeEach, describe, expect, it } from 'vitest';
import { InboxNotifier } from './InboxNotifier';
import type { InboxItem } from './types';

let time: number;
let shown: { title: string; body: string }[];
let notifier: InboxNotifier;

const item = (extra: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i',
  folderId: null,
  folderRemoved: false,
  kind: 'input',
  state: 'new',
  urgency: 'normal',
  source: 'agent',
  origin: 'mcp:inbox_post',
  message: 'Question',
  textAuthor: 'agent',
  occurrences: 1,
  createdAt: 't',
  updatedAt: 't',
  sessionId: 's1',
  ...extra,
});
const created = (i: InboxItem) => notifier.onEvent({ type: 'inbox.item_changed', item: i, change: 'created' });

beforeEach(() => {
  time = 0;
  shown = [];
  notifier = new InboxNotifier({ sink: { notify: (n) => shown.push(n) }, now: () => new Date(time), titleFor: () => 'Default - Project' });
});

describe('InboxNotifier', () => {
  it('notifies for an agent item at creation with the project title and the short message', () => {
    created(item());
    expect(shown, 'one notification').toEqual([{ title: 'Default - Project', body: 'Question' }]);
  });

  it('does not notify at creation for hook approvals and status items, but for failures', () => {
    created(item({ source: 'hook', kind: 'approval' }));
    created(item({ source: 'hook', kind: 'status', origin: 'hook:Stop', sessionId: 's2' }));
    expect(shown, 'waits for the prompt signal').toEqual([]);
    created(item({ source: 'hook', kind: 'failure', sessionId: 's3' }));
    expect(shown, 'failure notifies').toHaveLength(1);
  });

  it('notifies on request for a Stop item and a hook approval', () => {
    notifier.notifyNow(item({ source: 'hook', kind: 'status', origin: 'hook:Stop' }));
    notifier.notifyNow(item({ source: 'hook', kind: 'approval', sessionId: 's2' }));
    expect(shown, 'both notify').toHaveLength(2);
  });

  it('never notifies for low urgency, for status items below high, or for items already seen', () => {
    created(item({ urgency: 'low' }));
    created(item({ kind: 'status' }));
    created(item({ state: 'seen' }));
    expect(shown, 'nothing').toEqual([]);
    created(item({ kind: 'status', urgency: 'high' }));
    expect(shown, 'high status notifies').toHaveLength(1);
  });

  it('allows one notification per session per minute and separate sessions in parallel', () => {
    created(item());
    time += 30_000;
    created(item());
    created(item({ sessionId: 's2' }));
    expect(shown, 'second of the same session suppressed').toHaveLength(2);
    time += 31_000;
    created(item());
    expect(shown, 'after the window').toHaveLength(3);
  });

  it('shows only the title when the body is hidden', () => {
    notifier = new InboxNotifier({ sink: { notify: (n) => shown.push(n) }, now: () => new Date(time), titleFor: () => 'T', showBody: false });
    created(item());
    expect(shown[0]?.body, 'empty body').toBe('');
  });
});
