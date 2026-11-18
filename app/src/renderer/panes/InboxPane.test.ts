// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemRow } from '../../core/inbox/viewTypes';
import { installFakeApi, type FakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { InboxPane } from './InboxPane';

const NOW = '2026-11-17T10:00:00.000Z';
const item = (id: string, extra: Partial<ItemRow> = {}): ItemRow =>
  ({
    id,
    folderId: null,
    folderRemoved: false,
    kind: 'status',
    state: 'seen',
    urgency: 'normal',
    source: 'agent',
    origin: 'mcp:inbox_post',
    message: `message ${id}`,
    textAuthor: 'agent',
    occurrences: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  }) as ItemRow;

let rendered: Rendered | undefined;
let fake: FakeApi;

afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
});

async function mount(items: ItemRow[], unread = 0) {
  fake = installFakeApi({ inbox_list: { items, unread }, browser_answer_approval: {}, inbox_context: {}, inbox_resolve: {}, inbox_mark_unread: {}, inbox_snooze: {}, inbox_mark_seen: {}, inbox_reopen: {}, ui_focus_node: {} });
  rendered = await render(createElement(InboxPane, { instanceId: 'inbox', config: {}, inputs: {} }));
}
const root = () => rendered!.container;
const rows = () => [...root().querySelectorAll<HTMLElement>('[data-testid="inbox-row"]')];
const select = (index: number) => act(async () => rows()[index]?.click());
const press = (key: string) => act(async () => void root().querySelector('section')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const button = (label: string) => [...root().querySelectorAll('button')].find((b) => b.textContent === label);
const ids = (command: string) => fake.invoke.mock.calls.filter((c) => c[0] === command).map((c) => c[1]);

describe('InboxPane', () => {
  it('says so when nothing is open', async () => {
    await mount([]);
    expect(root().querySelector('[data-testid="inbox-empty"]')?.textContent, 'empty message').toBe('No open items');
    expect(root().querySelector('[data-testid="inbox-unread"]')?.textContent, 'unread line').toBe('No unread items');
  });

  it('lists the items with kind, place, repeats and the unread marker', async () => {
    await mount([item('a', { state: 'new', kind: 'approval', projectName: 'Proj', sessionName: 'Sess', occurrences: 3 }), item('b')], 1);
    expect(rows(), 'two rows').toHaveLength(2);
    expect(rows()[0]?.textContent, 'row kind').toContain('Approval');
    expect(rows()[0]?.textContent, 'row place').toContain('Proj / Sess');
    expect(rows()[0]?.textContent, 'repeat count').toContain('x3');
    expect(rows()[0]?.querySelector('[data-unread="true"]'), 'unread dot of the new item').not.toBeNull();
    expect(rows()[1]?.querySelector('[data-unread="true"]'), 'seen item has no unread dot').toBeNull();
    expect(root().querySelector('[data-testid="inbox-unread"]')?.textContent, 'unread line').toBe('1 unread');
  });

  it('shows agent text as plain text, never as markup', async () => {
    await mount([item('a', { message: '<b id="injected">bold</b>', details: '<img src=x onerror=alert(1)>' })]);
    await select(0);
    expect(root().querySelector('#injected'), 'no element made from the message').toBeNull();
    expect(root().querySelector('img'), 'no element made from the details').toBeNull();
    expect(root().querySelector('[data-testid="inbox-message"]')?.textContent, 'message as text').toBe('<b id="injected">bold</b>');
    expect(root().querySelector('[data-testid="inbox-card"]')?.textContent, 'text-author note').toContain('text written by the agent');
  });

  it('shows the project and session layers of the selected item', async () => {
    await mount([item('a')]);
    fake.respond('inbox_context', { project: { id: 'p', name: 'Proj', summary: 'About it' }, session: { id: 's', name: 'Sess', status: 'idle', summary: 'Doing it', summaryModel: 'haiku' } });
    await select(0);
    expect(root().querySelector('[data-testid="inbox-project-name"]')?.textContent, 'project').toBe('Proj');
    expect(root().querySelector('[data-testid="inbox-session-summary"]')?.textContent, 'session summary with its model').toContain('by haiku');
  });

  it('moves the selection with the arrow keys and stays inside the list', async () => {
    await mount([item('a'), item('b')]);
    await press('ArrowDown');
    expect(rows()[0]?.getAttribute('aria-current'), 'first row selected').toBe('true');
    await press('ArrowDown');
    await press('ArrowDown');
    expect(rows()[1]?.getAttribute('aria-current'), 'last row selected, no overrun').toBe('true');
    await press('ArrowUp');
    await press('ArrowUp');
    expect(rows()[0]?.getAttribute('aria-current'), 'back at the first row').toBe('true');
  });

  it('resolves, marks unread and snoozes the selected item from the keyboard', async () => {
    await mount([item('a')]);
    await select(0);
    await press('e');
    await press('u');
    vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['Date'] });
    await press('s');
    expect(ids('inbox_resolve'), 'resolve').toEqual([{ itemId: 'a', resolution: 'dismissed' }]);
    expect(ids('inbox_mark_unread'), 'mark unread').toEqual([{ itemId: 'a' }]);
    expect(ids('inbox_snooze'), 'snooze for an hour').toEqual([{ itemId: 'a', until: '2026-11-17T11:00:00.000Z' }]);
  });

  it('answers a browser approval from its card and leaves other items without those buttons', async () => {
    await mount([item('b', { kind: 'approval', origin: 'browser:approval', payload: { approvalId: 'req-1' } }), item('c')]);
    fake.invoke.mockClear();
    await select(0);
    await act(async () => button('Deny')?.click());
    await act(async () => button('Allow once')?.click());
    expect(ids('browser_answer_approval'), 'answers sent with the request id').toEqual([
      { id: 'req-1', answer: 'deny' },
      { id: 'req-1', answer: 'once' },
    ]);
    await select(1);
    expect(button('Deny'), 'no answer buttons on another item').toBeUndefined();
  });

  it('ignores shortcut keys without a selected item', async () => {
    await mount([item('a')]);
    await press('e');
    expect(ids('inbox_resolve'), 'nothing resolved').toEqual([]);
  });

  it('offers actions that fit the state of the item', async () => {
    await mount([item('n', { state: 'new' }), item('s', { state: 'seen' })]);
    await select(0);
    expect([button('Mark seen'), button('Mark unread')].map((b) => b !== undefined), 'new item').toEqual([true, false]);
    await select(1);
    expect([button('Mark seen'), button('Mark unread')].map((b) => b !== undefined), 'seen item').toEqual([false, true]);
    expect(root().querySelector('[data-testid="inbox-done"]'), 'done action').not.toBeNull();
  });

  it('marks a new item seen after it stays selected for a second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mount([item('n', { state: 'new' })]);
    await select(0);
    expect(ids('inbox_mark_seen'), 'not yet').toEqual([]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1100)));
    expect(ids('inbox_mark_seen'), 'after a second').toEqual([{ itemId: 'n' }]);
  });

  it('offers only Reopen for a done item', async () => {
    fake = installFakeApi({ inbox_list: { items: [item('d', { state: 'done', resolution: 'dismissed' })], unread: 0 }, inbox_context: {}, inbox_reopen: {} });
    rendered = await render(createElement(InboxPane, { instanceId: 'inbox', config: {}, inputs: {} }));
    await select(0);
    expect(button('Reopen'), 'reopen').toBeDefined();
    expect(root().querySelector('[data-testid="inbox-done"]'), 'no done action').toBeNull();
    expect(root().querySelector('[data-testid="inbox-card"]')?.textContent, 'resolution').toContain('Done: dismissed');
  });

  it('collapses long details and expands them on request', async () => {
    await mount([item('a', { details: 'x'.repeat(300) })]);
    await select(0);
    const details = () => root().querySelector('[data-testid="inbox-details"]');
    expect(details()?.getAttribute('data-expanded'), 'collapsed at first').toBe('false');
    await act(async () => button('Show more')?.click());
    expect(details()?.getAttribute('data-expanded'), 'expanded').toBe('true');
    expect(button('Show less'), 'collapse control').toBeDefined();
  });

  it('shows the raw request of an approval', async () => {
    await mount([item('a', { kind: 'approval', payload: { toolInput: { command: 'rm -r build' } } })]);
    await select(0);
    expect(root().querySelector('[data-testid="inbox-raw"]')?.textContent, 'raw tool input').toContain('"command": "rm -r build"');
  });

  it('keeps an open approval marked as needing an answer after it is read, and says where to answer', async () => {
    await mount([item('a', { kind: 'approval', state: 'seen', sessionId: 's1', linkNodeId: 'leaf1' }), item('b', { state: 'new', createdAt: '2026-11-17T11:00:00.000Z' })], 1);
    expect(rows()[0]?.getAttribute('data-kind'), 'the approval stays on top although it is read and the other item is newer').toBe('approval');
    expect(rows()[0]?.querySelector('[data-testid="inbox-needs-answer"]'), 'needs-answer marker on a read approval').not.toBeNull();
    expect(root().querySelector('[data-testid="inbox-waiting"]')?.textContent, 'header says one approval needs an answer').toBe('1 needs an answer');
    await select(0);
    expect(button('Dismiss without answering'), 'Done is named for what it does').toBeDefined();
    expect(root().querySelector('[data-testid="inbox-done"]')?.textContent, 'the dismiss action is not called Done').toBe('Dismiss without answering');
    await act(async () => root().querySelector<HTMLElement>('[data-testid="inbox-answer-in-session"]')?.click());
    expect(ids('ui_focus_node'), 'the session is brought to the front').toEqual([{ nodeId: 'leaf1' }]);
  });

  it('shows the raw request of an approval collapsed when the card already describes it', async () => {
    await mount([item('a', { kind: 'approval', details: 'Wants to run rm', payload: { toolInput: { command: 'rm -r build' } } })]);
    await select(0);
    expect(root().querySelector<HTMLDetailsElement>('.inbox-raw-block')?.open, 'raw request closed under the description').toBe(false);
  });

  it('switches to the done filter', async () => {
    await mount([]);
    await act(async () => root().querySelector<HTMLElement>('[data-testid="inbox-filter-done"]')?.click());
    expect(root().querySelector('[data-testid="inbox-empty"]')?.textContent, 'done empty message').toBe('No done items');
  });

  it('opens the peek only for an item that has a session', async () => {
    await mount([item('a'), item('b', { sessionId: 's1' })]);
    await select(0);
    expect(root().querySelector('[data-testid="inbox-peek-open"]'), 'no session, no peek button').toBeNull();
    await select(1);
    expect(root().querySelector('[data-testid="inbox-peek-open"]'), 'peek button').not.toBeNull();
  });
});
