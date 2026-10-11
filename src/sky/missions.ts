/**
 * Mission building for AI Stargazing Missions.
 * A mission is a chain of verified steps built from challenges.json and
 * visibleTonight; progress lives in the session store only.
 */

import { CHALLENGES, type Challenge } from './data';
import { findObject, nearbyObjects, visibleTonight } from './skyQuery';
import type { VisibleEntry, SkyContext } from './types';
import type { Equipment } from '@/state/session';

export interface MissionStep {
  /** Step kind drives the UI copy. */
  kind: 'anchor' | 'hop' | 'pattern' | 'confirm' | 'learn';
  title: string;
  detail: string;
  /** Reusable hint ladder (Detective clues) for this step's target. */
  targetName: string;
  targetKind: string;
}

export interface Mission {
  id: string;
  title: string;
  minutes: number;
  equipment: Equipment;
  difficulty: 'easy' | 'medium' | 'hard';
  steps: MissionStep[];
  /** Indexes of completed steps (session-only). */
  doneSteps: number[];
}

export interface MissionOptions {
  minutes: number;
  equipment: Equipment;
  difficulty?: 'easy' | 'medium' | 'hard' | 'any';
}

const EQUIP_RANK: Record<string, number> = { eyes: 0, binoculars: 1, telescope: 2 };

/**
 * Build tonight's mission: pick challenges whose target is actually up
 * tonight and within the user's equipment, ordered by difficulty.
 */
export function buildMission(
  ctx: SkyContext,
  visible: VisibleEntry[],
  challenges: Challenge[],
  options: MissionOptions,
): Mission | null {
  const userRank = EQUIP_RANK[options.equipment] ?? 0;
  const visibleNames = new Set(visible.map((v) => v.name.toLowerCase()));

  type Scored = { challenge: Challenge; step: MissionStep; rank: number };
  const scored: Scored[] = [];

  for (const c of challenges) {
    if (options.difficulty && options.difficulty !== 'any' && c.difficulty !== options.difficulty) {
      continue;
    }
    const needRank = c.needs.includes('telescope')
      ? 2
      : c.needs.includes('binoculars')
        ? 1
        : 0;
    if (needRank > userRank) continue;

    const found = findObject(c.target, ctx);
    if (!found.ok || !found.position?.above_horizon) continue;
    // Prefer challenges whose target was already in the visible list,
    // but anything above the horizon is fair game.
    const inVisible = visibleNames.has(c.target.toLowerCase());

    const steps = stepsForChallenge(c, ctx, found.summary ?? '');
    if (!steps) continue;

    scored.push({
      challenge: c,
      step: steps,
      rank:
        (c.difficulty === 'easy' ? 0 : c.difficulty === 'medium' ? 1 : 2) +
        (inVisible ? -0.5 : 0),
    });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => a.rank - b.rank);
  const chosen = scored.slice(0, 3);

  return {
    id: `mission-${ctx.now.getTime()}`,
    title: `Tonight's mission: ${chosen[0].challenge.target}`,
    minutes: options.minutes,
    equipment: options.equipment,
    difficulty: chosen[0].challenge.difficulty,
    steps: chosen.map((s) => s.step),
    doneSteps: [],
  };
}

/** One UI step per challenge, with a hop detail from computed neighbors. */
function stepsForChallenge(
  c: Challenge,
  ctx: SkyContext,
  summary: string,
): MissionStep | null {
  try {
    const found = findObject(c.target, ctx);
    if (!found.ok || !found.position) return null;
    const resolved = found.object
      ? { kind: found.object.kind, name: found.object.name }
      : { kind: 'star', name: c.target };

    const neighbors = nearbyObjects(
      { kind: resolved.kind as never, name: resolved.name, data: { name: resolved.name } as never },
      ctx,
      1,
    );
    const hop = neighbors[0]
      ? `Star-hop from ${neighbors[0].name} (${neighbors[0].direction}, about ${neighbors[0].fists} fists away).`
      : '';

    const kind: MissionStep['kind'] =
      c.text.toLowerCase().includes('pattern') || c.text.toLowerCase().includes('shape')
        ? 'pattern'
        : hop
          ? 'hop'
          : 'confirm';

    return {
      kind,
      title: c.text,
      detail: `${summary}${hop ? ` ${hop}` : ''}`.trim(),
      targetName: resolved.name,
      targetKind: resolved.kind,
    };
  } catch {
    return null;
  }
}

/** Convenience wrapper used by the Missions screen. */
export function buildTonightMission(
  ctx: SkyContext,
  options: MissionOptions,
): Mission | null {
  const visible = visibleTonight(ctx, {
    equipment: options.equipment,
    windowMinutes: options.minutes,
    limit: 40,
  });
  return buildMission(ctx, visible, CHALLENGES, options);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick up to `count` entries, one per kind before repeating a kind, so a
 * random mission samples planets, constellations and stars rather than
 * three similar stars.
 */
export function pickRandomEntries(visible: VisibleEntry[], count: number): VisibleEntry[] {
  if (count <= 0 || !visible.length) return [];
  const pools = new Map<string, VisibleEntry[]>();
  for (const e of visible) {
    const list = pools.get(e.kind) ?? [];
    list.push(e);
    pools.set(e.kind, list);
  }
  const buckets = shuffle([...pools.values()]).map((b) => shuffle(b));
  const picked: VisibleEntry[] = [];
  let bucket = 0;
  while (picked.length < count && buckets.some((b) => b.length)) {
    const next = buckets[bucket % buckets.length].shift();
    if (next) picked.push(next);
    bucket += 1;
  }
  return picked;
}

const RANDOM_TITLES: Record<string, string> = {
  planet: 'Planet watch',
  star: 'Star find',
  constellation: 'Constellation trace',
  asterism: 'Pattern hunt',
  messier: 'Deep-sky dive',
};

/**
 * Random mission straight from what is up at the observer's location,
 * within their equipment and time budget.
 */
export function buildRandomMission(ctx: SkyContext, options: MissionOptions): Mission | null {
  const visible = visibleTonight(ctx, {
    equipment: options.equipment,
    windowMinutes: options.minutes,
    limit: 40,
  });
  const picks = pickRandomEntries(
    visible.filter((e) => e.kind !== 'moon'),
    3,
  );
  if (!picks.length) return null;

  const steps: MissionStep[] = picks.map((e) => ({
    kind: e.kind === 'constellation' || e.kind === 'asterism' ? 'pattern' : 'confirm',
    title: `Find ${e.name} - ${e.compass}, about ${e.fists} fist${e.fists === 1 ? '' : 's'} up`,
    detail: `${e.why}${e.fact ? ` Fact: ${e.fact}` : ''}`.trim(),
    targetName: e.name,
    targetKind: e.kind,
  }));

  return {
    id: `mission-rand-${ctx.now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    title: `${RANDOM_TITLES[picks[0].kind] ?? 'Sky challenge'}: ${picks[0].name}`,
    minutes: options.minutes,
    equipment: options.equipment,
    difficulty: picks.some((p) => p.needs !== 'eyes') ? 'medium' : 'easy',
    steps,
    doneSteps: [],
  };
}

/** Compact mission summary for AI phrasing. */
export function missionPayloadText(mission: Mission): string {
  const lines = mission.steps.map((s, i) => {
    const done = mission.doneSteps.includes(i) ? ' (found)' : '';
    return `${i + 1}. ${s.title}${done} - ${s.detail}`;
  });
  return [
    `Mission: ${mission.title} (${mission.difficulty}, for ${mission.equipment})`,
    ...lines,
  ].join('\n');
}
