import { wallToUtc, type Wall } from './zoned';

/**
 * The RFC 5545 subset of 0021 section 7: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY (weekdays without
 * ordinals), BYMONTHDAY (positive days), BYHOUR, BYMINUTE, COUNT and UNTIL (UTC). Occurrences are computed in wall
 * time in the zone. A wall time inside a clock gap moves to the first valid minute after it and still counts towards
 * COUNT; a wall time that occurs twice fires once. A date a month lacks gives no occurrence.
 */
export interface RuleSpec {
  readonly freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  readonly interval: number;
  /** 0 is Monday, 6 is Sunday. */
  readonly byDay?: readonly number[];
  readonly byMonthDay?: readonly number[];
  readonly byHour?: readonly number[];
  readonly byMinute?: readonly number[];
  readonly count?: number;
  /** Instant, inclusive. */
  readonly until?: number;
}

export class RRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RRuleError';
  }
}

/** Upper bound on occurrences per day, so one rule cannot make the scheduler's enumeration costly. */
export const MAX_PER_DAY = 48;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;

function numbers(value: string, key: string, min: number, max: number): number[] {
  const list = value.split(',').map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (list.length === 0 || list.some((n) => Number.isNaN(n) || n < min || n > max)) throw new RRuleError(`${key} must list numbers from ${min} to ${max}`);
  return [...new Set(list)].sort((a, b) => a - b);
}

export function parseRRule(text: string): RuleSpec {
  const fields = new Map<string, string>();
  for (const part of text.replace(/^RRULE:/, '').split(';')) {
    const [key, value, ...extra] = part.split('=');
    if (!key || value === undefined || extra.length > 0) throw new RRuleError(`cannot read "${part}"`);
    if (fields.has(key)) throw new RRuleError(`${key} appears twice`);
    fields.set(key, value);
  }
  const known = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYHOUR', 'BYMINUTE', 'COUNT', 'UNTIL'];
  for (const key of fields.keys()) if (!known.includes(key)) throw new RRuleError(`${key} is not supported`);
  const freq = FREQS.find((candidate) => candidate === fields.get('FREQ'));
  if (!freq) throw new RRuleError('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY');
  if (fields.has('COUNT') && fields.has('UNTIL')) throw new RRuleError('COUNT and UNTIL cannot be used together');
  let until: number | undefined;
  const untilText = fields.get('UNTIL');
  if (untilText !== undefined) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(untilText);
    if (!match) throw new RRuleError('UNTIL must be a UTC time like 20261231T235959Z');
    const [y, m, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
    until = Date.UTC(y, m - 1, d, h, mi, s);
  }
  const byDayText = fields.get('BYDAY');
  const byDay = byDayText?.split(',').map((day) => {
    const at = WEEKDAYS.indexOf(day);
    if (at < 0) throw new RRuleError(`BYDAY ${day} is not a weekday; ordinals are not supported`);
    return at;
  });
  const byHour = fields.has('BYHOUR') ? numbers(fields.get('BYHOUR') ?? '', 'BYHOUR', 0, 23) : undefined;
  const byMinute = fields.has('BYMINUTE') ? numbers(fields.get('BYMINUTE') ?? '', 'BYMINUTE', 0, 59) : undefined;
  const perDay = (byHour?.length ?? 1) * (byMinute?.length ?? 1);
  if (perDay > MAX_PER_DAY) throw new RRuleError(`BYHOUR and BYMINUTE give ${perDay} times a day; at most ${MAX_PER_DAY} are allowed`);
  const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]: V }));
  return {
    freq,
    interval: fields.has('INTERVAL') ? (numbers(fields.get('INTERVAL') ?? '', 'INTERVAL', 1, 1000)[0] ?? 1) : 1,
    ...optional('byDay', byDay && [...new Set(byDay)].sort((a, b) => a - b)),
    ...optional('byMonthDay', fields.has('BYMONTHDAY') ? numbers(fields.get('BYMONTHDAY') ?? '', 'BYMONTHDAY', 1, 31) : undefined),
    ...optional('byHour', byHour),
    ...optional('byMinute', byMinute),
    ...optional('count', fields.has('COUNT') ? (numbers(fields.get('COUNT') ?? '', 'COUNT', 1, 100000)[0] ?? 1) : undefined),
    ...optional('until', until),
  };
}

const DAY = 86_400_000;
const MAX_PERIODS = 20_000;
type Day = { y: number; m: number; d: number };
const dayMs = (day: Day): number => Date.UTC(day.y, day.m - 1, day.d);
const fromMs = (ms: number): Day => {
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};
const weekday = (day: Day): number => (new Date(dayMs(day)).getUTCDay() + 6) % 7;
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

function daysOfPeriod(rule: RuleSpec, start: Wall, k: number): Day[] {
  const step = k * rule.interval;
  const matchesDay = (day: Day): boolean => (rule.byDay === undefined || rule.byDay.includes(weekday(day))) && (rule.byMonthDay === undefined || rule.byMonthDay.includes(day.d));
  switch (rule.freq) {
    case 'DAILY': {
      const day = fromMs(dayMs(start) + step * DAY);
      return matchesDay(day) ? [day] : [];
    }
    case 'WEEKLY': {
      const first = dayMs(start) - weekday(start) * DAY + step * 7 * DAY;
      const days = rule.byDay ?? [weekday(start)];
      return days.map((offset) => fromMs(first + offset * DAY)).filter((day) => rule.byMonthDay === undefined || rule.byMonthDay.includes(day.d));
    }
    case 'MONTHLY':
    case 'YEARLY': {
      const monthIndex = rule.freq === 'MONTHLY' ? start.m - 1 + step : start.m - 1;
      const y = start.y + (rule.freq === 'MONTHLY' ? Math.floor(monthIndex / 12) : step);
      const m = ((monthIndex % 12) + 12) % 12 + 1;
      const length = daysInMonth(y, m);
      const candidates = rule.byMonthDay ?? (rule.byDay === undefined ? [start.d] : Array.from({ length }, (_, i) => i + 1));
      return candidates.filter((d) => d <= length).map((d) => ({ y, m, d })).filter((day) => rule.byDay === undefined || rule.byDay.includes(weekday(day)));
    }
  }
}

/** The first period worth enumerating when only instants at or after `from` matter. A rule with COUNT starts at 0. */
function firstPeriod(rule: RuleSpec, start: Wall, from: number | undefined): number {
  if (from === undefined || rule.count !== undefined) return 0;
  const at = fromMs(from);
  const startDay = dayMs(start);
  let periods: number;
  switch (rule.freq) {
    case 'DAILY':
      periods = (from - startDay) / DAY;
      break;
    case 'WEEKLY':
      periods = (from - (startDay - weekday(start) * DAY)) / (7 * DAY);
      break;
    case 'MONTHLY':
      periods = (at.y - start.y) * 12 + (at.m - start.m);
      break;
    case 'YEARLY':
      periods = at.y - start.y;
      break;
  }
  return Math.max(0, Math.floor(periods / rule.interval) - 2);
}

/**
 * Occurrence instants in ascending order, from `dtstart` (local wall time in `tzid`). Without a rule there is one.
 * The generator ends at COUNT, at UNTIL, or after a bounded number of periods without a result. With `from` and no
 * COUNT, periods that end well before `from` are skipped; instants before `from` can still appear.
 */
export function* occurrences(dtstart: Wall, tzid: string, rule?: RuleSpec, from?: number): Generator<number> {
  if (!rule) {
    yield wallToUtc(dtstart, tzid);
    return;
  }
  const hours = rule.byHour ?? [dtstart.h];
  const minutes = rule.byMinute ?? [dtstart.mi];
  const startKey = dayMs(dtstart) + (dtstart.h * 60 + dtstart.mi) * 60_000;
  let produced = 0;
  let last = Number.NEGATIVE_INFINITY;
  const first = firstPeriod(rule, dtstart, from);
  for (let k = first; k < first + MAX_PERIODS; k++) {
    const instants: number[] = [];
    for (const day of daysOfPeriod(rule, dtstart, k)) {
      for (const h of hours) {
        for (const mi of minutes) {
          if (dayMs(day) + (h * 60 + mi) * 60_000 < startKey) continue;
          instants.push(wallToUtc({ ...day, h, mi }, tzid));
        }
      }
    }
    for (const instant of [...new Set(instants)].sort((a, b) => a - b)) {
      if (instant <= last) continue;
      if (rule.until !== undefined && instant > rule.until) return;
      last = instant;
      yield instant;
      if (rule.count !== undefined && ++produced >= rule.count) return;
    }
  }
}
