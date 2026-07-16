/**
 * Contracts imported by both the browser and the local API.
 * This module must stay free of React, Blockly, and SQLite imports.
 */

export const SESSION_TITLE_MAX_LENGTH = 200;
export const DEFAULT_SESSION_TITLE = "Untitled session";
export const REQUEST_BODY_MAX_BYTES = 100 * 1024;

export const REQUIREMENT_MIN_LENGTH = 1;
export const REQUIREMENT_MAX_LENGTH = 4_000;
export const CANDIDATE_COUNT_MIN = 2;
export const CANDIDATE_COUNT_MAX = 5;
export const CANDIDATE_COUNT_DEFAULT = 3;

/** Section 10: the raw provider envelope is capped before it is stored. */
export const PROVIDER_ENVELOPE_MAX_BYTES = 512 * 1024;

/** Section 11.1: a session title is derived deterministically, never by a model. */
export const DERIVED_TITLE_MAX_LENGTH = 60;

export type SessionStatus = "active" | "archived";
export type TurnStatus = "pending" | "running" | "completed" | "failed";
export type VersionSource = "generated" | "repair" | "blockly";
export type AdmissionState = "admitted" | "blocked";

export interface Session {
  id: string;
  title: string;
  current_requirement: string | null;
  status: SessionStatus;
  selected_candidate_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionTurnSummary {
  id: string;
  ordinal: number;
  status: TurnStatus;
  started_at: string;
  finished_at: string | null;
}

export interface SessionListResponse {
  sessions: Session[];
}

/**
 * Section 10: the session detail carries ordered turns with their candidate
 * lineages, versions, and validation summaries. It never embeds evaluation
 * rows; those stay paginated under the run endpoint.
 */
export interface SessionDetailResponse {
  session: Session;
  turns: SessionTurnDetail[];
}

export interface CreateSessionRequest {
  title?: string;
}

export interface PatchSessionRequest {
  title?: string;
  status?: SessionStatus;
  selected_candidate_version_id?: string | null;
}

export interface CreateTurnRequest {
  requirement: string;
  candidate_count?: number;
}

export interface CreateTurnResponse {
  turn_id: string;
  status: TurnStatus;
}

export interface CandidateVersionSummary {
  id: string;
  parent_version_id: string | null;
  version_no: number;
  source: VersionSource;
  admission_state: AdmissionState;
  ast_hash: string | null;
  /** The first blocking diagnostic, for the candidate row (Section 11.2). */
  first_diagnostic: { code: string; path: string; message: string } | null;
  explanation: string | null;
  assumptions: string[];
  created_at: string;
}

export interface CandidateSummary {
  id: string;
  proposal_id: string;
  ordinal: number;
  versions: CandidateVersionSummary[];
}

export interface SessionTurnDetail {
  id: string;
  session_id: string;
  ordinal: number;
  requirement: string;
  candidate_count: number;
  provider: string;
  model: string;
  prompt_version: string;
  status: TurnStatus;
  error: { code: string; message: string } | null;
  started_at: string;
  finished_at: string | null;
  candidates: CandidateSummary[];
}

export type Split = "calibration" | "review";
export type RunStatus = "pending" | "running" | "completed" | "failed";
export type ScoreDirection = "higher" | "lower";
export type ErrorClass = "true_positive" | "true_negative" | "false_positive" | "false_negative";
export type RowFilterClass = ErrorClass | "disagreement";

export const EVALUATION_ROW_LIMIT_MAX = 200;
export const EVALUATION_ROW_LIMIT_DEFAULT = 50;
export const EVALUATION_VERSIONS_MAX = 5;

export interface DatasetVersionSummary {
  id: string;
  source_doi: string;
  source_url: string;
  license: string;
  citation: string;
  preprocessing_version: string;
  inclusion_policy: string;
  outcome_definition: string;
  split_seed: string;
  source_row_count: number;
  source_event_count: number;
  admitted_row_count: number;
  admitted_event_count: number;
  status: "current" | "superseded";
  created_at: string;
}

export interface DatasetCurrentResponse {
  dataset: DatasetVersionSummary;
  counts: { split: Split; rows: number; events: number }[];
}

export interface ConfusionCounts {
  true_positive: number;
  true_negative: number;
  false_positive: number;
  false_negative: number;
}

export interface ReviewMetrics {
  auroc: number | null;
  average_precision: number | null;
  sensitivity: number;
  specificity: number;
  positive_predictive_value: number | null;
  negative_predictive_value: number | null;
  confusion: ConfusionCounts;
  median_score_positive: number | null;
  median_score_negative: number | null;
  review_row_count: number;
  observed_positive_count: number;
  prevalence: number;
  /** Never a held-out claim: a human may inspect these and then edit. */
  interpretation: "exploratory";
}

export interface EvaluationRunDetail {
  id: string;
  candidate_version_id: string;
  dataset_version_id: string;
  status: RunStatus;
  score_direction: ScoreDirection | null;
  threshold: number | null;
  threshold_policy_version: string;
  metric_policy_version: string;
  evaluator_version: string;
  ast_hash: string;
  registry_hash: string;
  calibration_summary: { row_count: number; youden_j: number; policy: string } | null;
  review_metrics: ReviewMetrics | null;
  calibration_row_count: number | null;
  review_row_count: number | null;
  error: { code: string; message: string } | null;
  stale_dataset: boolean;
  started_at: string;
  finished_at: string | null;
}

export interface EvaluationRow {
  row_key: string;
  score: number;
  percentile: number;
  predicted_label: 0 | 1;
  observed_label: 0 | 1;
  error_class: ErrorClass;
  /** Only the admitted formula inputs; never the outcome or follow-up. */
  explanation_inputs: Record<string, number>;
}

export interface EvaluationRowsResponse {
  rows: EvaluationRow[];
  next_cursor: number | null;
}

export interface CreateEvaluationRunsResponse {
  run_ids: string[];
}

export interface LatestEvaluationRunResponse {
  run: EvaluationRunDetail | null;
}

export interface ReviewDecision {
  id: string;
  candidate_version_id: string;
  decision_no: number;
  decision: "accepted" | "rejected";
  evaluation_run_id: string | null;
  note: string | null;
  decided_at: string;
  stale_dataset: boolean;
}

export interface HealthResponse {
  status: "ok";
  schema_version: number;
  generator: {
    configured: boolean;
    provider: string | null;
    model: string | null;
  };
}

/** Every non-2xx response uses this envelope. */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
