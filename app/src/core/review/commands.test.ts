import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../commands/index';
import { callTool, toolsFrom } from '../mcp/tools';
import { changesetIdOf } from './fakes/fixtures';
import { registerReviewCommands } from './commands';
import { ReviewError } from './types';

const ui = { kind: 'ui' } as const;
const mcp = { kind: 'mcp', sessionId: 's1', folderId: 'f1' } as const;
const reviewTools = (registry: CommandRegistry, set: 'default' | 'worker' | 'reviewer') =>
  toolsFrom(registry, 'app', set)
    .map((tool) => tool.name)
    .filter((name) => name.startsWith('review_') || name.startsWith('report_'))
    .sort();

describe('review commands', () => {
  it('lists each report tool in its own tool set only and the reviewer nothing else', () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, {});
    expect(reviewTools(registry, 'default'), 'a default session').toEqual(['review_base_status', 'review_get', 'review_list', 'review_request_escalation']);
    expect(reviewTools(registry, 'worker'), 'a worktree agent').toEqual(['report_outcome', 'review_base_status', 'review_get', 'review_list', 'review_request_escalation']);
    expect(
      toolsFrom(registry, 'app', 'reviewer').map((tool) => tool.name),
      'a reviewer',
    ).toEqual(['report_review']);
  });

  it('answers a tool outside the caller\'s set as unknown', async () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, { report_review: () => ({ stored: true, findings: 0 }) });
    const report = { changesetId: changesetIdOf('x'), verdict: 'accept', claimCheck: 'confirmed', summary: 'ok', findings: [] };
    expect(await callTool(registry, 'report_review', report, mcp, 'app', 'worker'), 'a worker calling report_review').toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('not_found') }],
    });
    expect((await callTool(registry, 'report_review', report, mcp, 'app', 'reviewer')).isError, 'the reviewer reaches the handler').not.toBe(true);
  });

  it('answers a missing handler as not built yet and maps review errors to command errors', async () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, {
      review_list: () => {
        throw new ReviewError('out_of_scope', 'not yours');
      },
    });
    expect(await registry.invoke('review_get', { changesetId: changesetIdOf('x') }, ui), 'pending').toMatchObject({ ok: false, error: { code: 'failed', message: 'review_get is not built yet' } });
    expect(await registry.invoke('review_list', {}, ui), 'mapped').toMatchObject({ ok: false, error: { code: 'out_of_scope', message: 'not yours' } });
    expect(await registry.invoke('review_accept', { changesetId: changesetIdOf('x'), expectedHash: 'a'.repeat(64), expectedRung: 'C' }, mcp), 'a decision is no tool').toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('answers a base command without a handler as not built and gives only the status to a session', async () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, {});
    const pair = { swarmId: 'sw1', commitId: 'a'.repeat(40), policyHash: 'b'.repeat(64) };
    expect(await registry.invoke('review_base_status', { swarmId: 'sw1' }, ui), 'status').toMatchObject({ ok: false, error: { code: 'not_built' } });
    expect(await registry.invoke('review_base_verdict', { commitId: pair.commitId }, ui), 'verdict').toMatchObject({ ok: false, error: { code: 'not_built' } });
    expect(await registry.invoke('review_base_rerun', pair, ui), 'rerun').toMatchObject({ ok: false, error: { code: 'not_built' } });
    expect(await registry.invoke('review_base_fix_draft', pair, ui), 'fix draft').toMatchObject({ ok: false, error: { code: 'not_built' } });
    expect(await registry.invoke('review_base_rerun', pair, mcp), 'a session cannot rerun a base').toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await registry.invoke('review_base_verdict', { commitId: pair.commitId }, mcp), 'a session cannot read the verdict of a commit').toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await registry.invoke('review_base_fix_draft', pair, mcp), 'a session cannot draft a fix swarm').toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await registry.invoke('review_base_status', { swarmId: 'sw1' }, mcp), 'the status is a tool').toMatchObject({ ok: false, error: { code: 'not_built' } });
  });

  it('refuses a base command with a commit or a policy hash that is not one', async () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, { review_base_rerun: () => ({ queued: true }) });
    const pair = { swarmId: 'sw1', commitId: 'a'.repeat(40), policyHash: 'b'.repeat(64) };
    expect(await registry.invoke('review_base_rerun', pair, ui), 'a valid pair reaches the handler').toMatchObject({ ok: true });
    expect(await registry.invoke('review_base_rerun', { ...pair, commitId: 'main' }, ui), 'a branch name').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await registry.invoke('review_base_rerun', { ...pair, policyHash: 'short' }, ui), 'a short hash').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('asks for the file at level file and hunk and the hunk at level hunk', async () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, { review_seen: () => ({ recorded: true }) });
    const seen = (input: Record<string, unknown>) => registry.invoke('review_seen', { changesetId: changesetIdOf('x'), how: 'marked', ...input }, ui);
    expect(await seen({ level: 'summary' }), 'the summary needs no file').toMatchObject({ ok: true });
    expect(await seen({ level: 'file' }), 'a file level without a file').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await seen({ level: 'hunk', file: 0 }), 'a hunk level without a hunk').toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await seen({ level: 'hunk', file: 0, hunk: 1 }), 'a complete hunk mark').toMatchObject({ ok: true });
  });

  it('does not turn an error that is not a review error into a command error code', async () => {
    const registry = new CommandRegistry();
    registerReviewCommands(registry, {
      review_list: () => {
        throw new TypeError('broken handler');
      },
    });
    const result = await registry.invoke('review_list', {}, ui);
    expect(result.ok, 'the call fails').toBe(false);
    expect(JSON.stringify(result), 'the failure is not reported as a review error code').not.toContain('out_of_scope');
  });
});
