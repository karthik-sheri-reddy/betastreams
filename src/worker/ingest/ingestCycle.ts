import type Database from 'better-sqlite3';
import type { Logger } from '../../shared/logger';
import { bumpDataVersion } from '../../shared/db/meta';
import { ingestChannelSource, ingestEpgSource } from './runIngest';
import type { BuiltSources } from './buildSources';

/**
 * One pass over every configured channel source. Sequential, not
 * parallel — politeness (§2.1: don't hammer providers) matters more here
 * than shaving a few seconds off ingest, and Phase 2's sources are small
 * enough that this is not the bottleneck.
 */
export async function runChannelIngestCycle(
  db: Database.Database,
  logger: Logger,
  sources: BuiltSources,
): Promise<void> {
  let changed = false;
  for (const source of sources.channelSources) {
    const result = await ingestChannelSource(db, source);
    if (result.error) {
      logger.warn({ sourceId: result.sourceId, error: result.error }, 'channel ingest failed');
    } else {
      logger.info(
        { sourceId: result.sourceId, skipped: result.skipped, recordCount: result.recordCount },
        'channel ingest',
      );
      if (!result.skipped) changed = true;
    }
  }
  if (changed) {
    const v = bumpDataVersion(db);
    logger.info({ dataVersion: v }, 'data version bumped after channel ingest');
  }
}

export async function runEpgIngestCycle(
  db: Database.Database,
  logger: Logger,
  sources: BuiltSources,
): Promise<void> {
  let changed = false;
  for (const source of sources.epgSources) {
    const result = await ingestEpgSource(db, source);
    if (result.error) {
      logger.warn({ sourceId: result.sourceId, error: result.error }, 'epg ingest failed');
    } else {
      logger.info(
        { sourceId: result.sourceId, skipped: result.skipped, recordCount: result.recordCount },
        'epg ingest',
      );
      if (!result.skipped) changed = true;
    }
  }
  if (changed) {
    const v = bumpDataVersion(db);
    logger.info({ dataVersion: v }, 'data version bumped after epg ingest');
  }
}
