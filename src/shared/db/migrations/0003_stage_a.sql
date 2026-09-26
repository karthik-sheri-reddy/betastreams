-- Stage A output (Phase 3): every ingested stream's channel resolution.
-- Read by Stage C (event matching, Phase 5) and the admin review queue
-- (Phase 12); written only by the worker's Stage A step.

CREATE TABLE IF NOT EXISTS channel_resolutions (
  source_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  feed_hint TEXT,
  is_event_channel INTEGER NOT NULL DEFAULT 0,
  canonical_channel_id TEXT,
  resolution_method TEXT NOT NULL,
  resolution_confidence REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, stream_key)
);
CREATE INDEX IF NOT EXISTS idx_channel_resolutions_canonical ON channel_resolutions(canonical_channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_resolutions_confidence ON channel_resolutions(resolution_confidence);

-- Memoization cache keyed by normalized name (§4: "Memoize by normalized
-- key so only names not seen before go through the cascade. A stable
-- playlist re-ingest does almost no fuzzy work.") — persisted across
-- worker restarts, not just within one ingest pass.
CREATE TABLE IF NOT EXISTS resolved_names (
  normalized_key TEXT PRIMARY KEY,
  canonical_channel_id TEXT,
  resolution_method TEXT NOT NULL,
  resolution_confidence REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
