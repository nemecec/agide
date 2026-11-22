import type { AssessInput } from '../types';
import type { ChangesetFile, Hunk } from '../schemas';
import { DEFAULT_TEST_GLOBS } from '../policy/defaults';
import type { ReviewPolicy } from '../policy/schema';
import { firstMatch } from './glob';
import { reasonMaker } from './reasons';

/** What every rule group reads. */
export interface RuleContext {
  readonly input: AssessInput;
  readonly policy: ReviewPolicy;
  readonly make: ReturnType<typeof reasonMaker>;
  readonly files: readonly ChangesetFile[];
  readonly hunksOf: (file: ChangesetFile) => readonly Hunk[];
  readonly isTest: (path: string) => boolean;
}

export function buildContext(input: AssessInput): RuleContext {
  const policy = input.policy.effective;
  const testGlobs = policy.paths.tests ?? DEFAULT_TEST_GLOBS;
  const byFile = new Map<number, Hunk[]>();
  for (const hunk of input.hunks) byFile.set(hunk.fileIdx, [...(byFile.get(hunk.fileIdx) ?? []), hunk]);
  return {
    input,
    policy,
    make: reasonMaker(policy.rungs),
    files: input.files,
    hunksOf: (file) => byFile.get(file.idx) ?? [],
    isTest: (path) => firstMatch(path, testGlobs) !== undefined,
  };
}

/** The paths a file occupies in the changeset: the new path and, for a rename or deletion, the old one. */
export const pathsOf = (file: ChangesetFile): string[] => [...new Set([file.newPath, file.oldPath].filter((path): path is string => path !== null))];

/** The path a person would call the file by. */
export const nameOf = (file: ChangesetFile): string => file.newPath ?? file.oldPath ?? '';

export interface NumberedLine {
  readonly line: number;
  readonly text: string;
}

/** The added and the removed lines of a hunk body, the added ones numbered on the new side. */
export function changedLines(hunk: Pick<Hunk, 'newStart' | 'body'>): { readonly added: NumberedLine[]; readonly removed: string[] } {
  const added: NumberedLine[] = [];
  const removed: string[] = [];
  let newLine = hunk.newStart;
  for (const line of hunk.body.split('\n')) {
    const mark = line[0];
    if (mark === '+') added.push({ line: newLine++, text: line.slice(1) });
    else if (mark === '-') removed.push(line.slice(1));
    else if (mark === ' ') newLine++;
  }
  return { added, removed };
}
