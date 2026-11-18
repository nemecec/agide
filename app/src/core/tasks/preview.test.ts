import { describe, expect, it } from 'vitest';
import { previewTaskStart } from './preview';

const worktreeDir = '/tmp/work/tree';

describe('previewTaskStart', () => {
  it('previews a pull request with the commands for the local repository and the prompt', () => {
    const preview = previewTaskStart({ source: 'https://github.com/acme/widgets/pull/42', repoPath: '/repos/widgets', worktreeDir });
    expect(preview.kind, 'kind').toBe('pull-request');
    expect(preview.repoPath, 'repo').toBe('/repos/widgets');
    expect(preview.commands[0], 'reads the pull request').toMatch(/^gh pr view 42 --repo=acme\/widgets /);
    expect(preview.commands, 'fetches the head and adds the worktree').toContain('git -C /repos/widgets fetch origin pull/42/head');
    expect(preview.commands.at(-1), 'worktree branch').toBe(`git -C /repos/widgets worktree add -b agide/pr-42 -- ${worktreeDir} FETCH_HEAD`);
    expect(preview.prompt, 'prompt names the pull request').toContain('42');
  });

  it('previews a pull request without a local repository as the read only', () => {
    const preview = previewTaskStart({ source: 'acme/widgets#7', worktreeDir });
    expect(preview.commands, 'one command').toHaveLength(1);
    expect(preview.commands[0], 'read').toContain('gh pr view 7');
    expect(preview, 'no repo path').not.toHaveProperty('repoPath');
  });

  it('uses the given remote for the fetch', () => {
    const preview = previewTaskStart({ source: 'acme/widgets#7', repoPath: '/r', remote: 'upstream', worktreeDir });
    expect(preview.commands, 'upstream fetch').toContain('git -C /r fetch upstream pull/7/head');
  });

  it('previews a ticket with a fetch and a worktree on the base, with a placeholder for the folder id', () => {
    const preview = previewTaskStart({ source: 'ABC-12', repoPath: '/repos/widgets', base: 'origin/main', worktreeDir });
    expect(preview.kind, 'kind').toBe('jira');
    expect(preview.commands[0], 'fetch').toBe('git -C /repos/widgets fetch origin');
    expect(preview.commands[1], 'worktree').toBe(`git -C /repos/widgets worktree add -b agide/abc-12-<folder id> -- ${worktreeDir} origin/main`);
  });

  it('defaults the base to the remote head', () => {
    const preview = previewTaskStart({ source: 'ABC-12', repoPath: '/r', worktreeDir });
    expect(preview.commands[1], 'default base').toMatch(/ origin\/HEAD$/);
  });

  it('previews a prompt without a repository as no commands', () => {
    const preview = previewTaskStart({ source: 'Fix the flaky login test', worktreeDir });
    expect(preview.kind, 'kind').toBe('prompt');
    expect(preview.commands, 'nothing runs').toEqual([]);
    expect(preview.prompt, 'prompt holds the text').toContain('Fix the flaky login test');
  });

  it('adds the instruction of the user to the prompt of a ticket', () => {
    const preview = previewTaskStart({ source: 'ABC-12', instruction: 'Look at CI first', worktreeDir });
    expect(preview.prompt, 'instruction in prompt').toContain('Look at CI first');
  });

  it('falls back to a plain slug for a prompt whose title has no usable characters', () => {
    const preview = previewTaskStart({ source: '!!!', repoPath: '/r', worktreeDir });
    expect(preview.commands[1], 'fallback slug').toContain('agide/task-<folder id>');
  });

  it('treats text that nearly matches a pull request form as a prompt, so no command takes the pieces', () => {
    const preview = previewTaskStart({ source: 'acme/widgets#7; rm -rf /', worktreeDir });
    expect(preview.kind, 'kind').toBe('prompt');
    expect(preview.commands, 'nothing runs').toEqual([]);
  });
});
