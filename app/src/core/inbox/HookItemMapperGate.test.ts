import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionInfo } from '../session/types';
import { InMemoryTreeService } from '../tree/InMemoryTreeService';
import { HookItemMapper } from './HookItemMapper';
import { InMemoryInboxService } from './InMemoryInboxService';

const SID = 's1';
let inbox: InMemoryInboxService;
let mapper: HookItemMapper;

beforeEach(() => {
  const tree = new InMemoryTreeService();
  inbox = new InMemoryInboxService(tree, { now: () => new Date('2026-11-17T12:00:00Z') });
  const folder = tree.createFolder({ title: 'Project' });
  tree.createLeaf({ title: 'Claude session', parentId: folder.id, surfaceType: 'claude-session', surfaceId: SID });
  const info = { id: SID, folderId: folder.id } as SessionInfo;
  mapper = new HookItemMapper({ inbox, tree, sessions: { get: () => info }, now: () => new Date(), isInView: () => false, notifyNow: () => undefined });
});

const open = () => inbox.list({ states: ['new', 'seen', 'snoozed'] });
const push = { tool_name: 'Bash', tool_input: { command: 'git push origin main' } };
const gated = (decision: object) => ({ hook_event_name: 'PreToolUse', ...push, agide_gate: decision });

describe('inspector records in the inbox', () => {
  it('makes a normal-urgency status item for a denial, named by class and origin gate:deny', () => {
    mapper.handle(SID, 'PreToolUse', gated({ decision: 'deny', classId: 'git.push', reason: 'The profile blocks git push' }));
    expect(open().map((item) => ({ kind: item.kind, origin: item.origin, urgency: item.urgency, message: item.message })), 'denial item').toEqual([
      { kind: 'status', origin: 'gate:deny', urgency: 'normal', message: 'Blocked git.push: git push origin main' },
    ]);
  });

  it('adds the class and audience to the approval item of a call the inspector asked about', () => {
    mapper.handle(SID, 'PreToolUse', gated({ decision: 'ask', classId: 'git.push', mode: 'approve', audience: 'origin main' }));
    expect(open(), 'an ask alone makes no item').toEqual([]);
    mapper.handle(SID, 'PermissionRequest', push);
    const [item] = open();
    expect(item?.message, 'headline names the class and audience').toBe('Approve: git.push to origin main');
    expect(item?.payload, 'payload carries the gate info').toMatchObject({ gate: { classId: 'git.push', mode: 'approve' }, toolInput: push.tool_input });
  });

  it('keeps the plain headline for an approval the inspector did not record', () => {
    mapper.handle(SID, 'PermissionRequest', push);
    expect(open()[0]?.message, 'plain headline').toContain('Wants to run Bash');
  });

  it('coalesces notify records into one low-urgency item per class', () => {
    const notify = { decision: 'none', classId: 'slack.react', mode: 'notify' };
    mapper.handle(SID, 'PreToolUse', { hook_event_name: 'PreToolUse', tool_name: 'x', tool_input: {}, agide_gate: notify });
    mapper.handle(SID, 'PreToolUse', { hook_event_name: 'PreToolUse', tool_name: 'x', tool_input: {}, agide_gate: notify });
    expect(open().map((item) => [item.origin, item.urgency]), 'one coalesced item').toEqual([['gate:notify', 'low']]);
  });

  it('makes no item for a read record and one item for a sandbox block', () => {
    mapper.handle(SID, 'PreToolUse', gated({ decision: 'none', classId: 'read', mode: 'allow' }));
    expect(open(), 'read').toEqual([]);
    mapper.handle(SID, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'curl x' }, tool_response: { stdout: '<sandbox_violations>\ndeny network-outbound evil.test:443 (not on the allow list)\n</sandbox_violations>' } });
    expect(open().map((item) => [item.origin, item.message]), 'sandbox block').toEqual([['gate:sandbox', 'Sandbox blocked evil.test']]);
  });
});
