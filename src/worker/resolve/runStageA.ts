import type Database from 'better-sqlite3';
import type { Logger } from '../../shared/logger';
import { ChannelResolver, type CascadeContext } from './cascade';
import { loadResolvedNamesMemo, saveResolvedNamesMemo, saveChannelResolutions } from './store';
import type { IptvOrgData } from '../ingest/iptvOrg';
import { buildIptvOrgIndex } from './iptvOrgIndex';
import { loadAliasesFromFile, buildAliasIndex } from '../../shared/config/aliases';
import {
  loadStationsFromFile,
  buildStationIndex,
  buildStationByNetworkCityIndex,
} from '../../shared/config/stations';

export interface StageARunSummary {
  total: number;
  eventChannels: number;
  byMethod: Record<string, number>;
}

interface RawChannelRow {
  source_id: string;
  stream_key: string;
  name: string;
  tvg_id: string | null;
  group_name: string | null;
}

function readAllChannels(db: Database.Database): RawChannelRow[] {
  return db
    .prepare('SELECT source_id, stream_key, name, tvg_id, group_name FROM channels')
    .all() as RawChannelRow[];
}

export interface StageAConfigPaths {
  aliasesPath: string;
  stationsPath: string;
}

/** Builds the cascade's read-only lookup structures. Pure of any DB access beyond the iptv-org data already loaded by the caller. */
export function buildCascadeContext(iptvOrgData: IptvOrgData, config: StageAConfigPaths): CascadeContext {
  const iptvOrgIndex = buildIptvOrgIndex(iptvOrgData);
  const aliasesFile = loadAliasesFromFile(config.aliasesPath);
  const stationsFile = loadStationsFromFile(config.stationsPath);

  return {
    iptvOrgIndex,
    aliasIndex: buildAliasIndex(aliasesFile),
    stationByCallsign: buildStationIndex(stationsFile),
    stationByNetworkCity: buildStationByNetworkCityIndex(stationsFile),
    // Every iptv-org channel is a fuzzy candidate; step 4 only reaches
    // here when steps 1-3 already failed to find an exact hit, and
    // networkFamilyOf() blocking (inside ChannelResolver) keeps this
    // pool from mattering much in practice.
    fuzzyCandidates: [...iptvOrgIndex.byNormalizedName.entries()].map(([normalized, canonicalChannelId]) => ({
      normalized,
      canonicalChannelId,
    })),
  };
}

/**
 * Runs Stage A (§4) over every channel Phase 2's ingest has stored: for
 * each, detect event channels first, then resolve regular channels via
 * the tvg-id -> alias -> call-sign -> blocked-fuzzy cascade, memoizing by
 * normalized name both within this run and (via resolved_names)
 * across worker restarts.
 */
export function runStageA(
  db: Database.Database,
  logger: Logger,
  iptvOrgData: IptvOrgData,
  config: StageAConfigPaths,
): StageARunSummary {
  const ctx = buildCascadeContext(iptvOrgData, config);
  const initialMemo = loadResolvedNamesMemo(db);
  const resolver = new ChannelResolver(ctx, initialMemo);

  const rows = readAllChannels(db);
  const resolutions = rows.map((row) =>
    resolver.resolve({
      sourceId: row.source_id,
      streamKey: row.stream_key,
      name: row.name,
      tvgId: row.tvg_id ?? undefined,
      group: row.group_name ?? undefined,
    }),
  );

  saveChannelResolutions(db, resolutions);
  saveResolvedNamesMemo(db, resolver.getMemoSnapshot());

  const summary: StageARunSummary = { total: resolutions.length, eventChannels: 0, byMethod: {} };
  for (const r of resolutions) {
    if (r.isEventChannel) summary.eventChannels += 1;
    summary.byMethod[r.resolutionMethod] = (summary.byMethod[r.resolutionMethod] ?? 0) + 1;
  }

  logger.info(summary, 'Stage A run complete');
  return summary;
}
