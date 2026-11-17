/** Wall-clock time in an IANA zone and its conversion to instants. Instants are milliseconds since the epoch. */
export interface Wall {
  readonly y: number;
  /** 1 to 12. */
  readonly m: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function formatFor(tzid: string): Intl.DateTimeFormat {
  let format = formats.get(tzid);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(tzid, format);
  }
  return format;
}

export function isValidZone(tzid: string): boolean {
  try {
    formatFor(tzid);
    return true;
  } catch {
    return false;
  }
}

/** Local time minus UTC at the instant, in milliseconds. */
export function offsetMs(tzid: string, utcMs: number): number {
  const parts = Object.fromEntries(formatFor(tzid).formatToParts(new Date(utcMs)).map((p) => [p.type, Number(p.value)])) as Record<string, number>;
  const local = Date.UTC(parts['year'] ?? 0, (parts['month'] ?? 1) - 1, parts['day'] ?? 1, parts['hour'] ?? 0, parts['minute'] ?? 0, parts['second'] ?? 0);
  return local - Math.floor(utcMs / 1000) * 1000;
}

export function utcToWall(utcMs: number, tzid: string): Wall {
  const local = new Date(utcMs + offsetMs(tzid, utcMs));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), h: local.getUTCHours(), mi: local.getUTCMinutes() };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * The instant of a wall time. A wall time that occurs twice (clocks go back) gives the first occurrence. One that
 * does not exist (clocks go forward) gives the first valid minute after the gap, so nothing is lost.
 */
export function wallToUtc(wall: Wall, tzid: string): number {
  const asUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi);
  const before = offsetMs(tzid, asUtc - DAY);
  const after = offsetMs(tzid, asUtc + DAY);
  const valid = [...new Set([before, after])].map((offset) => asUtc - offset).filter((instant) => offsetMs(tzid, instant) === asUtc - instant);
  if (valid.length > 0) return Math.min(...valid);
  let lo = asUtc - Math.max(before, after);
  let hi = asUtc - Math.min(before, after);
  const earlierOffset = offsetMs(tzid, lo);
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / MINUTE / 2) * MINUTE;
    if (offsetMs(tzid, mid) === earlierOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function parseWall(text: string): Wall {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error(`${text} is not a local time like 2026-11-17T09:00`);
  const [y, m, d, h, mi] = match.slice(1).map(Number) as [number, number, number, number, number];
  const check = new Date(Date.UTC(y, m - 1, d, h, mi));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) throw new Error(`${text} is not a valid local time`);
  return { y, m, d, h, mi };
}

export function formatWall(wall: Wall): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(wall.y).padStart(4, '0')}-${two(wall.m)}-${two(wall.d)}T${two(wall.h)}:${two(wall.mi)}`;
}
