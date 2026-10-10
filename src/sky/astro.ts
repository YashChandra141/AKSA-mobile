/**
 * Sky calculations with astronomy-engine (replaces Skyfield from the
 * Python reference). All positions are computed on-device.
 *
 * Conventions verified against astronomy-engine 2.1.19:
 * - `Horizon()` takes OF-DATE equatorial coordinates (from `Equator(body,
 *   t, obs, ofdate=true, aberration=true)`) and returns azimuth measured
 *   clockwise from north, altitude in degrees.
 * - `Rotation_EQJ_HOR(t, obs)` precesses J2000 (EQJ) vectors to the
 *   horizontal frame; after rotation, az = atan2(y, x) normalized to
 *   [0, 360), alt = asin(z). (Matches `HorizonFromVector` exactly.)
 * - No refraction is applied anywhere, matching Skyfield's
 *   `.apparent().altaz()` in the Python reference (airless topocentric).
 * - `Illumination(body, t)` provides magnitude (Mallama & Hilton 2018,
 *   standing in for Skyfield's planetary_magnitude), illuminated
 *   fraction and geocentric distance in AU.
 */

import * as A from 'astronomy-engine';
import { ASTERISMS, CONSTELLATIONS, SHOWERS, STARS } from './data';
import type { CatalogMatch } from './types';
import type {
  DarkWindow,
  MeteorShower,
  MoonInfo,
  Position,
  RiseSetTransit,
  SkyContext,
  VisiblePlanet,
} from './types';
import { fmtDate, fmtTime, hhmmToMins, localDateInTz, zonedTimeToUtc } from './time';
import type { LocalDate } from './facts';

export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'] as const;
export type PlanetName = (typeof PLANETS)[number];

const KM_PER_AU = A.KM_PER_AU;

// ------------------------------------------------------------- targets

/** Anything the engine can point at: a fixed RA/Dec or a moving body. */
export type SkyTarget =
  | { kind: 'fixed'; raHours: number; decDeg: number }
  | { kind: 'body'; body: A.Body };

export function makeObserver(lat: number, lon: number): A.Observer {
  return new A.Observer(lat, lon, 0);
}

const bodyByName: Record<string, A.Body> = {
  Mercury: A.Body.Mercury,
  Venus: A.Body.Venus,
  Mars: A.Body.Mars,
  Jupiter: A.Body.Jupiter,
  Saturn: A.Body.Saturn,
  Uranus: A.Body.Uranus,
  Neptune: A.Body.Neptune,
  Moon: A.Body.Moon,
  Sun: A.Body.Sun,
};

export function planetBody(name: string): A.Body {
  const b = bodyByName[name];
  if (b === undefined) throw new Error(`unknown body ${name}`);
  return b;
}

// ---------------------------------------------------------------- geometry

/** Compass word for an azimuth in degrees (16-point rose). */
export function compassWord(azDeg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.floor((((azDeg % 360) + 360) % 360 + 11.25) / 22.5) % 16];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function positionFromAltAz(altDeg: number, azDeg: number): Position {
  const az = ((azDeg % 360) + 360) % 360;
  return {
    alt: round1(altDeg),
    az: round1(az),
    compass: compassWord(az),
    fists: round1(Math.round(altDeg / 10.0 * 2) / 2),
    above_horizon: altDeg > 0.0,
  };
}

/** Unit vector (EQJ) from J2000 RA hours / Dec degrees. */
export function unitVector(raHours: number, decDeg: number): [number, number, number] {
  const raRad = ((raHours * 15) * Math.PI) / 180;
  const decRad = (decDeg * Math.PI) / 180;
  const cd = Math.cos(decRad);
  return [cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad)];
}

/**
 * Apply a precomputed EQJ->HOR rotation to a unit vector.
 *
 * In the HOR frame x=north, y=west, z=zenith. SphereFromVector's raw
 * atan2(y, x) is measured counter-clockwise from north, so the clockwise
 * azimuth needs the 360-x flip (the same toggle astronomy-engine applies
 * inside HorizonFromVector).
 */
export function applyEqjToHor(
  m: A.RotationMatrix,
  uv: readonly [number, number, number],
): { alt: number; az: number } {
  const r = m.rot;
  const x = r[0][0] * uv[0] + r[1][0] * uv[1] + r[2][0] * uv[2];
  const y = r[0][1] * uv[0] + r[1][1] * uv[1] + r[2][1] * uv[2];
  const z = r[0][2] * uv[0] + r[1][2] * uv[1] + r[2][2] * uv[2];
  const norm = Math.sqrt(x * x + y * y + z * z) || 1.0;
  const alt = (Math.asin(Math.max(-1, Math.min(1, z / norm))) * 180) / Math.PI;
  let az = (Math.atan2(y, x) * 180) / Math.PI;
  az = (360 - ((az % 360) + 360) % 360) % 360; // clockwise from north
  return { alt, az };
}

/** Altitude/azimuth of a target at time t from a location. */
export function position(target: SkyTarget, t: Date, observer: A.Observer): Position {
  const { alt, az } = altAz(target, t, observer);
  return positionFromAltAz(alt, az);
}

/** Raw alt/az degrees for a target (no rounding, no compass text). */
export function altAz(
  target: SkyTarget,
  t: Date,
  observer: A.Observer,
): { alt: number; az: number } {
  if (target.kind === 'fixed') {
    const rot = A.Rotation_EQJ_HOR(t, observer);
    return applyEqjToHor(rot, unitVector(target.raHours, target.decDeg));
  }
  const eq = A.Equator(target.body, t, observer, true, true);
  const hor = A.Horizon(t, observer, eq.ra, eq.dec, undefined);
  return { alt: hor.altitude, az: hor.azimuth };
}

/** Fast altitude-only series for one target (used by riseSetTransit). */
function altSeries(target: SkyTarget, times: Date[], observer: A.Observer): number[] {
  if (target.kind === 'body') {
    return times.map((t) => {
      const eq = A.Equator(target.body, t, observer, true, true);
      return A.Horizon(t, observer, eq.ra, eq.dec, undefined).altitude;
    });
  }
  const uv = unitVector(target.raHours, target.decDeg);
  const out: number[] = [];
  for (const t of times) {
    const rot = A.Rotation_EQJ_HOR(t, observer);
    out.push(applyEqjToHor(rot, uv).alt);
  }
  return out;
}

/** Build a SkyTarget from a catalog match dict (catalog.resolve output). */
export function objectTarget(match: CatalogMatch): SkyTarget {
  const kind = match.kind;
  const data = recordOf(match.data);
  if (kind === 'star' || kind === 'messier' || kind === 'constellation') {
    return {
      kind: 'fixed',
      raHours: data.ra_hours as number,
      decDeg: data.dec_degrees as number,
    };
  }
  if (kind === 'asterism') {
    const { ra, dec } = asterismCenter(match.name);
    return { kind: 'fixed', raHours: ra, decDeg: dec };
  }
  if (kind === 'planet') return { kind: 'body', body: planetBody(data.name as string) };
  if (kind === 'moon') return { kind: 'body', body: A.Body.Moon };
  throw new Error(`cannot build a target for kind '${kind}'`);
}

function recordOf(data: unknown): Record<string, unknown> {
  return data as Record<string, unknown>;
}

/** Center of an asterism = mean unit vector of member stars. */
export function asterismCenter(name: string): { ra: number; dec: number } {
  const starsByName = new Map(STARS.map((s) => [s.name ?? '', s]));
  const members = ASTERISMS[name]?.members ?? [];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const m of members) {
    const st = starsByName.get(m);
    if (!st) continue;
    const ra = (st.ra_hours * 15.0 * Math.PI) / 180;
    const dec = (st.dec_degrees * Math.PI) / 180;
    x += Math.cos(dec) * Math.cos(ra);
    y += Math.cos(dec) * Math.sin(ra);
    z += Math.sin(dec);
  }
  const n = members.length || 1;
  x /= n;
  y /= n;
  z /= n;
  const norm = Math.sqrt(x * x + y * y + z * z) || 1.0;
  const dec = (Math.asin(Math.max(-1.0, Math.min(1.0, z / norm))) * 180) / Math.PI;
  let raDeg = (Math.atan2(y, x) * 180) / Math.PI;
  raDeg = ((raDeg % 360) + 360) % 360;
  return { ra: raDeg / 15.0, dec };
}

// ------------------------------------------------------------- local time

/** The "tonight" anchor: local calendar noon of ctx.now in ctx.tz. */
export function todayNoon(ctx: SkyContext): Date {
  const { y, m, d } = localDateInTz(ctx.now, ctx.tz);
  return zonedTimeToUtc(y, m, d, 12, 0, ctx.tz);
}

export function todayDate(ctx: SkyContext): LocalDate {
  return localDateInTz(ctx.now, ctx.tz);
}

function sunAlt(body: A.Body, t: Date, observer: A.Observer): number {
  const eq = A.Equator(body, t, observer, true, true);
  return A.Horizon(t, observer, eq.ra, eq.dec, undefined).altitude;
}

export type DayPhase = {
  phase: 'day' | 'twilight' | 'night';
  /** Sun's apparent altitude in degrees at ctx.now (positive = above horizon). */
  sunAlt: number;
};

/**
 * Day vs night at the exact current instant, from the Sun's altitude:
 * above -6 deg = day, -6 to -18 = twilight, below -18 = astronomical
 * darkness. Everything else in the app is sampled from ctx.now too, so
 * the verdict/dark window always reflect whether it is day or night.
 */
export function dayPhase(ctx: SkyContext): DayPhase {
  const observer = makeObserver(ctx.lat, ctx.lon);
  const alt = sunAlt(A.Body.Sun, ctx.now, observer);
  const phase: DayPhase['phase'] = alt > -6 ? 'day' : alt > -18 ? 'twilight' : 'night';
  return { phase, sunAlt: Math.round(alt * 10) / 10 };
}

// --------------------------------------------------------------- dark window

/**
 * Tonight's darkness interval (local HH:MM) and its length in hours.
 * Prefers full astronomical darkness (Sun below -18 deg); falls back to
 * astronomical twilight (-12 deg) in bright seasons; returns null when
 * the sky never darkens.
 */
export function darkWindow(ctx: SkyContext): DarkWindow | null {
  const observer = makeObserver(ctx.lat, ctx.lon);
  const t0 = todayNoon(ctx);
  const t1 = new Date(t0.getTime() + 24 * 3600 * 1000);

  for (const wanted of [-18, -12]) {
    let dusk: Date | null = null;
    let dawn: Date | null = null;

    if (sunAlt(A.Body.Sun, t0, observer) < wanted) {
      dusk = t0; // already dark at local noon (polar winter)
    } else {
      const d = A.SearchAltitude(A.Body.Sun, observer, -1, t0, 1, wanted);
      if (d && d.date <= t1) dusk = d.date;
    }

    const r = A.SearchAltitude(A.Body.Sun, observer, +1, t0, 1, wanted);
    if (r && r.date <= t1) {
      dawn = r.date;
    } else if (sunAlt(A.Body.Sun, t1, observer) < wanted) {
      dawn = t1; // dark through the whole window
    }

    if (!dusk || !dawn || dawn <= dusk) continue;
    const hours = (dawn.getTime() - dusk.getTime()) / 3600000.0;
    const kind: DarkWindow['kind'] = wanted === -18 ? 'dark' : 'astronomical twilight';
    return {
      start: fmtTime(dusk, ctx.tz),
      end: fmtTime(dawn, ctx.tz),
      hours: Math.round(hours * 10) / 10,
      kind,
    };
  }
  return null;
}

// ----------------------------------------------------------------- the Moon

const _PHASE_NAMES: [number, number, string][] = [
  [337.5, 22.5, 'New Moon'],
  [22.5, 67.5, 'Waxing Crescent'],
  [67.5, 112.5, 'First Quarter'],
  [112.5, 157.5, 'Waxing Gibbous'],
  [157.5, 202.5, 'Full Moon'],
  [202.5, 247.5, 'Waning Gibbous'],
  [247.5, 292.5, 'Last Quarter'],
  [292.5, 337.5, 'Waning Crescent'],
];

/** Percent illuminated at a given time (0-100). */
export function moonPercentLit(t: Date): number {
  return Math.round(A.Illumination(A.Body.Moon, t).phase_fraction * 100);
}

export function moonPhaseName(phaseDeg: number): string {
  const a = ((phaseDeg % 360) + 360) % 360;
  for (const [lo, hi, name] of _PHASE_NAMES) {
    if (lo > hi) {
      // New Moon wraps around 0/360
      if (a >= lo || a < hi) return name;
    } else if (lo <= a && a < hi) {
      return name;
    }
  }
  return 'New Moon';
}

/** Moon phase, illumination, rise/set, distance and next full/new. */
export function moonInfo(ctx: SkyContext, t?: Date): MoonInfo {
  const time = t ?? ctx.now;
  const observer = makeObserver(ctx.lat, ctx.lon);
  const frac = A.Illumination(A.Body.Moon, time).phase_fraction;
  const phaseDeg = A.MoonPhase(time);

  const t0 = todayNoon(ctx);
  const riseHit = A.SearchRiseSet(A.Body.Moon, observer, +1, t0, 1);
  const setHit = A.SearchRiseSet(A.Body.Moon, observer, -1, t0, 1);
  const rise = riseHit ? fmtTime(riseHit.date, ctx.tz) : null;
  const set_ = setHit ? fmtTime(setHit.date, ctx.tz) : null;

  const distKm = Math.round(A.Illumination(A.Body.Moon, time).geo_dist * KM_PER_AU);

  // Next full (quarter 2) and new (quarter 0) within ~35 days.
  let nextFull: string | null = null;
  let nextNew: string | null = null;
  try {
    let q = A.SearchMoonQuarter(time);
    for (let i = 0; i < 8 && (!nextFull || !nextNew); i++) {
      if (q.quarter === 2 && !nextFull) nextFull = fmtDate(q.time.date, ctx.tz);
      if (q.quarter === 0 && !nextNew) nextNew = fmtDate(q.time.date, ctx.tz);
      q = A.NextMoonQuarter(q);
    }
  } catch {
    // keep nulls
  }

  return {
    phase_name: moonPhaseName(phaseDeg),
    percent_lit: Math.round(frac * 100),
    waxing: phaseDeg < 180.0,
    rise,
    set: set_,
    distance_km: distKm,
    next_full: nextFull,
    next_new: nextNew,
  };
}

// ------------------------------------------------------- rise / set / transit

/**
 * Rise, set and highest-point times for any fixed or moving target.
 * Generic 10-minute sampler port (unchanged from the Python reference):
 * it works for stars, deep-sky objects, planets and the Moon alike.
 */
export function riseSetTransit(
  target: SkyTarget,
  ctx: SkyContext,
  stepMinutes = 10,
): RiseSetTransit {
  const observer = makeObserver(ctx.lat, ctx.lon);
  const t0 = todayNoon(ctx);
  const t1 = new Date(t0.getTime() + 24 * 3600 * 1000);
  const n = Math.floor((24 * 60) / stepMinutes) + 1;
  const span = t1.getTime() - t0.getTime();
  const times: Date[] = [];
  for (let i = 0; i < n; i++) {
    times.push(new Date(t0.getTime() + (span * i) / (n - 1)));
  }
  const alt = altSeries(target, times, observer);

  let hiI = 0;
  for (let i = 1; i < n; i++) if (alt[i] > alt[hiI]) hiI = i;

  const interp = (i: number, j: number): Date => {
    const a0 = alt[i];
    const a1 = alt[j];
    if (a1 === a0) return times[j];
    const frac = (0.0 - a0) / (a1 - a0);
    return new Date(times[i].getTime() + (times[j].getTime() - times[i].getTime()) * frac);
  };

  let rise: Date | null = null;
  let settle: Date | null = null;
  for (let i = 0; i < n - 1; i++) {
    if (alt[i] < 0 && alt[i + 1] >= 0) {
      if (!rise) rise = interp(i, i + 1);
    } else if (alt[i] >= 0 && alt[i + 1] < 0) {
      if (!settle) settle = interp(i, i + 1);
    }
  }

  const result: RiseSetTransit = {
    highest_time: fmtTime(times[hiI], ctx.tz),
    highest_alt: round1(alt[hiI]),
    rise: null,
    set: null,
    circumpolar: false,
    never_rises: false,
  };
  const minAlt = Math.min(...alt);
  const maxAlt = Math.max(...alt);
  if (minAlt > 0) {
    result.circumpolar = true;
  } else if (maxAlt < 0) {
    result.never_rises = true;
  } else {
    result.rise = rise ? fmtTime(rise, ctx.tz) : null;
    result.set = settle ? fmtTime(settle, ctx.tz) : null;
  }
  return result;
}

// ------------------------------------------------------------------- planets

export function lightMinutes(km: number): number {
  return km / 299792.458 / 60.0;
}

/** Apparent magnitude of a planet (Mallama & Hilton 2018 via Illumination). */
export function planetMag(name: string, t: Date): number {
  const mag = A.Illumination(planetBody(name), t).mag;
  return isFinite(mag) ? Math.round(mag * 10) / 10 : 1.0;
}

/** Geocentric distance in km (rounded). */
export function planetDistanceKm(name: string, t: Date): number {
  return Math.round(A.Illumination(planetBody(name), t).geo_dist * KM_PER_AU);
}

/** Classical planets above 10 deg during tonight's darkness. */
export function visiblePlanets(
  ctx: SkyContext,
  dark?: DarkWindow | null,
): VisiblePlanet[] {
  const observer = makeObserver(ctx.lat, ctx.lon);
  const t0 = todayNoon(ctx);
  let start = t0.getTime();
  let end = t0.getTime() + 24 * 3600 * 1000;
  if (dark) {
    // Sample only within the dark window when it's available.
    const sMins = hhmmToMins(dark.start) - 12 * 60;
    const eMins = hhmmToMins(dark.end) - 12 * 60;
    start = t0.getTime() + sMins * 60 * 1000;
    end = t0.getTime() + eMins * 60 * 1000;
    if (end <= start) end += 24 * 3600 * 1000;
  }
  const spanMs = end - start;
  const n = Math.max(Math.floor(spanMs / (15 * 60 * 1000)) + 1, 3);
  const times: Date[] = [];
  for (let i = 0; i < n; i++) {
    times.push(new Date(start + (spanMs * i) / (n - 1)));
  }

  const out: VisiblePlanet[] = [];
  for (const name of PLANETS) {
    const body = planetBody(name);
    const alts: number[] = [];
    const azs: number[] = [];
    for (const t of times) {
      const eq = A.Equator(body, t, observer, true, true);
      const hor = A.Horizon(t, observer, eq.ra, eq.dec, undefined);
      alts.push(hor.altitude);
      azs.push(hor.azimuth);
    }
    let bestI = 0;
    for (let i = 1; i < n; i++) if (alts[i] > alts[bestI]) bestI = i;
    if (alts[bestI] <= 10.0) continue;
    const tBest = times[bestI];
    const azBest = azs[bestI];
    const km = planetDistanceKm(name, tBest);
    const visIdx: number[] = [];
    for (let i = 0; i < n; i++) if (alts[i] > 10.0) visIdx.push(i);
    const eqBest = A.Equator(body, tBest, observer, false, true); // J2000 for Constellation()
    out.push({
      name,
      from: fmtTime(times[visIdx[0]], ctx.tz),
      to: fmtTime(times[visIdx[visIdx.length - 1]], ctx.tz),
      best_time: fmtTime(tBest, ctx.tz),
      best_alt: round1(alts[bestI]),
      compass: compassWord(azBest),
      fists: round1(alts[bestI] / 10.0),
      distance_km: km,
      light_minutes: Math.round(lightMinutes(km)),
      constellation: constellationOfRaDec(eqBest.ra, eqBest.dec),
    });
  }
  return out;
}

/** Full constellation name for an RA/Dec position (IAU boundaries).
 * raHours/decDeg may be J2000; astronomy-engine handles the B1875
 * boundary conversion internally. */
export function constellationOfRaDec(raHours: number, decDegrees: number): string | null {
  try {
    const info = A.Constellation(raHours, decDegrees);
    for (const c of CONSTELLATIONS) {
      if (c.abbrev === info.symbol) return c.name;
    }
    return info.symbol;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ meteor showers

export function activeMeteorShowers(d: LocalDate): MeteorShower[] {
  const md: [number, number] = [d.m, d.d];
  const parse = (s: string): [number, number] => {
    const [mm, dd] = s.split('-').map(Number);
    return [mm, dd];
  };
  // Tuple comparison like Python's (month, day) <= (month, day).
  const cmp = (a: [number, number], b: [number, number]): number =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];

  const active: MeteorShower[] = [];
  for (const sh of SHOWERS) {
    const s = parse(sh.active_start);
    const e = parse(sh.active_end);
    const peak = parse(sh.peak);
    const inWindow =
      cmp(s, e) <= 0
        ? cmp(s, md) <= 0 && cmp(md, e) <= 0
        : cmp(md, s) >= 0 || cmp(md, e) <= 0; // wraps across New Year (e.g. Quadrantids)
    if (!inWindow) continue;
    // Days until the next peak date.
    const peakThisYear = new Date(Date.UTC(d.y, peak[0] - 1, peak[1]));
    const today = new Date(Date.UTC(d.y, md[0] - 1, md[1]));
    let peakDt = peakThisYear;
    if (peakDt < today) peakDt = new Date(Date.UTC(d.y + 1, peak[0] - 1, peak[1]));
    const daysToPeak = Math.round((peakDt.getTime() - today.getTime()) / 86400000);
    active.push({ ...sh, days_to_peak: daysToPeak });
  }
  return active;
}

// -------------------------------------------------------------------- misc

/** Polaris sits (roughly) as high above the horizon as your latitude. */
export function polarisAltitudeNote(lat: number): { expected_alt: number; star_dec: number } {
  const pol = STARS.find((st) => st.name === 'Polaris');
  return { expected_alt: round1(lat), star_dec: pol?.dec_degrees ?? 89.26 };
}

export function objectsRiseEarlier(): { minutes_per_day: number } {
  return { minutes_per_day: 4 };
}