-- Research workstation: user datasets and the saved documents every module
-- persists (cohorts, Score Forge formulas, study designs, report items).
-- Dataset rows are stored column-wise as JSON; derived columns are stored as
-- formulas and recomputed by the browser, never baked into values.

CREATE TABLE wb_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('upload', 'sample')),
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

CREATE INDEX wb_datasets_status_updated ON wb_datasets (status, updated_at DESC);

CREATE TABLE wb_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('cohort', 'score', 'study', 'report_item')),
  title TEXT NOT NULL,
  dataset_id TEXT REFERENCES wb_datasets (id),
  payload_json TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX wb_documents_kind_status ON wb_documents (kind, status, position, created_at);
CREATE INDEX wb_documents_dataset ON wb_documents (dataset_id);
