import type { ChangesetDetail, ChangesetSummary } from '../../../core/review/types';
import type { CommentRecord, Hunk } from '../../../core/review/schemas';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';

export interface ReviewServer {
  readonly fake: FakeApi;
  detail: ChangesetDetail;
  hunks: Hunk[];
  list: ChangesetSummary[];
  /** Commands the views sent, by id, with their inputs. */
  calls(id: string): unknown[];
}

/**
 * `window.api` for the review views: the answers of `review_get`, `review_list`, `review_seen` and
 * `review_comment` follow the server's state, and every other review command answers `{}` unless a responder is
 * given. A seen mark adds the hunk hash to the seen state, as the manager's mark does.
 */
export function installReviewApi(state: { detail: ChangesetDetail; hunks?: Hunk[]; list?: ChangesetSummary[] }, responders: Record<string, unknown> = {}): ReviewServer {
  const server: ReviewServer = {
    fake: undefined as never,
    detail: state.detail,
    hunks: state.hunks ?? [],
    list: state.list ?? [],
    calls: (id) => server.fake.invoke.mock.calls.filter(([called]) => called === id).map(([, input]) => input),
  };
  let draftNo = 0;
  const fake = installFakeApi({
    review_get: (input: unknown) => {
      const { hunks, file } = input as { hunks?: boolean; file?: number };
      if (hunks !== true) return server.detail;
      return { ...server.detail, hunks: server.hunks.filter((hunk) => file === undefined || hunk.fileIdx === file) };
    },
    review_list: () => ({ changesets: server.list }),
    // The decisions answer with the changeset as main/modules/review.ts does.
    review_accept: () => ({ changeset: server.detail.changeset }),
    review_reject: () => ({ changeset: server.detail.changeset }),
    review_send_back: () => ({ changeset: server.detail.changeset }),
    review_escalate: () => ({ changeset: server.detail.changeset }),
    review_seen: (input: unknown) => {
      const { level, file, hunk } = input as { level: string; file?: number; hunk?: number };
      if (level === 'summary') server.detail = { ...server.detail, seen: { ...server.detail.seen, summary: true } };
      if (level === 'hunk') {
        const target = server.hunks.find((candidate) => candidate.fileIdx === file && candidate.idx === hunk);
        if (target !== undefined) {
          const hunkHashes = [...server.detail.seen.hunks, target.hunkHash];
          const files = server.detail.seen.files.map((entry) => {
            const own = server.hunks.filter((candidate) => candidate.fileIdx === entry.idx);
            const unseenHunks = own.filter((candidate) => !hunkHashes.includes(candidate.hunkHash)).length;
            return { ...entry, unseenHunks, seen: unseenHunks === 0 };
          });
          server.detail = { ...server.detail, seen: { ...server.detail.seen, hunks: hunkHashes, files } };
        }
      }
      return {};
    },
    review_comment: (input: unknown) => {
      const body = input as { commentId?: string; delete?: true; file?: number; side?: 'new' | 'old'; line?: number; body?: string };
      if (body.delete === true) {
        server.detail = { ...server.detail, comments: server.detail.comments.filter((comment) => comment.id !== body.commentId) };
        return { deleted: true };
      }
      const hunk = server.hunks.find((candidate) => candidate.fileIdx === body.file);
      const comment: CommentRecord = {
        id: `draft${++draftNo}`,
        changesetId: server.detail.changeset.id,
        fileIdx: body.file ?? 0,
        side: body.side ?? 'new',
        line: body.line ?? 1,
        hunkHash: hunk?.hunkHash ?? '',
        body: body.body ?? '',
        state: 'draft',
        sentIn: null,
        createdAt: '2026-11-21T10:00:00.000Z',
      };
      server.detail = { ...server.detail, comments: [...server.detail.comments, comment] };
      return comment;
    },
    ...responders,
  });
  (server as { fake: FakeApi }).fake = fake;
  return server;
}
