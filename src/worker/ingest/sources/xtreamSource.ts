import type { XtreamAccountConfig } from '../../../shared/config/xtreamAccounts';
import type { ChannelRecord, ChannelSource, EpgSource, ProgrammeRecord } from '../../../shared/types/source';
import { checkXtreamAccount, resolveOutputExt, xtreamApiUrl, xtreamHeaders } from './xtreamAccount';
import { classifyCategories, type CategoryClass } from './xtreamCategories';
import { fetchXmltvProgrammes } from '../xmltv';

export interface XtreamCategoryDto {
  category_id: string;
  category_name: string;
}

export interface XtreamLiveStreamDto {
  stream_id: number;
  name: string;
  stream_icon?: string;
  epg_channel_id?: string;
  category_id?: string;
  tv_archive?: number;
  tv_archive_duration?: number;
}

export class XtreamAccountUnhealthyError extends Error {
  constructor(readonly reason: string) {
    super(`Xtream account unhealthy: ${reason}`);
  }
}

async function fetchJson<T>(url: string, account: XtreamAccountConfig): Promise<T> {
  const res = await fetch(url, { headers: xtreamHeaders(account) });
  if (!res.ok) {
    throw new Error(`Xtream API request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export interface XtreamChannelSourceOptions {
  categoryOverrides?: Record<string, CategoryClass>;
  /** Called with the pre-filter summary once per fetchChannels() call, per §2.1's logging requirement. */
  onCategoriesClassified?: (summary: { includedCount: number; excludedCount: number }) => void;
}

export class XtreamChannelSource implements ChannelSource {
  readonly kind = 'xtream' as const;
  readonly sourceId: string;

  constructor(
    private readonly account: XtreamAccountConfig,
    private readonly options: XtreamChannelSourceOptions = {},
  ) {
    this.sourceId = account.id;
  }

  async fetchChannels(): Promise<ChannelRecord[]> {
    const health = await checkXtreamAccount(this.account);
    if (!health.healthy) {
      throw new XtreamAccountUnhealthyError(health.reason ?? 'unknown');
    }

    const ext = resolveOutputExt(this.account, health.userInfo);

    const categories = await fetchJson<XtreamCategoryDto[]>(
      xtreamApiUrl(this.account, { action: 'get_live_categories' }),
      this.account,
    );
    const { included, excluded } = classifyCategories(categories, this.options.categoryOverrides);
    this.options.onCategoriesClassified?.({ includedCount: included.length, excludedCount: excluded.length });

    const categoryNameById = new Map(categories.map((c) => [c.category_id, c.category_name]));

    const records: ChannelRecord[] = [];
    for (const cat of included) {
      const streams = await fetchJson<XtreamLiveStreamDto[]>(
        xtreamApiUrl(this.account, { action: 'get_live_streams', category_id: cat.categoryId }),
        this.account,
      );
      for (const stream of streams) {
        records.push({
          sourceId: this.sourceId,
          streamKey: String(stream.stream_id),
          name: stream.name,
          tvgId: stream.epg_channel_id || undefined,
          logo: stream.stream_icon || undefined,
          group: categoryNameById.get(stream.category_id ?? '') ?? cat.categoryName,
          // {server}/{username}/{password} are resolved only in the /play
          // route (§8) from this source's account config, never stored
          // resolved — see the ChannelRecord.urlTemplate doc comment.
          urlTemplate: `{server}/live/{username}/{password}/${stream.stream_id}.${ext}`,
          containerExt: ext,
          tvArchive: stream.tv_archive === 1,
          tvArchiveDurationHours: stream.tv_archive_duration,
        });
      }
    }

    return records;
  }
}

export class XtreamEpgSource implements EpgSource {
  readonly sourceId: string;

  constructor(private readonly account: XtreamAccountConfig) {
    this.sourceId = account.id;
  }

  fetchProgrammes(): AsyncIterable<ProgrammeRecord> {
    const url = new URL(`${this.account.serverUrl}/xmltv.php`);
    url.searchParams.set('username', this.account.username);
    url.searchParams.set('password', this.account.password);
    return fetchXmltvProgrammes(url.toString(), this.sourceId, { headers: xtreamHeaders(this.account) });
  }
}

export interface ShortEpgEntry {
  title: string;
  description?: string;
  start: string;
  end: string;
}

interface ShortEpgListingDto {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
}

function decodeXtreamBase64(value: string): string {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    // get_short_epg encodes every text field; a value that isn't valid
    // base64 round-trips to garbage full of replacement characters, in
    // which case the provider sent plain text and we use it as-is.
    return decoded.includes('�') ? value : decoded;
  } catch {
    return value;
  }
}

/**
 * Short-EPG fallback (§2.1): only meant to be called for sports-category
 * channels with no programmes in the full guide, near a candidate event,
 * rate-limited by the caller, and cached ~30 min — none of which this
 * function does itself. It's a single request; the worker's scheduling
 * layer (Phase 5/6) is responsible for the "only when needed, rate
 * limited" policy.
 */
export async function fetchShortEpg(
  account: XtreamAccountConfig,
  streamId: number,
  limit = 4,
): Promise<ShortEpgEntry[]> {
  const url = xtreamApiUrl(account, {
    action: 'get_short_epg',
    stream_id: String(streamId),
    limit: String(limit),
  });
  const body = await fetchJson<{ epg_listings?: ShortEpgListingDto[] }>(url, account);
  const listings = body.epg_listings ?? [];
  return listings
    .filter((l): l is Required<Pick<ShortEpgListingDto, 'title' | 'start' | 'end'>> & ShortEpgListingDto =>
      Boolean(l.title && l.start && l.end),
    )
    .map((l) => ({
      title: decodeXtreamBase64(l.title),
      description: l.description ? decodeXtreamBase64(l.description) : undefined,
      start: l.start,
      end: l.end,
    }));
}
