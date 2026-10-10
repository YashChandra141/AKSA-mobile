/** Template fallbacks: computed answers with no model involved.
 * Ports of narrator._template and chat._fallback_text from the Python
 * reference. Every AI feature falls back to these when no model is
 * loaded, init fails, or generation errors out. */

import { fmtG } from '../sky/time';

interface PlanData {
  dark?: { start?: string; end?: string; hours?: number; kind?: string } | null;
  moon?: { phase_name?: string; percent_lit?: number } | null;
  planets?: { name: string; compass: string; fists: number }[] | null;
}

/** Tonight's short observing plan, fully templated. */
export function templatePlan(data: PlanData): string {
  const dark = data.dark ?? {};
  const moon = data.moon ?? {};
  const planets = data.planets ?? [];
  const bits = [`Head out after ${dark.start ?? 'darkness'}.`];
  if (moon.phase_name) {
    bits.push(
      `The Moon is a ${moon.phase_name.toLowerCase()} at ${moon.percent_lit}% lit.`,
    );
  }
  if (planets.length) {
    const first = planets[0];
    bits.push(
      `Start with ${first.name} in the ${first.compass.toLowerCase()}, about ${fmtG(first.fists)} fists up.`,
    );
  }
  if (planets.length > 1) {
    const second = planets[1];
    bits.push(
      `Then find ${second.name} toward the ${second.compass.toLowerCase()}.`,
    );
  }
  bits.push('Give your eyes 20 minutes to adjust; use a red light.');
  return bits.join(' ');
}

/** Computed summary + fact + ambiguity/error, joined like chat._fallback_text. */
export function fallbackText(result: Record<string, unknown>): string {
  const bits: string[] = [];
  const summary = result.summary;
  if (typeof summary === 'string' && summary) bits.push(summary);
  const fact = result.fact;
  if (typeof fact === 'string' && fact) bits.push(`Fact: ${fact}`);
  const ambiguous = result.ambiguous;
  if (Array.isArray(ambiguous) && ambiguous.length) {
    bits.push(
      `Did you mean ${ambiguous.slice(0, -1).join(', ')} or ${ambiguous[ambiguous.length - 1]}?`,
    );
  }
  const error = result.error;
  if (typeof error === 'string' && error) bits.push(error);
  return bits.join('\n') || 'No data available.';
}