import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitTestEnv, makeRepo } from '../manager/testRig';
import { Git } from './git';
import { SwarmWorkspaces } from './SwarmWorkspaces';

describe('git steps in a worktree an agent can write', () => {
  let repo: ReturnType<typeof makeRepo>;
  let root: string;
  let workspaces: SwarmWorkspaces;
  const trusted = new Git(undefined, gitTestEnv);
  beforeEach(() => {
    repo = makeRepo();
    root = `${repo.dir}-git`;
    mkdirSync(root);
    workspaces = new SwarmWorkspaces({ git: trusted, dataRoot: join(root, 'data'), worktreeBase: join(root, 'wt'), appRoot: join(root, 'app') });
  });
  afterEach(() => {
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  const prepare = (name: string) => workspaces.prepare({ swarmId: 'abcdef123456', name, workspace: 'worktree', repoPath: repo.dir, baseCommit: repo.commit });

  it('collects a patch that applies, whatever diff settings the user has', async () => {
    const config = join(root, 'user.gitconfig');
    writeFileSync(config, '[diff]\n\tnoprefix = true\n\tmnemonicPrefix = true\n[color]\n\tui = always\n');
    const hostile = new Git(undefined, () => ({ ...gitTestEnv(), GIT_CONFIG_GLOBAL: config }));
    const work = await prepare('w');
    writeFileSync(join(work.cwd, 'src/a.ts'), 'export const a = 2;\n');
    const collected = await hostile.collect(work.cwd, repo.commit);
    expect(collected.patch, 'the headers carry the a/ and b/ prefixes').toMatch(/^diff --git a\/src\/a\.ts b\/src\/a\.ts$/m);
    expect(collected.patch.includes('\u001b'), 'no colour codes').toBe(false);
    const patchFile = join(root, 'w.patch');
    writeFileSync(patchFile, Buffer.from(collected.patch, 'latin1'));
    await expect(trusted.verifyPatch(repo.dir, repo.commit, patchFile), 'the stored patch applies to the base').resolves.toBeUndefined();
  });

  it('stores the bytes of a file that is not UTF-8 unchanged', async () => {
    const work = await prepare('bytes');
    writeFileSync(join(work.cwd, 'latin.txt'), Buffer.from([0xe4, 0xff, 0xfe, 0x0a]));
    const stored = await workspaces.collect('abcdef123456', 'bytes', work.cwd, repo.commit);
    const bytes = readFileSync(stored.patchFile);
    expect(bytes.includes(Buffer.from([0xe4, 0xff, 0xfe])), 'the original bytes are in the patch').toBe(true);
    expect(bytes.includes(Buffer.from([0xef, 0xbf, 0xbd])), 'no replacement character').toBe(false);
  });

  it('refuses a worktree whose .git entry the agent replaced by a directory', async () => {
    const work = await prepare('swap');
    rmSync(join(work.cwd, '.git'));
    mkdirSync(join(work.cwd, '.git'));
    await expect(trusted.hasChanges(work.cwd), 'a directory instead of the .git file').rejects.toThrow(/not a file/);
  });

  it('refuses a worktree whose .git file points to the directory of another worktree', async () => {
    const first = await prepare('first');
    const second = await prepare('second');
    writeFileSync(join(first.cwd, '.git'), readFileSync(join(second.cwd, '.git'), 'utf8'));
    await expect(new Git(undefined, gitTestEnv).collect(first.cwd, repo.commit), 'a pointer to another worktree, for a worktree of an earlier run').rejects.toThrow(/registered for another worktree/);
  });

  it('does not run a filesystem monitor command from the repository configuration', async () => {
    const marker = join(root, 'ran');
    const script = join(root, 'monitor.sh');
    writeFileSync(script, `#!/bin/sh\ntouch ${marker}\nprintf '\\0'\n`);
    chmodSync(script, 0o755);
    repo.git('config', 'core.fsmonitor', script);
    const work = await prepare('monitor');
    writeFileSync(join(work.cwd, 'new.txt'), 'x\n');
    rmSync(marker, { force: true });
    await trusted.hasChanges(work.cwd);
    await trusted.collect(work.cwd, repo.commit);
    expect(existsSync(marker), 'the configured command did not run').toBe(false);
  });

  it('does not run a filter driver of the repository configuration on files of the worktree', async () => {
    const marker = join(root, 'filter-ran');
    const script = join(root, 'filter.sh');
    writeFileSync(script, `#!/bin/sh\ntouch ${marker}\ncat\n`);
    chmodSync(script, 0o755);
    repo.git('config', 'filter.evil.clean', script);
    const work = await prepare('filter');
    writeFileSync(join(work.cwd, '.gitattributes'), '* filter=evil\n');
    writeFileSync(join(work.cwd, 'new.txt'), 'x\n');
    rmSync(marker, { force: true });
    await trusted.hasChanges(work.cwd);
    await trusted.collect(work.cwd, repo.commit);
    expect(existsSync(marker), 'the filter command did not run').toBe(false);
  });

  it('refuses a git directory the agent built inside the worktree', async () => {
    const marker = join(root, 'forged-ran');
    const work = await prepare('forged');
    const fake = join(work.cwd, 'fake');
    cpSync(join(repo.dir, '.git'), fake, { recursive: true });
    const admin = readFileSync(join(work.cwd, '.git'), 'utf8').replace('gitdir: ', '').trim();
    const forgedAdmin = join(fake, 'worktrees', basename(admin));
    mkdirSync(dirname(forgedAdmin), { recursive: true });
    cpSync(admin, forgedAdmin, { recursive: true });
    writeFileSync(join(fake, 'config'), `${readFileSync(join(fake, 'config'), 'utf8')}[core]\n\tfsmonitor = touch ${marker}\n`);
    writeFileSync(join(work.cwd, '.git'), `gitdir: ${forgedAdmin}\n`);
    await expect(trusted.hasChanges(work.cwd), 'a git directory inside the worktree').rejects.toThrow(/inside the worktree|another git directory/);
    expect(existsSync(marker), 'nothing from the forged configuration ran').toBe(false);
  });

  it('refuses a .git file that names another directory than the one created for the worktree', async () => {
    const first = await prepare('one');
    const second = await prepare('two');
    const pointer = readFileSync(join(second.cwd, '.git'), 'utf8').replace('gitdir: ', '').trim();
    const copy = `${pointer}-copy`;
    cpSync(pointer, copy, { recursive: true });
    writeFileSync(join(copy, 'gitdir'), `${first.cwd}/.git\n`);
    writeFileSync(join(first.cwd, '.git'), `gitdir: ${copy}\n`);
    await expect(trusted.hasChanges(first.cwd), 'a pointer that differs from the recorded one').rejects.toThrow(/another git directory/);
  });

  it('refuses a stored patch that does not apply to the base', async () => {
    const patchFile = join(root, 'bad.patch');
    writeFileSync(patchFile, 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-nothing like the file\n+other\n');
    await expect(trusted.verifyPatch(repo.dir, repo.commit, patchFile), 'a patch for other content').rejects.toThrow(/does not apply/);
  });
});
