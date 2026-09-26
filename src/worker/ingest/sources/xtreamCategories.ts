/**
 * Category pre-filter (§2.1): classify Xtream categories once per refresh
 * so only sports/maybe-sports category streams are fetched at all — the
 * single biggest compute saving for large Xtream panels. Keyword lists
 * are intentionally broad; false positives ("maybe-sports") just cost one
 * extra get_live_streams call, false negatives silently drop a sport, so
 * we lean inclusive.
 */
export type CategoryClass = 'sports' | 'maybe-sports' | 'not-sports';

const SPORTS_KEYWORDS = [
  'sport',
  'espn',
  'nfl',
  'nba',
  'wnba',
  'nhl',
  'mlb',
  'ncaa',
  'college football',
  'college basketball',
  'ufc',
  'mma',
  'boxing',
  'soccer',
  'football',
  'fifa',
  'uefa',
  'premier league',
  'la liga',
  'bundesliga',
  'serie a',
  'ligue 1',
  'racing',
  'nascar',
  'f1',
  'formula',
  'golf',
  'pga',
  'tennis',
  'atp',
  'wta',
  'rugby',
  'afl',
  'cricket',
  'darts',
  'snooker',
  'billiard',
  'pool',
  'wwe',
  'wrestling',
  'motogp',
  'olympic',
];

const MAYBE_SPORTS_KEYWORDS = ['ppv', 'pay per view', 'pay-per-view', '24/7', 'events', 'game pass'];

export interface CategoryClassificationResult {
  categoryId: string;
  categoryName: string;
  classification: CategoryClass;
}

/**
 * `overrides` maps a lowercased, trimmed category name to a forced
 * classification — wired to the admin override list (§12) once it exists.
 * Until then, callers may pass {} or omit it.
 */
export function classifyCategory(
  categoryName: string,
  overrides: Record<string, CategoryClass> = {},
): CategoryClass {
  const key = categoryName.trim().toLowerCase();
  if (key in overrides) return overrides[key] as CategoryClass;
  if (SPORTS_KEYWORDS.some((kw) => key.includes(kw))) return 'sports';
  if (MAYBE_SPORTS_KEYWORDS.some((kw) => key.includes(kw))) return 'maybe-sports';
  return 'not-sports';
}

export interface XtreamCategoryLike {
  category_id: string;
  category_name: string;
}

export interface ClassifyCategoriesSummary {
  included: CategoryClassificationResult[];
  excluded: CategoryClassificationResult[];
}

/** Classifies every category once and reports how many were skipped, per §2.1's logging requirement. */
export function classifyCategories(
  categories: XtreamCategoryLike[],
  overrides: Record<string, CategoryClass> = {},
): ClassifyCategoriesSummary {
  const included: CategoryClassificationResult[] = [];
  const excluded: CategoryClassificationResult[] = [];

  for (const cat of categories) {
    const classification = classifyCategory(cat.category_name, overrides);
    const entry: CategoryClassificationResult = {
      categoryId: cat.category_id,
      categoryName: cat.category_name,
      classification,
    };
    if (classification === 'not-sports') excluded.push(entry);
    else included.push(entry);
  }

  return { included, excluded };
}
