import { describe, expect, it } from 'vitest';
import { hasHiddenCharacters, plainText, shorten } from './plainText';

describe('plainText', () => {
  it('shows a bidirectional override as a visible escape, so a path cannot reorder what follows', () => {
    expect(plainText('src/‮gnp.exe'), 'right-to-left override escaped').toBe('src/\\u{202E}gnp.exe');
    expect(plainText('a⁦b⁩'), 'isolates escaped').toBe('a\\u{2066}b\\u{2069}');
  });

  it('shows control characters, zero-width characters and a carriage return as escapes', () => {
    expect(plainText('a\u0000b\u001Bc​d\re'), 'control and zero-width characters').toBe('a\\u{0000}b\\u{001B}c\\u{200B}d\\u{000D}e');
  });

  it('shows tag characters, the soft hyphen, line and paragraph separators and variation selectors as escapes', () => {
    expect(plainText('a\u{E0041}b'), 'a Unicode tag character').toBe('a\\u{E0041}b');
    expect(plainText('a\u00ADb'), 'the soft hyphen').toBe('a\\u{00AD}b');
    expect(plainText('a\u2028b\u2029c', { multiline: true }), 'line and paragraph separators').toBe('a\\u{2028}b\\u{2029}c');
    expect(plainText('a\uFE01b'), 'a variation selector').toBe('a\\u{FE01}b');
  });

  it('keeps line feeds and tabs only for multiline text', () => {
    expect(plainText('a\n\tb'), 'single line escapes them').toBe('a\\u{000A}\\u{0009}b');
    expect(plainText('a\n\tb', { multiline: true }), 'multiline keeps them').toBe('a\n\tb');
    expect(plainText('a\r\nb', { multiline: true }), 'a carriage return is still escaped').toBe('a\\u{000D}\nb');
  });

  it('leaves ordinary text, including accents and emoji, unchanged', () => {
    const text = 'Tõnis ärkas — 日本語 🙂';
    expect(plainText(text), 'readable text is not altered').toBe(text);
    expect(hasHiddenCharacters(text), 'nothing hidden').toBe(false);
    expect(hasHiddenCharacters('x‮y'), 'a hidden character is reported').toBe(true);
  });

  it('cuts at a number of characters and says so in the text', () => {
    expect(shorten('abcdef', 3), 'cut text').toEqual({ text: 'abc…', cut: true });
    expect(shorten('abc', 3), 'short text').toEqual({ text: 'abc', cut: false });
  });
});
