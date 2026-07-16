-- Cohort storage and evaluation runs.
--
-- Row-level cohort values never leave the local database. The outcome label and
-- the follow-up fields live here but are held back from the AST interpreter by
-- the store's separate predictor projection (Section 7.1).

CREATE TABLE dataset_versions (
  id TEXT PRIMARY KEY,
  source_doi TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_md5 TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  license TEXT NOT NULL,
  citation TEXT NOT NULL,
  preprocessing_version TEXT NOT NULL,
  inclusion_policy TEXT NOT NULL,
  outcome_definition TEXT NOT NULL,
  column_contract_json TEXT NOT NULL,
  split_seed TEXT NOT NULL,
  -- Source totals as published, then what survived local filtering.
  source_row_count INTEGER NOT NULL,
  source_event_count INTEGER NOT NULL,
  admitted_row_count INTEGER NOT NULL,
  admitted_event_count INTEGER NOT NULL,
  exclusion_counts_json TEXT NOT NULL,
  split_counts_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'superseded')),
  created_at TEXT NOT NULL
);

-- At most one dataset version may be current.
CREATE UNIQUE INDEX dataset_versions_one_current
  ON dataset_versions (status) WHERE status = 'current';

CREATE TABLE cohort_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions (id),
  -- Deterministic internal identity. Never leaves the database.
  split_key TEXT NOT NULL,
  -- Random display identity. The only row id an API may return.
  row_key TEXT NOT NULL,
  split TEXT NOT NULL CHECK (split IN ('calibration', 'review')),

  -- Authorable predictors (Section 7.1).
  age REAL NOT NULL,
  bmi REAL NOT NULL,
  systolic_bp REAL NOT NULL,
  diastolic_bp REAL NOT NULL,
  baseline_fasting_plasma_glucose REAL NOT NULL,
  triglycerides REAL NOT NULL,
  hdl_cholesterol REAL NOT NULL,
  ldl_cholesterol REAL NOT NULL,
  total_cholesterol REAL NOT NULL,

  -- Evaluator-only. A candidate AST can never name these.
  followup_fasting_plasma_glucose REAL,
  followup_years REAL NOT NULL,
  incident_diabetes INTEGER NOT NULL CHECK (incident_diabetes IN (0, 1)),

  UNIQUE (dataset_version_id, split_key),
  UNIQUE (dataset_version_id, row_key)
);

CREATE INDEX cohort_rows_dataset_split ON cohort_rows (dataset_version_id, split);

CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY,
  candidate_version_id TEXT NOT NULL REFERENCES candidate_versions (id),
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions (id),
  session_id TEXT NOT NULL REFERENCES sessions (id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Frozen on the calibration split before any review metric is computed.
  score_direction TEXT CHECK (score_direction IN ('higher', 'lower')),
  threshold REAL,
  threshold_policy_version TEXT NOT NULL,
  calibration_summary_json TEXT,

  -- Exploratory review metrics. Never a held-out claim.
  review_metrics_json TEXT,

  -- Exactly what produced this result.
  ast_hash TEXT NOT NULL,
  registry_hash TEXT NOT NULL,
  evaluator_version TEXT NOT NULL,
  metric_policy_version TEXT NOT NULL,

  calibration_row_count INTEGER,
  review_row_count INTEGER,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,

  -- A completed run must carry the direction and threshold it was scored under.
  CHECK (
    status <> 'completed'
    OR (score_direction IS NOT NULL AND threshold IS NOT NULL AND review_metrics_json IS NOT NULL)
  )
);

CREATE INDEX evaluation_runs_version ON evaluation_runs (candidate_version_id);
CREATE INDEX evaluation_runs_session ON evaluation_runs (session_id);
CREATE INDEX evaluation_runs_status ON evaluation_runs (status);

CREATE TABLE evaluation_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_run_id TEXT NOT NULL REFERENCES evaluation_runs (id),
  -- The opaque display key, never the internal split key.
  row_key TEXT NOT NULL,
  score REAL NOT NULL,
  percentile REAL NOT NULL,
  predicted_label INTEGER NOT NULL CHECK (predicted_label IN (0, 1)),
  observed_label INTEGER NOT NULL CHECK (observed_label IN (0, 1)),
  error_class TEXT NOT NULL
    CHECK (error_class IN ('true_positive', 'true_negative', 'false_positive', 'false_negative')),
  explanation_inputs_json TEXT NOT NULL,
  UNIQUE (evaluation_run_id, row_key)
);

CREATE INDEX evaluation_rows_class ON evaluation_rows (evaluation_run_id, error_class);
CREATE INDEX evaluation_rows_score ON evaluation_rows (evaluation_run_id, score);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  candidate_version_id TEXT NOT NULL REFERENCES candidate_versions (id),
  decision_no INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  -- Required for acceptance; a rejection may precede any evaluation.
  evaluation_run_id TEXT REFERENCES evaluation_runs (id),
  note TEXT,
  decided_at TEXT NOT NULL,
  UNIQUE (candidate_version_id, decision_no),
  CHECK (decision = 'rejected' OR evaluation_run_id IS NOT NULL)
);

CREATE INDEX review_decisions_version ON review_decisions (candidate_version_id, decision_no);
