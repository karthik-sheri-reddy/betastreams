import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ChannelSource, EpgSource, ChannelRecord, ProgrammeRecord } from '../../shared/types/source';
import { redactCredentials } from '../../shared/redact';
import {
  upsertSourceMeta,
  markSourceHealth,
  getSourceContentHash,
  setSourceContentHash,
  replaceChannelsForSource,
  replaceProgrammesForSource,
} from './store';

export interface IngestResult {
  sourceId: string;
  /** True when the content hash matched the last ingest — no DB writes happened (§9: "warm re-ingest is a no-op"). */
  skipped: boolean;
  recordCount: number;
  error?: string;
}

/**
 * Deterministic hash of a record set: order-independent (sorted by a
 * stable key first) so a provider re-shuffling the same channels/
 * programmes between requests doesn't look like a change. This is what
 * makes "hash every source and skip unchanged ones" (§9) possible
 * without needing raw-byte access into each adapter.
 */
function hashRecords<T>(records: T[], keyFn: (r: T) => string): string {
  const sorted = [...records].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(sorted));
  return hash.digest('hex');
}

const channelKey = (r: ChannelRecord): string => `${r.sourceId}\u0000${r.streamKey}`;
const programmeKey = (r: ProgrammeRecord): string =>
  `${r.sourceId}\u0000${r.channelRef}\u0000${r.start}\u0000${r.title}`;

export async function ingestChannelSource(
  db: Database.Database,
  source: ChannelSource,
): Promise<IngestResult> {
  upsertSourceMeta(db, { id: source.sourceId, kind: source.kind });

  let records: ChannelRecord[];
  try {
    records = await source.fetchChannels();
  } catch (err) {
    const message = redactCredentials(err instanceof Error ? err.message : String(err));
    markSourceHealth(db, source.sourceId, false, message);
    return { sourceId: source.sourceId, skipped: false, recordCount: 0, error: message };
  }

  markSourceHealth(db, source.sourceId, true);

  const hash = hashRecords(records, channelKey);
  const previousHash = getSourceContentHash(db, source.sourceId, 'channels');
  if (hash === previousHash) {
    return { sourceId: source.sourceId, skipped: true, recordCount: records.length };
  }

  replaceChannelsForSource(db, source.sourceId, records);
  setSourceContentHash(db, source.sourceId, 'channels', hash);
  return { sourceId: source.sourceId, skipped: false, recordCount: records.length };
}

export async function ingestEpgSource(db: Database.Database, source: EpgSource): Promise<IngestResult> {
  upsertSourceMeta(db, { id: source.sourceId, kind: 'epg' });

  let records: ProgrammeRecord[];
  try {
    records = [];
    for await (const rec of source.fetchProgrammes()) records.push(rec);
  } catch (err) {
    const message = redactCredentials(err instanceof Error ? err.message : String(err));
    markSourceHealth(db, source.sourceId, false, message);
    return { sourceId: source.sourceId, skipped: false, recordCount: 0, error: message };
  }

  markSourceHealth(db, source.sourceId, true);

  const hash = hashRecords(records, programmeKey);
  const previousHash = getSourceContentHash(db, source.sourceId, 'programmes');
  if (hash === previousHash) {
    return { sourceId: source.sourceId, skipped: true, recordCount: records.length };
  }

  replaceProgrammesForSource(db, source.sourceId, records);
  setSourceContentHash(db, source.sourceId, 'programmes', hash);
  return { sourceId: source.sourceId, skipped: false, recordCount: records.length };
}
