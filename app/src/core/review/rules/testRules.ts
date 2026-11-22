import type { Reason } from '../schemas';
import { escapePath, isSourceFile } from './classify';
import { changedLines, nameOf, type RuleContext } from './context';

/** Tests deleted, skipped, weakened or missing (0040 section 7.2). */

const SKIP_MARKERS: readonly { readonly marker: string; readonly pattern: RegExp }[] = [
  { marker: '.skip(', pattern: /\.skip\(/ },
  { marker: '.only(', pattern: /\.only\(/ },
  { marker: 'xit(', pattern: /\bxit\(/ },
  { marker: 'xdescribe(', pattern: /\bxdescribe\(/ },
  { marker: '@Disabled', pattern: /@Disabled\b/ },
  { marker: '@Ignore', pattern: /@Ignore\b/ },
  { marker: 'pytest.mark.skip', pattern: /pytest\.mark\.skip/ },
  { marker: 't.Skip(', pattern: /\bt\.Skip\(/ },
  { marker: '#[ignore]', pattern: /#\[ignore\]/ },
];

const ASSERTION = /\bexpect\(|\bassert|\bshould\b|\bverify\(/;
const MAX_LINES = 20;

export function testReasons(ctx: RuleContext): Reason[] {
  const { make, isTest } = ctx;
  const reasons: Reason[] = [];
  let testChanged = false;
  const sources: string[] = [];

  for (const file of ctx.files) {
    const path = nameOf(file);
    const shown = escapePath(path);
    const oldIsTest = file.oldPath !== null && isTest(file.oldPath);
    const newIsTest = file.newPath !== null && isTest(file.newPath);
    if (oldIsTest || newIsTest) testChanged = true;
    else if (file.newPath !== null && isSourceFile(file.newPath)) sources.push(file.newPath);

    if (oldIsTest && !newIsTest && (file.status === 'D' || file.status === 'R')) reasons.push(make('tests.deleted', { subject: shown, evidence: { path: shown, status: file.status } }));
    if (!newIsTest || file.kind === 'large') continue;

    const hunks = ctx.hunksOf(file).map(changedLines);
    const removedLines = new Map<string, number>();
    for (const hunk of hunks) for (const text of hunk.removed) removedLines.set(text.trim(), (removedLines.get(text.trim()) ?? 0) + 1);

    const skipped: { line: number; marker: string }[] = [];
    let addedAssertions = 0;
    for (const hunk of hunks) {
      for (const { line, text } of hunk.added) {
        if (ASSERTION.test(text)) addedAssertions++;
        const hit = SKIP_MARKERS.find(({ pattern }) => pattern.test(text));
        if (hit === undefined) continue;
        const moved = removedLines.get(text.trim()) ?? 0;
        if (moved > 0) removedLines.set(text.trim(), moved - 1);
        else skipped.push({ line, marker: hit.marker });
      }
    }
    if (skipped.length > 0) reasons.push(make('tests.skipped', { subject: shown, evidence: { path: shown, line: skipped[0]!.line, lines: skipped.slice(0, MAX_LINES).map((entry) => entry.line), markers: [...new Set(skipped.map((entry) => entry.marker))] } }));

    const removedAssertions = hunks.reduce((sum, hunk) => sum + hunk.removed.filter((text) => ASSERTION.test(text)).length, 0);
    if (removedAssertions > addedAssertions) reasons.push(make('tests.weakened', { subject: shown, evidence: { path: shown, removedAssertions, addedAssertions } }));
  }

  if (sources.length > 0 && !testChanged) reasons.push(make('tests.missing', { evidence: { sourceFiles: sources.length, examples: sources.slice(0, 10).map(escapePath) } }));
  return reasons;
}
