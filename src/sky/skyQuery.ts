/**
 * Query layer: answer sky questions with pre-phrased, computed sentences.
 * Port of aksa/sky_query.py. These functions are the single source of
 * truth used by every feature (Guide, Detective, Missions, chat), so the
 * model never has to guess positions. Every function takes the observing
 * context {lat, lon, tz, now} explicitly - there is no global config.
 */

import * as astro from './astro';
import { NAMED_STARS, STARS, MESSIER, ASTERISMS, CONSTELLATIONS } from './data';
import { UnknownObjectError, resolve, PLANETS } from './catalog';
import { getFact } from './facts';
import { moonUpFraction, scoreNight } from './score';
import type {
  CatalogMatch,
  DarkWindow,
  MoonInfo,
  NearbyObject,
  ObjectKind,
  Position,
  RiseSetTransit,
  SkyContext,
  TonightSummary,
  UpItem,
  VisibleEntry,
} from './types';
import { hhmmToMins, zonedTimeToUtc, localDateInTz, fmtTime } from './time';

const BRIGHT_MAG = 2.5; // brightest named stars used for hints and IDs
const HOP_MAX_DEG = 45.0; // only hint hops within this distance
const HOP_MIN_DEG = 5.0; // skip if the object IS the hint star

const DIRS: Record<string, number> = {
  n: 0.0, north: 0.0, nne: 22.5, ne: 45.0, northeast: 45.0,
  ene: 67.5, e: 90.0, east: 90.0, ese: 112.5, se: 135.0,
  southeast: 135.0, sse: 157.5, s: 180.0, south: 180.0,
  ssw: 202.5, sw: 225.0, southwest: 225.0, wsw: 247.5,
  w: 270.0, west: 270.0, wnw: 292.5, nw: 315.0, northwest: 315.0,
  nnw: 337.5,
};

const HEIGHTS: Record<string, [number, number]> = {
  low: [0.0, 30.0],
  medium: [30.0, 60.0],
  mid: [30.0, 60.0],
  high: [60.0, 91.0],
  overhead: [65.0, 91.0],
};

/** What equipment is needed to see this object. */
export function needs(match: CatalogMatch): string {
  const kind = match.kind;
  const data = match.data as { mag?: number | null };
  if (kind === 'planet' || kind === 'moon' || kind === 'constellation' || kind === 'asterism') {
    return 'eyes';
  }
  if (kind === 'star') {
    const mag = data.mag ?? 99;
    return mag <= 3.5 ? 'eyes' : 'eyes (dark sky)';
  }
  // Messier object
  const mag = data.mag;
  if (mag == null) return 'telescope';
  if (mag <= 5.5) return 'eyes (dark sky)';
  if (mag <= 9.0) return 'binoculars';
  return 'telescope';
}

function namedStars(maxMag: number) {
  return NAMED_STARS.filter((st) => st.name && st.mag <= maxMag);
}

/** Angular separation between two horizontal positions, in degrees. */
export function sepDeg(alt1: number, az1: number, alt2: number, az2: number): number {
  const a1 = (alt1 * Math.PI) / 180;
  const a2 = (alt2 * Math.PI) / 180;
  const dz = ((az1 - az2) * Math.PI) / 180;
  const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dz);
  return (Math.acos(Math.max(-1.0, Math.min(1.0, c))) * 180) / Math.PI;
}

/** "About X fists from <bright star>, toward <direction>" for locating. */
export function hopHint(
  match: CatalogMatch,
  pos: Position,
  ctx: SkyContext,
): string | null {
  if (match.kind !== 'star' && match.kind !== 'messier') return null;
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  let stars = namedStars(BRIGHT_MAG);
  // Never hint from the object itself.
  if (match.kind === 'star') {
    stars = stars.filter((s) => s.name !== match.name);
  }
  if (!stars.length) return null;
  let best: (typeof stars)[number] | null = null;
  let bestSep: number | null = null;
  for (const s of stars) {
    const p = astro.altAz({ kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees }, ctx.now, observer);
    if (p.alt <= 5) continue;
    const sep = sepDeg(pos.alt, pos.az, p.alt, p.az);
    if (bestSep === null || sep < bestSep) {
      best = s;
      bestSep = sep;
    }
  }
  if (best === null || bestSep === null || !(HOP_MIN_DEG <= bestSep && bestSep <= HOP_MAX_DEG)) {
    return null;
  }
  const fists = Math.round((bestSep / 10.0) * 2) / 2;
  return `About ${fists} fist${fists !== 1 ? 's' : ''} from ${best.name}, toward the ${pos.compass}.`;
}

function tonightSentence(tonight: RiseSetTransit | null): string | null {
  const r = tonight;
  if (!r) return null;
  if (r.never_rises) return 'It never rises from your latitude.';
  if (r.circumpolar) return 'It never sets from your latitude.';
  const bits: string[] = [];
  if (r.rise) bits.push(`rises ${r.rise}`);
  if (r.set) bits.push(`sets ${r.set}`);
  if (r.highest_time) bits.push(`is highest ${r.highest_time} at ${r.highest_alt} deg`);
  if (!bits.length) return null;
  return 'It ' + bits.join(', ') + '.';
}

function positionSentence(pos: Position): string {
  if (!pos.above_horizon) return 'It is below the horizon right now.';
  const fists = pos.fists;
  const ftxt = `about ${fists} fist${fists !== 1 ? 's' : ''} up`;
  return `Face ${pos.compass} and look ${ftxt}.`;
}

/** Computed distance/phase data used by the facts layer. */
function liveFor(match: CatalogMatch, ctx: SkyContext): Record<string, unknown> | null {
  if (match.kind === 'planet') {
    const km = astro.planetDistanceKm(match.name, ctx.now);
    return {
      name: match.name,
      distance_km: km,
      light_minutes: Math.round(astro.lightMinutes(km)),
    };
  }
  if (match.kind === 'moon') {
    const info = astro.moonInfo(ctx, ctx.now);
    return { ...info };
  }
  return null;
}

export interface FindObjectResult {
  ok: boolean;
  error?: string;
  ambiguous?: string[];
  summary?: string;
  object?: { kind: ObjectKind; name: string };
  position?: Position;
  tonight?: RiseSetTransit;
  needs?: string;
  fact?: string;
  members?: string[];
  tip?: string;
  hop?: string;
  live?: Record<string, unknown>;
}

/** Where is X, when can I see it, and what do I need? */
export function findObject(name: string, ctx: SkyContext): FindObjectResult {
  let resolved;
  try {
    resolved = resolve(name);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return { ok: false, error: msg };
  }
  if (resolved.ambiguous) {
    const cands = resolved.ambiguous;
    return {
      ok: false,
      ambiguous: cands,
      summary: `Did you mean ${cands.slice(0, -1).join(', ')} or ${cands[cands.length - 1]}?`,
    };
  }
  const match = resolved.match!;
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  const target = astro.objectTarget(match);
  const pos = astro.position(target, ctx.now, observer);
  const tonight = astro.riseSetTransit(target, ctx);
  const live = liveFor(match, ctx);
  const fact = getFact(match, live, localDateInTz(ctx.now, ctx.tz));

  const parts = [positionSentence(pos)];
  const tsSentence = tonightSentence(tonight);
  if (tsSentence) parts.push(tsSentence);
  let summary = parts.join(' ');

  const result: FindObjectResult = {
    ok: true,
    object: { kind: match.kind, name: match.name },
    summary,
    position: pos,
    tonight,
    needs: needs(match),
    fact,
  };
  if (match.kind === 'asterism') {
    const data = match.data as { members: string[]; tip: string };
    result.members = data.members;
    result.tip = data.tip;
    summary += ` Look for ${data.members.slice(0, 3).join(' , ')}.`;
  } else if (match.kind === 'constellation') {
    const data = match.data as { named_stars?: string[] };
    if (data.named_stars?.length) {
      result.members = data.named_stars;
      summary += ` Its brightest named stars: ${data.named_stars.slice(0, 4).join(', ')}.`;
    }
  } else {
    const hop = hopHint(match, pos, ctx);
    if (hop) {
      result.hop = hop;
      summary += ' ' + hop;
    }
  }
  result.summary = summary;
  if (live && 'distance_km' in live) result.live = live;
  return result;
}

/** 'What's that bright star in the east?' -> best candidates. */
export function identifyObject(
  direction: string,
  height: string | number,
  ctx: SkyContext,
): { ok: boolean; error?: string; summary?: string; direction?: string; matches?: UpItem[] } {
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  const word = direction.trim().toLowerCase().replace(/-/g, '').replace(/ /g, '');
  if (!(word in DIRS)) {
    return {
      ok: false,
      error: `Unknown direction '${direction}'; try north/NE/east/south-west and so on.`,
    };
  }
  const azCenter = DIRS[word];
  let band: [number, number];
  if (typeof height === 'string') {
    const b = HEIGHTS[height.trim().toLowerCase()];
    if (!b) {
      return {
        ok: false,
        error: `Unknown height '${height}'; try low, medium, high or overhead.`,
      };
    }
    band = b;
  } else {
    const h = Number(height);
    band = [Math.max(0.0, h - 10), Math.min(90.0, h + 10)];
  }

  const cands: (UpItem & { _alt?: number; _az?: number })[] = [];
  const stars = namedStars(2.6);
  for (const s of stars) {
    const p = astro.altAz({ kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees }, ctx.now, observer);
    cands.push({
      name: s.name!,
      kind: 'star',
      mag: s.mag,
      alt: Math.round(p.alt * 10) / 10,
      az: Math.round(((p.az % 360) + 360) % 360 * 10) / 10,
      compass: astro.compassWord(p.az),
      fists: Math.round(p.alt / 10.0 * 10) / 10,
      _alt: p.alt,
      _az: p.az,
    });
  }
  for (const pname of astro.PLANETS) {
    const p = astro.position({ kind: 'body', body: astro.planetBody(pname) }, ctx.now, observer);
    // Real computed magnitude (Venus ~ -4, Jupiter ~ -2) so planets rank
    // correctly against stars.
    const mag = astro.planetMag(pname, ctx.now);
    cands.push({
      name: pname,
      kind: 'planet',
      mag,
      alt: p.alt,
      az: p.az,
      compass: p.compass,
      fists: p.fists,
      _alt: p.alt,
      _az: p.az,
    });
  }
  const moon = astro.position({ kind: 'body', body: astro.planetBody('Moon') }, ctx.now, observer);
  cands.push({
    name: 'Moon',
    kind: 'moon',
    mag: -12.0,
    alt: moon.alt,
    az: moon.az,
    compass: moon.compass,
    fists: moon.fists,
    _alt: moon.alt,
    _az: moon.az,
  });

  const inBand: UpItem[] = [];
  for (const c of cands) {
    const alt = c._alt ?? c.alt;
    const az = c._az ?? c.az;
    if (!(band[0] <= alt && alt <= band[1])) continue;
    const diff = Math.abs((((az - azCenter + 180) % 360) + 360) % 360 - 180);
    if (diff <= 30) inBand.push(c);
  }
  inBand.sort((a, b) => a.mag - b.mag);

  if (!inBand.length) {
    return {
      ok: false,
      error: `Nothing bright found ${word} in that height band right now. Try another direction.`,
    };
  }
  const top = inBand.slice(0, 3);
  const first = top[0];
  const nameTxt = first.kind === 'moon' ? 'the Moon' : first.name;
  const summary =
    `Most likely ${nameTxt} (mag ${first.mag}), ` +
    `${first.fists} fist${first.fists !== 1 ? 's' : ''} up in the ${first.compass.toLowerCase()}.`;
  return { ok: true, summary, direction: word, matches: top };
}

/** The brightest interesting objects above the horizon right now. */
export function whatsUp(ctx: SkyContext, limit = 8): { ok: boolean; summary: string; list: UpItem[] } {
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  const stars = namedStars(1.6);
  const items: UpItem[] = [];
  for (const s of stars) {
    const p = astro.altAz({ kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees }, ctx.now, observer);
    if (p.alt > 15.0) {
      items.push({
        name: s.name!,
        kind: 'star',
        mag: s.mag,
        alt: Math.round(p.alt * 10) / 10,
        az: Math.round(((p.az % 360) + 360) % 360 * 10) / 10,
        compass: astro.compassWord(p.az),
        fists: Math.round(p.alt / 10.0 * 10) / 10,
      });
    }
  }
  for (const pname of astro.PLANETS) {
    const p = astro.position({ kind: 'body', body: astro.planetBody(pname) }, ctx.now, observer);
    if (p.above_horizon && p.alt > 15.0) {
      items.push({
        name: pname,
        kind: 'planet',
        mag: astro.planetMag(pname, ctx.now),
        alt: p.alt,
        az: Math.round(((p.az % 360) + 360) % 360 * 10) / 10,
        compass: p.compass,
        fists: p.fists,
      });
    }
  }
  const moon = astro.position({ kind: 'body', body: astro.planetBody('Moon') }, ctx.now, observer);
  if (moon.above_horizon && moon.alt > 15.0) {
    const info = astro.moonInfo(ctx, ctx.now);
    items.push({
      name: 'Moon',
      kind: 'moon',
      mag: -12.0,
      alt: moon.alt,
      az: Math.round(((moon.az % 360) + 360) % 360 * 10) / 10,
      compass: moon.compass,
      fists: moon.fists,
      phase: info.phase_name,
    });
  }
  items.sort((a, b) => a.mag - b.mag);
  const top = items.slice(0, limit);
  if (!top.length) {
    return { ok: true, summary: 'Almost nothing bright is up right now.', list: [] };
  }
  const names = top.map((c) => (c.kind === 'moon' ? 'the Moon' : c.name)).join(', ');
  return { ok: true, summary: `Right now: ${names}.`, list: top };
}

/** Is tonight good for stargazing? Computed verdict, no model involved.
 * cloudForWindow supplies the average cloud cover for the dark window
 * (null = unknown/offline); kept as a parameter so this module stays
 * network-free and testable. */
export function tonightSummary(
  ctx: SkyContext,
  cloudForWindow: (start: string, end: string) => number | null | undefined,
  offline = false,
): TonightSummary {
  const dark = astro.darkWindow(ctx);
  const moon = astro.moonInfo(ctx);
  const planets = astro.visiblePlanets(ctx, dark);
  const showers = astro.activeMeteorShowers(localDateInTz(ctx.now, ctx.tz));
  const cloud = dark ? (cloudForWindow(dark.start, dark.end) ?? null) : null;
  const moonUp = dark ? moonUpFractionSafe(moon, dark) : 0.0;
  const verdict = scoreNight(cloud, moon.percent_lit, moonUp, dark ? dark.hours : 0.0);

  const cloudTxt = cloud === null ? 'cloud cover unknown' : `about ${cloud.toFixed(0)}% clouds`;
  const locLabel = ctx.label ?? `${ctx.lat}, ${ctx.lon}`;
  let summary: string;
  if (dark === null) {
    summary =
      `The sky never fully darkens tonight in ${locLabel} - ` +
      `${verdict.verdict} (${verdict.score}/100).`;
  } else {
    summary =
      `${verdict.verdict} (${verdict.score}/100) for ${locLabel}: dark from ` +
      `${dark.start} to ${dark.end} (${dark.hours} h, ${dark.kind}), ` +
      `${cloudTxt}, Moon ${moon.phase_name.toLowerCase()} at ${moon.percent_lit}% lit.`;
  }
  if (planets.length) {
    const first = planets[0];
    summary +=
      ` Best planet: ${first.name}, ${first.best_time}, ` +
      `${first.fists} fists up toward the ${first.compass.toLowerCase()}.`;
  }
  return {
    ok: true,
    summary,
    verdict: verdict.verdict,
    score: verdict.score,
    dark,
    cloud,
    moon: {
      phase: moon.phase_name,
      percent_lit: moon.percent_lit,
      rise: moon.rise,
      set: moon.set,
    },
    planets: planets.map((p) => ({
      name: p.name,
      best_time: p.best_time,
      compass: p.compass,
      fists: p.fists,
    })),
    showers: showers.map((s) => ({ name: s.name, days_to_peak: s.days_to_peak, zhr: s.zhr })),
    reasons: verdict.reasons,
    offline,
    location: locLabel,
  };
}

function moonUpFractionSafe(moon: MoonInfo, dark: DarkWindow): number {
  return moonUpFraction(moon.rise, moon.set, dark.start, dark.end);
}

/** All kinds of objects visible tonight during the dark window (or now).
 * Extends whatsUp to named stars, planets, the Moon, constellations,
 * asterisms and Messier objects. Used by the Guide and Missions. */
export function visibleTonight(
  ctx: SkyContext,
  options?: {
    dark?: DarkWindow | null;
    equipment?: string; // 'eyes' | 'binoculars' | 'telescope'
    windowMinutes?: number;
    limit?: number;
  },
): VisibleEntry[] {
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  const dark = options?.dark !== undefined ? options.dark : astro.darkWindow(ctx);
  const equipment = options?.equipment ?? 'eyes';
  const limit = options?.limit ?? 40;
  const nowLocal = localDateInTz(ctx.now, ctx.tz);

  // Sample times: the dark window when known, else a band around now.
  let samples: Date[];
  if (dark) {
    const t0 = zonedTimeToUtc(nowLocal.y, nowLocal.m, nowLocal.d, 12, 0, ctx.tz);
    const sMins = hhmmToMins(dark.start) - 12 * 60;
    const eMins = hhmmToMins(dark.end) - 12 * 60;
    const start = t0.getTime() + sMins * 60 * 1000;
    let end = t0.getTime() + eMins * 60 * 1000;
    if (end <= start) end += 24 * 3600 * 1000;
    const n = Math.max(Math.floor((end - start) / (30 * 60 * 1000)) + 1, 3);
    samples = [];
    for (let i = 0; i < n; i++) samples.push(new Date(start + ((end - start) * i) / (n - 1)));
  } else {
    const step = 30 * 60 * 1000;
    samples = [-step, 0, step].map((dt) => new Date(ctx.now.getTime() + dt));
  }

  const equipmentRank: Record<string, number> = { eyes: 0, binoculars: 1, telescope: 2 };
  const userRank = equipmentRank[equipment] ?? 0;

  interface Candidate {
    kind: ObjectKind;
    name: string;
    mag: number | null;
    target: astro.SkyTarget;
    needLabel: string;
  }
  const cands: Candidate[] = [];

  for (const s of NAMED_STARS) {
    if (s.mag > 3.5) continue;
    const need = s.mag <= 3.5 ? 'eyes' : 'eyes (dark sky)';
    cands.push({
      kind: 'star',
      name: s.name!,
      mag: s.mag,
      target: { kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees },
      needLabel: need,
    });
  }
  for (const pname of astro.PLANETS) {
    cands.push({
      kind: 'planet',
      name: pname,
      mag: null, // filled after sampling
      target: { kind: 'body', body: astro.planetBody(pname) },
      needLabel: 'eyes',
    });
  }
  cands.push({
    kind: 'moon',
    name: 'Moon',
    mag: -12.0,
    target: { kind: 'body', body: astro.planetBody('Moon') },
    needLabel: 'eyes',
  });
  for (const name of Object.keys(ASTERISMS)) {
    cands.push({
      kind: 'asterism',
      name,
      mag: null,
      target: astro.objectTarget({ kind: 'asterism', name, data: ASTERISMS[name] as never }),
      needLabel: 'eyes',
    });
  }
  for (const c of CONSTELLATIONS) {
    cands.push({
      kind: 'constellation',
      name: c.name,
      mag: null,
      target: astro.objectTarget({ kind: 'constellation', name: c.name, data: c as never }),
      needLabel: 'eyes',
    });
  }
  for (const obj of MESSIER) {
    const need =
      obj.mag == null ? 'telescope' : obj.mag <= 5.5 ? 'eyes (dark sky)' : obj.mag <= 9.0 ? 'binoculars' : 'telescope';
    cands.push({
      kind: 'messier',
      name: obj.name,
      mag: obj.mag,
      target: { kind: 'fixed', raHours: obj.ra_hours, decDeg: obj.dec_degrees },
      needLabel: need,
    });
  }

  const out: VisibleEntry[] = [];
  for (const c of cands) {
    // Equipment filter: needs must be satisfiable by the user's gear.
    const needRank =
      c.needLabel === 'eyes' ? 0 : c.needLabel === 'eyes (dark sky)' ? 0.5 : c.needLabel === 'binoculars' ? 1 : 2;
    if (needRank > userRank) continue;

    let bestIdx = -1;
    let bestAlt = -91;
    const alts: number[] = [];
    const azs: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const p = astro.altAz(c.target, samples[i], observer);
      alts.push(p.alt);
      azs.push(p.az);
      if (p.alt > bestAlt) {
        bestAlt = p.alt;
        bestIdx = i;
      }
    }
    if (bestAlt <= 15.0) continue; // must clear 15 deg at some point
    const azBest = azs[bestIdx];
    const mag =
      c.kind === 'planet' ? astro.planetMag(c.name, samples[bestIdx]) : c.mag;

    const match: CatalogMatch = { kind: c.kind, name: c.name, data: {} as never };
    // Fact lookup uses the real catalog entry where available.
    const fullMatch = catalogMatchFor(c.kind, c.name) ?? match;
    const fact = getFact(fullMatch, undefined, nowLocal);
    const factList = fact ? [fact] : [];

    out.push({
      kind: c.kind,
      name: c.name,
      mag,
      best_time: fmtTime(samples[bestIdx], ctx.tz),
      best_alt: Math.round(bestAlt * 10) / 10,
      compass: astro.compassWord(azBest),
      fists: Math.round(bestAlt / 10.0 * 2) / 2,
      needs: c.needLabel,
      fact,
      why: fact,
    });
  }

  // Rank: brighter first, then higher.
  out.sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99) || b.best_alt - a.best_alt);
  return out.slice(0, limit);
}

function catalogMatchFor(kind: ObjectKind, name: string): CatalogMatch | null {
  if (kind === 'star') {
    const st = NAMED_STARS.find((s) => s.name === name);
    return st ? { kind, name, data: st } : null;
  }
  if (kind === 'messier') {
    const obj = MESSIER.find((o) => o.name === name);
    return obj ? { kind, name, data: obj } : null;
  }
  if (kind === 'asterism') {
    const a = ASTERISMS[name];
    return a ? { kind, name, data: a } : null;
  }
  if (kind === 'constellation') {
    const c = CONSTELLATIONS.find((k) => k.name === name);
    return c ? { kind, name, data: c } : null;
  }
  return null;
}

/** The n closest visible objects to a target, with separation in fists,
 * direction and a brightness comparison. Used by the Detective. */
export function nearbyObjects(
  targetMatch: CatalogMatch,
  ctx: SkyContext,
  n = 4,
): NearbyObject[] {
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  const target = astro.objectTarget(targetMatch as never);
  const tPos = astro.position(target, ctx.now, observer);
  if (!tPos.above_horizon) return [];

  interface Ref {
    kind: ObjectKind;
    name: string;
    mag: number | null;
    alt: number;
    az: number;
  }
  const refs: Ref[] = [];
  for (const s of namedStars(BRIGHT_MAG)) {
    const p = astro.altAz({ kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees }, ctx.now, observer);
    refs.push({ kind: 'star', name: s.name!, mag: s.mag, alt: p.alt, az: p.az });
  }
  for (const pname of astro.PLANETS) {
    const p = astro.position({ kind: 'body', body: astro.planetBody(pname) }, ctx.now, observer);
    if (p.above_horizon) {
      refs.push({ kind: 'planet', name: pname, mag: astro.planetMag(pname, ctx.now), alt: p.alt, az: p.az });
    }
  }
  for (const name of Object.keys(ASTERISMS)) {
    if (targetMatch.kind === 'asterism' && targetMatch.name === name) continue;
    const t = astro.objectTarget({ kind: 'asterism', name, data: ASTERISMS[name] as never });
    const p = astro.position(t, ctx.now, observer);
    if (p.above_horizon) refs.push({ kind: 'asterism', name, mag: null, alt: p.alt, az: p.az });
  }

  const targetMag =
    targetMatch.kind === 'planet'
      ? astro.planetMag(targetMatch.name, ctx.now)
      : ((targetMatch.data as { mag?: number }).mag ?? null);

  const withSep = refs
    .filter((r) => !(targetMatch.kind === 'star' && r.name === targetMatch.name))
    .map((r) => {
      const sep = sepDeg(tPos.alt, tPos.az, r.alt, r.az);
      // Direction of the object relative to the target: compare compass
      // words of the target and the reference.
      const dirWord = astro.compassWord(r.az);
      return {
        kind: r.kind,
        name: r.name,
        mag: r.mag,
        sep_deg: Math.round(sep * 10) / 10,
        fists: Math.round((sep / 10.0) * 2) / 2,
        direction: dirWord,
        brighter: targetMag != null && r.mag != null ? r.mag < targetMag : null,
      } satisfies NearbyObject;
    })
    .filter((r) => r.sep_deg >= HOP_MIN_DEG && r.sep_deg <= 90.0)
    .sort((a, b) => a.sep_deg - b.sep_deg);
  return withSep.slice(0, n);
}

/** Build a local Date in ctx.tz from clock fields (tests and tools). */
export function makeTime(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  return zonedTimeToUtc(y, m, d, hour, minute, tz);
}

// Re-exports so features can import everything sky-related from one module.
export { astro, resolve, UnknownObjectError, PLANETS };
export { STARS, MESSIER, ASTERISMS, CONSTELLATIONS } from './data';