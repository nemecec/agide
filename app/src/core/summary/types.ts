import type { SessionId } from '../session/types';

/**
 * Session summaries on request (0043 section 4.7). A summary needs no answer from the user, so it is never an
 * inbox item and not part of the card; it shows on the session's row in the tree.
 */

export interface SummaryRequest {
  readonly sessionId: SessionId;
  readonly transcriptPath: string;
}

export interface SessionSummarizer {
  /** One run at a time per profile and per session; refused above the daily cap. */
  summarize(request: SummaryRequest): Promise<{ summary: string; model: string; generatedAt: string }>;
}

export interface SessionSummaryView {
  readonly sessionId: SessionId;
  /** Model text: plain text only. */
  readonly summary: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly stale: boolean;
}

export const SUMMARY_DAILY_CAP = 50;
export const SUMMARY_MAX_CHARS = 400;
export const SUMMARY_INPUT_MAX_CHARS = 20_000;
/** A summary is stale after this many turns since it was made, or this many bytes of transcript. */
export const SUMMARY_STALE_TURNS = 3;
export const SUMMARY_STALE_TRANSCRIPT_BYTES = 50_000;

export type SummaryEvent = { readonly type: 'session.summary_changed'; readonly sessionId: SessionId };
