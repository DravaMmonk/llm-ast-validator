import type { Session, SessionStatus, SessionTurnDetail } from "../../../shared/contracts";
import type { AppDatabase } from "../connection";
import { findTurnDetail } from "./candidates";

export interface SessionPatch {
  title?: string;
  status?: SessionStatus;
  selected_candidate_version_id?: string | null;
}

const SESSION_COLUMNS = `id, title, current_requirement, status, selected_candidate_version_id, created_at, updated_at`;

export function insertSession(
  database: AppDatabase,
  input: { id: string; title: string; now: string },
): Session {
  database
    .prepare(
      `INSERT INTO sessions (id, title, current_requirement, status, selected_candidate_version_id, created_at, updated_at)
       VALUES (?, ?, NULL, 'active', NULL, ?, ?)`,
    )
    .run(input.id, input.title, input.now, input.now);
  return findSession(database, input.id)!;
}

export function findSession(database: AppDatabase, id: string): Session | undefined {
  return database
    .prepare<[string], Session>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`)
    .get(id);
}

export function listSessions(database: AppDatabase, status: SessionStatus): Session[] {
  return database
    .prepare<[SessionStatus], Session>(
      `SELECT ${SESSION_COLUMNS} FROM sessions
       WHERE status = ?
       ORDER BY updated_at DESC, created_at DESC, id DESC`,
    )
    .all(status);
}

/**
 * Returns the session that ultimately owns a candidate version, so the service
 * can refuse a selection that reaches across sessions.
 */
export function findSessionIdForVersion(
  database: AppDatabase,
  versionId: string,
): string | undefined {
  const row = database
    .prepare<[string], { session_id: string }>(
      `SELECT session_turns.session_id AS session_id
       FROM candidate_versions
       JOIN candidates ON candidates.id = candidate_versions.candidate_id
       JOIN session_turns ON session_turns.id = candidates.turn_id
       WHERE candidate_versions.id = ?`,
    )
    .get(versionId);
  return row?.session_id;
}

export function updateSession(
  database: AppDatabase,
  id: string,
  patch: SessionPatch,
  now: string,
): Session | undefined {
  const assignments: string[] = [];
  const values: (string | null)[] = [];

  if (patch.title !== undefined) {
    assignments.push("title = ?");
    values.push(patch.title);
  }
  if (patch.status !== undefined) {
    assignments.push("status = ?");
    values.push(patch.status);
  }
  if ("selected_candidate_version_id" in patch) {
    assignments.push("selected_candidate_version_id = ?");
    values.push(patch.selected_candidate_version_id ?? null);
  }
  if (assignments.length === 0) return findSession(database, id);

  assignments.push("updated_at = ?");
  values.push(now);

  const result = database
    .prepare(`UPDATE sessions SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...values, id);
  return result.changes === 0 ? undefined : findSession(database, id);
}

/**
 * Ordered turns with their candidate lineages and versions (Section 10).
 * Evaluation rows are never embedded here; they stay under the run endpoint.
 */
export function listTurnDetails(database: AppDatabase, sessionId: string): SessionTurnDetail[] {
  const ids = database
    .prepare<[string], { id: string }>(
      "SELECT id FROM session_turns WHERE session_id = ? ORDER BY ordinal ASC",
    )
    .all(sessionId);
  return ids
    .map((row) => findTurnDetail(database, row.id))
    .filter((turn): turn is SessionTurnDetail => turn !== undefined);
}
