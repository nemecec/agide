import type { PlanWindowView } from '../../core/usage/types';

const WINDOW_NAMES: Readonly<Record<string, string>> = { five_hour: '5 h', seven_day: '7 d' };

/** The window the meter shows: the five-hour one, else the first the login reports. */
export const meterWindow = (plan: readonly PlanWindowView[]): PlanWindowView | undefined => plan.find((window) => window.window === 'five_hour') ?? plan[0];

/** "5 h 12%", or "5 h reset" once the window has reset and no newer reading came. */
export function meterText(window: PlanWindowView, now: number): string {
  const name = WINDOW_NAMES[window.window] ?? window.window;
  return Date.parse(window.resetsAt) <= now ? `${name} reset` : `${name} ${Math.round(window.usedPercentage)}%`;
}
