/**
 * Sky Detective clue ladder: five progressive hints for one object, all
 * derived from computed catalog data (position, hop, shape, neighbors).
 * Level 5 is the reveal. Clue text is template-phrased; the model only
 * re-voices it when loaded.
 */

import { resolve } from './catalog';
import { findObject, nearbyObjects } from './skyQuery';
import type { CatalogMatch, SkyContext } from './types';

export interface Clue {
  level: number; // 1..5
  text: string;
}

/** Build the five clues for one resolvable object name. */
export function buildClues(name: string, ctx: SkyContext): Clue[] | null {
  let match: CatalogMatch;
  try {
    const resolved = resolve(name);
    if (resolved.ambiguous || !resolved.match) return null;
    match = resolved.match;
  } catch {
    return null;
  }

  const found = findObject(match.name, ctx);
  if (!found.ok || !found.position) return null;

  const pos = found.position;
  const dirText = pos.above_horizon
    ? `Face ${pos.compass} and look ${pos.fists} fists above the horizon`
    : `It is below the horizon right now - it rises at ${found.tonight?.rise ?? 'a later hour'}`;

  const neighbors = match.kind === 'asterism' ? [] : nearbyObjects(match, ctx, 3);
  const nearest = neighbors[0];
  const other = neighbors.find((n) => n.brighter !== null);

  const clues: Clue[] = [
    {
      level: 1,
      text: `${dirText}. ${needsText(found.needs)} Take a look and guess when you have it.`,
    },
    {
      level: 2,
      text: nearest
        ? `Star-hop: start at ${nearest.name} (${nearest.direction}, about ${nearest.fists} fists away) and scan toward it.`
        : `Scan ${pos.compass} about ${pos.fists} fists up, moving your view slowly - it sits in that neighbourhood.`,
    },
    {
      level: 3,
      text: shapeClue(match),
    },
    {
      level: 4,
      text: other
        ? `Compare: it is ${other.brighter ? 'fainter' : 'brighter'} than ${other.name}, about ${other.sep_deg} degrees (${other.fists} fists) away.`
        : `Look for a steady point of light - unlike ${match.kind === 'planet' ? 'the stars around it, it does not twinkle' : 'the stars nearby, it may twinkle'}.`,
    },
    {
      level: 5,
      text: `It is ${match.name}. ${found.fact ? `Fact: ${found.fact}` : (found.summary ?? '')}`,
    },
  ];
  return clues;
}

function needsText(needs: string | undefined): string {
  if (!needs || needs === 'eyes') return 'Naked eye is enough.';
  if (needs.startsWith('binoculars')) return 'Binoculars will show it well.';
  if (needs.startsWith('telescope')) return 'You will want a telescope for this one.';
  return 'Naked eye works from a dark site.';
}

/** Shape/pattern hint from the catalog kind and members. */
function shapeClue(match: CatalogMatch): string {
  if (match.kind === 'asterism') {
    const data = match.data as { members: string[]; tip: string };
    return `Look for a pattern with ${data.members.length} main stars. ${data.tip}`;
  }
  if (match.kind === 'constellation') {
    const data = match.data as { named_stars?: string[] };
    const n = data.named_stars?.length;
    return `It is a whole constellation - a figure made of several fainter stars${n ? ` (its brightest named ones: ${data.named_stars!.slice(0, 3).join(', ')})` : ''}.`;
  }
  if (match.kind === 'messier') {
    return 'Look for something fuzzy, not a sharp point - a deep-sky object.';
  }
  if (match.kind === 'planet') {
    return 'Look for a steady, unflickering point of light - planets hold still while stars twinkle.';
  }
  if (match.kind === 'moon') {
    return 'The brightest thing up there - you cannot miss it once you face the right way.';
  }
  return 'A single bright point of light.';
}

/** Clue count recorded in the session store maps to 0-based index. */
export function clueFor(name: string, ctx: SkyContext, revealed: number): Clue | null {
  const clues = buildClues(name, ctx);
  if (!clues) return null;
  const idx = Math.min(Math.max(revealed, 0), clues.length - 1);
  return clues[idx];
}
