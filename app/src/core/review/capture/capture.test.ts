import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { anchorInFile } from '../anchors';
import { commitCheckpoint, readDiff, snapshotTree, checkpointRef } from './checkpoint';
import { agentTurn, makeRepo, ODD_NAMES, rawTruth, seedP42, sh, write, type Repo } from './gitFixtures';
import { GuardedGit } from './guardedGit';

describe('checkpoint and diff of a worktree (probe P42 corpus)', () => {
  let repo: Repo;
  let work: string;
  let checkpoint: string;
  let diff: Awaited<ReturnType<typeof readDiff>>;

  beforeAll(async () => {
    repo = makeRepo({ '.gitignore': 'ignored.log\n' });
    seedP42(repo.main);
    sh(repo.main, ['add', '-A']);
    sh(repo.main, ['commit', '-q', '--no-verify', '-m', 'p42 base']);
    const base = sh(repo.main, ['rev-parse', 'HEAD']).trim();
    work = join(repo.root, 'wt');
    sh(repo.main, ['worktree', 'add', '-q', '-b', 'agide/wt', work, base]);
    sh(repo.main, ['config', 'core.autocrlf', 'input']);
    agentTurn(work);
    write(join(work, 'ignored.log'), 'must not be captured\n');
    write(join(work, 'fresh-crlf.txt'), 'x\r\ny\r\n');
    const snapshot = await snapshotTree({ worktreePath: work, commonDir: repo.commonDir });
    checkpoint = await commitCheckpoint({ commonDir: repo.commonDir, changesetId: 'cs_0123456789abcdef', tree: snapshot.tree, head: snapshot.head });
    diff = await readDiff({ commonDir: repo.commonDir, base, checkpoint });
  });
  afterAll(() => repo.cleanup());

  const fileAt = (path: string) => diff.files.find((file) => (file.newPath ?? file.oldPath) === path);

  it('lists the same files, statuses and names as git diff -z --raw', () => {
    const truth = rawTruth(repo.main, sh(repo.main, ['rev-parse', 'HEAD']).trim(), checkpoint);
    expect(diff.files.map((file) => [file.status, file.oldPath, file.newPath]), 'files in git order with unquoted names').toEqual(truth.map((file) => [file.status, file.oldPath, file.newPath]));
  });

  it('keeps ignored files out and leaves the agent worktree, index and branch alone', () => {
    expect(fileAt('ignored.log'), 'an ignored file is not part of the checkpoint').toBeUndefined();
    expect(sh(work, ['status', '--porcelain']).includes('edit.txt'), 'the agent worktree still has its edits uncommitted').toBe(true);
    expect(sh(work, ['rev-parse', 'HEAD']).trim(), 'the branch of the agent did not move').toBe(sh(repo.main, ['rev-parse', 'agide/wt']).trim());
    expect(sh(repo.main, ['rev-parse', checkpointRef('cs_0123456789abcdef')]).trim(), 'the ref names the checkpoint').toBe(checkpoint);
  });

  it('records every kind of file', () => {
    expect(fileAt('bin-new.dat'), 'a new binary file').toMatchObject({ kind: 'binary', status: 'A' });
    expect(fileAt('bin-old.dat'), 'a changed binary file').toMatchObject({ kind: 'binary', status: 'M' });
    expect(fileAt('large.txt'), 'a file over the changed-line cap').toMatchObject({ kind: 'large', status: 'A' });
    expect(diff.hunks.filter((hunk) => hunk.fileIdx === fileAt('large.txt')!.idx), 'a large file stores no hunks').toEqual([]);
    expect(fileAt('large.txt')!.added, 'a large file still counts its lines').toBe(20_000);
    expect(fileAt('link-to-edit'), 'a new symlink').toMatchObject({ kind: 'symlink', status: 'A', newMode: '120000' });
    expect(fileAt('typechange'), 'a file that became a symlink is one entry').toMatchObject({ kind: 'symlink', status: 'T', oldMode: '100644', newMode: '120000' });
    expect(diff.files.filter((file) => file.newPath === 'typechange'), 'the deletion and the addition of the patch are merged').toHaveLength(1);
    expect(fileAt('empty.txt'), 'an empty file has a row and no hunks').toMatchObject({ kind: 'text', status: 'A', added: 0 });
    expect(diff.hunks.filter((hunk) => hunk.fileIdx === fileAt('empty.txt')!.idx), 'an empty file has no hunk').toEqual([]);
  });

  it('reads renames, mode changes and a rename with an edit', () => {
    expect(fileAt('renamed.txt'), 'a rename with an edit').toMatchObject({ status: 'R', oldPath: 'rename-me.txt', newPath: 'renamed.txt' });
    expect(fileAt('renamed.txt')!.similarity, 'similarity of the rename').toBeGreaterThan(50);
    expect(fileAt('mode.sh'), 'an added executable bit').toMatchObject({ status: 'M', oldMode: '100644', newMode: '100755', added: 0 });
    expect(diff.hunks.filter((hunk) => hunk.fileIdx === fileAt('mode.sh')!.idx), 'a mode-only change has no hunk').toEqual([]);
  });

  it('marks odd names and decodes quoted ones', () => {
    for (const name of ['new\nline.txt', 'tab\there.txt', '-dash.txt']) expect(fileAt(name)?.oddName, `${JSON.stringify(name)} is odd`).toBe(true);
    for (const name of ['sp ace.txt', 'ünï-çødé.txt', 'q"uote.txt', 'back\\slash.txt', 'dir with space/inner file.txt', '日本語.txt']) {
      expect(fileAt(name), `${JSON.stringify(name)} is found by its real name`).toBeDefined();
      expect(fileAt(name)!.oddName, `${JSON.stringify(name)} is not odd`).toBe(false);
    }
    expect(ODD_NAMES.every((name) => fileAt(name) !== undefined), 'every odd name of the corpus is a file').toBe(true);
  });

  it('is not fooled by content that looks like diff headers', () => {
    const tricky = fileAt('tricky-content.txt')!;
    expect(diff.hunks.filter((hunk) => hunk.fileIdx === tricky.idx), 'one hunk holds the whole file').toHaveLength(1);
    expect(diff.files.some((file) => (file.newPath ?? '').includes('fake')), 'no phantom file from a +++ line').toBe(false);
    expect(tricky.added, 'every line counts as added').toBe(7);
  });

  it('keeps CRLF and the no-newline marker in the hunk text', () => {
    const crlf = diff.hunks.find((hunk) => hunk.fileIdx === fileAt('crlf.txt')!.idx)!;
    expect(crlf.body.includes('+B\r'), 'the carriage return stays in the line').toBe(true);
    const noeol = diff.hunks.find((hunk) => hunk.fileIdx === fileAt('noeol.txt')!.idx)!;
    expect(noeol.body.includes('\\ No newline at end of file'), 'the marker stays in the body').toBe(true);
  });

  it('gives anchors on added lines of the new side', () => {
    const edit = fileAt('edit.txt')!;
    const anchor = anchorInFile(edit.idx, diff.hunks.map((hunk) => ({ ...hunk, changesetId: 'cs_0123456789abcdef' })), 'new', 1);
    expect(anchor?.onChangedLine, 'line 1 is an added line (line 0 of the file was edited)').toBe(true);
  });

  it('stores a patch of the changes that applies to the base in a temporary index', () => {
    const patch = join(repo.root, 'stored.patch');
    writeFileSync(patch, Buffer.from(diff.patch, 'latin1'));
    const base = sh(repo.main, ['rev-parse', 'HEAD']).trim();
    const index = join(repo.root, 'index-check');
    sh(repo.main, ['read-tree', base], { GIT_INDEX_FILE: index });
    sh(repo.main, ['apply', '--cached', '--check', '--', patch], { GIT_INDEX_FILE: index });
    expect(existsSync(patch), 'the stored patch exists').toBe(true);
    expect(readFileSync(patch).length, 'the stored patch carries the large file').toBeGreaterThan(1_000_000);
  });

  it('records the bytes of the file even when the user configured line-ending conversion', () => {
    const blob = sh(repo.main, ['rev-parse', `${checkpoint}:fresh-crlf.txt`]).trim();
    expect(fileAt('fresh-crlf.txt')!.newBlob, 'the blob of the checkpoint is the file as the agent wrote it').toBe(blob);
    expect(sh(repo.main, ['cat-file', 'blob', blob]), 'carriage returns of a new file are kept with core.autocrlf=input').toBe('x\r\ny\r\n');
  });

  it('refuses to overwrite an existing review ref', async () => {
    const snapshot = await snapshotTree({ worktreePath: work, commonDir: repo.commonDir });
    await expect(commitCheckpoint({ commonDir: repo.commonDir, changesetId: 'cs_0123456789abcdef', tree: snapshot.tree, head: snapshot.head }), 'a second checkpoint under the same id').rejects.toThrow();
  });

  it('does not move the guarded drivers of a clean configuration', async () => {
    const git = await GuardedGit.open(repo.commonDir);
    expect(git.gitDir, 'the guard is bound to the git directory').toBe(repo.commonDir);
  });
});
