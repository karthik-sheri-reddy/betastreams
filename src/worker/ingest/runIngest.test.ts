import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, runMigrations } from '../../shared/db/migrate';
import { ingestChannelSource, ingestEpgSource } from './runIngest';
import { countChannelsForSource, countProgrammesForSource } from './store';
import type { ChannelRecord, ChannelSource, EpgSource, ProgrammeRecord } from '../../shared/types/source';

let tmpDir: string;
let db: Database.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-ingest-'));
  db = openDb(path.join(tmpDir, 'app.db'));
  runMigrations(db, path.join(__dirname, '..', '..', 'shared', 'db', 'migrations'));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fakeChannelSource(sourceId: string, records: ChannelRecord[]): ChannelSource {
  return {
    sourceId,
    kind: 'm3u',
    async fetchChannels() {
      return records;
    },
  };
}

function fakeEpgSource(sourceId: string, records: ProgrammeRecord[]): EpgSource {
  return {
    sourceId,
    async *fetchProgrammes() {
      for (const r of records) yield r;
    },
  };
}

const channel = (n: number): ChannelRecord => ({
  sourceId: 'src1',
  streamKey: `k${n}`,
  name: `Channel ${n}`,
  urlTemplate: `http://example.com/${n}.ts`,
  containerExt: 'ts',
});

describe('ingestChannelSource', () => {
  it('inserts channels on first ingest', async () => {
    const source = fakeChannelSource('src1', [channel(1), channel(2)]);
    const result = await ingestChannelSource(db, source);
    expect(result).toMatchObject({ sourceId: 'src1', skipped: false, recordCount: 2 });
    expect(countChannelsForSource(db, 'src1')).toBe(2);
  });

  it('is a no-op on a warm re-ingest with unchanged content', async () => {
    const records = [channel(1), channel(2)];
    await ingestChannelSource(db, fakeChannelSource('src1', records));

    // Re-ingest with an identical (but freshly-constructed) record array —
    // simulates re-fetching the same upstream playlist.
    const result = await ingestChannelSource(db, fakeChannelSource('src1', [channel(1), channel(2)]));
    expect(result.skipped).toBe(true);
    expect(countChannelsForSource(db, 'src1')).toBe(2);
  });

  it('is a no-op even when the same records arrive in a different order', async () => {
    await ingestChannelSource(db, fakeChannelSource('src1', [channel(1), channel(2)]));
    const result = await ingestChannelSource(db, fakeChannelSource('src1', [channel(2), channel(1)]));
    expect(result.skipped).toBe(true);
  });

  it('replaces rows and reports skipped=false when content actually changes', async () => {
    await ingestChannelSource(db, fakeChannelSource('src1', [channel(1)]));
    const result = await ingestChannelSource(db, fakeChannelSource('src1', [channel(1), channel(2)]));
    expect(result.skipped).toBe(false);
    expect(countChannelsForSource(db, 'src1')).toBe(2);
  });

  it('marks the source unhealthy (without throwing) when fetchChannels fails, redacting credentials', async () => {
    const source: ChannelSource = {
      sourceId: 'src1',
      kind: 'xtream',
      async fetchChannels() {
        throw new Error(
          'request failed for http://host/player_api.php?username=secretuser&password=secretpass',
        );
      },
    };
    const result = await ingestChannelSource(db, source);
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain('secretuser');
    expect(result.error).not.toContain('secretpass');

    const row = db.prepare('SELECT healthy, last_error FROM sources WHERE id = ?').get('src1') as {
      healthy: number;
      last_error: string;
    };
    expect(row.healthy).toBe(0);
    expect(row.last_error).not.toContain('secretpass');
  });
});

describe('ingestEpgSource', () => {
  const programme = (n: number): ProgrammeRecord => ({
    sourceId: 'src1',
    channelRef: 'ESPN.us',
    title: `Programme ${n}`,
    start: `2026-01-15T1${n}:00:00.000Z`,
    stop: `2026-01-15T1${n}:30:00.000Z`,
  });

  it('inserts programmes on first ingest', async () => {
    const result = await ingestEpgSource(db, fakeEpgSource('src1', [programme(1), programme(2)]));
    expect(result).toMatchObject({ skipped: false, recordCount: 2 });
    expect(countProgrammesForSource(db, 'src1')).toBe(2);
  });

  it('is a no-op on a warm re-ingest with unchanged content', async () => {
    await ingestEpgSource(db, fakeEpgSource('src1', [programme(1), programme(2)]));
    const result = await ingestEpgSource(db, fakeEpgSource('src1', [programme(1), programme(2)]));
    expect(result.skipped).toBe(true);
    expect(countProgrammesForSource(db, 'src1')).toBe(2);
  });

  it('replaces rows when programmes change', async () => {
    await ingestEpgSource(db, fakeEpgSource('src1', [programme(1)]));
    const result = await ingestEpgSource(db, fakeEpgSource('src1', [programme(1), programme(2)]));
    expect(result.skipped).toBe(false);
    expect(countProgrammesForSource(db, 'src1')).toBe(2);
  });

  it('marks the source unhealthy when the async generator throws', async () => {
    const source: EpgSource = {
      sourceId: 'src1',
      async *fetchProgrammes(): AsyncIterable<ProgrammeRecord> {
        throw new Error('guide fetch failed');
      },
    };
    const result = await ingestEpgSource(db, source);
    expect(result.error).toContain('guide fetch failed');
    const row = db.prepare('SELECT healthy FROM sources WHERE id = ?').get('src1') as { healthy: number };
    expect(row.healthy).toBe(0);
  });
});
