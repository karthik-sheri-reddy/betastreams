import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, runMigrations } from '../../shared/db/migrate';
import { createLogger } from '../../shared/logger';
import { replaceChannelsForSource } from '../ingest/store';
import { runStageA } from './runStageA';
import { loadResolvedNamesMemo } from './store';
import type { ChannelRecord } from '../../shared/types/source';
import type { IptvOrgData } from '../ingest/iptvOrg';

process.env.PUBLIC_BASE_URL ??= 'http://localhost:7000';

const ALIASES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'aliases.yaml');
const STATIONS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'stations.yaml');

const iptvOrgData: IptvOrgData = {
  channels: [
    { id: 'ESPN.us', name: 'ESPN', alt_names: ['ESPN USA'] },
    { id: 'ESPN2.us', name: 'ESPN2' },
  ],
  feeds: [],
  logos: [],
  guides: [],
  fetchedAt: new Date().toISOString(),
};

let tmpDir: string;
let db: Database.Database;
const logger = createLogger('test');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-runstagea-'));
  db = openDb(path.join(tmpDir, 'app.db'));
  runMigrations(db, path.join(__dirname, '..', '..', 'shared', 'db', 'migrations'));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedChannels(records: ChannelRecord[]): void {
  replaceChannelsForSource(db, records[0]?.sourceId ?? 'src1', records);
}

describe('runStageA', () => {
  it('resolves ingested channels end to end and persists a per-method summary', () => {
    seedChannels([
      { sourceId: 'src1', streamKey: 'k1', name: 'US: ESPN HD', urlTemplate: 'x', containerExt: 'ts', tvgId: 'ESPN.us' },
      { sourceId: 'src1', streamKey: 'k2', name: 'Bally Sports Detroit', urlTemplate: 'x', containerExt: 'ts' },
      { sourceId: 'src1', streamKey: 'k3', name: 'WABC New York', urlTemplate: 'x', containerExt: 'ts' },
      {
        sourceId: 'src1',
        streamKey: 'k4',
        name: 'PPV 3 - UFC 320',
        urlTemplate: 'x',
        containerExt: 'ts',
        group: 'PPV EVENTS',
      },
      { sourceId: 'src1', streamKey: 'k5', name: 'Some Totally Unknown Channel', urlTemplate: 'x', containerExt: 'ts' },
    ]);

    const summary = runStageA(db, logger, iptvOrgData, {
      aliasesPath: ALIASES_PATH,
      stationsPath: STATIONS_PATH,
    });

    expect(summary.total).toBe(5);
    expect(summary.eventChannels).toBe(1);
    expect(summary.byMethod.tvg_id).toBe(1);
    expect(summary.byMethod.alias).toBe(1);
    expect(summary.byMethod.callsign).toBe(1);
    expect(summary.byMethod.unresolved).toBe(1);

    const persisted = db.prepare('SELECT COUNT(*) AS n FROM channel_resolutions').get() as { n: number };
    expect(persisted.n).toBe(5);
  });

  it('persists the resolved_names memo so a second run reuses it (no re-fuzzy-matching needed)', () => {
    seedChannels([
      { sourceId: 'src1', streamKey: 'k1', name: 'ESPN Deprotes', urlTemplate: 'x', containerExt: 'ts' },
    ]);

    runStageA(db, logger, { ...iptvOrgData, channels: [{ id: 'ESPNDeportes.us', name: 'ESPN Deportes' }] }, {
      aliasesPath: ALIASES_PATH,
      stationsPath: STATIONS_PATH,
    });

    const memo = loadResolvedNamesMemo(db);
    expect(memo.get('espn deprotes')?.canonicalChannelId).toBe('ESPNDeportes.us');

    // A second run with an empty iptv-org dataset still resolves the
    // same name correctly, purely from the persisted memo.
    const secondSummary = runStageA(db, logger, { ...iptvOrgData, channels: [] }, {
      aliasesPath: ALIASES_PATH,
      stationsPath: STATIONS_PATH,
    });
    expect(secondSummary.byMethod.fuzzy).toBe(1);
  });
});
