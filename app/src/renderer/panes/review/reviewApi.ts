import type { ChangesetRecord, CommentRecord, Rung } from '../../../core/review/schemas';
import type { ChangesetDetail, ChangesetSummary, DemoteResult, SwarmMergeResult } from '../../../core/review/types';
import { api } from '../../api';

export interface Failure {
  readonly message: string;
  readonly code: string;
  readonly details?: unknown;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

/** The message of a failed outcome, or undefined for a successful one. */
export const failureOf = (outcome: Outcome<unknown>): string | undefined => (outcome.ok ? undefined : outcome.failure.message);

/** Runs a command as the user and folds the result into a value or a failure with the message to show. */
export async function run<T>(id: string, input: Record<string, unknown>): Promise<Outcome<T>> {
  try {
    const result = await api().invoke<T>(id, input);
    if (result.ok) return { ok: true, value: result.value };
    return { ok: false, failure: { message: result.error.message, code: result.error.code, ...(result.error.details === undefined ? {} : { details: result.error.details }) } };
  } catch (error) {
    return { ok: false, failure: { message: error instanceof Error ? error.message : String(error), code: 'failed' } };
  }
}

/** A successful outcome with its value mapped; the review module wraps lists and records in an object. */
const mapped = async <T, U>(outcome: Promise<Outcome<T>>, map: (value: T) => U): Promise<Outcome<U>> => {
  const result = await outcome;
  return result.ok ? { ok: true, value: map(result.value) } : result;
};

const changesetOf = (outcome: Promise<Outcome<{ readonly changeset: ChangesetRecord }>>) => mapped(outcome, (value) => value.changeset);

export const listChangesets = (swarmId: string) => mapped(run<{ readonly changesets: readonly ChangesetSummary[] }>('review_list', { swarmId, limit: 200 }), (value) => value.changesets);
export const getChangeset = (changesetId: string) => run<ChangesetDetail>('review_get', { changesetId });
export const getFileHunks = (changesetId: string, file: number) => run<ChangesetDetail>('review_get', { changesetId, hunks: true, file });

export const markSeen = (changesetId: string, level: 'summary' | 'file' | 'hunk', how: 'dwell' | 'marked', file?: number, hunk?: number) =>
  run('review_seen', { changesetId, level, how, ...(file === undefined ? {} : { file }), ...(hunk === undefined ? {} : { hunk }) });

/** What a decision sends: the content hash and rung the user looked at, so a changed changeset is refused. */
export interface Basis {
  readonly changesetId: string;
  readonly contentHash: string;
  readonly rung: Rung;
}

export const basisOf = (changeset: Pick<ChangesetRecord, 'id' | 'contentHash' | 'rung'>): Basis => ({ changesetId: changeset.id, contentHash: changeset.contentHash, rung: changeset.rung });

export const accept = (basis: Basis, options: { readonly withoutReviewer?: boolean; readonly note?: string } = {}) =>
  changesetOf(run('review_accept', { changesetId: basis.changesetId, expectedHash: basis.contentHash, expectedRung: basis.rung, withoutReviewer: options.withoutReviewer ?? false, ...(options.note ? { note: options.note } : {}) }));

export const reject = (basis: Basis, reason: string) => changesetOf(run('review_reject', { changesetId: basis.changesetId, expectedHash: basis.contentHash, reason }));

export const sendBack = (basis: Basis, message: string, findingIds: readonly string[]) =>
  changesetOf(run('review_send_back', { changesetId: basis.changesetId, expectedHash: basis.contentHash, ...(message === '' ? {} : { message }), ...(findingIds.length === 0 ? {} : { findingIds }) }));

export const acceptRepoChange = (swarmId: string, expectedHash: string) => run('review_accept_repo_change', { swarmId, expectedHash });

export const escalate = (changesetId: string, toRung: Rung, reason: string) => changesetOf(run('review_escalate', { changesetId, toRung, ...(reason === '' ? {} : { reason }) }));

export const demote = (changesetId: string, toRung: Rung, reason: string, confirmToken?: string) =>
  run<DemoteResult>('review_demote', { changesetId, toRung, reason, ...(confirmToken === undefined ? {} : { confirmToken }) });

export const addComment = (changesetId: string, file: number, side: 'new' | 'old', line: number, body: string) => run<CommentRecord>('review_comment', { changesetId, file, side, line, body });
export const deleteComment = (commentId: string) => run('review_comment', { commentId, delete: true });

export const merge = (swarmId: string, input: { readonly target?: string; readonly exclude: readonly string[]; readonly dryRun: boolean }) =>
  run<SwarmMergeResult>('swarm_merge', { swarmId, exclude: input.exclude, dryRun: input.dryRun, ...(input.target === undefined || input.target === '' ? {} : { target: input.target }) });
