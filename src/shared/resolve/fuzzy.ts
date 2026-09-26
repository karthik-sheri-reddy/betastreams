/**
 * Small, self-contained fuzzy-matching primitives (§1: "implement
 * Jaro-Winkler and token-set ratio yourself... small and testable").
 * Used by Stage A's cascade step 4 (fuzzy match blocked by network
 * family) and reusable later for the team lexicon (§6.4).
 */

/** Standard Jaro similarity, 0-1. */
export function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const len1 = a.length;
  const len2 = b.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j += 1) {
      if (s2Matches[j] || a[i] !== b[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i += 1) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  transpositions = Math.floor(transpositions / 2);

  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler: Jaro similarity plus a bonus for a shared prefix (up to 4 chars, scaling factor p, default 0.1). */
export function jaroWinkler(a: string, b: string, p = 0.1): number {
  const jaro = jaroSimilarity(a, b);
  const maxPrefix = 4;
  let prefixLen = 0;
  const limit = Math.min(a.length, b.length, maxPrefix);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) break;
    prefixLen += 1;
  }
  return jaro + prefixLen * p * (1 - jaro);
}

/** Classic edit-distance (Levenshtein), for the ratio() helper below. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  let currRow = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i += 1) {
    currRow[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        (prevRow[j] as number) + 1,
        currRow[j - 1] as number + 1,
        (prevRow[j - 1] as number) + cost,
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n] as number;
}

/** Similarity ratio in [0, 1] derived from edit distance: 1 - distance / max(len). */
export function editRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/**
 * Token-set ratio (fuzzywuzzy-style): splits both strings into word
 * sets, then compares the sorted intersection against
 * intersection+each side's leftover tokens, taking the best score. This
 * makes "ESPN Deportes" and "Deportes ESPN HD" score identically to
 * "ESPN Deportes" vs "ESPN Deportes" once quality tags are normalized
 * away, since token order and duplicated shared words no longer matter.
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).sort();
  const onlyA = [...tokensA].filter((t) => !tokensB.has(t)).sort();
  const onlyB = [...tokensB].filter((t) => !tokensA.has(t)).sort();

  const sortedIntersection = intersection.join(' ');
  const combinedA = [...intersection, ...onlyA].join(' ').trim();
  const combinedB = [...intersection, ...onlyB].join(' ').trim();

  return Math.max(
    editRatio(sortedIntersection, combinedA),
    editRatio(sortedIntersection, combinedB),
    editRatio(combinedA, combinedB),
  );
}

/**
 * Coarse "network family" bucket for blocking fuzzy candidates (§4 step
 * 4) — never fuzzy-match across families (an ESPN-family name should
 * never fuzzy-match a Fox-family channel, however similar the strings).
 * Order matters: more specific patterns are checked first. Operates on
 * an already-normalized (lowercased) name.
 */
const FAMILY_PATTERNS: Array<[RegExp, string]> = [
  [/\bespn/, 'ESPN'],
  [/\b(bally sports|fanduel sports network|fsn)\b/, 'RSN'],
  [/\bfox sports\b/, 'FOX_SPORTS'],
  [/\bnbc sports\b/, 'NBC_SPORTS'],
  [/\bcbs sports\b/, 'CBS_SPORTS'],
  [/\bfox\b/, 'FOX'],
  [/\bcbs\b/, 'CBS'],
  [/\bnbc\b/, 'NBC'],
  [/\babc\b/, 'ABC'],
];

/**
 * Combines both metrics for candidate ranking. tokenSetRatio scores a
 * pure token subset as a perfect 1.0 by design (intentional for partial-
 * search use cases like "New York Yankees" vs "Yankees") — but that's
 * actively wrong for identity resolution: "ESPN" is not a good match for
 * "ESPN Deportes" just because every one of its tokens also appears
 * there. Only trust tokenSetRatio's boost when the two strings are
 * reasonably comparable in length; otherwise fall back to Jaro-Winkler
 * alone, which doesn't have this subset blind spot.
 */
export function combinedFuzzyScore(a: string, b: string): number {
  const jw = jaroWinkler(a, b);
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length, 1);
  if (lengthRatio < 0.6) return jw;
  return Math.max(jw, tokenSetRatio(a, b));
}

export function networkFamilyOf(normalizedName: string): string | undefined {
  for (const [pattern, family] of FAMILY_PATTERNS) {
    if (pattern.test(normalizedName)) return family;
  }
  return undefined;
}
