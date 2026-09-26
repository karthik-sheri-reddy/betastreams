import fs from 'node:fs';
import path from 'node:path';

const IPTV_ORG_BASE_URL = 'https://iptv-org.github.io/api';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // daily, per §2

export interface IptvOrgChannel {
  id: string;
  name: string;
  alt_names?: string[];
  network?: string;
  owners?: string[];
  country?: string;
  subdivision?: string;
  categories?: string[];
  closed?: boolean;
}

export interface IptvOrgFeed {
  channel: string;
  id: string;
  name?: string;
  is_main?: boolean;
  broadcast_area?: string[];
  languages?: string[];
}

export interface IptvOrgLogo {
  channel: string;
  feed?: string | null;
  url: string;
}

export interface IptvOrgGuide {
  channel: string;
  feed?: string | null;
  site: string;
  site_id: string;
  site_name?: string;
}

export interface IptvOrgData {
  channels: IptvOrgChannel[];
  feeds: IptvOrgFeed[];
  logos: IptvOrgLogo[];
  guides: IptvOrgGuide[];
  fetchedAt: string;
}

export interface IptvOrgCache {
  read(): IptvOrgData | undefined;
  write(data: IptvOrgData): void;
}

/** File-backed cache: one JSON blob on disk, timestamped by fetchedAt. */
export function createFileCache(cachePath: string): IptvOrgCache {
  return {
    read() {
      try {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        return JSON.parse(raw) as IptvOrgData;
      } catch {
        return undefined;
      }
    },
    write(data) {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(data));
    },
  };
}

async function fetchJsonArray<T>(fetchImpl: typeof fetch, url: string): Promise<T[]> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`iptv-org fetch failed (${res.status}) for ${url}`);
  return (await res.json()) as T[];
}

export interface LoadIptvOrgOptions {
  cache: IptvOrgCache;
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
}

export interface LoadIptvOrgResult {
  data: IptvOrgData;
  /** True when this is cached data served because a fresh fetch failed (§2: "serve the last good data and mark it stale"). */
  stale: boolean;
}

/**
 * Loads iptv-org's channels/feeds/logos/guides, refreshed daily. On a
 * failed refresh, falls back to the last cached copy and marks it stale
 * rather than failing ingest outright — this data is a supporting lookup
 * (canonical IDs, alt names, logos), not something Stage A can't proceed
 * without.
 */
export async function loadIptvOrgData(options: LoadIptvOrgOptions): Promise<LoadIptvOrgResult> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cached = options.cache.read();

  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < maxAgeMs) {
    return { data: cached, stale: false };
  }

  try {
    const [channels, feeds, logos, guides] = await Promise.all([
      fetchJsonArray<IptvOrgChannel>(fetchImpl, `${IPTV_ORG_BASE_URL}/channels.json`),
      fetchJsonArray<IptvOrgFeed>(fetchImpl, `${IPTV_ORG_BASE_URL}/feeds.json`),
      fetchJsonArray<IptvOrgLogo>(fetchImpl, `${IPTV_ORG_BASE_URL}/logos.json`),
      fetchJsonArray<IptvOrgGuide>(fetchImpl, `${IPTV_ORG_BASE_URL}/guides.json`),
    ]);
    const data: IptvOrgData = { channels, feeds, logos, guides, fetchedAt: new Date().toISOString() };
    options.cache.write(data);
    return { data, stale: false };
  } catch (err) {
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}
