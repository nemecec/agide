import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { DEFAULT_DIFF_LIMITS, parseDiff, type DiffLimits, type ParsedDiff } from './parseDiff';
import { DIFF_FLAGS, GuardedGit, ReviewGitError, ZERO_OID, worktreeGitDir, type GitExec } from './guardedGit';

/** The checkpoint of an agent's worktree and the diff against the base (0040 sections 4.2 and 5). */

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const assertOid = (value: string, what: string): void => {
  if (!OID.test(value)) throw new ReviewGitError(`${what} is not a full object id`);
};

export interface WorktreeTree {
  readonly head: string;
  readonly tree: string;
}

/**
 * The tree of the worktree as a commit would record it, from a temporary index: the agent's index, branch and files
 * stay untouched, ignored files stay out. No file of the worktree is read by a program the repository names: attributes
 * come from the empty tree and every filter is blanked.
 */
export async function snapshotTree(input: { readonly worktreePath: string; readonly commonDir: string; readonly exec?: GitExec }): Promise<WorktreeTree> {
  const root = await realpath(input.worktreePath);
  const gitDir = await worktreeGitDir(root, input.commonDir);
  const git = await GuardedGit.open(gitDir, { workTree: root, ...(input.exec === undefined ? {} : { exec: input.exec }) });
  const dir = await mkdtemp(join(tmpdir(), 'agide-index-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const head = (await git.text(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    await git.text(['read-tree', head], { env });
    await git.text(['add', '-A'], { env });
    const tree = (await git.text(['write-tree'], { env })).trim();
    assertOid(head, 'HEAD');
    assertOid(tree, 'the checkpoint tree');
    return { head, tree };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const checkpointRef = (changesetId: string): string => `refs/agide/review/${changesetId}`;

/**
 * Makes the checkpoint commit of `tree` on top of `head` with the app's identity and points
 * `refs/agide/review/<id>` at it, creating the ref only: an existing ref of that name is never overwritten.
 */
export async function commitCheckpoint(input: { readonly commonDir: string; readonly changesetId: string; readonly tree: string; readonly head: string; readonly exec?: GitExec }): Promise<string> {
  assertOid(input.tree, 'the tree');
  assertOid(input.head, 'HEAD');
  const git = await GuardedGit.open(input.commonDir, { ...(input.exec === undefined ? {} : { exec: input.exec }) });
  const commit = (await git.text(['commit-tree', input.tree, '-p', input.head, '-m', `Agide checkpoint ${input.changesetId}`], { identity: true })).trim();
  assertOid(commit, 'the checkpoint commit');
  await git.text(['update-ref', checkpointRef(input.changesetId), commit, ZERO_OID]);
  return commit;
}

export interface CapturedDiff extends ParsedDiff {
  /** The stored patch: `--binary --no-renames`, one character per byte, so it applies anywhere. */
  readonly patch: string;
}

/**
 * Tree against tree from the common directory with no work tree, so no file of any worktree is read, and the three
 * texts the review keeps: the file list, the hunks and the patch.
 */
export async function readDiff(input: { readonly commonDir: string; readonly base: string; readonly checkpoint: string; readonly limits?: DiffLimits; readonly exec?: GitExec; readonly clock?: () => number }): Promise<CapturedDiff> {
  assertOid(input.base, 'the base');
  assertOid(input.checkpoint, 'the checkpoint');
  const git = await GuardedGit.open(input.commonDir, { ...(input.exec === undefined ? {} : { exec: input.exec }) });
  const revisions = [input.base, input.checkpoint, '--'];
  const raw = await git.latin1(['diff', '--raw', '-z', '--find-renames', '--abbrev=40', ...DIFF_FLAGS, ...revisions]);
  const unified = await git.latin1(['diff', '-U3', '--find-renames', '--full-index', ...DIFF_FLAGS, ...revisions]);
  const patch = await git.latin1(['diff', '--binary', '--full-index', '--no-renames', ...DIFF_FLAGS, ...revisions]);
  const parsed = parseDiff(raw, unified, input.limits ?? DEFAULT_DIFF_LIMITS, input.clock);
  return { ...parsed, patch };
}
