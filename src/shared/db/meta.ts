import type Database from 'better-sqlite3';

export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getDataVersion(db: Database.Database): number {
  return Number(getMeta(db, 'data_version') ?? '0');
}

export function bumpDataVersion(db: Database.Database): number {
  const next = getDataVersion(db) + 1;
  setMeta(db, 'data_version', String(next));
  return next;
}
