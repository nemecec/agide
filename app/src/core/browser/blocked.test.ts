import { describe, expect, it } from 'vitest';
import { parseBlockedPatterns } from './blocked';
import { matchesBlocked } from './redaction';

describe('parseBlockedPatterns', () => {
  it('reads origins with and without a path prefix', () => {
    expect(parseBlockedPatterns('[{"origin":"https://bank.example"},{"origin":"admin.example","pathPrefix":"/secret"}]'), 'patterns').toEqual([
      { origin: 'https://bank.example' },
      { origin: 'admin.example', pathPrefix: '/secret' },
    ]);
  });

  it('accepts an empty list', () => {
    expect(parseBlockedPatterns('[]'), 'empty').toEqual([]);
  });

  it('refuses text that is not JSON, an entry with an unknown field, an empty origin and a non-list', () => {
    expect(() => parseBlockedPatterns('{'), 'not json').toThrow();
    expect(() => parseBlockedPatterns('[{"origin":"a.example","extra":1}]'), 'unknown field').toThrow();
    expect(() => parseBlockedPatterns('[{"origin":""}]'), 'empty origin').toThrow();
    expect(() => parseBlockedPatterns('{"origin":"a.example"}'), 'object instead of list').toThrow();
  });

  it('gives patterns that force observation off for the matching address only', () => {
    const patterns = parseBlockedPatterns('[{"origin":"admin.example","pathPrefix":"/secret"}]');
    expect(matchesBlocked('https://admin.example/secret/a', patterns), 'inside prefix').toBe(true);
    expect(matchesBlocked('https://admin.example/public', patterns), 'outside prefix').toBe(false);
    expect(matchesBlocked('https://other.example/secret', patterns), 'other host').toBe(false);
  });
});
