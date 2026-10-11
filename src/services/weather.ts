/**
 * Cloud cover from Open-Meteo with an in-memory 3-hour cache.
 * Only a rounded coordinate goes out in the request; there is no API
 * key and no account. Nothing is written to disk: when the app closes
 * the cache is gone. Offline -> null ("cloud cover unknown").
 */

import { localDateInTz, zonedTimeToUtc } from '@/sky/time';

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 3 * 3600 * 1000;
const TIMEOUT_MS = 5000;

interface CacheEntry {
  fetchedAt: number;
  lat: number;
  lon: number;
  /** "YYYY-MM-DDTHH:MM" local ISO strings from Open-Meteo. */
  hourly: { time: string; cloud: number | null }[];
}

let _cache: CacheEntry | null = null;
/** After a failed fetch, skip the network for a while (offline users). */
const FAIL_BACKOFF_MS = 5 * 60 * 1000;
let _lastFailAt = 0;

export interface CloudData {
  hourly: { time: string; cloud: number | null }[];
  fetchedAt: number;
}

async function fetchCloud(lat: number, lon: number): Promise<CloudData | null> {
  const params = new URLSearchParams({
    latitude: String(Math.round(lat * 10) / 10), // coarse on purpose: ~11 km
    longitude: String(Math.round(lon * 10) / 10),
    hourly: 'cloud_cover',
    forecast_days: '7',
    timezone: 'auto',
  });
  // AbortSignal.timeout is not available in every Hermes build.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${API_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      hourly?: { time?: string[]; cloud_cover?: (number | null)[] };
    };
    const times = data.hourly?.time ?? [];
    const clouds = data.hourly?.cloud_cover ?? [];
    if (!times.length || !clouds.length) return null;
    return {
      fetchedAt: Date.now(),
      hourly: times.map((t, i) => ({ time: t, cloud: clouds[i] ?? null })),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function samePlace(cache: CacheEntry, lat: number, lon: number): boolean {
  return (
    cache.lat === Math.round(lat * 10) / 10 &&
    cache.lon === Math.round(lon * 10) / 10
  );
}

/** Hourly cloud cover for a location, cached in memory for 3 hours.
 * Returns null when nothing is available (fully offline). */
export async function getCloudCover(
  lat: number,
  lon: number,
  offline = false,
): Promise<CloudData | null> {
  if (!offline) {
    if (_cache && samePlace(_cache, lat, lon) && Date.now() - _cache.fetchedAt < TTL_MS) {
      return _cache;
    }
    if (Date.now() - _lastFailAt >= FAIL_BACKOFF_MS) {
      const fresh = await fetchCloud(lat, lon);
      if (fresh) {
        _cache = { ...fresh, lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 };
        _lastFailAt = 0;
        return _cache;
      }
      _lastFailAt = Date.now();
    }
  }
  // Offline path, or network failure: use any cached forecast for this place.
  if (_cache && samePlace(_cache, lat, lon)) return _cache;
  return null;
}

/** Test hook: clear the in-memory cache. */
export function clearWeatherCache(): void {
  _cache = null;
  _lastFailAt = 0;
}

/** Open-Meteo local ISO "YYYY-MM-DDTHH:MM" -> instant in tz.
 * Small hours (before noon) are pushed to the next morning, because a
 * dark window crosses midnight. Mirrors weather._parse_hhmm. */
function parseIsoLocal(iso: string, tz: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const base = zonedTimeToUtc(y, mo, d, h, mi, tz);
  return h < 12 ? new Date(base.getTime() + 24 * 3600 * 1000) : base;
}

/** Mean cloud cover (%) across the dark window, or null. */
export function averageCloudForWindow(
  cloudData: CloudData | null,
  d: { y: number; m: number; d: number },
  tz: string,
  start: string,
  end: string,
): number | null {
  if (!cloudData) return null;
  const sH = Number(start.slice(0, 2));
  const sM = Number(start.slice(3, 5));
  const eH = Number(end.slice(0, 2));
  const eM = Number(end.slice(3, 5));
  const s0 = zonedTimeToUtc(d.y, d.m, d.d, sH, sM, tz);
  const e0 = zonedTimeToUtc(d.y, d.m, d.d, eH, eM, tz);
  const s = sH < 12 ? new Date(s0.getTime() + 24 * 3600 * 1000) : s0;
  const e = eH < 12 ? new Date(e0.getTime() + 24 * 3600 * 1000) : e0;
  const effEnd = e <= s ? new Date(e.getTime() + 24 * 3600 * 1000) : e;

  const vals: number[] = [];
  for (const row of cloudData.hourly) {
    const t = parseIsoLocal(row.time, tz);
    if (!t) continue;
    if (s <= t && t <= effEnd && row.cloud !== null) {
      vals.push(row.cloud);
    }
  }
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Convenience: fetch + average for one dark window (used by tonightSummary). */
export async function cloudForDarkWindow(
  lat: number,
  lon: number,
  dark: { start: string; end: string },
  now: Date,
  tz: string,
  offline = false,
): Promise<number | null> {
  const data = await getCloudCover(lat, lon, offline);
  if (!data) return null;
  return averageCloudForWindow(data, localDateInTz(now, tz), tz, dark.start, dark.end);
}