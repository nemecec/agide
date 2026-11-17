import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionInfo } from '../session/types';
import { InMemoryTreeService } from '../tree/InMemoryTreeService';
import { HookItemMapper } from './HookItemMapper';
import { InMemoryInboxService } from './InMemoryInboxService';
import type { InboxItem } from './types';

const SID = 's1';
let time: number;
let inView: boolean;
let tree: InMemoryTreeService;
let inbox: InMemoryInboxService;
let mapper: HookItemMapper;
let notified: InboxItem[];
let folderId: string;

beforeEach(() => {
  time = Date.parse('2026-11-17T12:00:00Z');
  inView = false;
  notified = [];
  tree = new InMemoryTreeService();
  inbox = new InMemoryInboxService(tree, { now: () => new Date(time) });
  const folder = tree.createFolder({ title: 'Project' });
  folderId = folder.id;
  tree.createLeaf({ title: 'Claude session', parentId: folder.id, surfaceType: 'claude-session', surfaceId: SID });
  const info = { id: SID, folderId: folder.id } as SessionInfo;
  mapper = new HookItemMapper({
    inbox,
    tree,
    sessions: { get: (id) => (id === SID ? info : undefined) },
    now: () => new Date(time),
    isInView: () => inView,
    notifyNow: (item) => notified.push(item),
    transcriptSize: () => 1234,
  });
});

const open = () => inbox.list({ states: ['new', 'seen', 'snoozed'] });
const stopPayload = (message: string) => ({ session_id: SID, hook_event_name: 'Stop', last_assistant_message: message, transcript_path: 'sessions/t.jsonl', background_tasks: [] });
const permission = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('Stop', () => {
  it('makes no item for a short turn that does not end in a question', () => {
    mapper.handle(SID, 'UserPromptSubmit', { prompt: 'hi' });
    time += 5_000;
    mapper.handle(SID, 'Stop', stopPayload('Done.'));
    expect(open(), 'short turn').toEqual([]);
  });

  it('makes a status item for a long turn with the first sentence, the full text and a transcript anchor', () => {
    mapper.handle(SID, 'UserPromptSubmit', { prompt: 'work' });
    time += 25_000;
    mapper.handle(SID, 'Stop', stopPayload('Finished the refactor. Tests pass.'));
    const [item] = open();
    expect(item?.message, 'first sentence').toBe('Finished the refactor.');
    expect(item?.details, 'full message').toBe('Finished the refactor. Tests pass.');
    expect(item?.linkAnchor, 'anchor at the transcript size').toEqual({ transcriptPath: 'sessions/t.jsonl', byteOffset: 1234 });
    expect(item?.folderId, 'folder of the session').toBe(folderId);
    expect(item?.linkNodeId, 'link to the session leaf').toBeDefined();
    expect(item?.textAuthor, 'assistant text is agent text').toBe('agent');
  });

  it('makes an item for a short turn that ends in a question, and coalesces later stops into it', () => {
    mapper.handle(SID, 'Stop', stopPayload('Which file?'));
    mapper.handle(SID, 'Stop', stopPayload('Which one?'));
    expect(open().map((i) => [i.message, i.occurrences]), 'one coalesced item').toEqual([['Which one?', 2]]);
  });

  it('makes no item while the session is in view', () => {
    inView = true;
    mapper.handle(SID, 'Stop', stopPayload('Which file?'));
    expect(open(), 'viewed session').toEqual([]);
  });

  it('notes background work in the payload', () => {
    mapper.handle(SID, 'Stop', { ...stopPayload('Waiting?'), background_tasks: [{ id: 'a' }] });
    expect(open()[0]?.payload, 'background tasks recorded').toEqual({ backgroundTasks: 1 });
  });
});

describe('UserPromptSubmit', () => {
  it('resolves open hook status and input items as viewed', () => {
    mapper.handle(SID, 'Stop', stopPayload('Which file?'));
    mapper.handle(SID, 'UserPromptSubmit', { prompt: 'this one' });
    expect(open(), 'item resolved').toEqual([]);
    expect(inbox.list({ states: ['done'] })[0]?.resolution, 'resolution viewed').toBe('viewed');
  });

  it('ignores a task notification prompt, which is not the user acting', () => {
    mapper.handle(SID, 'Stop', stopPayload('Which file?'));
    mapper.handle(SID, 'UserPromptSubmit', { prompt: '<task-notification>\n<status>completed</status>' });
    expect(open(), 'item stays open').toHaveLength(1);
  });

  it('leaves approval items open', () => {
    mapper.handle(SID, 'PermissionRequest', permission('rm x'));
    mapper.handle(SID, 'UserPromptSubmit', { prompt: 'go' });
    expect(open()[0]?.kind, 'approval needs a decision').toBe('approval');
  });
});

describe('PermissionRequest sequences', () => {
  it('makes an approval item with the raw input and a headline', () => {
    mapper.handle(SID, 'PermissionRequest', permission('npm test\nsecond line'));
    const [item] = open();
    expect(item?.kind, 'approval').toBe('approval');
    expect(item?.message, 'headline from the first line').toBe('Wants to run Bash: npm test');
    expect(item?.payload, 'raw tool input').toEqual({ toolName: 'Bash', toolInput: { command: 'npm test\nsecond line' } });
    expect(item?.details, 'raw input shown').toContain('second line');
  });

  it('allow: PostToolUse resolves the approval', () => {
    mapper.handle(SID, 'PermissionRequest', permission('ls'));
    mapper.handle(SID, 'PostToolUse', permission('ls'));
    expect(open(), 'resolved').toEqual([]);
    expect(inbox.list({ states: ['done'] })[0]?.resolution, 'superseded').toBe('superseded');
  });

  it('deny: Stop resolves the approval', () => {
    mapper.handle(SID, 'PermissionRequest', permission('ls'));
    mapper.handle(SID, 'Stop', stopPayload('Okay.'));
    expect(open(), 'no open approval').toEqual([]);
  });

  it('keeps two requests with different input apart and resolves only the matching one', () => {
    mapper.handle(SID, 'PermissionRequest', permission('a'));
    mapper.handle(SID, 'PermissionRequest', permission('b'));
    mapper.handle(SID, 'PostToolUse', permission('a'));
    expect(open().map((i) => i.message), 'only b stays').toEqual(['Wants to run Bash: b']);
  });

  it('coalesces the same request repeated', () => {
    mapper.handle(SID, 'PermissionRequest', permission('a'));
    mapper.handle(SID, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'a' } });
    expect(open(), 'one item').toHaveLength(1);
  });

  it('truncates a long command to the message limit', () => {
    mapper.handle(SID, 'PermissionRequest', permission('x'.repeat(500)));
    expect(open()[0]?.message.length, 'message within the limit').toBe(140);
  });
});

describe('Notification', () => {
  const note = (type: string, extra: object = {}) => mapper.handle(SID, 'Notification', { notification_type: type, message: 'm', ...extra });

  it('permission_prompt with an open approval only asks for its notification', () => {
    mapper.handle(SID, 'PermissionRequest', permission('a'));
    note('permission_prompt');
    expect(open(), 'no new item').toHaveLength(1);
    expect(notified.map((i) => i.kind), 'the approval notifies').toEqual(['approval']);
  });

  it('permission_prompt without an approval makes one and notifies', () => {
    note('permission_prompt');
    expect(open()[0]?.message, 'generic approval').toBe('Waiting for permission');
    expect(notified, 'notified').toHaveLength(1);
  });

  it('permission_prompt in view does nothing', () => {
    inView = true;
    note('permission_prompt');
    expect(open(), 'nothing').toEqual([]);
  });

  it('idle_prompt notifies the open Stop item without a new one', () => {
    mapper.handle(SID, 'Stop', stopPayload('Which file?'));
    note('idle_prompt');
    expect(open(), 'no extra item').toHaveLength(1);
    expect(notified[0]?.origin, 'Stop item notifies').toBe('hook:Stop');
  });

  it('idle_prompt without an open item makes a low-urgency input item from the last message', () => {
    mapper.handle(SID, 'Stop', stopPayload('Done.'));
    note('idle_prompt');
    const [item] = open();
    expect([item?.kind, item?.urgency, item?.details], 'low input item').toEqual(['input', 'low', 'Done.']);
    expect(notified, 'low urgency does not notify').toEqual([]);
  });

  it('elicitation_dialog makes an input item and elicitation_response resolves it', () => {
    note('elicitation_dialog', { message: 'Pick a colour. Now.' });
    expect(open()[0]?.message, 'first sentence').toBe('Pick a colour.');
    note('elicitation_response');
    expect(open(), 'resolved').toEqual([]);
  });

  it('auth_storage_failure makes a failure item and other types make none', () => {
    note('auth_success');
    note('agent_completed');
    note('plugin_notification');
    expect(open(), 'ignored types').toEqual([]);
    note('auth_storage_failure', { message: 'Keychain locked' });
    expect(open()[0]?.kind, 'failure').toBe('failure');
  });
});

describe('StopFailure', () => {
  it('makes a failure item with the error and resolves open approvals', () => {
    mapper.handle(SID, 'PermissionRequest', permission('a'));
    mapper.handle(SID, 'StopFailure', { error: 'server_error', error_details: '500', last_assistant_message: 'API Error: 500' });
    const [item] = open();
    expect([item?.kind, item?.message, item?.textAuthor], 'failure item').toEqual(['failure', 'Turn failed: server_error', 'app']);
    expect(item?.details, 'details').toBe('500\n\nAPI Error: 500');
  });

  it('makes an alert for a rate limit', () => {
    mapper.handle(SID, 'StopFailure', { error: 'rate_limit' });
    expect(open()[0]?.kind, 'alert').toBe('alert');
  });
});

describe('unknown sessions and events', () => {
  it('puts items of an unknown session at the top level and ignores other hook events', () => {
    mapper.handle('other', 'PermissionRequest', permission('a'));
    mapper.handle('other', 'SessionStart', {});
    mapper.handle('other', 'PreToolUse', {});
    expect(open().map((i) => i.folderId), 'top level').toEqual([null]);
  });

  it('forgets the turn start of a closed session', () => {
    mapper.handle(SID, 'UserPromptSubmit', { prompt: 'work' });
    time += 25_000;
    mapper.forget(SID);
    mapper.handle(SID, 'Stop', stopPayload('Done.'));
    expect(open(), 'no remembered turn length').toEqual([]);
  });
});
