import type { ChangesetFile, Hunk } from './schemas';

export interface Anchor {
  readonly fileIdx: number;
  readonly hunkHash: string;
  /** True on an added (new side) or removed (old side) line; false on a context line. */
  readonly onChangedLine: boolean;
}

/**
 * The lines a finding or comment may point at (0040 section 10.4): added and context lines on the new side,
 * removed lines on the old side, numbered from the `@@` starts. `\ No newline at end of file` counts on no side.
 */
export function anchorLines(hunk: Pick<Hunk, 'oldStart' | 'newStart' | 'body'>): { readonly newSide: ReadonlyMap<number, boolean>; readonly oldSide: ReadonlyMap<number, boolean> } {
  const newSide = new Map<number, boolean>();
  const oldSide = new Map<number, boolean>();
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const line of hunk.body.split('\n')) {
    const mark = line[0];
    if (mark === '+') newSide.set(newLine++, true);
    else if (mark === '-') oldSide.set(oldLine++, true);
    else if (mark === ' ') {
      newSide.set(newLine++, false);
      oldLine += 1;
    }
  }
  return { newSide, oldSide };
}

/** The anchor of a path, side and line in the changeset, or undefined. A `large` file takes no anchors. */
export function anchorOf(files: readonly ChangesetFile[], hunks: readonly Hunk[], target: { readonly path: string; readonly side: 'new' | 'old'; readonly line: number }): Anchor | undefined {
  const file = files.find((candidate) => candidate.kind !== 'large' && (candidate.newPath === target.path || candidate.oldPath === target.path));
  return file === undefined ? undefined : anchorInFile(file.idx, hunks, target.side, target.line);
}

/** The anchor of a side and line in the file with index `fileIdx`. */
export function anchorInFile(fileIdx: number, hunks: readonly Hunk[], side: 'new' | 'old', line: number): Anchor | undefined {
  for (const hunk of hunks) {
    if (hunk.fileIdx !== fileIdx) continue;
    const lines = anchorLines(hunk);
    const changed = (side === 'new' ? lines.newSide : lines.oldSide).get(line);
    if (changed !== undefined) return { fileIdx, hunkHash: hunk.hunkHash, onChangedLine: changed };
  }
  return undefined;
}
