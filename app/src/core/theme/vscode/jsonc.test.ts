import { describe, expect, it } from 'vitest';
import { parseJsonc, stripJsonComments } from './jsonc';

describe('parseJsonc', () => {
  it('reads comments, trailing commas and a byte order mark', () => {
    const text = '﻿{\n  // line comment\n  "a": 1, /* block */\n  "b": [1, 2,],\n}\n';
    expect(parseJsonc(text), 'parsed value').toEqual({ a: 1, b: [1, 2] });
  });

  it('keeps comment markers and commas inside strings', () => {
    expect(parseJsonc('{"url": "http://example.test/*x*/", "list": "a,]"}'), 'strings are untouched').toEqual({ url: 'http://example.test/*x*/', list: 'a,]' });
  });

  it('keeps an escaped quote inside a string', () => {
    expect(stripJsonComments('{"q": "say \\"hi\\" // not a comment"}'), 'escaped quote does not end the string').toBe('{"q": "say \\"hi\\" // not a comment"}');
  });

  it('throws on text that is not JSON', () => {
    expect(() => parseJsonc('{not json'), 'invalid input').toThrow();
  });
});
