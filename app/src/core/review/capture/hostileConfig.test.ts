import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitCheckpoint, readDiff, snapshotTree } from './checkpoint';
import { makeRepo, sh, write, type Repo } from './gitFixtures';
import { GuardedGit } from './guardedGit';

/** The agent can write the shared repository configuration, `.gitattributes` and `info/attributes` from its worktree (probe P42). */
describe('programs the repository names never run during a capture', () => {
  let repo: Repo;
  let marks: string;
  let work: string;
  const marked = (name: string): boolean => existsSync(join(marks, name));

  beforeAll(async () => {
    repo = makeRepo({ 'a.txt': 'one\n', 'notes.md': 'text\n' }, 'hostile');
    marks = join(repo.root, 'marks');
    mkdirSync(marks);
    const script = (name: string): string => {
      const path = join(repo.root, `${name}.sh`);
      writeFileSync(path, `#!/bin/sh\ntouch "${marks}/${name}"\ncat "$@" 2>/dev/null\n`);
      chmodSync(path, 0o755);
      return path;
    };
    work = repo.worktree('agent');
    const config = (key: string, value: string): void => void sh(work, ['config', key, value]);
    config('filter.evil.clean', script('clean'));
    config('filter.evil.smudge', script('smudge'));
    config('filter.evil.process', script('process'));
    config('filter.evil.required', 'true');
    config('filter.viainfo.clean', script('infoclean'));
    config('diff.evil.textconv', script('textconv'));
    config('diff.evil.command', script('diffcommand'));
    config('diff.external', script('external'));
    config('core.fsmonitor', script('fsmonitor'));
    config('core.pager', script('pager'));
    config('merge.evil.driver', script('mergedriver'));
    mkdirSync(join(repo.root, 'hooks'));
    writeFileSync(join(repo.root, 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marks}/hook"\n`, { mode: 0o755 });
    writeFileSync(join(repo.root, 'hooks', 'reference-transaction'), `#!/bin/sh\ntouch "${marks}/reftx"\n`, { mode: 0o755 });
    config('core.hooksPath', join(repo.root, 'hooks'));
    writeFileSync(join(repo.root, 'globalattrs'), '*.md filter=evil diff=evil\n');
    config('core.attributesFile', join(repo.root, 'globalattrs'));
    write(join(work, '.gitattributes'), '* filter=evil diff=evil merge=evil\n');
    mkdirSync(join(repo.commonDir, 'info'), { recursive: true });
    writeFileSync(join(repo.commonDir, 'info', 'attributes'), '*.txt filter=viainfo diff=evil\n');
    write(join(work, 'a.txt'), 'one\ntwo\n');
    write(join(work, 'notes.md'), 'text\nmore\n');
    write(join(work, 'new.txt'), 'brand new\n');

    const snapshot = await snapshotTree({ worktreePath: work, commonDir: repo.commonDir });
    const checkpoint = await commitCheckpoint({ commonDir: repo.commonDir, changesetId: 'cs_aaaaaaaaaaaaaaaa', tree: snapshot.tree, head: snapshot.head });
    await readDiff({ commonDir: repo.commonDir, base: repo.base, checkpoint });
  });
  afterAll(() => repo.cleanup());

  it.each(['clean', 'smudge', 'process', 'infoclean', 'textconv', 'diffcommand', 'external', 'fsmonitor', 'pager', 'hook', 'reftx'])('runs no %s program', (name) => {
    expect(marked(name), `the ${name} program of the repository configuration did not run`).toBe(false);
  });

  it('reads attributes from the empty tree, so the worktree and the global file name none, and blanks the drivers info/attributes still names', async () => {
    const git = await GuardedGit.open(join(repo.commonDir, 'worktrees', 'agent'), { workTree: work });
    const attributes = (await git.text(['check-attr', '-a', '--', 'notes.md'])).trim();
    expect(attributes, 'neither .gitattributes of the worktree nor core.attributesFile applies').toBe('');
    const viaInfo = await git.text(['check-attr', '-a', '--', 'a.txt']);
    expect(viaInfo.includes('filter: viainfo'), 'info/attributes of the common directory still names a filter').toBe(true);
    expect(marked('infoclean'), 'and that filter did not run').toBe(false);
  });
  it('proves the fixture works: the unguarded git of the same configuration runs the programs', () => {
    try {
      sh(work, ['add', '-A']);
    } catch {
      // A required filter that fails makes plain git fail; the program ran all the same.
    }
    expect(marked('clean') || marked('infoclean') || marked('fsmonitor'), 'plain git runs a configured program in this fixture').toBe(true);
  });

});
