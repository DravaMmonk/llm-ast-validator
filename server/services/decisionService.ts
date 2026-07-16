/**
 * Human accept/reject decisions (plan Sections 3.3, 11.5).
 *
 * Evaluation informs the decision; it never makes it. Acceptance binds one exact
 * candidate version to one completed evaluation of that same version against the
 * current dataset. Rejection may happen before any evaluation exists.
 *
 * Decisions are append-only: the latest is effective and earlier ones stay
 * visible, so a historical decision is never mutated.
 */

import { randomUUID } from "node:crypto";

import type { AppDatabase } from "../db/connection";
import { findCurrentDatasetVersion } from "../db/stores/datasets";
import { findRun } from "../db/stores/evaluations";
import { ApiFailure, validationFailed } from "../http";

export type Decision = "accepted" | "rejected";

export interface DecisionRecord {
  id: string;
  candidate_version_id: string;
  decision_no: number;
  decision: Decision;
  evaluation_run_id: string | null;
  note: string | null;
  decided_at: string;
  /** True when the run's dataset is no longer current (Section 3.3). */
  stale_dataset: boolean;
}

export function parseDecisionRequest(body: Record<string, unknown>): {
  decision: Decision;
  evaluation_run_id?: string;
  note?: string;
} {
  if (body.decision !== "accepted" && body.decision !== "rejected") {
    throw validationFailed("Decision must be “accepted” or “rejected”.");
  }
  if (body.evaluation_run_id !== undefined && typeof body.evaluation_run_id !== "string") {
    throw validationFailed("Evaluation run id must be a string.");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw validationFailed("Note must be a string.");
  }
  if (body.decision === "rejected" && body.evaluation_run_id !== undefined) {
    throw validationFailed("A rejection must not bind evaluation evidence.");
  }
  return {
    decision: body.decision,
    evaluation_run_id: body.evaluation_run_id as string | undefined,
    note: body.note as string | undefined,
  };
}

export function recordDecision(
  database: AppDatabase,
  versionId: string,
  input: { decision: Decision; evaluation_run_id?: string; note?: string },
): DecisionRecord {
  const version = database
    .prepare<[string], { id: string; admission_state: string }>(
      "SELECT id, admission_state FROM candidate_versions WHERE id = ?",
    )
    .get(versionId);
  if (!version) {
    throw new ApiFailure(404, "VERSION_NOT_FOUND", `Candidate version “${versionId}” does not exist.`);
  }
  if (version.admission_state !== "admitted") {
    throw new ApiFailure(409, "VERSION_NOT_ADMITTED", "Only a structurally valid version can be decided on.");
  }

  if (input.decision === "accepted") {
    if (!input.evaluation_run_id) {
      throw new ApiFailure(
        409,
        "EVALUATION_REQUIRED",
        "Acceptance requires a completed evaluation of this exact version against the current dataset.",
      );
    }
    const run = findRun(database, input.evaluation_run_id);
    if (!run) {
      throw new ApiFailure(404, "RUN_NOT_FOUND", `Evaluation run “${input.evaluation_run_id}” does not exist.`);
    }
    if (run.candidate_version_id !== versionId) {
      throw new ApiFailure(409, "RUN_VERSION_MISMATCH", "That evaluation belongs to a different candidate version.");
    }
    if (run.status !== "completed") {
      throw new ApiFailure(409, "EVALUATION_INCOMPLETE", "That evaluation has not completed.");
    }
    const current = findCurrentDatasetVersion(database);
    if (!current || run.dataset_version_id !== current.id) {
      throw new ApiFailure(
        409,
        "STALE_DATASET",
        "That evaluation ran against a superseded dataset. Re-evaluate against the current dataset first.",
      );
    }
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  // Append under a fresh ordinal, computed and inserted in one transaction so a
  // concurrent decision cannot reuse the number.
  const append = database.transaction(() => {
    const next = database
      .prepare<[string], { next: number }>(
        "SELECT COALESCE(MAX(decision_no), 0) + 1 AS next FROM review_decisions WHERE candidate_version_id = ?",
      )
      .get(versionId)!.next;

    database
      .prepare(
        `INSERT INTO review_decisions
           (id, candidate_version_id, decision_no, decision, evaluation_run_id, note, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, versionId, next, input.decision, input.evaluation_run_id ?? null, input.note ?? null, now);
    return next;
  });
  const decisionNo = append();

  return {
    id,
    candidate_version_id: versionId,
    decision_no: decisionNo,
    decision: input.decision,
    evaluation_run_id: input.evaluation_run_id ?? null,
    note: input.note ?? null,
    decided_at: now,
    stale_dataset: false,
  };
}

/** Every decision in order; the latest is effective. */
export function listDecisions(database: AppDatabase, versionId: string): DecisionRecord[] {
  const current = findCurrentDatasetVersion(database);
  return database
    .prepare<[string], Omit<DecisionRecord, "stale_dataset"> & { dataset_version_id: string | null }>(
      // Both tables carry candidate_version_id, so every column is qualified.
      `SELECT review_decisions.id AS id,
              review_decisions.candidate_version_id AS candidate_version_id,
              review_decisions.decision_no AS decision_no,
              review_decisions.decision AS decision,
              review_decisions.evaluation_run_id AS evaluation_run_id,
              review_decisions.note AS note,
              review_decisions.decided_at AS decided_at,
              evaluation_runs.dataset_version_id AS dataset_version_id
       FROM review_decisions
       LEFT JOIN evaluation_runs ON evaluation_runs.id = review_decisions.evaluation_run_id
       WHERE review_decisions.candidate_version_id = ?
       ORDER BY review_decisions.decision_no ASC`,
    )
    .all(versionId)
    .map(({ dataset_version_id, ...decision }) => ({
      ...decision,
      // A decision stays historical but reads as stale once its dataset is gone.
      stale_dataset: dataset_version_id !== null && dataset_version_id !== current?.id,
    }));
}
