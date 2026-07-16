-- Session spine: sessions own turns, turns own candidate lineages, lineages own
-- immutable versions. Timestamps are UTC ISO-8601 text; ids are text UUIDs.

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  current_requirement TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  selected_candidate_version_id TEXT
    REFERENCES candidate_versions (id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sessions_status_updated_at ON sessions (status, updated_at DESC);

CREATE TABLE session_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  ordinal INTEGER NOT NULL,
  requirement_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  -- Bounded raw provider envelope; null when the transport itself failed.
  provider_response_json TEXT,
  response_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (session_id, ordinal)
);

CREATE INDEX session_turns_session_id ON session_turns (session_id, ordinal);
CREATE INDEX session_turns_status ON session_turns (status);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES session_turns (id),
  proposal_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (turn_id, proposal_id),
  UNIQUE (turn_id, ordinal)
);

CREATE INDEX candidates_turn_id ON candidates (turn_id, ordinal);

CREATE TABLE candidate_versions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates (id),
  parent_version_id TEXT REFERENCES candidate_versions (id),
  version_no INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generated', 'repair', 'blockly')),
  -- Exact immutable provider or Blockly payload, retained even when admission fails.
  content_json TEXT NOT NULL,
  -- Canonical admitted formula; null while the version is blocked.
  ast_json TEXT,
  ast_hash TEXT,
  ast_schema_version TEXT,
  registry_version TEXT NOT NULL,
  registry_hash TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  admission_state TEXT NOT NULL CHECK (admission_state IN ('admitted', 'blocked')),
  validation_json TEXT NOT NULL,
  explanation TEXT,
  assumptions_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, version_no),
  -- An admitted version must carry the canonical AST it was admitted from.
  CHECK (admission_state = 'blocked' OR (ast_json IS NOT NULL AND ast_hash IS NOT NULL))
);

CREATE INDEX candidate_versions_candidate_id ON candidate_versions (candidate_id, version_no);
CREATE INDEX candidate_versions_parent ON candidate_versions (parent_version_id);
