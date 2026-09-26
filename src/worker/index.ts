import path from 'node:path';
import { loadEnv, dbPath } from '../shared/config/env';
import { createLogger } from '../shared/logger';
import { openDb, runMigrations } from '../shared/db/migrate';
import { buildSourcesFromEnv } from './ingest/buildSources';
import { runChannelIngestCycle, runEpgIngestCycle } from './ingest/ingestCycle';

// §2's refresh cadence: M3U/Xtream channel lists every 6h, EPGs every 3h.
const CHANNEL_INGEST_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EPG_INGEST_INTERVAL_MS = 3 * 60 * 60 * 1000;

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

  // Run one pass immediately on startup, then on the fixed cadence. No-op
  // (logs and returns) when no sources are configured for that kind.
  void runChannelIngestCycle(db, logger, sources).catch((err) =>
    logger.error({ err }, 'channel ingest cycle failed'),
  );
  void runEpgIngestCycle(db, logger, sources).catch((err) => logger.error({ err }, 'epg ingest cycle failed'));

  setInterval(() => {
    void runChannelIngestCycle(db, logger, sources).catch((err) =>
      logger.error({ err }, 'channel ingest cycle failed'),
    );
  }, CHANNEL_INGEST_INTERVAL_MS);

  setInterval(() => {
    void runEpgIngestCycle(db, logger, sources).catch((err) =>
      logger.error({ err }, 'epg ingest cycle failed'),
    );
  }, EPG_INGEST_INTERVAL_MS);
}

main();
