/**
 * Time-zone helpers built on Intl only (no external dependencies).
 * All timestamps are stored in UTC; schedules are expressed in local wall time.
 */

/** Offset in minutes of `tz` at instant `date` (e.g. Asia/Colombo => 330). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Local wall time (HH:mm) of an instant in a time zone. */
export function localTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** Convert a local date + wall time in a time zone to a UTC Date. */
export function zonedToUtc(dateYmd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - offset * 60000);
  // Re-check across DST boundaries.
  const offset2 = tzOffsetMinutes(result, tz);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60000);
}

/** ISO weekday 1 (Mon) .. 7 (Sun) for a YYYY-MM-DD date. */
export function isoWeekday(dateYmd: string): number {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Iterate YYYY-MM-DD dates from start to end inclusive. */
export function eachDate(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const [y1, m1, d1] = startYmd.split('-').map(Number);
  const [y2, m2, d2] = endYmd.split('-').map(Number);
  let t = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}
