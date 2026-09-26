import { describe, it, expect } from 'vitest';
import {
  jaroSimilarity,
  jaroWinkler,
  tokenSetRatio,
  editRatio,
  levenshteinDistance,
  networkFamilyOf,
  combinedFuzzyScore,
} from './fuzzy';

describe('jaroSimilarity / jaroWinkler', () => {
  // Reference values are the textbook examples from Winkler's own papers
  // on the algorithm — these are the standard cross-check for any
  // from-scratch Jaro-Winkler implementation.
  it('matches the textbook MARTHA/MARHTA values', () => {
    expect(jaroSimilarity('MARTHA', 'MARHTA')).toBeCloseTo(0.944, 3);
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.961, 3);
  });

  it('matches the textbook DWAYNE/DUANE values', () => {
    expect(jaroSimilarity('DWAYNE', 'DUANE')).toBeCloseTo(0.822, 3);
    expect(jaroWinkler('DWAYNE', 'DUANE')).toBeCloseTo(0.84, 2);
  });

  it('matches the textbook DIXON/DICKSONX values', () => {
    expect(jaroSimilarity('DIXON', 'DICKSONX')).toBeCloseTo(0.767, 3);
    expect(jaroWinkler('DIXON', 'DICKSONX')).toBeCloseTo(0.813, 3);
  });

  it('is 1 for identical strings and 0 for a shared-nothing comparison against empty', () => {
    expect(jaroWinkler('espn', 'espn')).toBe(1);
    expect(jaroWinkler('', 'espn')).toBe(0);
    expect(jaroWinkler('espn', '')).toBe(0);
  });

  it('is symmetric', () => {
    expect(jaroWinkler('bally sports', 'fanduel sports')).toBeCloseTo(
      jaroWinkler('fanduel sports', 'bally sports'),
      10,
    );
  });

  it('scores a near-miss channel-name typo highly', () => {
    // A single transposed letter should still score very close to 1.
    expect(jaroWinkler('espn deportes', 'espn deprotes')).toBeGreaterThan(0.9);
  });
});

describe('levenshteinDistance / editRatio', () => {
  it('is 0 for identical strings and len(b) for an empty a', () => {
    expect(levenshteinDistance('espn', 'espn')).toBe(0);
    expect(levenshteinDistance('', 'espn')).toBe(4);
  });

  it('counts a single substitution as distance 1', () => {
    expect(levenshteinDistance('espn', 'espm')).toBe(1);
  });

  it('editRatio is 1 for identical strings and between 0 and 1 otherwise', () => {
    expect(editRatio('espn', 'espn')).toBe(1);
    const r = editRatio('espn', 'golf');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });
});

describe('tokenSetRatio', () => {
  it('scores 1 for the same words in a different order', () => {
    expect(tokenSetRatio('espn deportes', 'deportes espn')).toBe(1);
  });

  it('scores 1 when one side is a superset (e.g. an extra quality-tag word)', () => {
    expect(tokenSetRatio('fox sports detroit', 'fox sports detroit hd')).toBe(1);
  });

  it('scores low for unrelated channel names', () => {
    expect(tokenSetRatio('espn', 'golf channel')).toBeLessThan(0.3);
  });

  it('scores moderately for a partial overlap', () => {
    const r = tokenSetRatio('fox sports detroit', 'fox sports ohio');
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(1);
  });
});

describe('combinedFuzzyScore', () => {
  it('does not let tokenSetRatio\'s subset-match inflation beat a genuinely closer same-length candidate', () => {
    // tokenSetRatio alone gives "espn" a perfect 1.0 against "espn
    // deprotes" (pure token subset) — that must not win over "espn
    // deportes", the actually-correct near-typo match.
    const query = 'espn deprotes';
    expect(combinedFuzzyScore(query, 'espn deportes')).toBeGreaterThan(combinedFuzzyScore(query, 'espn'));
  });

  it('still benefits from tokenSetRatio for legitimate same-length word-reordering', () => {
    const a = 'fox sports detroit';
    const b = 'detroit fox sports';
    expect(combinedFuzzyScore(a, b)).toBe(1);
  });

  it('falls back to plain Jaro-Winkler when the two strings are very different lengths', () => {
    expect(combinedFuzzyScore('espn', 'espn deportes network extra')).toBe(jaroWinkler('espn', 'espn deportes network extra'));
  });
});

describe('networkFamilyOf', () => {
  it('buckets ESPN-family names, including numbered variants', () => {
    expect(networkFamilyOf('espn')).toBe('ESPN');
    expect(networkFamilyOf('espn2')).toBe('ESPN');
    expect(networkFamilyOf('espn deportes')).toBe('ESPN');
  });

  it('buckets RSN rebrand chains under one family regardless of brand name', () => {
    expect(networkFamilyOf('fox sports detroit')).toBe('FOX_SPORTS');
    expect(networkFamilyOf('bally sports detroit')).toBe('RSN');
    expect(networkFamilyOf('fanduel sports network detroit')).toBe('RSN');
  });

  it('distinguishes national FOX/CBS/NBC from their -Sports- sub-brands', () => {
    expect(networkFamilyOf('fox news')).toBe('FOX');
    expect(networkFamilyOf('nbc sports boston')).toBe('NBC_SPORTS');
    expect(networkFamilyOf('cbs sports network')).toBe('CBS_SPORTS');
  });

  it('returns undefined for a name with no known network family', () => {
    expect(networkFamilyOf('golf channel')).toBeUndefined();
    expect(networkFamilyOf('comedy central')).toBeUndefined();
  });
});
