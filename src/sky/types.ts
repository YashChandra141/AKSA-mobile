/** Shared types for the AKSA sky engine (pure TypeScript, no RN imports). */

/**
 * Every engine function takes the observing context explicitly.
 * Mirrors the Python `_loc()` + `date.today()` pair, but with no global state.
 */
export interface SkyContext {
  lat: number;
  lon: number;
  /** IANA timezone name, e.g. "Asia/Kolkata". */
  tz: string;
  /** Current instant. */
  now: Date;
  /** Human label for the location (city name or "lat, lon"). */
  label?: string;
}

export type ObjectKind =
  | 'star'
  | 'messier'
  | 'constellation'
  | 'asterism'
  | 'planet'
  | 'moon';

export interface StarEntry {
  hip: number;
  name?: string;
  ra_hours: number;
  dec_degrees: number;
  mag: number;
  parallax_mas?: number | null;
  distance_ly?: number | null;
  constellation?: string | null;
}

export type StarRecord = StarEntry;

export interface MessierEntry {
  m: number;
  name: string;
  type: string;
  ra_hours: number;
  dec_degrees: number;
  mag: number | null;
  constellation: string;
}

export interface ConstellationEntry {
  name: string;
  abbrev: string;
  ra_hours: number;
  dec_degrees: number;
  named_stars: string[];
}

export interface AsterismEntry {
  members: string[];
  tip: string;
}

export interface CatalogMatch {
  kind: ObjectKind;
  name: string;
  data: StarEntry | MessierEntry | ConstellationEntry | AsterismEntry | { name: string };
}

export interface Position {
  alt: number;
  az: number;
  compass: string;
  fists: number;
  above_horizon: boolean;
}

export interface RiseSetTransit {
  highest_time: string;
  highest_alt: number;
  rise: string | null;
  set: string | null;
  circumpolar: boolean;
  never_rises: boolean;
}

export interface DarkWindow {
  start: string;
  end: string;
  hours: number;
  kind: 'dark' | 'astronomical twilight';
}

export interface MoonInfo {
  phase_name: string;
  percent_lit: number;
  waxing: boolean;
  rise: string | null;
  set: string | null;
  distance_km: number;
  next_full: string | null;
  next_new: string | null;
}

export interface VisiblePlanet {
  name: string;
  from: string;
  to: string;
  best_time: string;
  best_alt: number;
  compass: string;
  fists: number;
  distance_km: number;
  light_minutes: number;
  constellation: string | null;
}

export interface MeteorShower {
  name: string;
  active_start: string;
  active_end: string;
  peak: string;
  zhr: number;
  best_hour: string;
  days_to_peak: number;
}

export type Verdict = 'GO' | 'MAYBE' | 'SKIP';

export interface NightScore {
  score: number;
  verdict: Verdict;
  reasons: string[];
}

export interface TonightSummary {
  ok: true;
  summary: string;
  verdict: Verdict;
  score: number;
  dark: DarkWindow | null;
  cloud: number | null;
  moon: {
    phase: string;
    percent_lit: number;
    rise: string | null;
    set: string | null;
  };
  planets: { name: string; best_time: string; compass: string; fists: number }[];
  showers: { name: string; days_to_peak: number; zhr: number }[];
  reasons: string[];
  offline: boolean;
  location: string;
}

/** One entry of visibleTonight(): any object type with its best moment. */
export interface VisibleEntry {
  kind: ObjectKind;
  name: string;
  mag: number | null;
  best_time: string;
  best_alt: number;
  compass: string;
  fists: number;
  needs: string;
  fact: string;
  why: string;
}

/** nearbyObjects(): n closest visible objects for the Detective. */
export interface NearbyObject {
  kind: ObjectKind;
  name: string;
  mag: number | null;
  sep_deg: number;
  fists: number;
  direction: string;
  brighter: boolean | null;
}

export interface UpItem {
  name: string;
  kind: ObjectKind;
  mag: number;
  alt: number;
  az: number;
  compass: string;
  fists: number;
  phase?: string;
}