/**
 * Random mission tests: challenges generated from what is actually
 * visible at the observer's location tonight (kind diversity, horizons,
 * payload serialization). Pure computation - no model, no network.
 */

import { makeTime, visibleTonight } from '@/sky/skyQuery';
import {
  buildRandomMission,
  missionPayloadText,
  pickRandomEntries,
} from '@/sky/missions';
import type { SkyContext, VisibleEntry } from '@/sky/types';
import type { Equipment } from '@/state/session';

function puneCtx(): SkyContext {
  return {
    lat: 18.5204,
    lon: 73.8567,
    tz: 'Asia/Kolkata',
    now: makeTime(2024, 10, 18, 20, 30, 'Asia/Kolkata'),
    label: 'Pune',
  };
}

function entry(name: string, kind: VisibleEntry['kind']): VisibleEntry {
  return {
    kind,
    name,
    mag: 1.5,
    best_time: '21:00',
    best_alt: 40,
    compass: 'east',
    fists: 4,
    needs: 'eyes',
    fact: `Fact about ${name}.`,
    why: `${name} is well placed tonight.`,
  };
}

describe('pickRandomEntries', () => {
  it('returns the requested count, all from the input', () => {
    const visible = [
      entry('Jupiter', 'planet'),
      entry('Saturn', 'planet'),
      entry('Sirius', 'star'),
      entry('Vega', 'star'),
      entry('Orion', 'constellation'),
      entry('Cassiopeia', 'constellation'),
    ];
    const picked = pickRandomEntries(visible, 3);
    expect(picked).toHaveLength(3);
    for (const p of picked) expect(visible).toContain(p);
  });

  it('prefers kind diversity: one from each kind first', () => {
    const visible = [
      entry('Jupiter', 'planet'),
      entry('Saturn', 'planet'),
      entry('Sirius', 'star'),
      entry('Vega', 'star'),
      entry('Orion', 'constellation'),
      entry('Cassiopeia', 'constellation'),
    ];
    const picked = pickRandomEntries(visible, 3);
    const kinds = new Set(picked.map((p) => p.kind));
    expect(kinds.size).toBe(3);
  });

  it('handles empty and oversized requests', () => {
    expect(pickRandomEntries([], 3)).toEqual([]);
    const one = [entry('Sirius', 'star')];
    const picked = pickRandomEntries(one, 3);
    expect(picked).toEqual(one);
  });
});

describe('buildRandomMission', () => {
  it('builds up to 3 location-based steps from the visible sky', () => {
    const ctx = puneCtx();
    const mission = buildRandomMission(ctx, {
      minutes: 30,
      equipment: 'eyes',
      difficulty: 'any',
    });
    if (!mission) {
      // Only valid if nothing at all was visible - must not happen at a
      // dark Pune instant, but guard the assertion anyway.
      const visible = visibleTonight(ctx, { equipment: 'eyes', windowMinutes: 30, limit: 40 });
      expect(visible.filter((v) => v.kind !== 'moon')).toHaveLength(0);
      return;
    }
    expect(mission.id).toMatch(/^mission-rand-/);
    expect(mission.steps.length).toBeGreaterThan(0);
    expect(mission.steps.length).toBeLessThanOrEqual(3);
    expect(mission.doneSteps).toEqual([]);
    for (const step of mission.steps) {
      expect(step.targetName).toBeTruthy();
      expect(step.targetKind).toBeTruthy();
      expect(step.title).toContain(step.targetName);
    }
  });

  it('uses a pattern step for constellation targets', () => {
    const ctx = puneCtx();
    const mission = buildRandomMission(ctx, {
      minutes: 30,
      equipment: 'eyes',
      difficulty: 'any',
    });
    if (!mission) return;
    for (const step of mission.steps) {
      if (step.targetKind === 'constellation') {
        expect(step.kind).toBe('pattern');
      }
    }
  });
});

describe('missionPayloadText', () => {
  it('lists steps and marks found ones', () => {
    const ctx = puneCtx();
    const mission = buildRandomMission(ctx, {
      minutes: 30,
      equipment: 'eyes',
      difficulty: 'any',
    });
    if (!mission) return;
    const fresh = missionPayloadText(mission);
    expect(fresh).toContain(mission.title);
    expect(fresh).toContain('1. ');

    const done: typeof mission = {
      ...mission,
      doneSteps: [0],
    };
    const text = missionPayloadText(done);
    expect(text).toContain('(found)');
  });
});
