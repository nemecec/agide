/** Control characters, soft hyphen, bidirectional and zero-width characters, line and paragraph separators, variation selectors and Unicode tag characters. */
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

const escapeChar = (char: string): string => `\\u{${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`;

/**
 * Makes text written by an agent safe to read: control characters, bidirectional controls and zero-width
 * characters show as visible `\u{...}` escapes, so a path or a line cannot reorder or hide what follows.
 * Line feeds and tabs stay when `multiline` is set; a carriage return always shows as an escape.
 */
export function plainText(text: string, options: { readonly multiline?: boolean } = {}): string {
  const keep = options.multiline === true ? '\n\t' : '';
  return text.replaceAll(HIDDEN, (char) => (keep.includes(char) ? char : escapeChar(char)));
}

/** True when `plainText` changed something, so a view can say that the text held hidden characters. */
export const hasHiddenCharacters = (text: string, options: { readonly multiline?: boolean } = {}): boolean => plainText(text, options) !== text;

/** At most `limit` characters, with the cut marked in the text itself. */
export function shorten(text: string, limit: number): { readonly text: string; readonly cut: boolean } {
  const chars = [...text];
  return chars.length <= limit ? { text, cut: false } : { text: `${chars.slice(0, limit).join('')}…`, cut: true };
}
