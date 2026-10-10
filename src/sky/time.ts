/**
 * Time helpers for a specific IANA timezone, without extra dependencies.
 *
 * The Python reference (aksa/astro.py) formats every time in the observer's
 * timezone as "HH:MM". JavaScript Date is a bare UTC instant, so all
 * local-calendar math goes through Intl-based conversion helpers here.
 */

/** Offset (ms east of UTC) that `tz` has at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // Intl can yield hour "24" for midnight in some locales.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - date.getTime();
}

/** Build a UTC Date from local calendar fields in `tz`. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass handles DST edges where the offset differs a day apart.
  const off2 = tzOffsetMs(new Date(ts), tz);
  if (off2 !== tzOffsetMs(new Date(guess), tz)) ts = guess - off2;
  return new Date(ts);
}

/** Year/month/day tuple of `date` as seen in `tz`. */
export function localDateInTz(date: Date, tz: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return { y: map.year, m: map.month, d: map.day };
}

/** "HH:MM" for `date` in `tz` (24-hour). Mirrors astro.fmt_time. */
export function fmtTime(date: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  let s = dtf.format(date);
  if (s.startsWith('24:')) s = `00:${s.slice(3)}`; // en-GB yields "24:xx" at midnight
  return s;
}

/** "DD MMM" for `date` in `tz` (e.g. "12 Oct"). Mirrors astro.fmt_date. */
export function fmtDate(date: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
  });
  return dtf.format(date);
}

/** 1-based day of year for a calendar date (mirrors date.timetuple().tm_yday). */
export function dayOfYear(y: number, m: number, d: number): number {
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let doy = cum[m - 1] + d;
  if (isLeap && m > 2) doy += 1;
  return doy;
}

/** Minutes since local midnight for "HH:MM"; wraps small hours past 24 h. */
export function hhmmToMins(hhmm: string): number {
  const h = Math.floor(Number(hhmm.slice(0, 2)));
  const m = Math.floor(Number(hhmm.slice(3, 5)));
  const v = h * 60 + m;
  return h < 12 ? v + 24 * 60 : v; // a window crosses midnight
}

/** Python f"{value:g}"-style compact number (no trailing zeros). */
export function fmtG(value: number): string {
  if (!isFinite(value)) return String(value);
  const r = Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-4 && value !== 0)
    ? value.toExponential(6).replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e')
    : String(Number(value.toPrecision(6)));
  return r;
}

/** Python f"{value:,}" thousands-separated integer. */
export function fmtComma(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}