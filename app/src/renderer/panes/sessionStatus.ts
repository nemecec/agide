import type { StatusKind } from '../ui/icons';

/** The chip status of a session state: one that is starting or loading reads as busy, a missing one as exited, an unknown one as idle. */
export function sessionStatusKind(status: string): StatusKind {
  switch (status) {
    case 'starting':
    case 'loading':
    case 'busy':
      return 'busy';
    case 'closed':
    case 'exited':
      return 'exited';
    case 'waiting':
      return 'waiting';
    default:
      return 'idle';
  }
}
