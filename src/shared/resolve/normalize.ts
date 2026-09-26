import unidecode from 'unidecode';

/**
 * Name normalization (§4.1). Order matters:
 *  1. Strip a leading country/region prefix ("US:", "USA |", "[US]").
 *  2. Strip "backup" markers.
 *  3. Strip plain-ASCII quality tags (HD, FHD, UHD, 4K, ...).
 *  4. Pull an (East)/(West)-style feed hint off the end, before it's lost
 *     to punctuation stripping.
 *  5. Unidecode — this also disposes of emoji and stylized Unicode
 *     quality markers (e.g. small-caps "ᴿᴬᵂ") for free, since unidecode
 *     has no transliteration for them and drops them to nothing.
 *  6. Strip remaining punctuation, lowercase, collapse whitespace.
 */

const COUNTRY_CODES = [
  'US',
  'USA',
  'UK',
  'GB',
  'CA',
  'CANADA',
  'MX',
  'AU',
  'NZ',
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'LATAM',
  'ARABIC',
  'AR',
  'IN',
  'PK',
  'BR',
];

// The separator after the code is mandatory (":", "|", or " - "), never
// optional — otherwise a bare code that's a legitimate word prefix (e.g.
// "ES" in "ESPN", "CA" in "Canal+") gets amputated. Requiring a real
// delimiter is also what makes JS regex alternation backtrack correctly
// when a shorter code (e.g. "US") is tried before a longer one that's
// actually present ("USA"): "US" fails to find a delimiter right after
// itself in "USA| ...", so the engine backtracks to "USA", which does.
const COUNTRY_PREFIX_RE = new RegExp(
  `^\\s*(?:\\[(${COUNTRY_CODES.join('|')})\\]\\s*|(${COUNTRY_CODES.join('|')})(?:\\s*[:|]\\s*|\\s+-\\s+))`,
  'i',
);

const BACKUP_RE = /\bback\s*-?up\s*\d*\b/gi;

const QUALITY_TAG_RE = /\b(FHD|UHD|SD|HD\d?|4K|8K|RAW|HEVC|H\s*26[45])\b/gi;

const FEED_HINT_WORDS = ['East', 'West', 'Pacific', 'Mountain', 'Central', 'Atlantic'];
const FEED_HINT_RE = new RegExp(`[(\\[]?\\s*(${FEED_HINT_WORDS.join('|')})\\s*[)\\]]?\\s*$`, 'i');

export interface NormalizedName {
  /** Lowercased, ASCII, whitespace-collapsed key — the memoization key for the resolution cascade. */
  normalized: string;
  /** "East"/"West"/etc. when the name carried one, lowercased. Undefined otherwise. */
  feedHint?: string;
}

function stripCountryPrefix(input: string): string {
  let s = input;
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(COUNTRY_PREFIX_RE, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

export function normalizeChannelName(rawName: string): NormalizedName {
  let s = rawName.trim();

  s = stripCountryPrefix(s);
  s = s.replace(BACKUP_RE, ' ');
  s = s.replace(QUALITY_TAG_RE, ' ');

  let feedHint: string | undefined;
  const feedMatch = FEED_HINT_RE.exec(s);
  if (feedMatch?.[1]) {
    feedHint = feedMatch[1].toLowerCase();
    s = s.slice(0, feedMatch.index);
  }

  s = unidecode(s);
  s = s.replace(/[^a-zA-Z0-9\s]/g, ' ');
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();

  return feedHint ? { normalized: s, feedHint } : { normalized: s };
}
