import { describe, expect, it } from 'vitest';
import { isSensitiveField, matchesBlocked, redactCookieValues, redactFieldValues, redactHeaders, redactNetworkUrl, sanitizeTitle, stripQuery, originOf } from './redaction';

describe('URL redaction', () => {
  it('strips query and fragment for the digest and the log', () => {
    expect(stripQuery('https://github.com/acme/app/pull/1?token=abc#frag'), 'query and fragment gone').toBe('https://github.com/acme/app/pull/1');
    expect(stripQuery('javascript:alert(1)'), 'non-http').toBe('');
    expect(originOf('https://acme.atlassian.net/browse/A-1?x=1'), 'origin only').toBe('https://acme.atlassian.net');
  });

  it('masks the values of sensitive query keys in network results and keeps the others', () => {
    const redacted = redactNetworkUrl('https://api.example/cb?code=1&state=2&access_token=3&page=4&Key=5&sig=6');
    const params = new URL(redacted).searchParams;
    for (const key of ['code', 'state', 'access_token', 'Key', 'sig']) expect(params.get(key), key).toBe('REDACTED');
    expect(params.get('page'), 'harmless key').toBe('4');
    expect(redactNetworkUrl('https://a.example/#access_token=zzz'), 'token in fragment').toContain('REDACTED');
  });

  it('masks authorization and cookie headers whatever their case', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', cookie: 'a=b', 'Set-Cookie': 'c=d', 'Proxy-Authorization': 'p', Accept: 'text/html' }), 'headers').toEqual({
      Authorization: 'REDACTED',
      cookie: 'REDACTED',
      'Set-Cookie': 'REDACTED',
      'Proxy-Authorization': 'REDACTED',
      Accept: 'text/html',
    });
  });
});

describe('titles', () => {
  it('removes control and format characters, cuts to 120 characters and quotes', () => {
    expect(sanitizeTitle('Fix\u0000 retry‮ in\nuploader'), 'control and bidi characters').toBe('"Fix retry in uploader"');
    const long = JSON.parse(sanitizeTitle('x'.repeat(300))) as string;
    expect(long.length, 'cut length').toBe(120);
    expect(sanitizeTitle('say "hi"'), 'quotes are escaped').toBe('"say \\"hi\\""');
  });
});

describe('sensitive fields', () => {
  it('recognizes password inputs, autocomplete tokens, protected fields and configured names', () => {
    expect(isSensitiveField({ type: 'password' }), 'password type').toBe(true);
    expect(isSensitiveField({ type: 'PASSWORD' }), 'case').toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'one-time-code' }), 'one-time-code').toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'section-x cc-number' }), 'token in a list').toBe(true);
    expect(isSensitiveField({ protected: true }), 'AX protected').toBe(true);
    expect(isSensitiveField({ type: 'text', name: 'user_ssn' }), 'name match').toBe(true);
    expect(isSensitiveField({ type: 'text', id: 'API_TOKEN' }), 'id match').toBe(true);
    expect(isSensitiveField({ type: 'text', name: 'q', id: 'search' }), 'plain field').toBe(false);
    expect(isSensitiveField({ type: 'text', name: 'pin' }, ['pin']), 'custom list').toBe(true);
  });

  it('replaces cookie values of 8 or more characters and field values of 3 or more', () => {
    expect(redactCookieValues('session=abcdef123456 and short', [{ value: 'abcdef123456' }, { value: 'short' }]), 'long cookie').toBe('session=[cookie] and short');
    expect(redactFieldValues('typed hunter2 here', ['hunter2', 'ab']), 'field value').toBe('typed [sensitive field] here');
  });

  it('replaces the longest value first so a value that holds another leaves no rest', () => {
    expect(redactFieldValues('abcdef', ['abc', 'abcdef']), 'field values').toBe('[sensitive field]');
    expect(redactCookieValues('abcdefgh12345678', [{ value: 'abcdefgh' }, { value: 'abcdefgh12345678' }]), 'cookie values').toBe('[cookie]');
  });
});

describe('blocked patterns: path forms', () => {
  const patterns = [{ origin: 'https://bank.example', pathPrefix: '/account' }];
  it.each(['/%61ccount', '/Account', '//account', '/account/../account/x', '/%2561ccount', '/%41CCOUNT/1'])('blocks %s', (path) => {
    expect(matchesBlocked(`https://bank.example${path}`, patterns), path).toBe(true);
  });
  it('keeps a malformed escape from throwing and leaves other paths open', () => {
    expect(matchesBlocked('https://bank.example/%E0%A4%A', patterns), 'malformed escape').toBe(false);
    expect(matchesBlocked('https://bank.example/help', patterns), 'other path').toBe(false);
  });
});

describe('network URL redaction: more keys', () => {
  it('masks client secrets, API keys, signatures and session values', () => {
    const redacted = redactNetworkUrl('https://api.example/x?client_secret=a&api_key=b&apikey=c&X-Amz-Signature=d&x-goog-signature=e&session=f&jwt=g&page=1');
    expect(redacted, 'secrets masked').not.toMatch(/=[a-g]\b/);
    expect(redacted, 'plain value kept').toContain('page=1');
  });
});

describe('blocked patterns', () => {
  it('match on the parsed origin and path, not on substrings', () => {
    const patterns = [{ origin: 'bank.example' }, { origin: 'https://hr.example', pathPrefix: '/people' }];
    expect(matchesBlocked('https://bank.example/accounts', patterns), 'host pattern').toBe(true);
    expect(matchesBlocked('https://hr.example/people/1', patterns), 'origin and path').toBe(true);
    expect(matchesBlocked('https://hr.example/docs', patterns), 'other path').toBe(false);
    expect(matchesBlocked('https://evil.example/?u=https://bank.example/', patterns), 'URL inside a query').toBe(false);
    expect(matchesBlocked('https://bank.example.evil.example/', patterns), 'look-alike host').toBe(false);
    expect(matchesBlocked('https://notbank.example/', patterns), 'host that ends with the pattern').toBe(false);
    expect(matchesBlocked('https://BANK.example/', patterns), 'case of the host').toBe(true);
  });
});
