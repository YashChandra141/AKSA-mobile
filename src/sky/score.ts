/** GO / MAYBE / SKIP verdict for tonight's sky, with human reasons.
 * Line-for-line port of aksa/score.py. */

import type { NightScore, Verdict } from './types';
import { hhmmToMins } from './time';

export function scoreNight(
  cloudPct: number | null,
  moonIllum: number,
  moonUpFraction: number,
  darkHours: number,
): NightScore {
  // cloudPct may be null (unknown -> neutral, the reasons say so).
  const score = 100.0;
  const reasons: string[] = [];
  let s = score;

  if (cloudPct === null || cloudPct === undefined) {
    reasons.push('cloud cover unknown (offline?) - check outside');
  } else {
    // Clouds dominate: full overcast should nearly zero the score.
    s -= cloudPct;
    if (cloudPct <= 25) {
      reasons.push(`mostly clear (${cloudPct.toFixed(0)}% clouds)`);
    } else if (cloudPct <= 55) {
      reasons.push(`partly cloudy (${cloudPct.toFixed(0)}% clouds)`);
    } else {
      reasons.push(`lots of cloud (${cloudPct.toFixed(0)}% clouds)`);
    }
  }

  const moonPenalty = (moonIllum / 100.0) * moonUpFraction * 30.0;
  if (moonPenalty >= 1) {
    s -= moonPenalty;
    if (moonIllum >= 80) {
      reasons.push(
        `bright moon (${moonIllum.toFixed(0)}% lit) washes out faint stars`,
      );
    } else if (moonIllum >= 35) {
      reasons.push(`moon ${moonIllum.toFixed(0)}% lit dims the faint sky a bit`);
    } else {
      reasons.push(`thin moon (${moonIllum.toFixed(0)}% lit)`);
    }
  }

  if (darkHours < 4) {
    s -= 10;
    reasons.push(`short dark window (${darkHours.toFixed(1)} h)`);
  } else if (darkHours >= 8) {
    s += 5;
    reasons.push(`long dark window (${darkHours.toFixed(1)} h)`);
  } else {
    reasons.push(`dark window ${darkHours.toFixed(1)} h`);
  }

  s = Math.max(0.0, Math.min(100.0, s));
  let verdict: Verdict;
  if (s >= 70) verdict = 'GO';
  else if (s >= 40) verdict = 'MAYBE';
  else verdict = 'SKIP';
  return { score: Math.round(s), verdict, reasons };
}

/** Fraction of the dark window the moon spends above the horizon.
 * Simple interval overlap; good enough for scoring. */
export function moonUpFraction(
  rise: string | null,
  set_: string | null,
  darkStart: string,
  darkEnd: string,
): number {
  const s = hhmmToMins(darkStart);
  let e = hhmmToMins(darkEnd);
  if (e <= s) e += 24 * 60;

  if (rise === null && set_ === null) {
    return 0.0; // no events found: the moon is never up in the window
  }
  if (rise === null) {
    // Already up when the window began (it rose the previous evening);
    // count only up to its set, not the whole night.
    const st = set_ ? hhmmToMins(set_) : e;
    return Math.min(1.0, Math.max(0.0, Math.min(e, st) - s) / Math.max(1, e - s));
  }
  const r = hhmmToMins(rise);
  const st = set_ ? hhmmToMins(set_) : e;
  let overlap: number;
  if (st < r) {
    // The set happens before the rise, so it belongs to this same
    // evening: the moon is up from window start until it sets.
    overlap = Math.max(0.0, Math.min(e, st) - s);
  } else {
    overlap = Math.max(0.0, Math.min(e, st) - Math.max(s, r));
  }
  return Math.min(1.0, overlap / Math.max(1, e - s));
}