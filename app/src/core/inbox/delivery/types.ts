import type { LaunchPath, SessionId, SessionStatus } from '../../session/types';

/**
 * The delivery of a decision or an answer to the session that waits for it after its call returned (0043 sections
 * 4.4 and 4.10). Asks and access requests share one planner. It takes a record id and the fixed lines that the app
 * made from the id; it never takes agent text. A notice is typed into an idle PTY session or written as a user
 * message to a stream-json session, or its context line reaches the model with the next `UserPromptSubmit` reply.
 */

export type NoticeDeliveryKind = 'notice' | 'stdin' | 'context' | 'failed';

export interface Notice {
  /** An ask id or an access request id: an id the app made. */
  readonly recordId: string;
  readonly sessionId: SessionId;
  /** Typed into an idle PTY, or a stdin user message. */
  readonly noticeLine: string;
  /** `UserPromptSubmit` `additionalContext`. */
  readonly contextLine: string;
  onDelivered(delivery: NoticeDeliveryKind): void;
}

export interface NoticeDelivery {
  /** Queues the notice, replacing a queued notice of the same record; delivers at once when the session is idle. */
  enqueue(notice: Notice): void;
  /** Drops the queued notice of the record, for example when the agent read the answer. */
  cancel(recordId: string): void;
  /** A `UserPromptSubmit` of the session: takes its queued notices as context lines and reports `context` for each. */
  takeContext(sessionId: SessionId): readonly { readonly recordId: string; readonly contextLine: string }[];
  /** The session became idle or resumed: delivers its queued notices. */
  flush(sessionId: SessionId): void;
}

/** What the planner needs of the session service. */
export interface DeliverySessions {
  /** `undefined` for a session the service does not know. */
  state(sessionId: SessionId): { readonly status: SessionStatus; readonly launchPath: LaunchPath } | undefined;
  /** Types the line as a prompt and submits it. */
  typeLine(sessionId: SessionId, line: string): void;
  /** Writes the line as a user message on the stdin of a stream-json session. */
  writeUserMessage(sessionId: SessionId, line: string): void;
}
