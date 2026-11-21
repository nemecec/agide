import { describe, expect, it } from 'vitest';
import type { PlanWindowView } from '../../core/usage/types';
import { meterText, meterWindow } from './meterModel';

const now = Date.parse('2026-11-21T10:00:00Z');
const window = (over: Partial<PlanWindowView>): PlanWindowView => ({ window: 'five_hour', usedPercentage: 12.4, resetsAt: '2026-11-21T12:00:00Z', observedAt: '2026-11-21T09:59:00Z', source: 'status-line', ...over });

describe('usage meter text', () => {
  it('shows the window name and the rounded percentage', () => {
    expect(meterText(window({}), now), 'five-hour window').toBe('5 h 12%');
    expect(meterText(window({ window: 'seven_day', usedPercentage: 30.6 }), now), 'seven-day window').toBe('7 d 31%');
  });

  it('says reset once the window has reset and no newer reading came', () => {
    expect(meterText(window({ resetsAt: '2026-11-21T09:00:00Z' }), now), 'passed reset').toBe('5 h reset');
  });

  it('prefers the five-hour window and falls back to the first one reported', () => {
    const seven = window({ window: 'seven_day' });
    const five = window({});
    expect(meterWindow([seven, five]), 'five-hour wins').toBe(five);
    expect(meterWindow([seven]), 'only the seven-day window').toBe(seven);
    expect(meterWindow([]), 'no windows').toBeUndefined();
  });
});
