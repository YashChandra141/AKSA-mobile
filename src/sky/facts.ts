/** Facts layer: curated lore plus facts computed from live data.
 * Port of aksa/facts.py. Curated sentences come from data/facts.json;
 * computed facts (light travel time, planet distance, moon phase) are
 * derived at runtime so they are always correct. One fact is picked per
 * object per day, rotating through the available candidates. */

import { CHALLENGES, FACTS } from './data';
import type { CatalogMatch, MoonInfo } from './types';
import { dayOfYear, fmtComma } from './time';

/** Calendar date in the observer's timezone. */
export interface LocalDate {
  y: number;
  m: number;
  d: number;
}

export function curated(name: string) {
  return FACTS[name] ?? null;
}

/** Describe how long ago the light we see left its source. */
export function lightLeft(distanceLy: number, today: LocalDate): string {
  const frac = (dayOfYear(today.y, today.m, today.d) - 1) / 365.25;
  const decimalYear = today.y + frac;
  if (distanceLy >= 1_000_000) {
    const millions = distanceLy / 1_000_000;
    return (
      `Its light left about ${millions.toFixed(1)} million years ago, ` +
      'long before modern humans existed.'
    );
  }
  if (distanceLy >= 100) {
    const years = Math.round(distanceLy);
    const yr = Math.round(decimalYear - years);
    if (yr > 0) {
      return `Its light left about ${fmtComma(years)} years ago, around the year ${yr}.`;
    }
    return `Its light left about ${fmtComma(years)} years ago, before written history.`;
  }
  const yr = Math.round(decimalYear - distanceLy);
  return `Its light left about ${distanceLy.toFixed(1)} years ago, around ${yr}.`;
}

/** Sentence from live planet data {name, distance_km, light_minutes}. */
export function planetDistanceSentence(live: {
  name: string;
  distance_km: number;
  light_minutes: number;
}): string {
  const km = live.distance_km;
  const lm = live.light_minutes;
  let dist: string;
  if (km >= 1_000_000_000) {
    dist = `${(km / 1_000_000_000).toFixed(1)} billion km`;
  } else if (km >= 1_000_000) {
    dist = `${(km / 1_000_000).toFixed(0)} million km`;
  } else {
    dist = `${(km / 1000).toFixed(0)} thousand km`;
  }
  return (
    `${live.name} is about ${dist} away tonight; ` +
    `its light took ${lm} minutes to reach you.`
  );
}

/** Sentence from live moon_info data. */
export function moonFact(moon: MoonInfo): string {
  const bits = [
    `The Moon is a ${moon.phase_name.toLowerCase()} tonight, ` +
      `${moon.percent_lit}% lit, about ${(moon.distance_km / 1000).toFixed(0)} thousand km away.`,
  ];
  if (moon.next_full) {
    bits.push(`Next full moon: ${moon.next_full}.`);
  }
  return bits.join(' ');
}

export function polarisSentence(altDeg: number): string {
  return (
    `Polaris sits about ${altDeg.toFixed(0)} degrees up, which equals ` +
    'your latitude - the closer to the pole you stand, the higher it rides.'
  );
}

export function riseEarlierSentence(): string {
  return (
    'Every night, every star rises about 4 minutes earlier than ' +
    "it did the night before; the sky you see drifts as Earth orbits the Sun."
  );
}

function distanceLyFor(match: CatalogMatch): number | null {
  if (match.kind === 'star') {
    const data = match.data as { distance_ly?: number | null };
    return data.distance_ly ?? null;
  }
  if (match.kind === 'messier') {
    const entry = FACTS[match.name];
    return entry?.distance_ly ?? null;
  }
  return null;
}

/** All accurate one-liner facts for an object.
 * live may carry computed values: {distance_km, light_minutes} for
 * planets, or a full moon_info dict for the Moon. */
export function candidates(
  match: CatalogMatch,
  live?: Record<string, unknown> | null,
  today?: LocalDate,
): string[] {
  const name = match.name;
  const kind = match.kind;
  const entry = FACTS[name] ?? {};
  const out: string[] = [];

  if (entry.headline) {
    out.push(`${name} - ${entry.headline}`);
  }
  if (entry.color_reason) {
    out.push(`Why it looks that way: ${entry.color_reason}`);
  }
  if (entry.size_or_scale) {
    out.push(entry.size_or_scale);
  }
  if (entry.lore) {
    out.push(entry.lore);
  } else if (entry.indian_name) {
    out.push(`In Indian sky tradition, ${name} is called ${entry.indian_name}.`);
  }
  if (entry.binocular_tip) {
    out.push(entry.binocular_tip);
  }

  if (kind === 'planet' && live && 'distance_km' in live) {
    out.push(
      planetDistanceSentence(live as { name: string; distance_km: number; light_minutes: number }),
    );
  }
  if (kind === 'moon' && live && 'phase_name' in live) {
    out.push(moonFact(live as unknown as MoonInfo));
  }

  const dist = distanceLyFor(match);
  if (dist) {
    out.push(lightLeft(dist, today ?? { y: new Date().getFullYear(), m: 1, d: 1 }));
  }
  return out.filter(Boolean);
}

/** One fact per object per day, rotating through candidates. */
export function getFact(
  match: CatalogMatch,
  live?: Record<string, unknown> | null,
  today?: LocalDate,
): string {
  const cands = candidates(match, live, today);
  if (!cands.length) return '';
  const td = today ?? { y: new Date().getFullYear(), m: 1, d: 1 };
  const seed =
    dayOfYear(td.y, td.m, td.d) +
    Array.from(match.name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return cands[seed % cands.length];
}

export function challenges() {
  return CHALLENGES;
}