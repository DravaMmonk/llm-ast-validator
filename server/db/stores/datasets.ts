import type { PredictorRow, SignalId } from "../../../shared/ast/registry";
import { SIGNALS } from "../../../shared/ast/registry";
import type { AppDatabase } from "../connection";

export type Split = "calibration" | "review";

export interface DatasetVersion {
  id: string;
  source_doi: string;
  source_url: string;
  source_filename: string;
  source_md5: string;
  source_sha256: string;
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

const PREDICTOR_COLUMNS = SIGNALS.map((signal) => signal.id);

/** The columns an evaluation may read in addition to the predictors. */
export interface EvaluatorRow {
  row_key: string;
  split: Split;
  predictors: PredictorRow;
  observed_label: 0 | 1;
}

export function findCurrentDatasetVersion(database: AppDatabase): DatasetVersion | undefined {
  return database
    .prepare<[], DatasetVersion>(
      `SELECT id, source_doi, source_url, source_filename, source_md5, source_sha256, license, citation,
              preprocessing_version, inclusion_policy, outcome_definition, split_seed,
              source_row_count, source_event_count, admitted_row_count, admitted_event_count,
              status, created_at
       FROM dataset_versions WHERE status = 'current'`,
    )
    .get();
}

export function findDatasetVersion(database: AppDatabase, id: string): DatasetVersion | undefined {
  return database
    .prepare<[string], DatasetVersion>(
      `SELECT id, source_doi, source_url, source_filename, source_md5, source_sha256, license, citation,
              preprocessing_version, inclusion_policy, outcome_definition, split_seed,
              source_row_count, source_event_count, admitted_row_count, admitted_event_count,
              status, created_at
       FROM dataset_versions WHERE id = ?`,
    )
    .get(id);
}

/**
 * Section 17: preparation is idempotent by source checksum and preprocessing
 * version. A re-import of the same file under the same policy must not create a
 * second version or duplicate the rows.
 */
export function findDatasetVersionBySource(
  database: AppDatabase,
  sourceSha256: string,
  preprocessingVersion: string,
): DatasetVersion | undefined {
  return database
    .prepare<[string, string], DatasetVersion>(
      `SELECT id, source_doi, source_url, source_filename, source_md5, source_sha256, license, citation,
              preprocessing_version, inclusion_policy, outcome_definition, split_seed,
              source_row_count, source_event_count, admitted_row_count, admitted_event_count,
              status, created_at
       FROM dataset_versions
       WHERE source_sha256 = ? AND preprocessing_version = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sourceSha256, preprocessingVersion);
}

export function datasetCounts(
  database: AppDatabase,
  datasetVersionId: string,
): { split: Split; rows: number; events: number }[] {
  return database
    .prepare<[string], { split: Split; rows: number; events: number }>(
      `SELECT split, COUNT(*) AS rows, SUM(incident_diabetes) AS events
       FROM cohort_rows WHERE dataset_version_id = ? GROUP BY split ORDER BY split`,
    )
    .all(datasetVersionId);
}

/**
 * Reads one split as predictor projections plus the observed label.
 *
 * The projection is constructed here, column by column, from the allowlist. The
 * AST interpreter therefore never receives a complete database row and cannot
 * reach the outcome or the follow-up fields even by accident (Section 7.1).
 */
export function readSplit(database: AppDatabase, datasetVersionId: string, split: Split): EvaluatorRow[] {
  const columns = ["row_key", "incident_diabetes", ...PREDICTOR_COLUMNS].join(", ");
  const rows = database
    .prepare<[string, Split], Record<string, unknown>>(
      `SELECT ${columns} FROM cohort_rows WHERE dataset_version_id = ? AND split = ? ORDER BY row_key`,
    )
    .all(datasetVersionId, split);

  return rows.map((row) => {
    const predictors = {} as PredictorRow;
    for (const id of PREDICTOR_COLUMNS) predictors[id as SignalId] = row[id] as number;
    return {
      row_key: row.row_key as string,
      split,
      predictors,
      observed_label: (row.incident_diabetes as number) === 1 ? 1 : 0,
    };
  });
}

export interface InsertDatasetInput extends Omit<DatasetVersion, "status" | "created_at"> {
  column_contract: unknown;
  exclusion_counts: unknown;
  split_counts: unknown;
  now: string;
}

export interface CohortRowInput {
  split_key: string;
  row_key: string;
  split: Split;
  predictors: PredictorRow;
  followup_fasting_plasma_glucose: number | null;
  followup_years: number;
  incident_diabetes: 0 | 1;
}

/**
 * Publishes a dataset version atomically: stage the rows, then supersede the
 * previous current version and mark this one current in the same transaction
 * (Section 12.6). A failed load leaves the previous version current.
 */
export function publishDatasetVersion(
  database: AppDatabase,
  input: InsertDatasetInput,
  rows: readonly CohortRowInput[],
): void {
  const insertRow = database.prepare(
    `INSERT INTO cohort_rows
       (dataset_version_id, split_key, row_key, split, ${PREDICTOR_COLUMNS.join(", ")},
        followup_fasting_plasma_glucose, followup_years, incident_diabetes)
     VALUES (@dataset_version_id, @split_key, @row_key, @split, ${PREDICTOR_COLUMNS.map((c) => `@${c}`).join(", ")},
        @followup_fasting_plasma_glucose, @followup_years, @incident_diabetes)`,
  );

  const publish = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO dataset_versions
           (id, source_doi, source_url, source_filename, source_md5, source_sha256, license, citation,
            preprocessing_version, inclusion_policy, outcome_definition, column_contract_json, split_seed,
            source_row_count, source_event_count, admitted_row_count, admitted_event_count,
            exclusion_counts_json, split_counts_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'superseded', ?)`,
      )
      .run(
        input.id,
        input.source_doi,
        input.source_url,
        input.source_filename,
        input.source_md5,
        input.source_sha256,
        input.license,
        input.citation,
        input.preprocessing_version,
        input.inclusion_policy,
        input.outcome_definition,
        JSON.stringify(input.column_contract),
        input.split_seed,
        input.source_row_count,
        input.source_event_count,
        input.admitted_row_count,
        input.admitted_event_count,
        JSON.stringify(input.exclusion_counts),
        JSON.stringify(input.split_counts),
        input.now,
      );

    for (const row of rows) {
      insertRow.run({
        dataset_version_id: input.id,
        split_key: row.split_key,
        row_key: row.row_key,
        split: row.split,
        ...row.predictors,
        followup_fasting_plasma_glucose: row.followup_fasting_plasma_glucose,
        followup_years: row.followup_years,
        incident_diabetes: row.incident_diabetes,
      });
    }

    // Only now flip current, so a failure above never unseats the old version.
    database.prepare("UPDATE dataset_versions SET status = 'superseded' WHERE status = 'current'").run();
    database.prepare("UPDATE dataset_versions SET status = 'current' WHERE id = ?").run(input.id);
  });
  publish();
}
