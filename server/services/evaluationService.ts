/**
 * Evaluates one candidate version against the current cohort (plan Section 8).
 *
 * The order here is the contract: score calibration, freeze the direction and
 * threshold on calibration alone, and only then score review. The review split
 * never chooses its own threshold, and its metrics are exploratory — a human may
 * inspect a false negative and then edit the formula, so they are not a held-out
 * estimate and must never be described as one.
 */

import { randomUUID } from "node:crypto";

import { evaluate, type AstDocument, type AstNode } from "../../shared/ast/core";
import type { SignalId } from "../../shared/ast/registry";
import type { AppDatabase } from "../db/connection";
import { findCurrentDatasetVersion, readSplit, type EvaluatorRow } from "../db/stores/datasets";
import {
  completeRun,
  findRun,
  insertRun,
  markRunFailed,
  markRunRunning,
  type EvaluationRowInput,
} from "../db/stores/evaluations";
import { ApiFailure } from "../http";
import {
  EVALUATOR_VERSION,
  METRIC_POLICY_VERSION,
  THRESHOLD_POLICY_VERSION,
  chooseThreshold,
  classify,
  normalizeScore,
  percentileOf,
  predictsPositive,
  reviewMetrics,
  type ScoredRow,
} from "./metrics";

interface VersionRow {
  id: string;
  ast_json: string | null;
  ast_hash: string | null;
  registry_hash: string;
  admission_state: string;
  session_id: string;
}

function findVersion(database: AppDatabase, versionId: string): VersionRow | undefined {
  return database
    .prepare<[string], VersionRow>(
      `SELECT candidate_versions.id, ast_json, ast_hash, registry_hash, admission_state,
              session_turns.session_id AS session_id
       FROM candidate_versions
       JOIN candidates ON candidates.id = candidate_versions.candidate_id
       JOIN session_turns ON session_turns.id = candidates.turn_id
       WHERE candidate_versions.id = ?`,
    )
    .get(versionId);
}

/**
 * Creates one independent run per requested version. A failure in one formula
 * must not roll back another's completed results, so each is its own run.
 */
export function createEvaluationRuns(
  database: AppDatabase,
  sessionId: string,
  versionIds: readonly string[],
): { run_ids: string[] } {
  const dataset = findCurrentDatasetVersion(database);
  if (!dataset) {
    throw new ApiFailure(409, "DATASET_NOT_PREPARED", "No current dataset version exists. Prepare the cohort first.");
  }

  const versions = versionIds.map((versionId) => {
    const version = findVersion(database, versionId);
    if (!version) {
      throw new ApiFailure(404, "VERSION_NOT_FOUND", `Candidate version “${versionId}” does not exist.`);
    }
    if (version.session_id !== sessionId) {
      throw new ApiFailure(409, "VERSION_NOT_IN_SESSION", "A candidate version does not belong to this session.");
    }
    if (version.admission_state !== "admitted" || !version.ast_hash) {
      throw new ApiFailure(409, "VERSION_NOT_ADMITTED", "Only an admitted candidate version can be evaluated.");
    }

    return version;
  });

  const now = new Date().toISOString();
  const runIds: string[] = [];
  const createAll = database.transaction(() => {
    for (const [index, version] of versions.entries()) {
      const versionId = versionIds[index];

      const runId = randomUUID();
      insertRun(database, {
        id: runId,
        candidate_version_id: versionId,
        dataset_version_id: dataset.id,
        session_id: sessionId,
        ast_hash: version.ast_hash!,
        registry_hash: version.registry_hash,
        evaluator_version: EVALUATOR_VERSION,
        threshold_policy_version: THRESHOLD_POLICY_VERSION,
        metric_policy_version: METRIC_POLICY_VERSION,
        now,
      });
      runIds.push(runId);
    }
  });
  createAll();

  return { run_ids: runIds };
}

class NonFiniteScoreError extends Error {}

/** Returns each signal actually referenced by the formula, in first-use order. */
function referencedSignals(document: AstDocument): SignalId[] {
  const found = new Set<SignalId>();
  const visit = (node: AstNode): void => {
    if (node.node_type === "ref") {
      found.add(node.id);
      return;
    }
    if (node.node_type === "call") node.args.forEach(visit);
  };
  visit(document.root);
  return [...found];
}

/** Scores one split, failing the whole run on any unavailable or non-finite value. */
function scoreSplit(document: AstDocument, rows: readonly EvaluatorRow[]): ScoredRow[] {
  return rows.map((row) => {
    // The interpreter receives the allowlisted projection only.
    const result = evaluate(document, row.predictors);
    if (result.value === null || !Number.isFinite(result.value)) {
      throw new NonFiniteScoreError(
        result.diagnostics[0]?.message ?? "The formula did not produce a finite score for every row.",
      );
    }
    return { score: result.value, label: row.observed_label };
  });
}

export async function executeEvaluationRun(database: AppDatabase, runId: string): Promise<void> {
  const run = findRun(database, runId);
  if (!run || run.status !== "pending") return;

  markRunRunning(database, runId);

  try {
    const version = findVersion(database, run.candidate_version_id);
    if (!version?.ast_json) throw new Error("The candidate version has no admitted AST.");
    const document = JSON.parse(version.ast_json) as AstDocument;
    const evidenceSignals = referencedSignals(document);

    const calibrationRows = readSplit(database, run.dataset_version_id, "calibration");
    const reviewRows = readSplit(database, run.dataset_version_id, "review");

    // 1. Score calibration and freeze the rule. Review is not read yet.
    const calibrationScores = scoreSplit(document, calibrationRows);
    const choice = chooseThreshold(calibrationScores);

    // 2. Only now score review, under the already frozen rule.
    const reviewScores = scoreSplit(document, reviewRows);
    const metrics = reviewMetrics(reviewScores, choice.direction, choice.threshold);

    const normalized = reviewScores.map((row) => normalizeScore(choice.direction, row.score));
    const percentile = percentileOf(normalized);

    const rows: EvaluationRowInput[] = reviewRows.map((row, index) => {
      const score = reviewScores[index].score;
      const predicted: 0 | 1 = predictsPositive(choice.direction, score, choice.threshold) ? 1 : 0;
      return {
        row_key: row.row_key,
        score,
        percentile: percentile(normalizeScore(choice.direction, score)),
        predicted_label: predicted,
        observed_label: row.observed_label,
        error_class: classify(predicted, row.observed_label),
        explanation_inputs: Object.fromEntries(
          evidenceSignals.map((signalId) => [signalId, row.predictors[signalId]]),
        ),
      };
    });

    completeRun(
      database,
      {
        id: runId,
        score_direction: choice.direction,
        threshold: choice.threshold,
        calibration_summary: {
          row_count: calibrationRows.length,
          youden_j: choice.youden_j,
          sensitivity: choice.sensitivity,
          specificity: choice.specificity,
          policy: THRESHOLD_POLICY_VERSION,
        },
        review_metrics: metrics,
        calibration_row_count: calibrationRows.length,
        review_row_count: reviewRows.length,
        now: new Date().toISOString(),
      },
      rows,
    );
  } catch (error) {
    // Section 8.3: a single unavailable score fails the whole candidate
    // evaluation. No partial metrics, no smaller denominator.
    markRunFailed(
      database,
      runId,
      error instanceof NonFiniteScoreError
        ? { code: "NON_FINITE_SCORE", message: error.message }
        : { code: "EVALUATION_FAILED", message: error instanceof Error ? error.message : "The evaluation failed." },
      new Date().toISOString(),
    );
  }
}
