import type { ChangesetFile, Reason } from '../schemas';
import { escapePath } from './classify';
import { changedLines, nameOf, type RuleContext } from './context';

/** Reasons from the kind, mode and name of a file (0040 sections 5.2 and 7.2). */

const EXEC_BITS = new Set(['100755']);

/** The target of a symlink: the content of its added line. Agent text. */
function symlinkTarget(ctx: RuleContext, file: ChangesetFile): string | undefined {
  for (const hunk of ctx.hunksOf(file)) {
    const first = changedLines(hunk).added[0];
    if (first !== undefined) return first.text;
  }
  return undefined;
}

export function fileReasons(ctx: RuleContext): Reason[] {
  const { make } = ctx;
  const reasons: Reason[] = [];
  for (const file of ctx.files) {
    const path = nameOf(file);
    const shown = file.oddName ? escapePath(path) : path;
    if (file.kind === 'large') reasons.push(make('file.large_unreviewed', { subject: shown, evidence: { path: shown, changedLines: file.added + file.removed } }));
    if (file.kind === 'binary') reasons.push(make('file.binary', { subject: shown, evidence: { path: shown, status: file.status } }));
    if (file.kind === 'submodule') reasons.push(make('file.submodule', { subject: shown, evidence: { path: shown } }));
    if (file.kind === 'symlink' || file.status === 'T') {
      const target = symlinkTarget(ctx, file);
      reasons.push(make('file.symlink', { subject: shown, evidence: { path: shown, ...(target === undefined ? {} : { target: { untrusted: true, text: escapePath(target).slice(0, 500) } }) } }));
    }
    if (file.newMode !== null && EXEC_BITS.has(file.newMode) && file.oldMode !== file.newMode) reasons.push(make('file.exec_bit', { subject: shown, evidence: { path: shown, oldMode: file.oldMode, newMode: file.newMode } }));
    if (file.oddName) reasons.push(make('file.odd_name', { subject: shown, evidence: { path: shown } }));
  }
  return reasons;
}
