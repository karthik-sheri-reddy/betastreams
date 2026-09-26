import { loadEnv, dbPath } from '../shared/config/env';
import { createLogger } from '../shared/logger';
import { openDb, runMigrations } from '../shared/db/migrate';
import path from 'node:path';

/**
 * Worker process entrypoint. Forked by src/entrypoint.ts. Owns all writes to
 * SQLite: ingest, matching, and scoring run here on schedules (added in
 * later phases). The server process only ever reads.
 */
function main(): void {
  const env = loadEnv();
  const logger = createLogger('worker');
  const db = openDb(dbPath(env));
  runMigrations(db, path.join(__dirname, '..', 'shared', 'db', 'migrations'));

  logger.info('worker started');

  process.send?.({ type: 'ready' });

  process.on('SIGTERM', () => {
    logger.info('worker received SIGTERM, shutting down');
    db.close();
    process.exit(0);
  });

  // Placeholder heartbeat until Phase 2 adds real ingest scheduling.
  setInterval(() => {
    logger.debug('worker heartbeat');
  }, 60_000);
}

main();
