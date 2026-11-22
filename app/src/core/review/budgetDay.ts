/** The local calendar day as `YYYY-MM-DD`, the key of the day's review spend. */
export const localDay = (at: Date): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

/** Milliseconds from `now` to the next local midnight, when a new day's allowance starts. */
export function msToNextLocalMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/** The day's limit of a swarm: the profile's, lowered by the swarm's policy and never raised by it. */
export const dailyLimitUsd = (profileUsd: number, policyUsd: number | undefined): number => Math.min(profileUsd, policyUsd ?? Number.POSITIVE_INFINITY);

/** Calls `onMidnight` a second after every local midnight until the returned function is called. */
export function atEveryLocalMidnight(onMidnight: () => void, now: () => Date = () => new Date()): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    timer = setTimeout(() => {
      onMidnight();
      arm();
    }, msToNextLocalMidnight(now()) + 1_000);
    timer.unref();
  };
  arm();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}
