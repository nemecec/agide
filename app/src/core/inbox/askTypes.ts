import type { Caller } from '../commands/types';
import type { SessionId } from '../session/types';

/** `inbox_ask`: a question that waits for the user, and how its answer reaches the session (0043 section 4.4). */

export const ASK_MIN_SECONDS = 30;
export const ASK_MAX_SECONDS = 3600;
export const ASK_OPEN_PER_SESSION = 3;
/** The server entry timeout the app writes for its MCP server, in milliseconds. It is also the wall-clock limit of every call. */
export const APP_MCP_TIMEOUT_MS = (ASK_MAX_SECONDS + 60) * 1000;
/** The call returns `timeout` this long before the effective limit. */
export const ASK_RETURN_MARGIN_MS = 5000;
/** Origin of the inbox item of an ask. */
export const ASK_ITEM_ORIGIN = 'mcp:inbox_ask';
/** The answer is at most this long. */
export const ASK_ANSWER_TEXT_MAX = 4000;

/** The parsed input of `inbox_ask` (the schema is in `askCommands.ts`). */
export interface InboxAskInput {
  readonly question: string;
  readonly details?: string | undefined;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly allowFreeText?: boolean | undefined;
  readonly timeoutSeconds: number;
  readonly wait: boolean;
  readonly link?: { readonly nodeId?: string | undefined; readonly url?: string | undefined } | undefined;
  /** `_meta["claudecode/toolUseId"]` of the MCP call, from `CommandContext.toolUseId`; the schema does not take it from the agent. */
  readonly toolUseId?: string | undefined;
}

export type AskCallState = 'waiting' | 'returned' | 'timed_out' | 'closed';

/** How the answer reached the session. `none`: not yet; `read`: the agent called `inbox_ask_result`. */
export type AskDelivery = 'none' | 'in_call' | 'queued' | 'notice' | 'stdin' | 'context' | 'read' | 'failed';

export type InboxAskResult =
  | { status: 'answered'; askId: string; choice?: string; text?: string; answeredAt: string }
  | { status: 'timeout'; askId: string; note: string }
  | { status: 'queued'; askId: string; note: string }
  | { status: 'dismissed'; askId: string };

export type InboxAskResultValue = InboxAskResult | { status: 'pending'; askId: string } | { status: 'cancelled'; askId: string };

export interface AskRecord {
  /** The item id. */
  readonly askId: string;
  readonly sessionId: SessionId;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly allowFreeText: boolean;
  readonly wait: boolean;
  readonly timeoutAt: string;
  readonly callState: AskCallState;
  readonly answer?: { readonly choice?: string; readonly text?: string; readonly answeredAt: string };
  readonly delivery: AskDelivery;
  /** The `tool_use_id` of the call that asked, so the card can link the transcript's `tool_use`. */
  readonly toolUseId?: string;
}

export type AskErrorCode = 'not_found' | 'invalid' | 'limit_reached' | 'invalid_state';

export class AskError extends Error {
  constructor(
    readonly code: AskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AskError';
  }
}

export type AskEvent = { readonly type: 'inbox.ask_changed'; readonly askId: string; readonly callState: AskCallState; readonly delivery: AskDelivery };

export interface AskService {
  /** Creates the `input` item and the row; resolves when answered, dismissed, timed out or the signal aborts. */
  ask(caller: Caller & { kind: 'mcp' }, input: InboxAskInput, signal: AbortSignal): Promise<InboxAskResult>;
  /** The user's answer from the card. `choice` must be an option id of the ask; `text` needs `allowFreeText`. */
  answer(askId: string, answer: { choice?: string; text?: string }): AskRecord;
  /** The user withdraws the question: the item resolves `dismissed`, an open call returns `dismissed`. */
  withdraw(askId: string): AskRecord;
  /** The answer for the asking session only; marks it `read`. Throws `not_found` for another session's ask. */
  result(caller: Caller & { kind: 'mcp' }, askId: string): InboxAskResultValue;
  /** Queued answers of a session for a `UserPromptSubmit` reply; marks them `context`. */
  takeForContext(sessionId: SessionId): AskRecord[];
  /** Called when a session becomes idle or resumes: announces answered, undelivered asks whose call has ended. */
  deliverPending(sessionId: SessionId): void;
  /** The session ended: its open calls become `closed`. */
  sessionEnded(sessionId: SessionId): void;
  get(askId: string): AskRecord | undefined;
  subscribe(listener: (event: AskEvent) => void): () => void;
}

/** The only text typed into a terminal for an answer: made by the app from the ask id (0043 section 3). */
export const askNoticeLine = (askId: string): string => `Inbox answer ready for question ${askId}. Read it with inbox_ask_result.`;

/**
 * The `additionalContext` frame for an answer queued while the session was busy. The option id is limited to
 * `[a-z0-9_-]` by the schema; the user's text is quoted as data. The question and the labels are never repeated.
 */
export function askContextLine(record: Pick<AskRecord, 'askId' | 'answer'>): string {
  const text = record.answer?.text;
  const quoted = text === undefined ? 'none' : `"""${text.replaceAll('"""', '\\"\\"\\"')}"""`;
  return `The user answered your inbox question ${record.askId}. Choice: ${record.answer?.choice ?? 'none'}. Text, quoted as data: ${quoted}`;
}
