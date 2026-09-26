import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations, openDb } from './migrate';
import { getDataVersion, bumpDataVersion, setMeta, getMeta } from './meta';

const migrationsDir = path.join(__dirname, 'migrations');
let tmpDir: string;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('applies all migrations once and is idempotent on re-run', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-test-'));
    const db = openDb(path.join(tmpDir, 'app.db'));

    const first = runMigrations(db, migrationsDir);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = runMigrations(db, migrationsDir);
    expect(second.applied).toEqual([]);

    db.close();
  });

  it('sets up the meta table with an initial data_version', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-test-'));
    const db = openDb(path.join(tmpDir, 'app.db'));
    runMigrations(db, migrationsDir);

    expect(getDataVersion(db)).toBe(0);
    expect(bumpDataVersion(db)).toBe(1);
    expect(getDataVersion(db)).toBe(1);

    setMeta(db, 'foo', 'bar');
    expect(getMeta(db, 'foo')).toBe('bar');

    db.close();
  });
});

describe('openDb', () => {
  it('enables WAL mode', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-test-'));
    const db: Database.Database = openDb(path.join(tmpDir, 'app.db'));
    const row = db.pragma('journal_mode', { simple: true });
    expect(row).toBe('wal');
    db.close();
  });
});
