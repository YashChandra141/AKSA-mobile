/**
 * All-sky map data: everything needed to draw a stereographic star map -
 * naked-eye stars, planets, the Moon, and asterism figure lines - for one
 * place and instant. Pure computation; the Skia canvas only draws it.
 */

import * as astro from './astro';
import { NAMED_STARS, STARS, ASTERISMS, CONSTELLATIONS } from './data';
import type { SkyContext } from './types';

export const MAP_MAG_LIMIT = 4.5;

export interface MapPoint {
  id: string; // resolvable name for tap/search ("Sirius", "Saturn", "M31")
  kind: 'star' | 'planet' | 'moon' | 'messier' | 'asterism' | 'constellation';
  name: string;
  mag: number | null;
  x: number; // 0..1 screen space (map square)
  y: number;
  alt: number;
  az: number;
}

export interface MapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SkyMapData {
  points: MapPoint[];
  lines: MapLine[];
}

/**
 * Stereographic projection from (alt, az) to unit square [0..1].
 * Zenith at center, horizon at the rim; radius = tan((90-alt)/2 / 45deg
 * normalized) - standard for planetarium domes, keeps shapes local.
 */
export function projectAltAz(alt: number, az: number): { x: number; y: number } | null {
  if (alt < -0.5) return null;
  const r = Math.tan(((90 - alt) / 2) * (Math.PI / 180));
  // r in [0..1] for alt in [0..90]; allow slightly below horizon (r > 1)
  const theta = (az * Math.PI) / 180;
  return {
    x: 0.5 + (r / 2) * Math.sin(theta),
    y: 0.5 - (r / 2) * Math.cos(theta),
  };
}

function mapPoint(
  id: string,
  kind: MapPoint['kind'],
  name: string,
  mag: number | null,
  alt: number,
  az: number,
): MapPoint | null {
  const p = projectAltAz(alt, az);
  if (!p) return null;
  return { id, kind, name, mag, x: p.x, y: p.y, alt, az };
}

/** Build the full map for one context (planets + Moon included). */
export function buildSkyMapData(ctx: SkyContext): SkyMapData {
  const observer = astro.makeObserver(ctx.lat, ctx.lon);
  const points: MapPoint[] = [];
  const lines: MapLine[] = [];

  // Bright naked-eye stars from the full catalog.
  for (const s of STARS) {
    if (s.mag > MAP_MAG_LIMIT) continue;
    const p = astro.altAz({ kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees }, ctx.now, observer);
    const pt = mapPoint(
      s.name ?? `hip${s.hip}`,
      'star',
      s.name ?? '',
      s.mag,
      p.alt,
      p.az,
    );
    if (pt) points.push(pt);
  }

  // Planets and the Moon.
  for (const pname of astro.PLANETS) {
    const p = astro.position({ kind: 'body', body: astro.planetBody(pname) }, ctx.now, observer);
    const pt = mapPoint(pname, 'planet', pname, astro.planetMag(pname, ctx.now), p.alt, p.az);
    if (pt) points.push(pt);
  }
  {
    const p = astro.position({ kind: 'body', body: astro.planetBody('Moon') }, ctx.now, observer);
    const pt = mapPoint('Moon', 'moon', 'Moon', -12, p.alt, p.az);
    if (pt) points.push(pt);
  }

  // Asterism figures: lines between member stars ( brightest <= limit).
  const starPos = new Map<string, { x: number; y: number; alt: number; az: number }>();
  for (const s of NAMED_STARS) {
    if (!s.name) continue;
    const p = astro.altAz({ kind: 'fixed', raHours: s.ra_hours, decDeg: s.dec_degrees }, ctx.now, observer);
    starPos.set(s.name, { x: p.az, y: p.alt, alt: p.alt, az: p.az });
  }

  for (const [name, a] of Object.entries(ASTERISMS)) {
    const members = a.members as string[];
    const projected: MapPoint[] = [];
    for (const m of members) {
      const sp = starPos.get(m);
      if (!sp) continue;
      const pt = mapPoint(name, 'star', m, null, sp.alt, sp.az);
      if (pt) projected.push(pt);
    }
    // Chain lines between consecutive members that are both up.
    for (let i = 0; i + 1 < projected.length; i++) {
      lines.push({ x1: projected[i].x, y1: projected[i].y, x2: projected[i + 1].x, y2: projected[i + 1].y });
    }
    // Also mark named asterisms as tappable centers.
    if (projected.length) {
      const cx = projected.reduce((s, p) => s + p.x, 0) / projected.length;
      const cy = projected.reduce((s, p) => s + p.y, 0) / projected.length;
      points.push({
        id: name,
        kind: 'asterism',
        name,
        mag: null,
        x: cx,
        y: cy,
        alt: projected[0].alt,
        az: projected[0].az,
      });
    }
  }

  // Constellation centers (dim markers; the asterisms already draw lines).
  for (const c of CONSTELLATIONS) {
    const p = astro.altAz(
      { kind: 'fixed', raHours: c.ra_hours, decDeg: c.dec_degrees },
      ctx.now,
      observer,
    );
    const pt = mapPoint(c.name, 'constellation', c.name, null, p.alt, p.az);
    if (pt) points.push(pt);
  }

  return { points, lines };
}

/** Nearest map point within a tap radius (units of the unit square). */
export function hitTest(data: SkyMapData, x: number, y: number, radius = 0.03): MapPoint | null {
  let best: MapPoint | null = null;
  let bestD = radius * radius;
  for (const p of data.points) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
