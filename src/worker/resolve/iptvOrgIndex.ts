import type { IptvOrgData, IptvOrgChannel } from '../ingest/iptvOrg';
import { normalizeChannelName } from '../../shared/resolve/normalize';

export interface IptvOrgIndex {
  byId: Map<string, IptvOrgChannel>;
  /** normalized display/alt name -> channel id. First writer wins on a collision (rare, and only ever between two equally-plausible candidates). */
  byNormalizedName: Map<string, string>;
}

/**
 * Builds the lookup structures Stage A's cascade needs from iptv-org's
 * channels.json (§4 cascade steps 1-2). Closed/defunct channels are
 * excluded — resolving a live stream to a channel iptv-org itself
 * considers shut down would be actively wrong.
 */
export function buildIptvOrgIndex(data: IptvOrgData): IptvOrgIndex {
  const byId = new Map<string, IptvOrgChannel>();
  const byNormalizedName = new Map<string, string>();

  for (const channel of data.channels) {
    if (channel.closed) continue;
    byId.set(channel.id, channel);

    for (const name of [channel.name, ...(channel.alt_names ?? [])]) {
      const { normalized } = normalizeChannelName(name);
      if (normalized && !byNormalizedName.has(normalized)) {
        byNormalizedName.set(normalized, channel.id);
      }
    }
  }

  return { byId, byNormalizedName };
}

/** Cascade step 1: tvg-id (or Xtream epg_channel_id) that resolves to a known iptv-org id. */
export function resolveByChannelId(index: IptvOrgIndex, tvgId: string): string | undefined {
  return index.byId.has(tvgId) ? tvgId : undefined;
}

/** Cascade step 2 (iptv-org half): exact normalized-name/alt-name lookup. */
export function resolveByNormalizedName(index: IptvOrgIndex, normalizedName: string): string | undefined {
  return index.byNormalizedName.get(normalizedName);
}
