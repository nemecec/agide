import type { Hunk } from '../../../core/review/schemas';

export type LineKind = 'add' | 'del' | 'ctx' | 'note';

export interface DiffLine {
  readonly index: number;
  readonly kind: LineKind;
  readonly oldNo?: number;
  readonly newNo?: number;
  /** The line without its prefix and without a trailing carriage return. */
  readonly text: string;
  readonly crlf: boolean;
}

export const GLYPHS: Readonly<Record<LineKind, string>> = { add: '+', del: '-', ctx: ' ', note: '\\' };
export const KIND_WORDS: Readonly<Record<LineKind, string>> = { add: 'added', del: 'removed', ctx: 'unchanged', note: 'note' };

/** Splits a hunk body into numbered lines; the numbers follow the `@@` starts, as the anchors of a comment do. */
export function parseHunkLines(hunk: Pick<Hunk, 'oldStart' | 'newStart' | 'body'>): DiffLine[] {
  const rows = hunk.body.split('\n');
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  return rows.map((row, index): DiffLine => {
    const crlf = row.endsWith('\r');
    const content = crlf ? row.slice(0, -1) : row;
    const mark = content[0];
    const text = content.slice(1);
    if (mark === '+') return { index, kind: 'add', newNo: newNo++, text, crlf };
    if (mark === '-') return { index, kind: 'del', oldNo: oldNo++, text, crlf };
    if (mark === '\\') return { index, kind: 'note', text: text.trim(), crlf: false };
    return { index, kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: mark === ' ' || mark === undefined ? text : content, crlf };
  });
}

/** The side and number a comment on the line anchors to, or undefined for a note. */
export function anchorOfLine(line: DiffLine): { readonly side: 'new' | 'old'; readonly line: number } | undefined {
  if (line.kind === 'del' && line.oldNo !== undefined) return { side: 'old', line: line.oldNo };
  if ((line.kind === 'add' || line.kind === 'ctx') && line.newNo !== undefined) return { side: 'new', line: line.newNo };
  return undefined;
}

/** Lines shown at first for one hunk, and in each step of "Show more". */
export const LINE_PAGE = 400;
/** Hunks shown at first for one file, and in each step. */
export const HUNK_PAGE = 20;

export interface Paged<T> {
  readonly shown: readonly T[];
  readonly hidden: number;
}

export function page<T>(items: readonly T[], limit: number): Paged<T> {
  return { shown: items.slice(0, limit), hidden: Math.max(0, items.length - limit) };
}

/** The index of the next or previous hunk, wrapping at neither end; -1 steps from before the first. */
export function stepIndex(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  return Math.min(count - 1, Math.max(0, current + direction));
}

/** The first unseen hunk after `current`, or the first one before it, or -1 when all are seen. */
export function nextUnseen(seen: readonly boolean[], current: number): number {
  for (let at = current + 1; at < seen.length; at++) if (!seen[at]) return at;
  for (let at = 0; at <= Math.min(current, seen.length - 1); at++) if (!seen[at]) return at;
  return -1;
}
