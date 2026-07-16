import type {
  AdmissionState,
  CandidateSummary,
  CandidateVersionSummary,
  SessionTurnDetail,
  TurnStatus,
  VersionSource,
} from "../../../shared/contracts";
import type { AppDatabase } from "../connection";

export interface InsertTurnInput {
  id: string;
  session_id: string;
  requirement: string;
  candidate_count: number;
  provider: string;
  model: string;
  prompt_version: string;
  now: string;
}

export interface VersionInput {
  id: string;
  parent_version_id: string | null;
  version_no: number;
  source: VersionSource;
  content_json: string;
  ast_json: string | null;
  ast_hash: string | null;
  ast_schema_version: string | null;
  registry_version: string;
  registry_hash: string;
  validator_version: string;
  admission_state: AdmissionState;
  validation_json: string;
  explanation: string | null;
  assumptions_json: string | null;
  note: string | null;
}

export interface CandidateInput {
  id: string;
  proposal_id: string;
  ordinal: number;
  versions: VersionInput[];
}

/** Allocates the next turn ordinal within a session. */
export function nextTurnOrdinal(database: AppDatabase, sessionId: string): number {
  const row = database
    .prepare<[string], { next: number }>(
      "SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM session_turns WHERE session_id = ?",
    )
    .get(sessionId);
  return row?.next ?? 1;
}

export function insertTurn(database: AppDatabase, input: InsertTurnInput): void {
  const ordinal = nextTurnOrdinal(database, input.session_id);
  database
    .prepare(
      `INSERT INTO session_turns
         (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      input.id,
      input.session_id,
      ordinal,
      JSON.stringify({ requirement: input.requirement, candidate_count: input.candidate_count }),
      input.provider,
      input.model,
      input.prompt_version,
      input.now,
    );
}

interface TurnRow {
  id: string;
  session_id: string;
  ordinal: number;
  requirement_json: string;
  provider: string;
  model: string;
  prompt_version: string;
  status: TurnStatus;
  error_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export function findTurnRow(database: AppDatabase, turnId: string): TurnRow | undefined {
  return database
    .prepare<[string], TurnRow>(
      `SELECT id, session_id, ordinal, requirement_json, provider, model, prompt_version,
              status, error_json, started_at, finished_at
       FROM session_turns WHERE id = ?`,
    )
    .get(turnId);
}

export function markTurnRunning(database: AppDatabase, turnId: string): void {
  database.prepare("UPDATE session_turns SET status = 'running' WHERE id = ?").run(turnId);
}

export function markTurnFailed(
  database: AppDatabase,
  turnId: string,
  error: { code: string; message: string; details?: unknown },
  now: string,
  envelope?: { provider_response_json: string | null; response_hash: string | null },
): void {
  database
    .prepare(
      `UPDATE session_turns
       SET status = 'failed', error_json = ?, finished_at = ?,
           provider_response_json = COALESCE(?, provider_response_json),
           response_hash = COALESCE(?, response_hash)
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(error),
      now,
      envelope?.provider_response_json ?? null,
      envelope?.response_hash ?? null,
      turnId,
    );
}

/**
 * Persists every candidate lineage and version for one turn and completes the
 * turn in a single transaction, so a turn is never half-created.
 */
export function completeTurnWithCandidates(
  database: AppDatabase,
  input: {
    turn_id: string;
    candidates: CandidateInput[];
    provider_response_json: string;
    response_hash: string;
    now: string;
  },
): void {
  const insertCandidate = database.prepare(
    "INSERT INTO candidates (id, turn_id, proposal_id, ordinal, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertVersion = database.prepare(
    `INSERT INTO candidate_versions
       (id, candidate_id, parent_version_id, version_no, source, content_json, ast_json, ast_hash,
        ast_schema_version, registry_version, registry_hash, validator_version, admission_state,
        validation_json, explanation, assumptions_json, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const complete = database.prepare(
    `UPDATE session_turns
     SET status = 'completed', provider_response_json = ?, response_hash = ?, finished_at = ?
     WHERE id = ?`,
  );

  const write = database.transaction(() => {
    for (const candidate of input.candidates) {
      insertCandidate.run(candidate.id, input.turn_id, candidate.proposal_id, candidate.ordinal, input.now);
      for (const version of candidate.versions) {
        insertVersion.run(
          version.id,
          candidate.id,
          version.parent_version_id,
          version.version_no,
          version.source,
          version.content_json,
          version.ast_json,
          version.ast_hash,
          version.ast_schema_version,
          version.registry_version,
          version.registry_hash,
          version.validator_version,
          version.admission_state,
          version.validation_json,
          version.explanation,
          version.assumptions_json,
          version.note,
          input.now,
        );
      }
    }
    complete.run(input.provider_response_json, input.response_hash, input.now, input.turn_id);
  });
  write();
}

interface VersionRow {
  id: string;
  candidate_id: string;
  parent_version_id: string | null;
  version_no: number;
  source: VersionSource;
  admission_state: AdmissionState;
  ast_hash: string | null;
  validation_json: string;
  explanation: string | null;
  assumptions_json: string | null;
  created_at: string;
}

function toVersionSummary(row: VersionRow): CandidateVersionSummary {
  let first: CandidateVersionSummary["first_diagnostic"] = null;
  try {
    const report = JSON.parse(row.validation_json) as {
      diagnostics?: { code: string; path: string; message: string }[];
    };
    const diagnostic = report.diagnostics?.[0];
    if (diagnostic) {
      first = { code: diagnostic.code, path: diagnostic.path, message: diagnostic.message };
    }
  } catch {
    first = null;
  }

  return {
    id: row.id,
    parent_version_id: row.parent_version_id,
    version_no: row.version_no,
    source: row.source,
    admission_state: row.admission_state,
    ast_hash: row.ast_hash,
    first_diagnostic: first,
    explanation: row.explanation,
    assumptions: row.assumptions_json ? (JSON.parse(row.assumptions_json) as string[]) : [],
    created_at: row.created_at,
  };
}

function listCandidateSummaries(database: AppDatabase, turnId: string): CandidateSummary[] {
  const candidates = database
    .prepare<[string], { id: string; proposal_id: string; ordinal: number }>(
      "SELECT id, proposal_id, ordinal FROM candidates WHERE turn_id = ? ORDER BY ordinal ASC",
    )
    .all(turnId);

  const versions = database.prepare<[string], VersionRow>(
    `SELECT id, candidate_id, parent_version_id, version_no, source, admission_state, ast_hash,
            validation_json, explanation, assumptions_json, created_at
     FROM candidate_versions WHERE candidate_id = ? ORDER BY version_no ASC`,
  );

  return candidates.map((candidate) => ({
    id: candidate.id,
    proposal_id: candidate.proposal_id,
    ordinal: candidate.ordinal,
    versions: versions.all(candidate.id).map(toVersionSummary),
  }));
}

/** Returns every candidate lineage for a turn, not only the first passing one. */
export function findTurnDetail(database: AppDatabase, turnId: string): SessionTurnDetail | undefined {
  const row = findTurnRow(database, turnId);
  if (!row) return undefined;

  const requirement = JSON.parse(row.requirement_json) as {
    requirement: string;
    candidate_count: number;
  };

  return {
    id: row.id,
    session_id: row.session_id,
    ordinal: row.ordinal,
    requirement: requirement.requirement,
    candidate_count: requirement.candidate_count,
    provider: row.provider,
    model: row.model,
    prompt_version: row.prompt_version,
    status: row.status,
    error: row.error_json ? (JSON.parse(row.error_json) as { code: string; message: string }) : null,
    started_at: row.started_at,
    finished_at: row.finished_at,
    candidates: listCandidateSummaries(database, turnId),
  };
}

export function findCandidateSummary(
  database: AppDatabase,
  candidateId: string,
): (CandidateSummary & { turn_id: string; session_id: string }) | undefined {
  const row = database
    .prepare<[string], { id: string; turn_id: string; proposal_id: string; ordinal: number; session_id: string }>(
      `SELECT candidates.id, candidates.turn_id, candidates.proposal_id, candidates.ordinal,
              session_turns.session_id
       FROM candidates
       JOIN session_turns ON session_turns.id = candidates.turn_id
       WHERE candidates.id = ?`,
    )
    .get(candidateId);
  if (!row) return undefined;

  const versions = database
    .prepare<[string], VersionRow>(
      `SELECT id, candidate_id, parent_version_id, version_no, source, admission_state, ast_hash,
              validation_json, explanation, assumptions_json, created_at
       FROM candidate_versions WHERE candidate_id = ? ORDER BY version_no ASC`,
    )
    .all(candidateId)
    .map(toVersionSummary);

  return {
    id: row.id,
    proposal_id: row.proposal_id,
    ordinal: row.ordinal,
    turn_id: row.turn_id,
    session_id: row.session_id,
    versions,
  };
}

/** Full validation report for one version, for the review panel. */
export function findVersionReport(
  database: AppDatabase,
  versionId: string,
): { validation: unknown; content: unknown; ast: unknown } | undefined {
  const row = database
    .prepare<[string], { validation_json: string; content_json: string; ast_json: string | null }>(
      "SELECT validation_json, content_json, ast_json FROM candidate_versions WHERE id = ?",
    )
    .get(versionId);
  if (!row) return undefined;
  return {
    validation: JSON.parse(row.validation_json),
    content: JSON.parse(row.content_json),
    ast: row.ast_json ? JSON.parse(row.ast_json) : null,
  };
}

/** The newest version in a lineage, used as the parent of a Blockly save. */
export function findLatestVersion(
  database: AppDatabase,
  candidateId: string,
): { id: string; version_no: number } | undefined {
  return database
    .prepare<[string], { id: string; version_no: number }>(
      "SELECT id, version_no FROM candidate_versions WHERE candidate_id = ? ORDER BY version_no DESC LIMIT 1",
    )
    .get(candidateId);
}

/**
 * Appends one child version and points the owning session at it, in a single
 * transaction. Parent versions are never mutated: the chain is append-only.
 */
export function appendVersion(
  database: AppDatabase,
  input: { candidate_id: string; session_id: string; version: VersionInput; now: string },
): void {
  const write = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO candidate_versions
           (id, candidate_id, parent_version_id, version_no, source, content_json, ast_json, ast_hash,
            ast_schema_version, registry_version, registry_hash, validator_version, admission_state,
            validation_json, explanation, assumptions_json, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.version.id,
        input.candidate_id,
        input.version.parent_version_id,
        input.version.version_no,
        input.version.source,
        input.version.content_json,
        input.version.ast_json,
        input.version.ast_hash,
        input.version.ast_schema_version,
        input.version.registry_version,
        input.version.registry_hash,
        input.version.validator_version,
        input.version.admission_state,
        input.version.validation_json,
        input.version.explanation,
        input.version.assumptions_json,
        input.version.note,
        input.now,
      );
    database
      .prepare("UPDATE sessions SET selected_candidate_version_id = ?, updated_at = ? WHERE id = ?")
      .run(input.version.id, input.now, input.session_id);
  });
  write();
}

/**
 * Startup recovery (Section 5): a turn left `pending` or `running` by a crash or
 * restart can never progress, so it becomes a visible, retryable failure.
 * Completed and failed turns are untouched.
 */
export function failStaleTurns(database: AppDatabase, now: string): number {
  const result = database
    .prepare(
      `UPDATE session_turns
       SET status = 'failed', finished_at = ?, error_json = ?
       WHERE status IN ('pending', 'running')`,
    )
    .run(
      now,
      JSON.stringify({
        code: "APP_RESTARTED",
        message: "The application restarted while this generation was in flight. Retry to run it again.",
      }),
    );
  return result.changes;
}
