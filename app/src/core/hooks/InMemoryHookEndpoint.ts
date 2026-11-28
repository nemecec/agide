import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import {
  HOOK_BODY_MAX_BYTES,
  HTTP_HOOK_EVENTS,
  USER_PROMPT_REPLY_WAIT_MS,
  type HookEndpoint,
  type HookEventName,
  type HookGrant,
  type HookReply,
  type HookReplyContributor,
  type HookRequest,
} from './types';

/** What a client of the hook route sends: the HTTP request, without the HTTP. */
export interface HookPost {
  readonly sessionId: SessionId;
  readonly token?: string;
  /** The `Host` header. */
  readonly host?: string;
  readonly origin?: string;
  readonly body: string;
  /** Aborts when the client gives up, as the CLI does at an Esc. */
  readonly signal?: AbortSignal;
}

export interface HookPostResult {
  readonly status: number;
  readonly reply?: HookReply;
  /** The client gave up before the reply. */
  readonly aborted?: boolean;
  /** The text of an error response; the in-memory endpoint sends none. */
  readonly body?: string;
}

export interface InMemoryHookEndpointOptions {
  readonly now?: () => Date;
  /** The listener's port, for the grant's URL and the `Host` check. */
  readonly port?: number;
  readonly userPromptWaitMs?: number;
}

const EMPTY: HookReply = {};

function tokensEqual(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isEvent = (value: unknown): value is HookEventName => (HTTP_HOOK_EVENTS as readonly unknown[]).includes(value);

/** The rules of 0043 section 4.1 without a socket; `HttpHookEndpoint` of w-hooks passes the same contract over HTTP. */
export class InMemoryHookEndpoint implements HookEndpoint {
  private readonly grants = new Map<SessionId, { token: string; hostHeader?: string }>();
  private readonly listeners = new Set<(request: HookRequest) => void>();
  private readonly contributors = new Set<HookReplyContributor>();
  private readonly now: () => Date;
  private readonly port: number;
  private readonly userPromptWaitMs: number;

  constructor(options: InMemoryHookEndpointOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.port = options.port ?? 4242;
    this.userPromptWaitMs = options.userPromptWaitMs ?? USER_PROMPT_REPLY_WAIT_MS;
  }

  grant(sessionId: SessionId, hostHeader?: string): HookGrant {
    const token = randomBytes(32).toString('hex');
    this.grants.set(sessionId, { token, ...(hostHeader === undefined ? {} : { hostHeader }) });
    return { url: `http://127.0.0.1:${this.port}/hooks/${encodeURIComponent(sessionId)}`, token };
  }

  revoke(sessionId: SessionId): void {
    this.grants.delete(sessionId);
  }

  subscribe(listener: (request: HookRequest) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addContributor(contributor: HookReplyContributor): Unsubscribe {
    this.contributors.add(contributor);
    return () => this.contributors.delete(contributor);
  }

  /** Handles one post as the route does: the guard, the checks of the body, the listeners, then the reply. */
  async receive(post: HookPost): Promise<HookPostResult> {
    const grant = this.grants.get(post.sessionId);
    if (post.origin !== undefined) return { status: 403 };
    const host = post.host ?? `127.0.0.1:${this.port}`;
    const loopback = host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
    if (!loopback && host !== grant?.hostHeader) return { status: 403 };
    if (!grant || !tokensEqual(post.token, grant.token)) return { status: 401 };
    if (Buffer.byteLength(post.body) > HOOK_BODY_MAX_BYTES) return { status: 413 };
    let payload: unknown;
    try {
      payload = JSON.parse(post.body);
    } catch {
      return { status: 400 };
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return { status: 400 };
    const record = payload as Record<string, unknown>;
    const event = record['hook_event_name'];
    if (!isEvent(event) || record['session_id'] !== post.sessionId) return { status: 400 };

    const controller = new AbortController();
    const abandoned = new Promise<'aborted'>((resolve) => {
      const onAbort = (): void => {
        controller.abort();
        resolve('aborted');
      };
      if (post.signal?.aborted) onAbort();
      else post.signal?.addEventListener('abort', onAbort, { once: true });
    });
    const request: HookRequest = { sessionId: post.sessionId, event, payload: record, receivedAt: this.now().toISOString(), signal: controller.signal };
    for (const listener of [...this.listeners]) listener(request);
    const reply = await Promise.race([this.replyTo(request), abandoned]);
    return reply === 'aborted' ? { status: 499, aborted: true } : { status: 200, reply };
  }

  private async replyTo(request: HookRequest): Promise<HookReply> {
    const mine = [...this.contributors].filter((contributor) => contributor.events.includes(request.event));
    if (request.event === 'UserPromptSubmit') return this.userPromptReply(mine, request);
    if (request.event === 'PermissionRequest') return this.firstReply(mine, request);
    return EMPTY;
  }

  private async userPromptReply(contributors: readonly HookReplyContributor[], request: HookRequest): Promise<HookReply> {
    const contexts: string[] = [];
    const answers = contributors.map(async (contributor) => {
      const reply = await safeReply(contributor, request);
      if (reply && 'hookSpecificOutput' in reply && reply.hookSpecificOutput.hookEventName === 'UserPromptSubmit') contexts.push(reply.hookSpecificOutput.additionalContext);
    });
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(answers), new Promise<void>((resolve) => (timer = setTimeout(resolve, this.userPromptWaitMs)))]);
    clearTimeout(timer);
    return contexts.length === 0 ? EMPTY : { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: contexts.join('\n\n') } };
  }

  private async firstReply(contributors: readonly HookReplyContributor[], request: HookRequest): Promise<HookReply> {
    if (contributors.length === 0) return EMPTY;
    return new Promise<HookReply>((resolve) => {
      let open = contributors.length;
      for (const contributor of contributors) {
        void safeReply(contributor, request).then((reply) => {
          if (reply) resolve(reply);
          else if (--open === 0) resolve(EMPTY);
        });
      }
    });
  }
}

/** A contributor that throws answers nothing: a failing contributor never blocks the CLI. */
async function safeReply(contributor: HookReplyContributor, request: HookRequest): Promise<HookReply | undefined> {
  try {
    const reply = await contributor.reply(request);
    return reply !== undefined && Object.keys(reply).length === 0 ? undefined : reply;
  } catch {
    return undefined;
  }
}
