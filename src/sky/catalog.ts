/** Name resolution: turn anything a user types into a sky object.
 * Port of aksa/catalog.py. Resolution order: exact match (stars, Messier,
 * asterisms, constellations, planets, Moon), then curated aliases
 * (including Indian names), then fuzzy matching for typos. Ambiguous
 * queries return a candidate list so the caller can ask which one
 * was meant. Fuse.js replaces difflib; the ambiguity-slack rule is kept. */

import Fuse from 'fuse.js';
import { ALIASES, ASTERISMS, CONSTELLATIONS, MESSIER, NAMED_STARS } from './data';
import { ratio as diffRatio, getCloseMatches } from './difflib';
import type { AsterismEntry, CatalogMatch, ConstellationEntry, MessierEntry, ObjectKind, StarEntry } from './types';

export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'] as const;

export const _FUZZY_CUTOFF = 0.55;
export const _AMBIGUITY_SLACK = 0.06;

export function _norm(text: string): string {
  let t = text.toLowerCase().replace(/['\u2019]/g, '');
  t = t.replace(/[^a-z0-9]+/g, ' ');
  return t.trim().split(/\s+/).filter(Boolean).join(' ');
}

type IndexEntry = [ObjectKind, string];

let _indexMap: Map<string, IndexEntry> | null = null;
let _keys: string[] | null = null;

/** normalized query -> (kind, canonical name). Same build order as Python. */
export function _index(): Map<string, IndexEntry> {
  if (_indexMap) return _indexMap;
  const idx = new Map<string, IndexEntry>();

  for (const st of NAMED_STARS) {
    if (st.name) idx.set(_norm(st.name), ['star', st.name]);
  }

  for (const obj of MESSIER) {
    idx.set(_norm(obj.name), ['messier', obj.name]);
    idx.set(_norm(`M${obj.m}`), ['messier', obj.name]);
    idx.set(_norm(`Messier ${obj.m}`), ['messier', obj.name]);
  }

  for (const name of Object.keys(ASTERISMS)) {
    idx.set(_norm(name), ['asterism', name]);
  }

  for (const c of CONSTELLATIONS) {
    idx.set(_norm(c.name), ['constellation', c.name]);
    idx.set(_norm(c.abbrev), ['constellation', c.name]);
  }

  for (const planet of PLANETS) {
    idx.set(_norm(planet), ['planet', planet]);
  }
  idx.set('moon', ['moon', 'Moon']);
  idx.set('the moon', ['moon', 'Moon']);

  for (const [alias, target] of Object.entries(ALIASES)) {
    idx.set(_norm(alias), [target.kind as ObjectKind, target.name]);
  }

  _indexMap = idx;
  _keys = Array.from(idx.keys());
  return idx;
}

/** Build the full match dict for a resolved (kind, name) pair. */
export function _entity(kind: ObjectKind, name: string): CatalogMatch {
  if (kind === 'star') {
    const st = NAMED_STARS.find((s) => s.name === name);
    if (!st) throw new Error(`star '${name}' missing from stars.json`);
    return { kind, name, data: st as StarEntry };
  }
  if (kind === 'messier') {
    const obj = MESSIER.find((o) => o.name === name);
    if (!obj) throw new Error(`Messier object '${name}' missing from messier.json`);
    return { kind, name, data: obj as MessierEntry };
  }
  if (kind === 'asterism') {
    const data = ASTERISMS[name];
    if (!data) throw new Error(`asterism '${name}' missing from asterisms.json`);
    return { kind, name, data: data as AsterismEntry };
  }
  if (kind === 'constellation') {
    const c = CONSTELLATIONS.find((k) => k.name === name);
    if (!c) throw new Error(`constellation '${name}' missing from constellations.json`);
    return { kind, name, data: c as ConstellationEntry };
  }
  if (kind === 'planet') {
    if (!(PLANETS as readonly string[]).includes(name)) {
      throw new Error(`unknown planet '${name}'`);
    }
    return { kind, name, data: { name } };
  }
  if (kind === 'moon') {
    return { kind, name: 'Moon', data: { name: 'Moon' } };
  }
  throw new Error(`unknown kind '${kind}'`);
}

/** Raised (thrown) when nothing matches; carries suggestions. */
export class UnknownObjectError extends Error {
  suggestions: string[];
  constructor(query: string, suggestions: string[]) {
    super(`Unknown sky object '${query}'. Try: ${suggestions.join(', ')}`);
    this.name = 'UnknownObjectError';
    this.suggestions = suggestions;
  }
}

export interface ResolveResult {
  match?: CatalogMatch;
  ambiguous?: string[];
}

interface ScoredTarget {
  target: IndexEntry;
  similarity: number;
}

function fuzzyRanked(q: string): ScoredTarget[] {
  const idx = _index();
  const scored = new Map<string, { target: IndexEntry; similarity: number }>();
  for (const key of _keys!) {
    const similarity = diffRatio(q, key);
    if (similarity < _FUZZY_CUTOFF) continue;
    const target = idx.get(key)!;
    const tid = `${target[0]}:${target[1]}`;
    const prev = scored.get(tid);
    if (!prev || similarity > prev.similarity) {
      scored.set(tid, { target, similarity });
    }
  }
  return Array.from(scored.values()).sort((a, b) => b.similarity - a.similarity);
}

/** Resolve a user string to a sky object.
 * Returns {match} with kind/name/data, or {ambiguous: [...]} when several
 * objects score equally well. Throws UnknownObjectError with suggestions
 * when nothing matches. */
export function resolve(query: string): ResolveResult {
  const q = _norm(query);
  if (!q) throw new UnknownObjectError(query, []);

  const hit = _index().get(q);
  if (hit) return { match: _entity(hit[0], hit[1]) };

  const ranked = fuzzyRanked(q);
  if (!ranked.length) {
    const raw = getCloseMatches(q, _keys!, 3, 0.35);
    throw new UnknownObjectError(query, raw);
  }

  const topScore = ranked[0].similarity;
  if (ranked.length >= 2 && topScore - ranked[1].similarity <= _AMBIGUITY_SLACK) {
    // Candidates: distinct labels among the near-tied top matches.
    const cands: string[] = [];
    for (const { target, similarity } of ranked) {
      if (similarity < topScore - _AMBIGUITY_SLACK) break;
      const [kind, name] = target;
      const label = kind !== 'moon' ? `${name} (${kind})` : name;
      if (!cands.includes(label)) cands.push(label);
      if (cands.length >= 3) break;
    }
    if (cands.length >= 2) return { ambiguous: cands };
  }
  const [kind, name] = ranked[0].target;
  return { match: _entity(kind, name) };
}

/** Fuzzy suggestions for interactive prompts: canonical labels. */
export function suggest(query: string, n = 5): string[] {
  const q = _norm(query);
  if (!q) return [];
  const matches = getCloseMatches(q, _keys!, n, 0.45);
  const labels: string[] = [];
  for (const key of matches) {
    const target = _index().get(key);
    if (!target) continue;
    const [kind, name] = target;
    const label = kind !== 'moon' ? `${name} (${kind})` : name;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}