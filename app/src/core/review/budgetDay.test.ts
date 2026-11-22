import { afterEach, describe, expect, it, vi } from 'vitest';
import { atEveryLocalMidnight, dailyLimitUsd, localDay, msToNextLocalMidnight } from './budgetDay';

describe('the review budget day', () => {
  it('names the local day with two-digit month and day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59)), 'a January day late in the evening').toBe('2026-01-05');
    expect(localDay(new Date(2026, 10, 21, 0, 0)), 'a November day at midnight').toBe('2026-11-21');
    expect(localDay(new Date(2026, 11, 31, 12, 0)), 'the last day of the year').toBe('2026-12-31');
  });

  it('counts the time to the next local midnight, also from midnight itself', () => {
    expect(msToNextLocalMidnight(new Date(2026, 10, 21, 23, 0, 0, 0)), 'an hour before').toBe(3_600_000);
    expect(msToNextLocalMidnight(new Date(2026, 10, 21, 0, 0, 0, 0)), 'from the start of a day').toBe(24 * 3_600_000);
    expect(msToNextLocalMidnight(new Date(2026, 10, 21, 23, 59, 59, 999)), 'a millisecond before').toBe(1);
  });

  it('lowers the profile limit with the policy limit and never raises it', () => {
    expect(dailyLimitUsd(10, 4), 'the policy is lower').toBe(4);
    expect(dailyLimitUsd(10, 40), 'the policy is higher').toBe(10);
    expect(dailyLimitUsd(10, undefined), 'the policy says nothing').toBe(10);
    expect(dailyLimitUsd(0, 5), 'a profile that allows nothing').toBe(0);
  });
});

describe('the midnight timer', () => {
  afterEach(() => vi.useRealTimers());

  it('fires a second after each local midnight, again the next day, and not after it is stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 21, 23, 0, 0, 0));
    const fired: number[] = [];
    const stop = atEveryLocalMidnight(() => fired.push(Date.now()));
    vi.advanceTimersByTime(3_600_000);
    expect(fired, 'not yet at midnight itself').toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(fired.map((at) => new Date(at).getHours() * 3600 + new Date(at).getSeconds()), 'one second after midnight').toEqual([1]);
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(fired.length, 'a second firing a day later').toBe(2);
    stop();
    vi.advanceTimersByTime(48 * 3_600_000);
    expect(fired.length, 'nothing after stop').toBe(2);
  });

  it('can be stopped at once', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    atEveryLocalMidnight(fired, () => new Date(2026, 10, 21, 12, 0, 0, 0))();
    vi.advanceTimersByTime(48 * 3_600_000);
    expect(fired, 'never fired').not.toHaveBeenCalled();
  });
});
