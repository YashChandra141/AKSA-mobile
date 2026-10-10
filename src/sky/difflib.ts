/**
 * Minimal faithful port of Python's difflib.SequenceMatcher and
 * get_close_matches, so the fuzzy-name behavior (including the
 * ambiguity tie rule) matches the reference implementation exactly.
 * Fuse.js is kept for interactive suggestions elsewhere, but scoring
 * here uses the real ratios.
 *
 * Port of the CPython difflib algorithm (no junk/autojunk, matching
 * aksa's usage: SequenceMatcher(None, a, b) with default settings).
 */

const b2jCache = new Map<string, Map<string, number[]>>();

function b2jFor(b: string): Map<string, number[]> {
  let m = b2jCache.get(b);
  if (m) return m;
  m = new Map();
  for (let i = 0; i < b.length; i++) {
    const ch = b[i];
    const arr = m.get(ch);
    if (arr) arr.push(i);
    else m.set(ch, [i]);
  }
  b2jCache.set(b, m);
  return m;
}

interface Match {
  i: number; // index into a
  j: number; // index into b
  k: number; // length
}

function findLongestMatch(a: string, b: string, b2j: Map<string, number[]>, alo: number, ahi: number, blo: number, bhi: number): Match {
  const j2len = new Map<number, number>();
  let best: Match = { i: alo, j: blo, k: 0 };
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const idxs = b2j.get(a[i]) ?? [];
    for (const j of idxs) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > best.k) {
        best = { i: i - k + 1, j: j - k + 1, k };
      }
    }
    j2len.clear();
    for (const [k, v] of newj2len) j2len.set(k, v);
  }
  return best;
}

/** difflib.SequenceMatcher(None, a, b).ratio() */
export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 1.0;
  if (!a.length || !b.length) return 0.0;
  const b2j = b2jFor(b);
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const m = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    matches += m.k;
    if (m.k > 0) {
      // CPython guards the recursion on a non-empty match; without this
      // a zero-match range would re-enqueue itself forever.
      if (alo < m.i && blo < m.j) queue.push([alo, m.i, blo, m.j]);
      if (m.i + m.k < ahi && m.j + m.k < bhi) queue.push([m.i + m.k, ahi, m.j + m.k, bhi]);
    }
  }
  return (2.0 * matches) / (a.length + b.length);
}

/** difflib.get_close_matches with the same defaults aksa uses. */
export function getCloseMatches(word: string, possibilities: string[], n = 3, cutoff = 0.6): string[] {
  const scored: { value: string; score: number }[] = [];
  for (const p of possibilities) {
    const s = ratio(word, p);
    if (s >= cutoff) scored.push({ value: p, score: s });
  }
  // Python: heapq.nlargest(n, results) with (score, value) keys ->
  // sort by score desc, then value desc (string comparison).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.value < b.value ? 1 : a.value > b.value ? -1 : 0;
  });
  return scored.slice(0, n).map((s) => s.value);
}