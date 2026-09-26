import path from 'node:path';
import type Database from 'better-sqlite3';
import { loadEnv, dbPath, type AppEnv } from '../shared/config/env';
import { createLogger, type Logger } from '../shared/logger';
import { openDb, runMigrations } from '../shared/db/migrate';
import { buildSourcesFromEnv } from './ingest/buildSources';
import { runChannelIngestCycle, runEpgIngestCycle } from './ingest/ingestCycle';
import { loadIptvOrgData, createFileCache } from './ingest/iptvOrg';
import { runStageA } from './resolve/runStageA';

// §2's refresh cadence: M3U/Xtream channel lists every 6h, EPGs every 3h.
const CHANNEL_INGEST_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EPG_INGEST_INTERVAL_MS = 3 * 60 * 60 * 1000;

// data/aliases.yaml and data/stations.yaml are versioned seed config
// copied into the image next to dist/ (see Dockerfile) — resolve
// relative to this compiled file's location, not process.cwd().
const ALIASES_PATH = path.join(__dirname, '..', '..', 'data', 'aliases.yaml');
const STATIONS_PATH = path.join(__dirname, '..', '..', 'data', 'stations.yaml');

/**
 * Stage A (§4) needs channels.json et al. from iptv-org, refreshed daily
 * (loadIptvOrgData's own cache handles that regardless of how often this
 * is called). If iptv-org is unreachable and there's no cache yet, Stage
 * A still runs — just without the iptv-org half of the cascade — rather
 * than blocking channel resolution entirely (§2: every source is
 * individually disable-able).
 */
async function runStageACycle(db: Database.Database, logger: Logger, env: AppEnv): Promise<void> {
  const cache = createFileCache(path.join(env.DATA_DIR, 'cache', 'iptv-org.json'));

  let iptvOrgData;
  try {
    const result = await loadIptvOrgData({ cache });
    iptvOrgData = result.data;
    if (result.stale) logger.warn('iptv-org data is stale (refresh failed; using last cached copy)');
  } catch (err) {
    logger.warn({ err }, 'iptv-org data unavailable; Stage A running with an empty iptv-org dataset');
    iptvOrgData = { channels: [], feeds: [], logos: [], guides: [], fetchedAt: new Date().toISOString() };
  }

  runStageA(db, logger, iptvOrgData, { aliasesPath: ALIASES_PATH, stationsPath: STATIONS_PATH });
}

/**
 * Worker process entrypoint. Forked by src/entrypoint.ts. Owns all writes to
 * SQLite: ingest, matching, and scoring run here on schedules. The server
 * process only ever reads.
 */
function main(): void {
  const env = loadEnv();
  const logger = createLogger('worker');
  const db = openDb(dbPath(env));
  runMigrations(db, path.join(__dirname, '..', 'shared', 'db', 'migrations'));

  const sources = buildSourcesFromEnv(env);
  logger.info(
    { channelSourceCount: sources.channelSources.length, epgSourceCount: sources.epgSources.length },
    'worker started',
  );

  process.send?.({ type: 'ready' });

  process.on('SIGTERM', () => {
    logger.info('worker received SIGTERM, shutting down');
    db.close();
    process.exit(0);
  });

  async function channelIngestAndResolve(): Promise<void> {
    await runChannelIngestCycle(db, logger, sources);
    await runStageACycle(db, logger, env);
  }

  // Run one pass immediately on startup, then on the fixed cadence. No-op
  // (logs and returns) when no sources are configured for that kind.
  void channelIngestAndResolve().catch((err) => logger.error({ err }, 'channel ingest + Stage A cycle failed'));
  void runEpgIngestCycle(db, logger, sources).catch((err) => logger.error({ err }, 'epg ingest cycle failed'));

  setInterval(() => {
    void channelIngestAndResolve().catch((err) => logger.error({ err }, 'channel ingest + Stage A cycle failed'));
  }, CHANNEL_INGEST_INTERVAL_MS);

  setInterval(() => {
    void runEpgIngestCycle(db, logger, sources).catch((err) => logger.error({ err }, 'epg ingest cycle failed'));
  }, EPG_INGEST_INTERVAL_MS);
}

main();
