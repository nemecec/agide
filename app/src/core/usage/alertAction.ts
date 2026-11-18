import type { RankedSubject } from './types';

export type AlertActionId = 'pause' | 'stop' | 'pause-top';

interface AlertSubject {
  readonly kind?: string;
  readonly sessionId?: string;
  readonly ref?: { readonly sessionId?: string };
}

/** The session of the highest ranked session subject, or undefined when no session is ranked. Agents of a session do not count. */
export function topSessionId(ranked: readonly RankedSubject[]): string | undefined {
  const top = ranked.find((entry) => entry.subject.kind === 'session');
  return top?.subject.kind === 'session' ? top.subject.sessionId : undefined;
}

/** The session an alert action runs on: the top session for `pause-top`, otherwise the session of the alert's subject or of its agent. */
export function alertActionSession(payload: unknown, action: AlertActionId, top: string | undefined): string | undefined {
  if (action === 'pause-top') return top;
  const subject = (payload as { subject?: AlertSubject } | undefined)?.subject;
  return subject?.sessionId ?? subject?.ref?.sessionId;
}
