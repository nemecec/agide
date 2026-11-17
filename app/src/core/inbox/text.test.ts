import { describe, expect, it } from 'vitest';
import { cleanLine, cleanText } from './text';

describe('untrusted item text', () => {
  it('removes escape sequences, control characters and every Unicode format character', () => {
    const hidden = 'a‎b‏c؜d​e‍f﻿g‮h⁦i';
    expect(cleanText(`\u001b[31m${hidden}\u0007`), 'marks, zero-width characters and overrides are gone').toBe('abcdefghi');
  });

  it('turns line and paragraph separators into line feeds and keeps tabs', () => {
    expect(cleanText('a b c\td'), 'separators become line feeds').toBe('a\nb\nc\td');
    expect(cleanLine('a b c'), 'a line has single spaces').toBe('a b c');
  });
});
