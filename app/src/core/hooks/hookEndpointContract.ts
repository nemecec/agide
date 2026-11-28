import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOOK_BODY_MAX_BYTES, HOOK_PATH, type HookEndpoint, type HookReply, type HookReplyContributor, type HookRequest } from './types';

export interface HookClientPost {
  readonly sessionId: string;
  readonly token?: string;
  readonly host?: string;
  readonly origin?: string;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface HookClientResult {
  readonly status: number;
  readonly reply?: HookReply;
  readonly aborted?: boolean;
  /** The text of an error response, when the endpoint sends one. */
  readonly body?: string;
}

export interface HookEndpointHarness {
  readonly endpoint: HookEndpoint;
  /** Posts as the CLI's http hook does: the route with the session in the path and the token as bearer. */
  post(post: HookClientPost): Promise<HookClientResult>;
  /** The `Host` header the endpoint accepts for its own address. */
  readonly ownHost: string;
  close(): Promise<void>;
}

const body = (sessionId: string, event: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ session_id: sessionId, hook_event_name: event, ...extra });

/**
 * Behaviour every `HookEndpoint` must show (0043 section 4.1). `create` takes the time the endpoint waits for the
 * contributors of `UserPromptSubmit`, which the tests keep short; the HTTP implementation runs the same cases over a socket.
 */
export function describeHookEndpointContract(name: string, create: (options: { userPromptWaitMs: number }) => HookEndpointHarness | Promise<HookEndpointHarness>): void {
  describe(`${name} (HookEndpoint contract)`, () => {
    let h: HookEndpointHarness;
    let token: string;
    beforeEach(async () => {
      h = await create({ userPromptWaitMs: 40 });
      token = h.endpoint.grant('s1').token;
    });
    afterEach(async () => {
      await h.close();
    });

    const seen = (): HookRequest[] => {
      const requests: HookRequest[] = [];
      h.endpoint.subscribe((request) => requests.push(request));
      return requests;
    };
    const post = (event: string, extra: Record<string, unknown> = {}, overrides: Partial<HookClientPost> = {}) =>
      h.post({ sessionId: 's1', token, body: body('s1', event, extra), ...overrides });
    const contributor = (events: HookRequest['event'][], reply: HookReplyContributor['reply'], id = 'c'): HookReplyContributor => ({ id, events, reply });

    it('grants a URL on the hook path and a random 32 byte token, and replaces the token on a new grant', async () => {
      const grant = h.endpoint.grant('s2');
      expect(new URL(grant.url).pathname, 'the URL is the hook route of the session').toMatch(HOOK_PATH);
      expect(new URL(grant.url).pathname, 'the session id is in the path').toBe('/hooks/s2');
      expect(grant.token, 'the token is 32 bytes in hex').toMatch(/^[0-9a-f]{64}$/);
      const second = h.endpoint.grant('s2');
      expect(second.token, 'a new grant issues a new token').not.toBe(grant.token);
      expect((await h.post({ sessionId: 's2', token: grant.token, body: body('s2', 'Stop') })).status, 'the replaced token is refused').toBe(401);
      expect((await h.post({ sessionId: 's2', token: second.token, body: body('s2', 'Stop') })).status, 'the new token is accepted').toBe(200);
    });

    it('answers 401 for a wrong, missing or revoked token and for an unknown session, and passes nothing on', async () => {
      const requests = seen();
      expect((await post('Stop', {}, { token: 'wrong' })).status, 'a wrong token').toBe(401);
      expect((await h.post({ sessionId: 's1', body: body('s1', 'Stop') })).status, 'no token').toBe(401);
      expect((await h.post({ sessionId: 'nobody', token, body: body('nobody', 'Stop') })).status, 'a session without a grant').toBe(401);
      const other = h.endpoint.grant('s2').token;
      expect((await h.post({ sessionId: 's1', token: other, body: body('s1', 'Stop') })).status, 'the token of another session').toBe(401);
      h.endpoint.revoke('s1');
      expect((await post('Stop')).status, 'a revoked token').toBe(401);
      expect(requests, 'no refused request reaches a listener').toEqual([]);
    });

    it('answers every 401 with the same body, which names neither the cause, the session nor the token', async () => {
      h.endpoint.grant('s2');
      const refused = [
        await post('Stop', {}, { token: 'wrong' }),
        await h.post({ sessionId: 's1', body: body('s1', 'Stop') }),
        await h.post({ sessionId: 'nobody', token, body: body('nobody', 'Stop') }),
        await h.post({ sessionId: 's1', token: h.endpoint.grant('s3').token, body: body('s1', 'Stop') }),
      ];
      h.endpoint.revoke('s1');
      refused.push(await post('Stop'));
      expect(refused.map((result) => result.status), 'each of them is refused').toEqual([401, 401, 401, 401, 401]);
      const bodies = refused.map((result) => result.body ?? '');
      expect(new Set(bodies).size, 'the body does not tell a wrong token from a missing grant or a revoked one').toBe(1);
      expect(bodies[0], 'the body holds no token').not.toContain(token);
      expect(bodies[0], 'the body holds no session id').not.toMatch(/nobody|s1|s2|s3/);
    });

    it('refuses an Origin, a foreign Host and bodies that are not a hook payload of the session', async () => {
      const requests = seen();
      expect((await post('Stop', {}, { origin: 'http://evil.example' })).status, 'an Origin header means a browser').toBe(403);
      expect((await post('Stop', {}, { host: 'evil.example:80' })).status, 'a foreign Host').toBe(403);
      expect((await h.post({ sessionId: 's1', token, body: 'not json' })).status, 'a body that is not JSON').toBe(400);
      expect((await h.post({ sessionId: 's1', token, body: '[1]' })).status, 'a body that is not an object').toBe(400);
      expect((await post('NotAnEvent')).status, 'an unknown event').toBe(400);
      expect((await post('SessionStart')).status, 'SessionStart stays a command hook').toBe(400);
      expect((await post('SessionEnd')).status, 'SessionEnd stays a command hook').toBe(400);
      expect((await h.post({ sessionId: 's1', token, body: body('s9', 'Stop') })).status, 'the session of the payload must be the token\'s').toBe(400);
      expect(requests, 'no refused request reaches a listener').toEqual([]);
    });

    it('accepts the Host that the grant names', async () => {
      const grant = h.endpoint.grant('s3', 'host.docker.internal:7000');
      expect((await h.post({ sessionId: 's3', token: grant.token, host: 'host.docker.internal:7000', body: body('s3', 'Stop') })).status, 'the grant host').toBe(200);
      expect((await h.post({ sessionId: 's3', token: grant.token, host: h.ownHost, body: body('s3', 'Stop') })).status, 'the own address').toBe(200);
    });

    it('answers 413 above the size limit and passes nothing on', async () => {
      const requests = seen();
      const big = body('s1', 'PostToolUse', { tool_response: 'x'.repeat(HOOK_BODY_MAX_BYTES) });
      expect((await h.post({ sessionId: 's1', token, body: big })).status, 'an oversized payload').toBe(413);
      expect(requests, 'it is not passed on').toEqual([]);
    });

    it('tells listeners the accepted requests in arrival order before any contributor replies', async () => {
      const order: string[] = [];
      h.endpoint.subscribe((request) => order.push(`seen:${request.event}`));
      h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => {
        order.push('contributor');
        return undefined;
      }));
      await post('PreToolUse', { tool_name: 'Bash' });
      await post('UserPromptSubmit', { prompt: 'hi' });
      await post('PostToolUse');
      expect(order, 'listeners see each request in order, and before the contributor').toEqual(['seen:PreToolUse', 'seen:UserPromptSubmit', 'contributor', 'seen:PostToolUse']);
    });

    it('gives listeners the session of the token, the payload and a signal', async () => {
      const requests = seen();
      await post('Notification', { notification_type: 'idle_prompt' });
      expect(requests[0]?.sessionId, 'the session comes from the token').toBe('s1');
      expect(requests[0]?.event, 'the event').toBe('Notification');
      expect(requests[0]?.payload['notification_type'], 'the payload is passed on').toBe('idle_prompt');
      expect(Number.isNaN(Date.parse(requests[0]?.receivedAt ?? '')), 'receivedAt is a time').toBe(false);
      expect(requests[0]?.signal.aborted, 'the signal is open while the request is open').toBe(false);
    });

    it('replies at once with no decision to events that nobody answers', async () => {
      h.endpoint.addContributor(contributor(['PermissionRequest'], () => new Promise<undefined>(() => undefined)));
      for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification', 'SubagentStart', 'SubagentStop']) {
        const result = await post(event);
        expect(result, `${event} gets an empty reply at once`).toEqual({ status: 200, reply: {} });
      }
    });

    it('joins the contexts that contributors give to UserPromptSubmit and leaves out one that is too slow', async () => {
      h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => ({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'one' } }), 'a'));
      h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => ({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'two' } }), 'b'));
      h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => new Promise<undefined>(() => undefined), 'slow'));
      h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => {
        throw new Error('broken contributor');
      }, 'broken'));
      const result = await post('UserPromptSubmit', { prompt: 'go' });
      const context = result.reply && 'hookSpecificOutput' in result.reply && result.reply.hookSpecificOutput.hookEventName === 'UserPromptSubmit' ? result.reply.hookSpecificOutput.additionalContext : '';
      expect(context, 'the contexts are joined').toContain('one');
      expect(context, 'both contexts are in the reply').toContain('two');
      expect(result.status, 'a slow or failing contributor does not fail the request').toBe(200);
    });

    it('replies with no decision to UserPromptSubmit when no contributor has context', async () => {
      h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => undefined));
      expect(await post('UserPromptSubmit'), 'nothing to add').toEqual({ status: 200, reply: {} });
    });

    it('holds a PermissionRequest for its contributor without delaying later requests', async () => {
      let release: (reply: HookReply) => void = () => undefined;
      h.endpoint.addContributor(contributor(['PermissionRequest'], () => new Promise<HookReply>((resolve) => (release = resolve))));
      const requests = seen();
      const held = post('PermissionRequest', { tool_name: 'Bash' });
      let heldDone = false;
      void held.then(() => (heldDone = true));
      await vi.waitFor(() => expect(requests.length, 'the held request reached the listeners').toBe(1));
      const later = await post('PostToolUse');
      expect(later, 'a later request is answered while the first is held').toEqual({ status: 200, reply: {} });
      expect(requests.map((request) => request.event), 'listeners saw both, in order').toEqual(['PermissionRequest', 'PostToolUse']);
      expect(heldDone, 'the held request is still open').toBe(false);
      release({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'no' } } });
      expect(await held, 'the held request gets the contributor\'s reply').toEqual({ status: 200, reply: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'no' } } } });
    });

    it('replies with the first non-empty reply of the PermissionRequest contributors and ignores the later ones', async () => {
      const allow: HookReply = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
      const deny: HookReply = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'late' } } };
      let releaseSlow: (reply: HookReply) => void = () => undefined;
      h.endpoint.addContributor(contributor(['PermissionRequest'], () => ({}), 'empty'));
      h.endpoint.addContributor(contributor(['PermissionRequest'], () => new Promise<HookReply>((resolve) => (releaseSlow = resolve)), 'slow'));
      h.endpoint.addContributor(contributor(['PermissionRequest'], () => allow, 'fast'));
      const result = await post('PermissionRequest', { tool_name: 'Bash' });
      releaseSlow(deny);
      expect(result, 'an empty reply is skipped, the first real reply wins over a slower one').toEqual({ status: 200, reply: allow });
    });

    it('replies with no decision to a PermissionRequest nobody holds', async () => {
      expect(await post('PermissionRequest', { tool_name: 'Bash' }), 'no contributor, no decision').toEqual({ status: 200, reply: {} });
      h.endpoint.addContributor(contributor(['PermissionRequest'], () => undefined));
      expect(await post('PermissionRequest', { tool_name: 'Bash' }), 'a contributor with no answer, no decision').toEqual({ status: 200, reply: {} });
    });

    it('aborts the request signal when the client gives up on a held request', async () => {
      const signals: AbortSignal[] = [];
      h.endpoint.addContributor(contributor(['PermissionRequest'], (request) => {
        signals.push(request.signal);
        return new Promise<undefined>(() => undefined);
      }));
      const client = new AbortController();
      const held = post('PermissionRequest', { tool_name: 'Bash' }, { signal: client.signal });
      await vi.waitFor(() => expect(signals.length, 'the contributor holds the request').toBe(1));
      expect(signals[0]?.aborted, 'open while the client waits').toBe(false);
      client.abort();
      void held.catch(() => undefined);
      await vi.waitFor(() => expect(signals[0]?.aborted, 'the CLI closing the request aborts its signal').toBe(true));
    });

    it('stops asking a contributor that was removed and one that is not for the event', async () => {
      let calls = 0;
      const off = h.endpoint.addContributor(contributor(['UserPromptSubmit'], () => {
        calls += 1;
        return undefined;
      }));
      await post('Stop');
      expect(calls, 'a contributor is asked for its events only').toBe(0);
      await post('UserPromptSubmit');
      off();
      await post('UserPromptSubmit');
      expect(calls, 'a removed contributor is not asked').toBe(1);
    });

    it('stops telling a listener that unsubscribed', async () => {
      let calls = 0;
      const off = h.endpoint.subscribe(() => (calls += 1));
      await post('Stop');
      off();
      await post('Stop');
      expect(calls, 'only the request before the unsubscribe').toBe(1);
    });
  });
}
