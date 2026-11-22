import { DEFAULT_DIFF_LIMITS } from '../capture/parseDiff';
import type { ChangesetFile, Reason } from '../schemas';
import { escapePath } from './classify';
import { pathsOf, type RuleContext } from './context';
import { firstMatch } from './glob';

/** Size and diffusion (0040 section 7.2). Generated files count at a tenth of their lines. */

const changed = (file: ChangesetFile): number => file.added + file.removed;

export function sizeReasons(ctx: RuleContext): Reason[] {
  const { policy, input, make, files } = ctx;
  const { thresholds } = policy;
  const generated = policy.paths.generated;
  const lines = Math.ceil(files.reduce((sum, file) => sum + (pathsOf(file).some((path) => firstMatch(path, generated) !== undefined) ? changed(file) / 10 : changed(file)), 0));
  const fileCount = files.length;
  const reasons: Reason[] = [];

  const over = (limit: { lines: number; files: number }, l: number, f: number): boolean => l > limit.lines || f > limit.files;
  if (over(thresholds.large, lines, fileCount)) reasons.push(make('size.large', { evidence: { lines, files: fileCount, threshold: thresholds.large } }));
  else if (over(thresholds.small, lines, fileCount)) reasons.push(make('size.medium', { evidence: { lines, files: fileCount, threshold: thresholds.small } }));

  // A changeset after a merge carries only the work since the merge, so the merged ones add to the run.
  const earlier = input.runChangesets.filter((other) => other.id !== input.changeset.id && other.mergedCommit !== null);
  if (earlier.length > 0) {
    const runLines = lines + earlier.reduce((sum, other) => sum + other.added + other.removed, 0);
    const runFiles = fileCount + earlier.reduce((sum, other) => sum + other.fileCount, 0);
    if (over(thresholds.run, runLines, runFiles)) reasons.push(make('size.run', { evidence: { lines: runLines, files: runFiles, changesets: earlier.length + 1, threshold: thresholds.run } }));
  }

  const others = input.swarmChangesets.filter((other) => other.agent !== input.changeset.agent);
  if (others.length > 0) {
    const swarmLines = lines + others.reduce((sum, other) => sum + other.added + other.removed, 0);
    const swarmFiles = fileCount + others.reduce((sum, other) => sum + other.fileCount, 0);
    if (over(thresholds.swarm, swarmLines, swarmFiles)) reasons.push(make('size.swarm', { evidence: { lines: swarmLines, files: swarmFiles, agents: others.length + 1, threshold: thresholds.swarm } }));
  }

  if (fileCount > DEFAULT_DIFF_LIMITS.files) reasons.push(make('size.too_many_files', { evidence: { files: fileCount, cap: DEFAULT_DIFF_LIMITS.files } }));

  const topLevel = new Set(files.flatMap(pathsOf).map((path) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '.')));
  if (topLevel.size > thresholds.dirs) reasons.push(make('diffusion.dirs', { evidence: { directories: [...topLevel].sort().slice(0, 50).map(escapePath), count: topLevel.size, threshold: thresholds.dirs } }));
  return reasons;
}
