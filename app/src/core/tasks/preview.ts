import { basename } from 'node:path';
import { composePrompt } from './promptComposer';
import { parseTaskSource, sourceTitle } from './parseSource';
import { slugOf } from './remotes';
import type { TaskSourceKind } from './types';

export interface TaskPreview {
  readonly kind: TaskSourceKind;
  /** The commands the start runs, with placeholders for what is only known when it runs. */
  readonly commands: readonly string[];
  /** The first prompt, without the text of the pull request or ticket (that stays in the source file). */
  readonly prompt: string;
  /** The local repository found for a pull request. */
  readonly repoPath?: string;
}

export interface PreviewInput {
  readonly source: string;
  readonly instruction?: string;
  readonly repoPath?: string;
  readonly base?: string;
  readonly remote?: string;
  readonly worktreeDir: string;
}

/** What a start would run and type, computed without running anything. Pure. */
export function previewTaskStart(input: PreviewInput): TaskPreview {
  const source = parseTaskSource(input.source);
  const remote = input.remote ?? 'origin';
  const repo = input.repoPath;
  const commands: string[] = [];
  if (source.kind === 'pull-request') {
    commands.push(`gh pr view ${source.number} --repo=${source.owner}/${source.repo} --json number,title,url,state,author,headRefName,baseRefName,isCrossRepository,headRepositoryOwner,body,files`);
    if (repo !== undefined) {
      commands.push(`git -C ${repo} fetch ${remote} pull/${source.number}/head`, `git -C ${repo} worktree add -b agide/pr-${source.number} -- ${input.worktreeDir} FETCH_HEAD`);
    }
  } else if (repo !== undefined) {
    const base = input.base ?? 'origin/HEAD';
    commands.push(
      `git -C ${repo} fetch ${remote}`,
      `git -C ${repo} worktree add -b agide/${slugOf(sourceTitle(source)) || 'task'}-<folder id> -- ${input.worktreeDir} ${base}`,
    );
  }
  const prompt = composePrompt({
    source,
    author: { kind: 'user' },
    ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    workdir:
      repo === undefined
        ? {}
        : {
            repository: source.kind === 'pull-request' ? `${source.owner}/${source.repo}` : basename(repo),
            branch: source.kind === 'pull-request' ? `agide/pr-${source.number}` : 'agide/<slug>',
            commit: '<commit id>',
            base: input.base ?? (source.kind === 'pull-request' ? '<base branch>' : 'origin/HEAD'),
          },
    ...(repo === undefined ? {} : { claudeMd: '<CLAUDE.md of the repository at the base commit>' }),
    ...(source.kind === 'pull-request' ? { sourceFile: '<source directory>/task-source.md' } : {}),
  });
  return { kind: source.kind, commands, prompt, ...(repo === undefined ? {} : { repoPath: repo }) };
}
