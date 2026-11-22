import { GuardedGit, type GitExec } from '../capture/guardedGit';
import { isReasonId } from '../reasonCatalogue';
import { fieldsHash } from '../rungs';
import type { PolicySnapshot } from '../schemas';
import type { PolicyLoader, RepoRef } from '../types';
import { canonicalJson } from './defaults';
import { mergeOverlay } from './mergePolicy';
import { DEFAULT_REVIEW_POLICY, POLICY_MAX_BYTES, POLICY_PATH, reviewPolicySchema, userPolicySchema, type ReviewPolicy, type UserPolicy } from './schema';

/**
 * Reads the project policy from the base commit with `ls-tree` and `cat-file` and nothing else (0040 section 8.3):
 * no work tree, no attributes, no filters. The file the agent changes in its worktree is never read.
 */

export interface GitPolicyLoaderOptions {
  readonly exec?: GitExec;
  readonly now?: () => Date;
}

type ProjectRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed'; readonly errors: readonly string[]; readonly text?: string }
  | { readonly kind: 'read'; readonly text: string; readonly policy: ReviewPolicy };

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export class GitPolicyLoader implements PolicyLoader {
  constructor(private readonly options: GitPolicyLoaderOptions = {}) {}

  async load(repo: RepoRef, baseCommit: string, overlay: UserPolicy | undefined): Promise<PolicySnapshot> {
    const git = await GuardedGit.open(repo.commonDir, { ...(this.options.exec === undefined ? {} : { exec: this.options.exec }) });
    const project = await readProjectPolicy(git, baseCommit);
    const overlayCheck = overlay === undefined ? undefined : userPolicySchema.safeParse(overlay);
    const validOverlay = overlayCheck?.success === true ? overlayCheck.data : undefined;

    const base = project.kind === 'read' ? project.policy : DEFAULT_REVIEW_POLICY;
    const effective = mergeOverlay(base, validOverlay);
    const errors = project.kind === 'malformed' ? [...project.errors] : overlayCheck?.success === false ? overlayCheck.error.issues.map((issue) => `user overlay: ${issue.path.join('.')}: ${issue.message}`) : null;
    const warnings = Object.keys(effective.rungs)
      .filter((id) => !isReasonId(id))
      .map((id) => `rungs: ${id} is not a reason id and is ignored`);
    if (Object.keys(effective.outward).length > 0 || effective.deployCommands.length > 0) warnings.push('outward and deployCommands are read but not applied to the agents in this build');

    const effectiveJson = canonicalJson(effective);
    return {
      hash: fieldsHash(effectiveJson),
      source: project.kind === 'read' ? 'base' : project.kind === 'missing' ? 'default' : 'invalid',
      repoPath: repo.repoPath,
      baseCommit,
      projectJson: project.kind === 'read' ? project.text : project.kind === 'malformed' ? (project.text ?? null) : null,
      userJson: validOverlay === undefined ? null : canonicalJson(validOverlay),
      effective,
      errors,
      warnings,
      createdAt: (this.options.now?.() ?? new Date()).toISOString(),
    };
  }
}

async function readProjectPolicy(git: GuardedGit, baseCommit: string): Promise<ProjectRead> {
  const listing = (await git.latin1(['ls-tree', '-z', baseCommit, '--', POLICY_PATH])).split('\0').filter((entry) => entry !== '');
  if (listing.length === 0) return { kind: 'missing' };
  const entry = /^(\d+) (\w+) ([0-9a-f]{40,64})\t/.exec(listing[0]!);
  if (entry === null) return { kind: 'malformed', errors: ['the policy entry of the base commit does not parse'] };
  const [, mode, type, blob] = entry;
  if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) return { kind: 'malformed', errors: [`${POLICY_PATH} is a ${mode === '120000' ? 'symbolic link' : type} (mode ${mode}), not a regular file`] };
  const size = Number((await git.text(['cat-file', '-s', blob!])).trim());
  if (!Number.isFinite(size) || size > POLICY_MAX_BYTES) return { kind: 'malformed', errors: [`${POLICY_PATH} is ${size} bytes; the limit is ${POLICY_MAX_BYTES}`] };
  const bytes = await git.bytes(['cat-file', 'blob', blob!]);
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return { kind: 'malformed', errors: [`${POLICY_PATH} is not valid UTF-8`] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { kind: 'malformed', errors: [`${POLICY_PATH} is not valid JSON: ${(error as Error).message}`], text };
  }
  const parsed = reviewPolicySchema.safeParse(json);
  if (!parsed.success) return { kind: 'malformed', errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`), text };
  return { kind: 'read', text, policy: parsed.data };
}
