/**
 * Location service (memory only). On every launch: request permission
 * (the OS remembers the grant; we store nothing) and read one GPS fix.
 * The timezone comes from the device. If GPS is denied, the caller shows
 * a city picker over the bundled cities.json and the label comes from
 * the nearest bundled city (haversine), so no geocoding API is needed.
 */

import * as Location from 'expo-location';
import { CITIES } from '@/sky/data';
import type { CityEntry } from '@/sky/data';
import type { LocInfo } from '@/state/session';

const EARTH_RADIUS_KM = 6371.0;

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Nearest bundled city to a coordinate (offline labeling). */
export function nearestCity(lat: number, lon: number): { name: string; city: CityEntry; distanceKm: number } {
  let bestName = '';
  let bestCity: CityEntry | null = null;
  let bestDist = Infinity;
  for (const [name, c] of Object.entries(CITIES)) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) {
      bestName = name;
      bestCity = c;
      bestDist = d;
    }
  }
  return { name: bestName, city: bestCity!, distanceKm: bestDist };
}

export function findCity(name: string): { name: string; city: CityEntry } | null {
  const lowered = name.trim().toLowerCase();
  for (const [key, c] of Object.entries(CITIES)) {
    if (key.toLowerCase() === lowered) return { name: key, city: c };
  }
  // prefix / contains match over bundled cities
  for (const [key, c] of Object.entries(CITIES)) {
    if (key.toLowerCase().includes(lowered)) return { name: key, city: c };
  }
  return null;
}

export function cityNames(): string[] {
  return Object.keys(CITIES).sort();
}

export interface GpsResult {
  ok: boolean;
  loc?: LocInfo;
  error?: string;
}

/** A sky computed for a fix a few km off is identical to the eye. */
const LAST_KNOWN_MAX_AGE_MS = 30 * 60 * 1000;
/** Cold GPS on budget phones can need 10s+ for its first lock. */
const FRESH_FIX_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * One fix per launch; never persisted. Uses the OS's cached position when
 * it is recent (instant), otherwise a fresh low-power fix capped at a few
 * seconds so the first screen never hangs indoors.
 */
export async function getGpsLocation(): Promise<GpsResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { ok: false, error: 'location permission denied' };
    }
    const pos =
      (await withTimeout(
        Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }),
        1500,
      )) ??
      (await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        FRESH_FIX_TIMEOUT_MS,
      ));
    if (!pos) {
      return { ok: false, error: 'location fix timed out' };
    }
    const lat = Math.round(pos.coords.latitude * 10000) / 10000;
    const lon = Math.round(pos.coords.longitude * 10000) / 10000;
    const nearest = nearestCity(lat, lon);
    // Always label with a city name - raw coordinates mean nothing to a
    // stargazer. When the fix is far from the nearest bundled city, say so.
    const label =
      nearest.distanceKm <= 40
        ? nearest.name
        : `${nearest.name} (${Math.round(nearest.distanceKm)} km away)`;
    return {
      ok: true,
      loc: { lat, lon, tz: deviceTimezone(), label, source: 'gps' },
    };
  } catch (exc) {
    return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

/** Location from a bundled city pick (GPS denied path). */
export function cityLocation(cityName: string): LocInfo | null {
  const found = findCity(cityName);
  if (!found) return null;
  return {
    lat: found.city.lat,
    lon: found.city.lon,
    tz: found.city.tz,
    label: found.name,
    source: 'city',
  };
}

export interface IpResult {
  ok: boolean;
  loc?: LocInfo;
  error?: string;
}

/**
 * Location + timezone from the device's public IP (ipapi.co, free, no
 * key). Used as the automatic fallback when GPS is denied: it returns
 * the country's correct IANA timezone so the sky math uses the right
 * clock even without a GPS fix. Memory only - nothing persisted.
 */
export async function getIpLocation(): Promise<IpResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let json: {
      latitude?: number;
      longitude?: number;
      city?: string;
      timezone?: string;
      country_name?: string;
      error?: boolean;
      reason?: string;
    };
    try {
      const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
      json = (await res.json()) as typeof json;
      if (!res.ok) {
        return { ok: false, error: `ip lookup HTTP ${res.status}` };
      }
    } finally {
      clearTimeout(timer);
    }
    if (json.error || typeof json.latitude !== 'number' || typeof json.longitude !== 'number' || !json.timezone) {
      return { ok: false, error: json.reason ?? 'incomplete ip response' };
    }
    const lat = Math.round(json.latitude * 10000) / 10000;
    const lon = Math.round(json.longitude * 10000) / 10000;
    const nearest = nearestCity(lat, lon);
    const label =
      json.city ?? (json.country_name ? `${nearest.name} (${json.country_name})` : nearest.name);
    return {
      ok: true,
      loc: { lat, lon, tz: json.timezone, label, source: 'ip' },
    };
  } catch (exc) {
    return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}