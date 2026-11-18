import { describe, expect, it } from 'vitest';
import { githubRepositoryOf, remoteFor, slugOf } from './remotes';

describe('remote matching', () => {
  it.each([
    ['https://github.com/Acme/App.git', 'acme/app'],
    ['https://user@github.com/acme/app', 'acme/app'],
    ['git@github.com:acme/app.git', 'acme/app'],
    ['ssh://git@github.com/acme/app.git', 'acme/app'],
  ])('reads %s', (url, expected) => {
    expect(githubRepositoryOf(url), url).toBe(expected);
  });

  it('ignores other hosts', () => {
    expect(githubRepositoryOf('https://gitlab.com/acme/app.git'), 'gitlab').toBeUndefined();
  });

  it('finds the upstream remote of a fork clone and prefers origin when both match', () => {
    const fork = 'remote.origin.url https://github.com/me/app.git\nremote.upstream.url git@github.com:acme/app.git\n';
    expect(remoteFor(fork, 'acme', 'app'), 'fork clone').toBe('upstream');
    const both = 'remote.upstream.url https://github.com/acme/app.git\nremote.origin.url https://github.com/acme/app.git\n';
    expect(remoteFor(both, 'acme', 'app'), 'origin first').toBe('origin');
    expect(remoteFor(fork, 'other', 'app'), 'no match').toBeUndefined();
  });

  it('reduces a title to a slug of at most forty characters', () => {
    expect(slugOf('Fix the Retry!! in uploader'), 'punctuation').toBe('fix-the-retry-in-uploader');
    expect(slugOf('x'.repeat(100)), 'cap').toHaveLength(40);
    expect(slugOf('***'), 'nothing left').toBe('');
  });
});
