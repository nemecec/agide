import type { Caller } from '../commands/index';
import type { ReviewCaller } from './types';

/**
 * Reads a command caller as a review caller. A session whose reviewer run is running is a reviewer and nothing
 * else; every other session is a session, and the user is the user.
 */
export function reviewCallerOf(caller: Caller, runsAsReviewer: (sessionId: string) => boolean): ReviewCaller {
  if (caller.kind === 'ui') return { kind: 'ui' };
  return runsAsReviewer(caller.sessionId) ? { kind: 'reviewer', sessionId: caller.sessionId } : { kind: 'session', sessionId: caller.sessionId, folderId: caller.folderId };
}
