import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadEnv, dbPath as resolveDbPath } from '../config/env';

export interface MigrationResult {
  applied: string[];
  current: string[];
}

/**
 * Migrations are plain numbered .sql files applied in order exactly once,
 * tracked in schema_migrations so re-running is a no-op.
 */
export function runMigrations(db: Database.Database, migrationsDir: string): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const already = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => (row as { id: string }).id),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    if (already.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(file);
    });
    tx();
    applied.push(file);
  }

  return { applied, current: files };
}

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

if (require.main === module) {
  const env = loadEnv();
  const db = openDb(resolveDbPath(env));
  const result = runMigrations(db, path.join(__dirname, 'migrations'));
  console.log(`Applied ${result.applied.length} migration(s):`, result.applied);
  db.close();
}
