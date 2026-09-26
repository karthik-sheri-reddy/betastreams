-- Bootstrap table for cross-process state. The worker owns writes; the
-- server only reads. data_version bumps every time the worker publishes a
-- new consistent snapshot, so the server's response cache can key on it.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('data_version', '0');
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
