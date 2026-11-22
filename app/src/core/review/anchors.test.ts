import { describe, expect, it } from 'vitest';
import { anchorLines, anchorOf } from './anchors';
import { changesetIdOf, sha256Of } from './fakes/fixtures';
import type { ChangesetFile, Hunk } from './schemas';

const changesetId = changesetIdOf('anchors');

const file = (idx: number, oldPath: string | null, newPath: string | null, kind: ChangesetFile['kind'] = 'text'): ChangesetFile => ({
  changesetId,
  idx,
  status: oldPath === newPath ? 'M' : 'R',
  oldPath,
  newPath,
  oldMode: '100644',
  newMode: '100644',
  oldBlob: null,
  newBlob: null,
  similarity: null,
  kind,
  added: 0,
  removed: 0,
  oddName: false,
  fileHash: sha256Of(`file:${idx}`),
});

const hunk = (fileIdx: number, oldStart: number, newStart: number, body: string): Hunk => ({
  changesetId,
  fileIdx,
  idx: 0,
  oldStart,
  oldLines: 0,
  newStart,
  newLines: 0,
  section: null,
  body,
  hunkHash: sha256Of(`hunk:${fileIdx}:${body}`),
});

describe('anchors', () => {
  it('numbers added and context lines on the new side and removed lines on the old side', () => {
    const lines = anchorLines({ oldStart: 10, newStart: 20, body: ' a\n-b\n+c\n\\ No newline at end of file\n+d' });
    expect([...lines.newSide], 'new side: context, added, added').toEqual([
      [20, false],
      [21, true],
      [22, true],
    ]);
    expect([...lines.oldSide], 'old side: the removed line only').toEqual([[11, true]]);
  });

  it('anchors a finding by path, side and line, and never in a large file', () => {
    const files = [file(0, 'src/a.ts', 'src/a.ts'), file(1, 'big.bin', 'big.bin', 'large'), file(2, 'old.ts', 'new.ts')];
    const hunks = [hunk(0, 10, 20, ' a\n-b\n+c'), hunk(2, 1, 1, '-x\n+y')];
    expect(anchorOf(files, hunks, { path: 'src/a.ts', side: 'new', line: 21 }), 'an added line').toEqual({ fileIdx: 0, hunkHash: hunks[0]!.hunkHash, onChangedLine: true });
    expect(anchorOf(files, hunks, { path: 'src/a.ts', side: 'new', line: 20 })?.onChangedLine, 'a context line').toBe(false);
    expect(anchorOf(files, hunks, { path: 'src/a.ts', side: 'old', line: 11 })?.onChangedLine, 'a removed line').toBe(true);
    expect(anchorOf(files, hunks, { path: 'src/a.ts', side: 'old', line: 10 }), 'a context line on the old side').toBeUndefined();
    expect(anchorOf(files, hunks, { path: 'src/a.ts', side: 'new', line: 11 }), 'the removed line number on the new side').toBeUndefined();
    expect(anchorOf(files, hunks, { path: 'big.bin', side: 'new', line: 1 }), 'a large file').toBeUndefined();
    expect(anchorOf(files, hunks, { path: 'old.ts', side: 'old', line: 1 })?.fileIdx, 'the old path of a rename').toBe(2);
    expect(anchorOf(files, hunks, { path: 'elsewhere.ts', side: 'new', line: 1 }), 'a path outside the changeset').toBeUndefined();
  });
});
