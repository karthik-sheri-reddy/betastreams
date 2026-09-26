import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, runMigrations } from '../../shared/db/migrate';
import {
  loadResolvedNamesMemo,
  saveResolvedNamesMemo,
  saveChannelResolutions,
  countChannelResolutions,
  countUnresolvedChannelResolutions,
} from './store';
import type { ChannelResolution, MemoizedResolution } from './cascade';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-stagea-'));
  db = openDb(path.join(tmpDir, 'app.db'));
  runMigrations(db, path.join(__dirname, '..', '..', 'shared', 'db', 'migrations'));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolved_names memo persistence', () => {
  it('round-trips a memo map through save/load', () => {
    const memo = new Map<string, MemoizedResolution>([
      ['espn', { canonicalChannelId: 'ESPN.us', resolutionMethod: 'tvg_id', resolutionConfidence: 0.99 }],
      ['unknown channel', { canonicalChannelId: undefined, resolutionMethod: 'unresolved', resolutionConfidence: 0 }],
    ]);
    saveResolvedNamesMemo(db, memo);

    const loaded = loadResolvedNamesMemo(db);
    expect(loaded.get('espn')).toEqual({
      canonicalChannelId: 'ESPN.us',
      resolutionMethod: 'tvg_id',
      resolutionConfidence: 0.99,
    });
    expect(loaded.get('unknown channel')).toEqual({
      canonicalChannelId: undefined,
      resolutionMethod: 'unresolved',
      resolutionConfidence: 0,
    });
  });

  it('upserts: saving the same key twice updates rather than duplicates', () => {
    saveResolvedNamesMemo(
      db,
      new Map([['espn', { canonicalChannelId: 'ESPN.us', resolutionMethod: 'fuzzy' as const, resolutionConfidence: 0.86 }]]),
    );
    saveResolvedNamesMemo(
      db,
      new Map([['espn', { canonicalChannelId: 'ESPN.us', resolutionMethod: 'alias' as const, resolutionConfidence: 0.95 }]]),
    );
    const loaded = loadResolvedNamesMemo(db);
    expect(loaded.size).toBe(1);
    expect(loaded.get('espn')?.resolutionMethod).toBe('alias');
  });
});

describe('channel_resolutions persistence', () => {
  const resolution = (overrides: Partial<ChannelResolution> = {}): ChannelResolution => ({
    sourceId: 'src1',
    streamKey: 'k1',
    normalizedKey: 'espn',
    isEventChannel: false,
    canonicalChannelId: 'ESPN.us',
    resolutionMethod: 'tvg_id',
    resolutionConfidence: 0.99,
    ...overrides,
  });

  it('saves and counts resolutions', () => {
    saveChannelResolutions(db, [resolution(), resolution({ streamKey: 'k2', canonicalChannelId: undefined, resolutionMethod: 'unresolved', resolutionConfidence: 0 })]);
    expect(countChannelResolutions(db)).toBe(2);
    expect(countUnresolvedChannelResolutions(db)).toBe(1);
  });

  it('upserts by (source_id, stream_key)', () => {
    saveChannelResolutions(db, [resolution()]);
    saveChannelResolutions(db, [resolution({ canonicalChannelId: 'ESPN2.us', resolutionMethod: 'fuzzy', resolutionConfidence: 0.87 })]);
    expect(countChannelResolutions(db)).toBe(1);

    const row = db.prepare('SELECT canonical_channel_id, resolution_method FROM channel_resolutions').get() as {
      canonical_channel_id: string;
      resolution_method: string;
    };
    expect(row.canonical_channel_id).toBe('ESPN2.us');
    expect(row.resolution_method).toBe('fuzzy');
  });
});
