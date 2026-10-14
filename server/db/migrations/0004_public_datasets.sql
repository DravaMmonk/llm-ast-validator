-- migrate: foreign-keys-off
-- Datasets may now also come from the public catalogue (source 'public',
-- catalogue key in sample_key). SQLite cannot change a CHECK constraint in
-- place, so the table is rebuilt following the documented procedure: with
-- foreign keys off, copy into a new table, swap it in, and let the runner
-- verify foreign_key_check before committing.

CREATE TABLE wb_datasets_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('upload', 'sample', 'public')),
  sample_key TEXT,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  column_count INTEGER NOT NULL CHECK (column_count >= 0),
  content_hash TEXT NOT NULL,
  columns_json TEXT NOT NULL,
  derived_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO wb_datasets_next
  (id, name, description, source, sample_key, row_count, column_count, content_hash, columns_json, derived_json, status, created_at, updated_at)
SELECT id, name, description, source, sample_key, row_count, column_count, content_hash, columns_json, derived_json, status, created_at, updated_at
FROM wb_datasets;

DROP TABLE wb_datasets;
ALTER TABLE wb_datasets_next RENAME TO wb_datasets;

CREATE INDEX wb_datasets_status_updated ON wb_datasets (status, updated_at DESC);
CREATE INDEX wb_datasets_source_key ON wb_datasets (source, sample_key, status);
