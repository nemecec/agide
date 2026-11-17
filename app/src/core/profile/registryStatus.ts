import { REGISTRY_STALE_MS, type ProfileStatus, type RegistryEntry } from './types';

export interface Liveness {
  readonly now: () => Date;
  /** `process.kill(pid, 0)` in the real registry. */
  readonly isAlive: (pid: number) => boolean;
}

export const processLiveness: Liveness = {
  now: () => new Date(),
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the pid exists under another user.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
};

/** The status a reader shows for one valid entry. */
export function statusOf(entry: RegistryEntry, liveness: Liveness): ProfileStatus {
  const age = liveness.now().getTime() - Date.parse(entry.updatedAt);
  const running = age < REGISTRY_STALE_MS && liveness.isAlive(entry.pid);
  return { profileId: entry.profileId, running, ...(entry.unread === undefined ? {} : { unread: entry.unread }) };
}
