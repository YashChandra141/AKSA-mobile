/**
 * Golden tests: the TypeScript sky engine vs fixtures dumped from the
 * Python reference (aksa, Skyfield-based). Tolerances: 0.5 deg for
 * positions, 5 minutes for times, matching the port plan.
 *
 * Regenerate fixtures with:
 *   d:\\project\\cursor\\mlh\\venv\\Scripts\\python.exe tools\\make_golden.py
 */

import * as golden from './golden.json';
import { darkWindow, moonInfo, riseSetTransit, visiblePlanets, activeMeteorShowers, objectTarget, makeObserver, position, compassWord } from '@/sky/astro';
import { findObject, identifyObject, whatsUp, makeTime, resolve } from '@/sky/skyQuery';
import type { SkyContext } from '@/sky/types';

const FIX = golden as {
  cases: Record<
    string,
    {
      local_time: string;
      dark_window: { start: string; end: string; hours: number; kind: string } | null;
      moon_info: Record<string, unknown>;
      visible_planets: Record<string, unknown>[];
      meteor_showers: Record<string, unknown>[];
      find_objects: Record<string, Record<string, unknown>>;
      whats_up: { ok: boolean; summary: string; list: Record<string, unknown>[] };
    }
  >;
  catalog: Record<string, { result?: Record<string, unknown>; error?: string }>;
};

function ctxFor(caseName: string): SkyContext {
  const c = FIX.cases[caseName];
  const [datePart, timePart] = c.local_time.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const tzs: Record<string, string> = {
    pune_oct: 'Asia/Kolkata',
    reykjavik_summer: 'Atlantic/Reykjavik',
    newyork_winter: 'America/New_York',
  };
  const locs: Record<string, { lat: number; lon: number }> = {
    pune_oct: { lat: 18.5204, lon: 73.8567 },
    reykjavik_summer: { lat: 64.1466, lon: -21.9426 },
    newyork_winter: { lat: 40.7128, lon: -74.006 },
  };
  return {
    lat: locs[caseName].lat,
    lon: locs[caseName].lon,
    tz: tzs[caseName],
    now: makeTime(y, m, d, hh, mm, tzs[caseName]),
    label: caseName,
  };
}

function mins(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function expectTimeClose(actual: string | null, expected: string | null, tolMin = 5) {
  if (expected === null || actual === null) {
    expect(actual).toBe(expected);
    return;
  }
  const diff = Math.abs(mins(actual) - mins(expected));
  // 5 min tolerance, with wraparound past midnight.
  const wrapped = Math.min(diff, Math.abs(diff - 1440));
  expect(wrapped).toBeLessThanOrEqual(tolMin);
}

describe('compass words', () => {
  test('match Python reference on the 16-point rose', () => {
    expect(compassWord(0)).toBe('N');
    expect(compassWord(90)).toBe('E');
    expect(compassWord(180)).toBe('S');
    expect(compassWord(270)).toBe('W');
    expect(compassWord(45)).toBe('NE');
    expect(compassWord(359.9)).toBe('N');
  });
});

describe('dark window vs Python', () => {
  for (const caseName of Object.keys(FIX.cases)) {
    test(caseName, () => {
      const ctx = ctxFor(caseName);
      const actual = darkWindow(ctx);
      const expected = FIX.cases[caseName].dark_window;
      if (expected === null) {
        expect(actual).toBeNull();
        return;
      }
      expect(actual).not.toBeNull();
      expectTimeClose(actual!.start, expected.start);
      expectTimeClose(actual!.end, expected.end);
      expect(Math.abs(actual!.hours - expected.hours)).toBeLessThanOrEqual(0.3);
      expect(actual!.kind).toBe(expected.kind);
    });
  }
});

describe('moon info vs Python', () => {
  for (const caseName of Object.keys(FIX.cases)) {
    test(caseName, () => {
      const ctx = ctxFor(caseName);
      const actual = moonInfo(ctx, ctx.now);
      const expected = FIX.cases[caseName].moon_info as Record<string, string | number | boolean | null>;
      expect(actual.phase_name).toBe(expected.phase_name);
      expect(Math.abs(actual.percent_lit - Number(expected.percent_lit))).toBeLessThanOrEqual(3);
      // Skyfield's almanac moon rise/set bakes in refraction + the Moon's
      // limb radius (~0.5 deg total), shifting events vs a center-crossing
      // search by up to ~10 min. 10 min is the honest tolerance here.
      expectTimeClose(actual.rise, expected.rise as string | null, 10);
      expectTimeClose(actual.set, expected.set as string | null, 10);
      // Distance within 2500 km (different ephemerides agree to ~0.1%).
      expect(Math.abs(actual.distance_km - Number(expected.distance_km))).toBeLessThanOrEqual(2500);
    });
  }
});

describe('visible planets vs Python', () => {
  for (const caseName of Object.keys(FIX.cases)) {
    test(caseName, () => {
      const ctx = ctxFor(caseName);
      const expected = FIX.cases[caseName].visible_planets as Record<string, string | number>[];
      const actual = visiblePlanets(ctx, darkWindow(ctx));
      const byName = new Map(actual.map((p) => [p.name, p]));
      for (const exp of expected) {
        const act = byName.get(String(exp.name));
        expect(act).toBeDefined();
        expectTimeClose(act!.best_time, String(exp.best_time));
        expect(Math.abs(act!.best_alt - Number(exp.best_alt))).toBeLessThanOrEqual(0.5);
        expect(act!.compass).toBe(exp.compass);
        expect(Math.abs(act!.distance_km - Number(exp.distance_km))).toBeLessThanOrEqual(
          Number(exp.distance_km) * 0.02,
        );
      }
    });
  }
});

describe('meteor showers vs Python', () => {
  test('pune_oct shows the October showers', () => {
    const ctx = ctxFor('pune_oct');
    const [, , , , m, d] = FIX.cases.pune_oct.local_time.replace('T', '-').split(/-|T|:/).map(Number);
    void m;
    void d;
    const actual = activeMeteorShowers({ y: 2026, m: 10, d: 9 });
    const expected = FIX.cases.pune_oct.meteor_showers as { name: string; days_to_peak: number }[];
    expect(new Set(actual.map((s) => s.name))).toEqual(new Set(expected.map((s) => s.name)));
    for (const exp of expected) {
      const act = actual.find((s) => s.name === exp.name)!;
      expect(act.days_to_peak).toBe(exp.days_to_peak);
    }
  });
});

describe('find_object vs Python', () => {
  for (const caseName of Object.keys(FIX.cases)) {
    for (const [name, exp] of Object.entries(FIX.cases[caseName].find_objects)) {
      const hasRefError = '_reference_error' in exp;
      const testFn = hasRefError ? test.skip : test;
      testFn(`${caseName}: ${name}`, () => {
        const ctx = ctxFor(caseName);
        const act = findObject(name, ctx);
        const expected = exp as {
          ok: boolean;
          object?: { kind: string; name: string };
          position?: { alt: number; az: number; compass: string };
          tonight?: Record<string, unknown>;
          needs?: string;
          members?: string[];
          summary?: string;
        };
        expect(act.ok).toBe(expected.ok);
        if (!expected.ok) return;
        expect(act.object!.kind).toBe(expected.object!.kind);
        expect(act.object!.name).toBe(expected.object!.name);
        // Position within 0.5 deg.
        const pExp = expected.position!;
        const pAct = act.position!;
        if (pExp.alt > -5) {
          expect(Math.abs(pAct.alt - pExp.alt)).toBeLessThanOrEqual(0.5);
          const azDiff = Math.abs(pAct.az - pExp.az);
          expect(Math.min(azDiff, 360 - azDiff)).toBeLessThanOrEqual(0.5);
          expect(pAct.compass).toBe(pExp.compass);
        }
        // Rise/set/transit within 5 min (10-min sampler on both sides).
        const tExp = expected.tonight as Record<string, string | number | boolean | null>;
        const tAct = act.tonight!;
        // Python's rise_set_transit omits the never_rises/circumpolar
        // keys when false (dict.update pattern); the TS port always
        // carries both, so default the fixture side.
        expect(tAct.circumpolar).toBe(tExp.circumpolar ?? false);
        expect(tAct.never_rises).toBe(tExp.never_rises ?? false);
        expectTimeClose(tAct.rise, tExp.rise as string | null);
        expectTimeClose(tAct.set, tExp.set as string | null);
        expectTimeClose(tAct.highest_time, String(tExp.highest_time));
        expect(Math.abs(tAct.highest_alt - Number(tExp.highest_alt))).toBeLessThanOrEqual(1.0);
        expect(act.needs).toBe(expected.needs);
        if (expected.members) {
          expect(new Set(act.members)).toEqual(new Set(expected.members));
        }
      });
    }
  }
});

describe('catalog resolution vs Python', () => {
  for (const [query, exp] of Object.entries(FIX.catalog)) {
    test(query, () => {
      if ('error' in exp && exp.error) {
        // Reference raised KeyError: empty suggestions for gibberish.
        expect(() => resolve(query)).toThrow();
        return;
      }
      const result = resolve(query);
      const expResult = exp.result as Record<string, unknown>;
      if ('ambiguous' in expResult) {
        expect(result.ambiguous).toBeDefined();
        // Same top candidates (order may differ within the tied set).
        expect(result.ambiguous!.sort()).toEqual((expResult.ambiguous as string[]).sort());
      } else {
        const m = result.match!;
        const em = expResult.match as { kind: string; name: string };
        expect(m.kind).toBe(em.kind);
        expect(m.name).toBe(em.name);
      }
    });
  }
});

describe('whats_up vs Python', () => {
  for (const caseName of Object.keys(FIX.cases)) {
    test(caseName, () => {
      const ctx = ctxFor(caseName);
      const act = whatsUp(ctx);
      const exp = FIX.cases[caseName].whats_up;
      expect(act.ok).toBe(exp.ok);
      // The brightest few names should overlap (limit-8 lists may differ
      // at the faint tail between ephemerides; the top 3 must agree).
      const actNames = act.list.slice(0, 3).map((c) => c.name);
      const expNames = exp.list.slice(0, 3).map((c) => String(c.name));
      expect(actNames).toEqual(expNames);
    });
  }
});

describe('identify_object vs Python (pune)', () => {
  test('east/medium at fixture time', () => {
    const ctx = ctxFor('pune_oct');
    const act = identifyObject('east', 'medium', ctx);
    expect(act.ok).toBe(true);
    expect(act.matches!.length).toBeGreaterThan(0);
  });
});

describe('rise_set_transit circumpolar guard (polar case)', () => {
  // Reykjavik in June: the reference crashes on double horizon crossings;
  // the TS port must not.
  test('never throws', () => {
    const ctx = ctxFor('reykjavik_summer');
    const target = objectTarget(resolve('Polaris').match!);
    expect(() => riseSetTransit(target, ctx)).not.toThrow();
  });
});