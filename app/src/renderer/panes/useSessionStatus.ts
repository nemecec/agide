import { useEffect, useState } from 'react';
import type { SessionInfo, SessionStatus } from '../../core/session/types';
import { api } from '../api';

/** The status of one session: listed once, then kept current by status events. Undefined for no session or an unknown one. */
export function useSessionStatus(sessionId: string | undefined): SessionStatus | undefined {
  const [status, setStatus] = useState<SessionStatus | undefined>(undefined);
  useEffect(() => {
    setStatus(undefined);
    if (sessionId === undefined) return;
    let live = true;
    void api()
      .invoke<SessionInfo[]>('session_list', {})
      .then((result) => live && result.ok && setStatus(result.value.find((candidate) => candidate.id === sessionId)?.status));
    const stop = api().subscribe((event) => {
      if (event.type === 'session.status_changed' && event.session.id === sessionId) setStatus(event.session.status);
      else if (event.type === 'session.closed' && event.sessionId === sessionId) setStatus(undefined);
    });
    return () => {
      live = false;
      stop();
    };
  }, [sessionId]);
  return status;
}
