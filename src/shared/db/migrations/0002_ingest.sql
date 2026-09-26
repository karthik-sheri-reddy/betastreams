-- Raw ingest storage (Phase 2). Stage A's canonical-channel grouping and
-- Stage C's event matching (Phase 3/5) will read these tables but never
-- write them; only the worker's ingest step does.

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT,
  healthy INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One content hash per (source, artifact type). Xtream accounts share one
-- source id across both channels and programmes; M3U/XMLTV pairs
-- typically don't, so this is keyed per artifact rather than per source.
CREATE TABLE IF NOT EXISTS source_hashes (
  source_id TEXT NOT NULL,
  artifact TEXT NOT NULL CHECK (artifact IN ('channels', 'programmes')),
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, artifact)
);

CREATE TABLE IF NOT EXISTS channels (
  source_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  name TEXT NOT NULL,
  tvg_id TEXT,
  logo TEXT,
  group_name TEXT,
  url_template TEXT NOT NULL,
  container_ext TEXT NOT NULL,
  is_event_channel INTEGER NOT NULL DEFAULT 0,
  tv_archive INTEGER NOT NULL DEFAULT 0,
  tv_archive_duration_hours INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, stream_key)
);
CREATE INDEX IF NOT EXISTS idx_channels_tvg_id ON channels(tvg_id);

CREATE TABLE IF NOT EXISTS programmes (
  source_id TEXT NOT NULL,
  channel_ref TEXT NOT NULL,
  start TEXT NOT NULL,
  stop TEXT NOT NULL,
  title TEXT NOT NULL,
  sub_title TEXT,
  description TEXT,
  category TEXT,
  previously_shown INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, channel_ref, start, title)
);
CREATE INDEX IF NOT EXISTS idx_programmes_channel_ref ON programmes(channel_ref);
