import type Database from 'better-sqlite3';
import type { ChannelResolution, MemoizedResolution } from './cascade';

export function loadResolvedNamesMemo(db: Database.Database): Map<string, MemoizedResolution> {
  const rows = db
    .prepare('SELECT normalized_key, canonical_channel_id, resolution_method, resolution_confidence FROM resolved_names')
    .all() as Array<{
    normalized_key: string;
    canonical_channel_id: string | null;
    resolution_method: MemoizedResolution['resolutionMethod'];
    resolution_confidence: number;
  }>;

  const memo = new Map<string, MemoizedResolution>();
  for (const row of rows) {
    memo.set(row.normalized_key, {
      canonicalChannelId: row.canonical_channel_id ?? undefined,
      resolutionMethod: row.resolution_method,
      resolutionConfidence: row.resolution_confidence,
    });
  }
  return memo;
}

/** Persists every entry in a resolver's memo snapshot, so the next worker run starts warm (§4: "a stable playlist re-ingest does almost no fuzzy work"). */
export function saveResolvedNamesMemo(db: Database.Database, memo: Map<string, MemoizedResolution>): void {
  const upsert = db.prepare(
    `INSERT INTO resolved_names (normalized_key, canonical_channel_id, resolution_method, resolution_confidence, updated_at)
     VALUES (@normalized_key, @canonical_channel_id, @resolution_method, @resolution_confidence, datetime('now'))
     ON CONFLICT(normalized_key) DO UPDATE SET
       canonical_channel_id = excluded.canonical_channel_id,
       resolution_method = excluded.resolution_method,
       resolution_confidence = excluded.resolution_confidence,
       updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((entries: Array<[string, MemoizedResolution]>) => {
    for (const [normalizedKey, r] of entries) {
      upsert.run({
        normalized_key: normalizedKey,
        canonical_channel_id: r.canonicalChannelId ?? null,
        resolution_method: r.resolutionMethod,
        resolution_confidence: r.resolutionConfidence,
      });
    }
  });
  tx([...memo.entries()]);
}

export function saveChannelResolutions(db: Database.Database, resolutions: ChannelResolution[]): void {
  const upsert = db.prepare(
    `INSERT INTO channel_resolutions
       (source_id, stream_key, normalized_key, feed_hint, is_event_channel, canonical_channel_id,
        resolution_method, resolution_confidence, updated_at)
     VALUES (@source_id, @stream_key, @normalized_key, @feed_hint, @is_event_channel, @canonical_channel_id,
             @resolution_method, @resolution_confidence, datetime('now'))
     ON CONFLICT(source_id, stream_key) DO UPDATE SET
       normalized_key = excluded.normalized_key,
       feed_hint = excluded.feed_hint,
       is_event_channel = excluded.is_event_channel,
       canonical_channel_id = excluded.canonical_channel_id,
       resolution_method = excluded.resolution_method,
       resolution_confidence = excluded.resolution_confidence,
       updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((rows: ChannelResolution[]) => {
    for (const r of rows) {
      upsert.run({
        source_id: r.sourceId,
        stream_key: r.streamKey,
        normalized_key: r.normalizedKey,
        feed_hint: r.feedHint ?? null,
        is_event_channel: r.isEventChannel ? 1 : 0,
        canonical_channel_id: r.canonicalChannelId ?? null,
        resolution_method: r.resolutionMethod,
        resolution_confidence: r.resolutionConfidence,
      });
    }
  });
  tx(resolutions);
}

export function countChannelResolutions(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM channel_resolutions').get() as { n: number };
  return row.n;
}

export function countUnresolvedChannelResolutions(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM channel_resolutions WHERE resolution_method = 'unresolved'")
    .get() as { n: number };
  return row.n;
}
