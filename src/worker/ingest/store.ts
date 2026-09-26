import type Database from 'better-sqlite3';
import type { ChannelRecord, ProgrammeRecord } from '../../shared/types/source';

export type IngestArtifact = 'channels' | 'programmes';

export function upsertSourceMeta(
  db: Database.Database,
  source: { id: string; kind: string; label?: string },
): void {
  db.prepare(
    `INSERT INTO sources (id, kind, label, healthy, last_error, updated_at)
     VALUES (?, ?, ?, 1, NULL, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, label = excluded.label`,
  ).run(source.id, source.kind, source.label ?? null);
}

export function markSourceHealth(
  db: Database.Database,
  sourceId: string,
  healthy: boolean,
  lastError?: string,
): void {
  db.prepare(
    `UPDATE sources SET healthy = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(healthy ? 1 : 0, lastError ?? null, sourceId);
}

export function getSourceContentHash(
  db: Database.Database,
  sourceId: string,
  artifact: IngestArtifact,
): string | undefined {
  const row = db
    .prepare('SELECT content_hash FROM source_hashes WHERE source_id = ? AND artifact = ?')
    .get(sourceId, artifact) as { content_hash: string } | undefined;
  return row?.content_hash;
}

export function setSourceContentHash(
  db: Database.Database,
  sourceId: string,
  artifact: IngestArtifact,
  hash: string,
): void {
  db.prepare(
    `INSERT INTO source_hashes (source_id, artifact, content_hash, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(source_id, artifact) DO UPDATE SET content_hash = excluded.content_hash, updated_at = datetime('now')`,
  ).run(sourceId, artifact, hash);
}

/**
 * Full replace-per-source: both adapters return a complete channel list
 * on every fetch (no incremental diff from the provider), so the
 * simplest correct approach is delete-then-reinsert inside one
 * transaction. The content-hash check upstream of this is what makes a
 * warm re-ingest skip this entirely.
 */
export function replaceChannelsForSource(
  db: Database.Database,
  sourceId: string,
  records: ChannelRecord[],
): void {
  const tx = db.transaction((rows: ChannelRecord[]) => {
    db.prepare('DELETE FROM channels WHERE source_id = ?').run(sourceId);
    const insert = db.prepare(
      `INSERT INTO channels
        (source_id, stream_key, name, tvg_id, logo, group_name, url_template, container_ext,
         is_event_channel, tv_archive, tv_archive_duration_hours, updated_at)
       VALUES (@source_id, @stream_key, @name, @tvg_id, @logo, @group_name, @url_template, @container_ext,
               @is_event_channel, @tv_archive, @tv_archive_duration_hours, datetime('now'))`,
    );
    for (const r of rows) {
      insert.run({
        source_id: r.sourceId,
        stream_key: r.streamKey,
        name: r.name,
        tvg_id: r.tvgId ?? null,
        logo: r.logo ?? null,
        group_name: r.group ?? null,
        url_template: r.urlTemplate,
        container_ext: r.containerExt,
        is_event_channel: r.isEventChannel ? 1 : 0,
        tv_archive: r.tvArchive ? 1 : 0,
        tv_archive_duration_hours: r.tvArchiveDurationHours ?? null,
      });
    }
  });
  tx(records);
}

export function replaceProgrammesForSource(
  db: Database.Database,
  sourceId: string,
  records: ProgrammeRecord[],
): void {
  const tx = db.transaction((rows: ProgrammeRecord[]) => {
    db.prepare('DELETE FROM programmes WHERE source_id = ?').run(sourceId);
    const insert = db.prepare(
      `INSERT INTO programmes
        (source_id, channel_ref, start, stop, title, sub_title, description, category, previously_shown, updated_at)
       VALUES (@source_id, @channel_ref, @start, @stop, @title, @sub_title, @description, @category, @previously_shown, datetime('now'))`,
    );
    for (const r of rows) {
      insert.run({
        source_id: r.sourceId,
        channel_ref: r.channelRef,
        start: r.start,
        stop: r.stop,
        title: r.title,
        sub_title: r.subTitle ?? null,
        description: r.description ?? null,
        category: r.category ?? null,
        previously_shown: r.previouslyShown ? 1 : 0,
      });
    }
  });
  tx(records);
}

export function countChannelsForSource(db: Database.Database, sourceId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM channels WHERE source_id = ?').get(sourceId) as {
    n: number;
  };
  return row.n;
}

export function countProgrammesForSource(db: Database.Database, sourceId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM programmes WHERE source_id = ?').get(sourceId) as {
    n: number;
  };
  return row.n;
}
