import { describe, expect, it } from 'vitest';
import { occurrences, parseRRule, RRuleError } from './rrule';
import { formatWall, parseWall, utcToWall, wallToUtc } from './zoned';

const TZ = 'Europe/Tallinn';
const take = (start: string, rule: string | undefined, n: number, tz = TZ): string[] => {
  const out: string[] = [];
  for (const instant of occurrences(parseWall(start), tz, rule === undefined ? undefined : parseRRule(rule))) {
    out.push(new Date(instant).toISOString());
    if (out.length >= n) break;
  }
  return out;
};
const local = (iso: string, tz = TZ): string => formatWall(utcToWall(Date.parse(iso), tz));

describe('zone conversion', () => {
  it('converts wall time with the offset of the day', () => {
    expect(new Date(wallToUtc(parseWall('2026-01-15T09:00'), TZ)).toISOString(), 'winter +2').toBe('2026-01-15T07:00:00.000Z');
    expect(new Date(wallToUtc(parseWall('2026-07-15T09:00'), TZ)).toISOString(), 'summer +3').toBe('2026-07-15T06:00:00.000Z');
  });

  it('moves a time inside the spring gap to the first valid minute after it', () => {
    expect(local(new Date(wallToUtc(parseWall('2026-03-29T03:30'), TZ)).toISOString()), 'gap 03:00 to 04:00').toBe('2026-03-29T04:00');
  });

  it('takes the first occurrence of a time that repeats in autumn', () => {
    expect(new Date(wallToUtc(parseWall('2026-10-25T03:30'), TZ)).toISOString(), 'first 03:30 is at +3').toBe('2026-10-25T00:30:00.000Z');
  });

  it('rejects text that is not a local time', () => {
    expect(() => parseWall('2026-02-30T10:00'), 'impossible date').toThrow();
    expect(() => parseWall('tomorrow'), 'free text').toThrow();
  });
});

describe('RRULE parsing', () => {
  it.each([
    ['FREQ=HOURLY', 'unsupported frequency'],
    ['FREQ=DAILY;BYSETPOS=1', 'unsupported key'],
    ['FREQ=MONTHLY;BYDAY=1MO', 'ordinal weekday'],
    ['FREQ=DAILY;COUNT=2;UNTIL=20261231T000000Z', 'count with until'],
    ['FREQ=DAILY;UNTIL=20261231', 'until without UTC time'],
    ['FREQ=DAILY;BYHOUR=25', 'hour out of range'],
    ['FREQ=DAILY;INTERVAL=0', 'zero interval'],
    ['BYDAY=MO', 'missing FREQ'],
  ])('refuses %s (%s)', (rule) => {
    expect(() => parseRRule(rule), `"${rule}" is refused`).toThrow(RRuleError);
  });
});

describe('occurrences', () => {
  it('gives a one-off exactly once', () => {
    expect(take('2026-11-17T09:00', undefined, 5), 'one instant').toEqual(['2026-11-17T07:00:00.000Z']);
  });

  it('repeats daily at the same wall time across the autumn change', () => {
    const list = take('2026-10-23T09:00', 'FREQ=DAILY', 5);
    expect(list.map((iso) => local(iso)), 'always 09:00 local').toEqual(['2026-10-23T09:00', '2026-10-24T09:00', '2026-10-25T09:00', '2026-10-26T09:00', '2026-10-27T09:00']);
    expect(list[2], 'the change day is 25 hours long, offset +2 after').toBe('2026-10-25T07:00:00.000Z');
  });

  it('keeps a daily 09:00 rule at 09:00 across the spring change', () => {
    expect(take('2026-03-27T09:00', 'FREQ=DAILY', 4).map((iso) => local(iso)), 'wall time stays').toEqual(['2026-03-27T09:00', '2026-03-28T09:00', '2026-03-29T09:00', '2026-03-30T09:00']);
  });

  it('moves a daily 03:30 occurrence inside the spring gap and fires the autumn repeat once', () => {
    const spring = take('2026-03-28T03:30', 'FREQ=DAILY', 3).map((iso) => local(iso));
    expect(spring, 'spring change day at 04:00').toEqual(['2026-03-28T03:30', '2026-03-29T04:00', '2026-03-30T03:30']);
    const autumn = take('2026-10-24T03:30', 'FREQ=DAILY', 3);
    expect(autumn.map((iso) => iso), 'three distinct instants, one on the repeat day').toEqual(['2026-10-24T00:30:00.000Z', '2026-10-25T00:30:00.000Z', '2026-10-26T01:30:00.000Z']);
  });

  it('repeats weekly on the listed weekdays with an interval', () => {
    expect(take('2026-11-16T09:00', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR', 4).map((iso) => local(iso)), 'every other week').toEqual([
      '2026-11-16T09:00',
      '2026-11-20T09:00',
      '2026-11-30T09:00',
      '2026-12-04T09:00',
    ]);
  });

  it('defaults weekly to the weekday of the start', () => {
    expect(take('2026-11-18T09:00', 'FREQ=WEEKLY', 2).map((iso) => local(iso)), 'Wednesdays').toEqual(['2026-11-18T09:00', '2026-11-25T09:00']);
  });

  it('skips a month that lacks the day for BYMONTHDAY=31', () => {
    expect(take('2026-01-31T09:00', 'FREQ=MONTHLY;BYMONTHDAY=31', 5).map((iso) => local(iso).slice(0, 10)), 'only long months').toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-08-31',
    ]);
  });

  it('repeats yearly and skips February 29 in common years', () => {
    expect(take('2024-02-29T09:00', 'FREQ=YEARLY', 2).map((iso) => local(iso).slice(0, 10)), 'leap days only').toEqual(['2024-02-29', '2028-02-29']);
  });

  it('counts a moved occurrence towards COUNT', () => {
    expect(take('2026-03-28T03:30', 'FREQ=DAILY;COUNT=2', 10).map((iso) => local(iso)), 'two occurrences, the second moved').toEqual(['2026-03-28T03:30', '2026-03-29T04:00']);
  });

  it('includes an occurrence at UNTIL and nothing after', () => {
    expect(take('2026-11-17T09:00', 'FREQ=DAILY;UNTIL=20261119T070000Z', 10), 'last at the until instant').toEqual([
      '2026-11-17T07:00:00.000Z',
      '2026-11-18T07:00:00.000Z',
      '2026-11-19T07:00:00.000Z',
    ]);
  });

  it('expands BYHOUR and BYMINUTE', () => {
    expect(take('2026-11-17T09:00', 'FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0,30', 5).map((iso) => local(iso)), 'sorted within the day').toEqual([
      '2026-11-17T09:00',
      '2026-11-17T09:30',
      '2026-11-17T17:00',
      '2026-11-17T17:30',
      '2026-11-18T09:00',
    ]);
  });

  it('starts no earlier than the start time on the first day', () => {
    expect(take('2026-11-17T12:00', 'FREQ=DAILY;BYHOUR=9,15', 2).map((iso) => local(iso)), 'the 09:00 before the start is dropped').toEqual(['2026-11-17T15:00', '2026-11-18T09:00']);
  });
});
