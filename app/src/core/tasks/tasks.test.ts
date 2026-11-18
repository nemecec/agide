import { describe, expect, it } from 'vitest';
import { parseTaskSource, sourceTitle } from './parseSource';
import { taskStartInputSchema } from './types';

describe('task source', () => {
  it.each([
    ['https://github.com/acme/app/pull/418', { kind: 'pull-request', owner: 'acme', repo: 'app', number: 418 }],
    ['https://github.com/acme/app/pull/418/files', { kind: 'pull-request', number: 418 }],
    ['https://github.com/acme/app/pull/418#discussion_r1', { kind: 'pull-request', number: 418 }],
    ['acme/app.js#7', { kind: 'pull-request', owner: 'acme', repo: 'app.js', number: 7 }],
    ['ABC-77', { kind: 'jira', key: 'ABC-77' }],
    ['https://acme.atlassian.net/browse/ABC-77', { kind: 'jira', key: 'ABC-77', site: 'acme.atlassian.net' }],
  ])('reads %s', (input, expected) => {
    expect(parseTaskSource(input), input).toMatchObject(expected);
  });

  it.each([
    'Fix the retry in the uploader',
    'https://github.com/acme/app/pull/12abc',
    'https://github.com/-acme/app/pull/1',
    'https://github.com/acme/app/pull/1 and also do X',
    'https://evil.example/acme/app/pull/1',
    'http://github.com/acme/app/pull/1',
    'abc-77',
    'see ABC-77',
    '--repo=x/y#1',
  ])('treats %s as a prompt', (input) => {
    expect(parseTaskSource(input).kind, input).toBe('prompt');
  });

  it('titles a start by its first prompt line, the PR number or the Jira key', () => {
    expect(sourceTitle(parseTaskSource(`${'x'.repeat(80)}\nmore`)), 'prompt line capped').toHaveLength(60);
    expect(sourceTitle(parseTaskSource('acme/app#3')), 'pull request').toBe('PR #3');
    expect(sourceTitle(parseTaskSource('ABC-1')), 'jira').toBe('ABC-1');
  });

  it('refuses task_start input with unknown fields or an oversized source', () => {
    expect(taskStartInputSchema.safeParse({ source: 'x', shell: 'rm' }).success, 'unknown field').toBe(false);
    expect(taskStartInputSchema.safeParse({ source: 'x'.repeat(20_001) }).success, 'source above the cap').toBe(false);
    expect(taskStartInputSchema.safeParse({ source: 'ABC-1', permissionMode: 'dontAsk' }).success, 'mode not offered').toBe(false);
  });
});
