import type { AppDatabase } from "../connection";
import type { ErrorClass } from "../../services/metrics";

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface EvaluationRunRow {
  id: string;
  candidate_version_id: string;
  dataset_version_id: string;
  session_id: string;
  status: RunStatus;
  score_direction: "higher" | "lower" | null;
  threshold: number | null;
  threshold_policy_version: string;
  calibration_summary_json: string | null;
  review_metrics_json: string | null;
  ast_hash: string;
  registry_hash: string;
  evaluator_version: string;
  metric_policy_version: string;
  calibration_row_count: number | null;
  review_row_count: number | null;
  error_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface EvaluationRowInput {
  row_key: string;
  score: number;
  percentile: number;
  predicted_label: 0 | 1;
  observed_label: 0 | 1;
  error_class: ErrorClass;
  explanation_inputs: unknown;
}

export function insertRun(
  database: AppDatabase,
  input: {
    id: string;
    candidate_version_id: string;
    dataset_version_id: string;
    session_id: string;
    ast_hash: string;
    registry_hash: string;
    evaluator_version: string;
    threshold_policy_version: string;
    metric_policy_version: string;
    now: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO evaluation_runs
         (id, candidate_version_id, dataset_version_id, session_id, status, threshold_policy_version,
          ast_hash, registry_hash, evaluator_version, metric_policy_version, started_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.candidate_version_id,
      input.dataset_version_id,
      input.session_id,
      input.threshold_policy_version,
      input.ast_hash,
      input.registry_hash,
      input.evaluator_version,
      input.metric_policy_version,
      input.now,
    );
}

export function findRun(database: AppDatabase, id: string): EvaluationRunRow | undefined {
  return database.prepare<[string], EvaluationRunRow>("SELECT * FROM evaluation_runs WHERE id = ?").get(id);
}

/** The most recently created run for one immutable candidate version. */
export function findLatestRunForVersion(
  database: AppDatabase,
  versionId: string,
): EvaluationRunRow | undefined {
  return database
    .prepare<[string], EvaluationRunRow>(
      `SELECT * FROM evaluation_runs
       WHERE candidate_version_id = ?
       ORDER BY rowid DESC
       LIMIT 1`,
    )
    .get(versionId);
}

export function markRunRunning(database: AppDatabase, id: string): void {
  database.prepare("UPDATE evaluation_runs SET status = 'running' WHERE id = ?").run(id);
}

export function markRunFailed(
  database: AppDatabase,
  id: string,
  error: { code: string; message: string },
  now: string,
): void {
  database
    .prepare("UPDATE evaluation_runs SET status = 'failed', error_json = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(error), now, id);
}

/**
 * Writes every row result and completes the run in one transaction, so results
 * become visible only when the run is whole (Section 12.5). An evaluation run is
 * immutable once completed.
 */
export function completeRun(
  database: AppDatabase,
  input: {
    id: string;
    score_direction: "higher" | "lower";
    threshold: number;
    calibration_summary: unknown;
    review_metrics: unknown;
    calibration_row_count: number;
    review_row_count: number;
    now: string;
  },
  rows: readonly EvaluationRowInput[],
): void {
  const insertRow = database.prepare(
    `INSERT INTO evaluation_rows
       (evaluation_run_id, row_key, score, percentile, predicted_label, observed_label, error_class,
        explanation_inputs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const write = database.transaction(() => {
    for (const row of rows) {
      insertRow.run(
        input.id,
        row.row_key,
        row.score,
        row.percentile,
        row.predicted_label,
        row.observed_label,
        row.error_class,
        JSON.stringify(row.explanation_inputs),
      );
    }
    database
      .prepare(
        `UPDATE evaluation_runs
         SET status = 'completed', score_direction = ?, threshold = ?, calibration_summary_json = ?,
             review_metrics_json = ?, calibration_row_count = ?, review_row_count = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.score_direction,
        input.threshold,
        JSON.stringify(input.calibration_summary),
        JSON.stringify(input.review_metrics),
        input.calibration_row_count,
        input.review_row_count,
        input.now,
        input.id,
      );
  });
  write();
}

export interface RowFilter {
  error_class?: ErrorClass | "disagreement";
  observed_label?: 0 | 1;
  sort?: "score_asc" | "score_desc" | "percentile_asc" | "percentile_desc";
  limit: number;
  cursor?: number;
}

/** Bounded, cursor-paginated rows. No raw SQL or column expression is accepted. */
export function listRows(
  database: AppDatabase,
  runId: string,
  filter: RowFilter,
): { rows: Record<string, unknown>[]; next_cursor: number | null } {
  const where: string[] = ["evaluation_run_id = ?"];
  const values: (string | number)[] = [runId];

  if (filter.error_class === "disagreement") {
    where.push("error_class IN ('false_positive', 'false_negative')");
  } else if (filter.error_class) {
    where.push("error_class = ?");
    values.push(filter.error_class);
  }
  if (filter.observed_label !== undefined) {
    where.push("observed_label = ?");
    values.push(filter.observed_label);
  }
  const order =
    filter.sort === "score_asc"
      ? "score ASC, id ASC"
      : filter.sort === "score_desc"
        ? "score DESC, id ASC"
        : filter.sort === "percentile_asc"
          ? "percentile ASC, id ASC"
          : filter.sort === "percentile_desc"
            ? "percentile DESC, id ASC"
            : "id ASC";

  const rows = database
    .prepare<(string | number)[], Record<string, unknown>>(
      `SELECT id, row_key, score, percentile, predicted_label, observed_label, error_class,
              explanation_inputs_json
       FROM evaluation_rows
       WHERE ${where.join(" AND ")}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...values, filter.limit + 1, filter.cursor ?? 0);

  const page = rows.slice(0, filter.limit).map((row) => ({
    row_key: row.row_key,
    score: row.score,
    percentile: row.percentile,
    predicted_label: row.predicted_label,
    observed_label: row.observed_label,
    error_class: row.error_class,
    explanation_inputs: JSON.parse(row.explanation_inputs_json as string),
  }));

  return {
    rows: page,
    // Evaluation rows are immutable, so an offset cursor is stable and remains
    // correct for every supported sort order.
    next_cursor: rows.length > filter.limit ? (filter.cursor ?? 0) + filter.limit : null,
  };
}

/** Startup recovery for evaluation runs (Section 5). */
export function failStaleRuns(database: AppDatabase, now: string): number {
  return database
    .prepare(
      `UPDATE evaluation_runs SET status = 'failed', finished_at = ?, error_json = ?
       WHERE status IN ('pending', 'running')`,
    )
    .run(
      now,
      JSON.stringify({
        code: "APP_RESTARTED",
        message: "The application restarted while this evaluation was in flight. Retry to run it again.",
      }),
    ).changes;
}
