import { describe, expect, it } from 'vitest';
import { anchorLines } from '../../../core/review/anchors';
import { anchorOfLine, nextUnseen, page, parseHunkLines, stepIndex } from './hunkModel';

describe('parseHunkLines', () => {
  const hunk = { oldStart: 10, newStart: 20, body: ' keep\n-old\n+new\n+more\n keep two\n\\ No newline at end of file' };

  it('numbers both sides from the hunk header and keeps the kind of every line', () => {
    const lines = parseHunkLines(hunk);
    expect(lines.map((line) => [line.kind, line.oldNo, line.newNo, line.text]), 'kind, numbers and text per line').toEqual([
      ['ctx', 10, 20, 'keep'],
      ['del', 11, undefined, 'old'],
      ['add', undefined, 21, 'new'],
      ['add', undefined, 22, 'more'],
      ['ctx', 12, 23, 'keep two'],
      ['note', undefined, undefined, 'No newline at end of file'],
    ]);
  });

  it('flags a line that ends with a carriage return and drops the carriage return from its text', () => {
    const [line] = parseHunkLines({ oldStart: 1, newStart: 1, body: '+windows\r' });
    expect(line, 'a CRLF line').toMatchObject({ kind: 'add', text: 'windows', crlf: true });
  });

  it('agrees with the anchors the review commands accept', () => {
    const anchors = anchorLines(hunk);
    for (const line of parseHunkLines(hunk)) {
      const anchor = anchorOfLine(line);
      if (anchor === undefined) continue;
      const known = anchor.side === 'new' ? anchors.newSide : anchors.oldSide;
      expect(known.has(anchor.line), `${anchor.side} line ${anchor.line} is an anchor the manager accepts`).toBe(true);
    }
    expect(parseHunkLines(hunk).map(anchorOfLine).filter((anchor) => anchor === undefined), 'only the note has no anchor').toHaveLength(1);
  });

  it('ignores a trailing line feed and treats an empty line as an unchanged empty line', () => {
    const lines = parseHunkLines({ oldStart: 1, newStart: 1, body: ' a\n\n+b\n' });
    expect(lines.map((line) => [line.kind, line.text]), 'three lines and no phantom line').toEqual([
      ['ctx', 'a'],
      ['ctx', ''],
      ['add', 'b'],
    ]);
  });
});

describe('paging and keys', () => {
  it('pages and reports how many items it leaves out', () => {
    expect(page([1, 2, 3, 4, 5], 2), 'two shown').toEqual({ shown: [1, 2], hidden: 3 });
    expect(page([1], 2), 'all shown').toEqual({ shown: [1], hidden: 0 });
  });

  it('steps between hunks without wrapping and starts from before the first', () => {
    expect(stepIndex(3, -1, 1), 'first step from nothing').toBe(0);
    expect(stepIndex(3, 2, 1), 'stays on the last').toBe(2);
    expect(stepIndex(3, 0, -1), 'stays on the first').toBe(0);
    expect(stepIndex(0, -1, 1), 'no hunks').toBe(-1);
  });

  it('finds the next unseen hunk after the current one, then from the start, then none', () => {
    expect(nextUnseen([true, false, true, false], 1), 'after the current').toBe(3);
    expect(nextUnseen([false, true, true], 1), 'wraps to the start').toBe(0);
    expect(nextUnseen([true, true], 0), 'all seen').toBe(-1);
  });
});
