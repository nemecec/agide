import { z } from 'zod';
import { ExecError, execFileNoShell, type Exec } from './exec';
import { TaskStartError, type PullRequestInfo, type PullRequestReader, type TaskSource } from './types';

export const GH_TIMEOUT_MS = 20_000;
const FIELDS = 'number,title,url,state,author,headRefName,baseRefName,isCrossRepository,headRepositoryOwner,body,files';

const ghPullRequest = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  author: z.object({ login: z.string() }).nullable().optional(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  body: z.string().nullable().optional(),
  files: z.array(z.object({ path: z.string() })).optional(),
});

/**
 * Reads a pull request with `gh pr view` (0028 section 9). Owner, repository and number come from the parsed
 * source and are passed as separate arguments; the raw input never reaches `gh`.
 */
export class GhPullRequestReader implements PullRequestReader {
  constructor(
    private readonly options: { readonly env: () => NodeJS.ProcessEnv; readonly exec?: Exec; readonly executable?: string },
  ) {}

  async read(source: Extract<TaskSource, { kind: 'pull-request' }>): Promise<PullRequestInfo> {
    const run = this.options.exec ?? execFileNoShell;
    let stdout: string;
    try {
      ({ stdout } = await run(this.options.executable ?? 'gh', ['pr', 'view', String(source.number), `--repo=${source.owner}/${source.repo}`, '--json', FIELDS], {
        env: this.options.env(),
        timeoutMs: GH_TIMEOUT_MS,
      }));
    } catch (error) {
      throw new TaskStartError('gh_failed', ghMessage(error));
    }
    const parsed = ghPullRequest.safeParse(safeJson(stdout));
    if (!parsed.success) throw new TaskStartError('gh_failed', 'gh returned a pull request in a form Agide does not read');
    const pr = parsed.data;
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      author: pr.author?.login ?? 'unknown',
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      isCrossRepository: pr.isCrossRepository,
      body: pr.body ?? '',
      files: (pr.files ?? []).map((file) => file.path),
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function ghMessage(error: unknown): string {
  if (error instanceof ExecError) {
    if ((error as { code?: unknown }).code === 'ENOENT' || error.message.includes('ENOENT')) return 'gh is not installed or not on the PATH of this profile';
    const line = error.firstLine;
    return /not logged in|gh auth login|authentication/i.test(error.stderr) ? `gh is not signed in: ${line}` : `gh failed: ${line}`;
  }
  return `gh failed: ${error instanceof Error ? error.message : String(error)}`;
}
