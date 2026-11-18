import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IDENTITY = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };

export const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, ...IDENTITY, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8' }).trim();
}

export interface TestRepository {
  /** The checkout the app uses as the user's repository, `origin` pointing at the bare remote. */
  readonly repo: string;
  readonly bare: string;
  readonly root: string;
  /** Commit of `main`. */
  readonly mainCommit: string;
  /** Commit that `refs/pull/1/head` names on the bare remote. */
  readonly pullCommit: string;
}

/**
 * A temporary repository with a local bare remote that carries `refs/pull/1/head`. The remote's URL is a GitHub
 * URL through `url.<local>.insteadOf`, so the app's remote matching sees `acme/app`.
 */
export function createRepositoryWithRemote(options: { readonly claudeMd?: string; readonly pullClaudeMd?: string } = {}): TestRepository {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tasks-repo-')));
  const bare = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const repo = join(root, 'app');
  mkdirSync(seed);
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-b', 'main');
  writeFileSync(join(seed, 'README.md'), 'readme\n');
  if (options.claudeMd !== undefined) writeFileSync(join(seed, 'CLAUDE.md'), options.claudeMd);
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'first');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', 'origin', 'main');
  const mainCommit = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'checkout', '-b', 'fix-retry');
  writeFileSync(join(seed, 'upload.ts'), 'export {};\n');
  if (options.pullClaudeMd !== undefined) writeFileSync(join(seed, 'CLAUDE.md'), options.pullClaudeMd);
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'retry');
  const pullCommit = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', 'origin', 'HEAD:refs/pull/1/head');
  git(root, 'clone', bare, repo);
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git');
  git(repo, 'config', `url.${bare}.insteadOf`, 'https://github.com/acme/app.git');
  return { repo, bare, root, mainCommit, pullCommit };
}
