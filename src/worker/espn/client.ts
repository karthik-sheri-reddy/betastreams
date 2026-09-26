/**
 * Thin client for the public (undocumented) ESPN site API — see
 * github.com/pseudo-r/Public-ESPN-API. Treated as a prior, never ground
 * truth (§2): callers combine this with EPG/market data rather than
 * trusting `broadcasts`/`geoBroadcasts` alone.
 */

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

export interface EspnCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  team: {
    id: string;
    displayName: string;
    shortDisplayName?: string;
    abbreviation?: string;
    location?: string;
    name?: string;
    logo?: string;
  };
  curatedRank?: { current?: number };
}

export interface EspnBroadcast {
  names?: string[];
  market?: string;
}

export interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  status: {
    type: {
      state: 'pre' | 'in' | 'post';
      completed?: boolean;
    };
  };
  competitions: Array<{
    id: string;
    venue?: { fullName?: string };
    competitors: EspnCompetitor[];
    broadcasts?: EspnBroadcast[];
    geoBroadcasts?: Array<{ media?: { shortName?: string }; market?: { type?: string } }>;
  }>;
}

export interface EspnScoreboardResponse {
  events: EspnEvent[];
}

export interface EspnTeam {
  id: string;
  displayName: string;
  shortDisplayName?: string;
  abbreviation?: string;
  location?: string;
  name?: string;
  logos?: Array<{ href: string }>;
}

export interface FetchResult<T> {
  /** 200 = fresh body returned, 304 = upstream said "not modified" (conditional request hit). */
  status: 200 | 304 | number;
  body?: T;
  etag?: string;
}

export interface EspnFetchOptions {
  etag?: string;
  fetchImpl?: typeof fetch;
}

function buildUrl(sportPath: string, leaguePath: string, suffix: string, query?: Record<string, string>): string {
  const url = new URL(`${ESPN_BASE_URL}/${sportPath}/${leaguePath}/${suffix}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

async function conditionalGet<T>(url: string, options: EspnFetchOptions = {}): Promise<FetchResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'User-Agent': 'betastreams/0.1 (+sports EPG matcher)' };
  if (options.etag) headers['If-None-Match'] = options.etag;

  const res = await fetchImpl(url, { headers });
  if (res.status === 304) {
    return { status: 304, etag: options.etag };
  }
  if (!res.ok) {
    return { status: res.status };
  }
  const body = (await res.json()) as T;
  const etag = res.headers.get('etag') ?? undefined;
  return { status: 200, body, etag };
}

/** `date` is YYYYMMDD, ESPN's scoreboard format. Omit for "today" in ESPN's own timezone handling. */
export async function fetchEspnScoreboard(
  sportPath: string,
  leaguePath: string,
  date?: string,
  options: EspnFetchOptions = {},
): Promise<FetchResult<EspnScoreboardResponse>> {
  const url = buildUrl(sportPath, leaguePath, 'scoreboard', date ? { dates: date } : undefined);
  return conditionalGet<EspnScoreboardResponse>(url, options);
}

export async function fetchEspnTeams(
  sportPath: string,
  leaguePath: string,
  options: EspnFetchOptions = {},
): Promise<FetchResult<{ sports: Array<{ leagues: Array<{ teams: Array<{ team: EspnTeam }> }> }> }>> {
  const url = buildUrl(sportPath, leaguePath, 'teams');
  return conditionalGet(url, options);
}

/**
 * §9's adaptive polling rule: 60s once anything in this league is live,
 * 10min once anything starts within 6h, 60min otherwise. Pure and
 * deterministic so the scheduling policy is unit-testable without a
 * clock or network.
 */
export function computeAdaptivePollIntervalMs(events: EspnEvent[], now: Date = new Date()): number {
  const SIXTY_SECONDS = 60_000;
  const TEN_MINUTES = 10 * 60_000;
  const SIXTY_MINUTES = 60 * 60_000;
  const SIX_HOURS_MS = 6 * 60 * 60_000;

  const hasLive = events.some((e) => e.status.type.state === 'in');
  if (hasLive) return SIXTY_SECONDS;

  const hasUpcomingSoon = events.some((e) => {
    if (e.status.type.state !== 'pre') return false;
    const start = new Date(e.date).getTime();
    return start - now.getTime() <= SIX_HOURS_MS && start - now.getTime() >= 0;
  });
  if (hasUpcomingSoon) return TEN_MINUTES;

  return SIXTY_MINUTES;
}
