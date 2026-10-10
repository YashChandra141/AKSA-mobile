/**
 * Sky Guide payload: tonight's verdict plus a ranked shortlist of what to
 * actually look at, filtered by the user's equipment and time budget.
 * This is the computed backbone the Guide screen shows directly and hands
 * to the model for phrasing - the model adds no facts of its own.
 */

import { darkWindow } from './astro';
import { tonightSummary, visibleTonight } from './skyQuery';
import { cloudForDarkWindow } from '@/services/weather';
import type { DarkWindow, SkyContext, TonightSummary, VisibleEntry } from './types';

export interface GuidePayload {
  summary: TonightSummary;
  /** Best targets for this user's equipment and time budget. */
  picks: VisibleEntry[];
  cloudFetched: boolean;
}

/** Rank rule: planets first, then brightest stars, then asterisms. */
function rankKey(e: VisibleEntry): number {
  if (e.kind === 'planet') return 0;
  if (e.kind === 'star' && e.mag !== null) return 1 + e.mag;
  if (e.kind === 'moon') return 90; // shown via the verdict, not as a pick
  return 50; // asterisms
}

/**
 * Build the full Guide payload for the current observing context.
 * Makes the single network call (cloud cover) when not offline.
 */
export async function buildGuidePayload(
  ctx: SkyContext,
  equipment: 'eyes' | 'binoculars' | 'telescope',
  minutes: number,
  offline = false,
): Promise<GuidePayload> {
  const dark: DarkWindow | null = darkWindow(ctx);
  let preCloud: number | null = null;
  let cloudFetched = false;
  if (dark && !offline) {
    preCloud = await cloudForDarkWindow(ctx.lat, ctx.lon, dark, ctx.now, ctx.tz, offline);
    cloudFetched = preCloud !== null;
  }
  const summary = tonightSummary(ctx, () => preCloud, offline || !cloudFetched);

  const picks = visibleTonight(ctx, {
    dark,
    equipment,
    windowMinutes: minutes,
    limit: 40,
  })
    .filter((e) => e.kind !== 'moon')
    .sort((a, b) => rankKey(a) - rankKey(b))
    .slice(0, 5);

  return { summary, picks, cloudFetched };
}

/** Compact text form for the model prompt (and template narration). */
export function guidePayloadText(payload: GuidePayload, minutes: number): string {
  const s = payload.summary;
  const lines: string[] = [];
  lines.push(
    `Verdict: ${s.verdict} (${s.score}/100). ${s.summary}`,
    `Dark window: ${s.dark ? `${s.dark.start} to ${s.dark.end} (${s.dark.hours} h, ${s.dark.kind})` : 'none tonight'}`,
    `Moon: ${s.moon.phase}, ${s.moon.percent_lit}% lit` +
      (s.moon.rise ? `, rises ${s.moon.rise}` : '') +
      (s.moon.set ? `, sets ${s.moon.set}` : ''),
    `Clouds: ${s.cloud === null ? 'unknown' : `about ${s.cloud}%`}`,
  );
  if (s.planets.length) {
    lines.push(
      `Planets: ${s.planets
        .map((p) => `${p.name} best ${p.best_time} ${p.compass} ${p.fists} fists up`)
        .join('; ')}`,
    );
  }
  if (payload.picks.length) {
    lines.push(
      `Best targets in your ${minutes} minutes: ` +
        payload.picks
          .map((e) => `${e.name} (${e.compass}, ${e.fists} fists up, needs ${e.needs})`)
          .join('; '),
    );
  }
  if (s.reasons.length) lines.push(`Reasons: ${s.reasons.join('; ')}`);
  return lines.join('\n');
}
