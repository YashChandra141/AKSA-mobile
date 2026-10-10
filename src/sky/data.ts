/**
 * Read-only bundled catalogs (copied from the Python reference aksa/data/).
 * Loaded once at module init; pure data, no state.
 */

import aliasesJson from './data/aliases.json';
import asterismsJson from './data/asterisms.json';
import challengesJson from './data/challenges.json';
import citiesJson from './data/cities.json';
import constellationsJson from './data/constellations.json';
import factsJson from './data/facts.json';
import messierJson from './data/messier.json';
import meteorShowersJson from './data/meteor_showers.json';
import starsJson from './data/stars.json';
import starNamesJson from './data/star_names.json';
import type {
  AsterismEntry,
  ConstellationEntry,
  MessierEntry,
  StarEntry,
} from './types';

export interface CityEntry {
  lat: number;
  lon: number;
  tz: string;
}

export interface FactEntry {
  type?: string;
  headline?: string;
  color_reason?: string;
  size_or_scale?: string;
  lore?: string;
  indian_name?: string;
  binocular_tip?: string;
  distance_ly?: number;
}

export interface Challenge {
  target: string;
  text: string;
  difficulty: 'easy' | 'medium' | 'hard';
  needs: string;
}

export interface ShowerRecord {
  name: string;
  active_start: string;
  active_end: string;
  peak: string;
  zhr: number;
  best_hour: string;
}

interface StarsFile {
  source: string;
  count: number;
  stars: StarEntry[];
}

interface MessierFile {
  source: string;
  count: number;
  objects: MessierEntry[];
}

interface ConstellationsFile {
  source: string;
  count: number;
  constellations: ConstellationEntry[];
}

export const STARS: StarEntry[] = (starsJson as unknown as StarsFile).stars;
export const NAMED_STARS: StarEntry[] = STARS.filter((s) => !!s.name);
export const MESSIER: MessierEntry[] = (messierJson as unknown as MessierFile).objects;
export const CONSTELLATIONS: ConstellationEntry[] =
  (constellationsJson as unknown as ConstellationsFile).constellations;
export const ASTERISMS: Record<string, AsterismEntry> =
  asterismsJson as unknown as Record<string, AsterismEntry>;
export const ALIASES: Record<string, { kind: string; name: string }> =
  aliasesJson as unknown as Record<string, { kind: string; name: string }>;
export const FACTS: Record<string, FactEntry> = factsJson as unknown as Record<
  string,
  FactEntry
>;
export const CHALLENGES: Challenge[] =
  (challengesJson as unknown as { challenges: Challenge[] }).challenges;
export const SHOWERS: ShowerRecord[] =
  (meteorShowersJson as unknown as { showers: ShowerRecord[] }).showers;
export const CITIES: Record<string, CityEntry> = citiesJson as unknown as Record<
  string,
  CityEntry
>;
export const STAR_NAMES: Record<string, number> =
  starNamesJson as unknown as Record<string, number>;

export function starByName(name: string): StarEntry | undefined {
  return NAMED_STARS.find((s) => s.name === name);
}