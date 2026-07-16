import { Hono } from "hono";

import type { AppDatabase } from "../db/connection";
import { datasetCounts, findCurrentDatasetVersion } from "../db/stores/datasets";
import {
  findLatestRunForVersion,
  findRun,
  listRows,
  type EvaluationRunRow,
  type RowFilter,
} from "../db/stores/evaluations";
import { ApiFailure, readJsonObject, rejectUnknownFields, validationFailed } from "../http";
import type { InProcessRunner } from "../jobs/inProcessRunner";
import { createEvaluationRuns, executeEvaluationRun } from "../services/evaluationService";
import { listDecisions, parseDecisionRequest, recordDecision } from "../services/decisionService";
import type { ErrorClass } from "../services/metrics";

const MAX_VERSIONS_PER_REQUEST = 5;
const MAX_ROW_LIMIT = 200;
const ERROR_CLASSES: readonly string[] = [
  "disagreement",
  "true_positive",
  "true_negative",
  "false_positive",
  "false_negative",
];
const SORTS: readonly string[] = ["score_asc", "score_desc", "percentile_asc", "percentile_desc"];

function runDetail(database: AppDatabase, run: EvaluationRunRow) {
  const current = findCurrentDatasetVersion(database);
  return {
    id: run.id,
    candidate_version_id: run.candidate_version_id,
    dataset_version_id: run.dataset_version_id,
    status: run.status,
    score_direction: run.score_direction,
    threshold: run.threshold,
    threshold_policy_version: run.threshold_policy_version,
    metric_policy_version: run.metric_policy_version,
    evaluator_version: run.evaluator_version,
    ast_hash: run.ast_hash,
    registry_hash: run.registry_hash,
    calibration_summary: run.calibration_summary_json ? JSON.parse(run.calibration_summary_json) : null,
    review_metrics: run.review_metrics_json ? JSON.parse(run.review_metrics_json) : null,
    calibration_row_count: run.calibration_row_count,
    review_row_count: run.review_row_count,
    error: run.error_json ? JSON.parse(run.error_json) : null,
    stale_dataset: current ? run.dataset_version_id !== current.id : true,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

/** GET /api/dataset-versions/current — metadata and counts, never cohort rows. */
export function createDatasetRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/current", (context) => {
    const dataset = findCurrentDatasetVersion(database);
    if (!dataset) {
      throw new ApiFailure(409, "DATASET_NOT_PREPARED", "No current dataset version exists. Prepare the cohort first.");
    }
    return context.json({ dataset, counts: datasetCounts(database, dataset.id) });
  });

  return routes;
}

/** POST /api/sessions/:sessionId/evaluation-runs */
export function createEvaluationRunRoutes(options: {
  database: AppDatabase;
  runner: InProcessRunner;
}): Hono {
  const { database, runner } = options;
  const routes = new Hono();

  routes.post("/:sessionId/evaluation-runs", async (context) => {
    const sessionId = context.req.param("sessionId");
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["candidate_version_ids"]);

    const ids = body.candidate_version_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_VERSIONS_PER_REQUEST) {
      throw validationFailed(`Provide 1 to ${MAX_VERSIONS_PER_REQUEST} candidate version ids.`);
    }
    if (!ids.every((id) => typeof id === "string" && id !== "")) {
      throw validationFailed("Every candidate version id must be a non-empty string.");
    }

    const created = createEvaluationRuns(database, sessionId, ids as string[]);
    for (const runId of created.run_ids) {
      runner.enqueue("evaluation", () => executeEvaluationRun(database, runId));
    }
    return context.json(created, 202);
  });

  return routes;
}

/** GET /api/evaluation-runs/:runId and its bounded row page. */
export function createEvaluationDetailRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/:runId", (context) => {
    const run = findRun(database, context.req.param("runId"));
    if (!run) throw new ApiFailure(404, "RUN_NOT_FOUND", "That evaluation run does not exist.");

    return context.json(runDetail(database, run));
  });

  routes.get("/:runId/rows", (context) => {
    const runId = context.req.param("runId");
    if (!findRun(database, runId)) {
      throw new ApiFailure(404, "RUN_NOT_FOUND", "That evaluation run does not exist.");
    }

    const query = context.req.query();
    const filter: RowFilter = { limit: 50 };

    if (query.error_class !== undefined) {
      if (!ERROR_CLASSES.includes(query.error_class)) throw validationFailed("Unknown error class filter.");
      filter.error_class = query.error_class as ErrorClass | "disagreement";
    }
    if (query.observed_label !== undefined) {
      if (query.observed_label !== "0" && query.observed_label !== "1") {
        throw validationFailed("Observed label must be 0 or 1.");
      }
      filter.observed_label = query.observed_label === "1" ? 1 : 0;
    }
    if (query.sort !== undefined) {
      if (!SORTS.includes(query.sort)) throw validationFailed("Unknown sort.");
      filter.sort = query.sort as RowFilter["sort"];
    }
    if (query.limit !== undefined) {
      const limit = Number.parseInt(query.limit, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROW_LIMIT) {
        throw validationFailed(`Limit must be an integer between 1 and ${MAX_ROW_LIMIT}.`);
      }
      filter.limit = limit;
    }
    if (query.cursor !== undefined) {
      const cursor = Number.parseInt(query.cursor, 10);
      if (!Number.isInteger(cursor) || cursor < 0) throw validationFailed("Cursor is not valid.");
      filter.cursor = cursor;
    }

    return context.json(listRows(database, runId, filter));
  });

  return routes;
}

/** Discovers the latest persisted result after refresh or session restoration. */
export function createVersionEvaluationRoutes(database: AppDatabase): Hono {
  const routes = new Hono();
  routes.get("/:versionId/evaluation-runs/latest", (context) => {
    const run = findLatestRunForVersion(database, context.req.param("versionId"));
    return context.json({ run: run ? runDetail(database, run) : null });
  });
  return routes;
}

/** POST/GET /api/candidate-versions/:versionId/decisions */
export function createDecisionRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/:versionId/decisions", (context) =>
    context.json({ decisions: listDecisions(database, context.req.param("versionId")) }),
  );

  routes.post("/:versionId/decisions", async (context) => {
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["decision", "evaluation_run_id", "note"]);
    const request = parseDecisionRequest(body);
    const decision = recordDecision(database, context.req.param("versionId"), request);
    return context.json(decision, 201);
  });

  return routes;
}
