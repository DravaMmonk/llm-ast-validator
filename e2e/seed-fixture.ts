/**
 * Seeds a small synthetic cohort for the browser test.
 *
 * Synthetic only, never the real workbook: Section 8.6 keeps real cohort rows
 * out of every test artifact, screenshot, and recording.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { openDatabase } from "../server/db/connection";
import { migrate } from "../server/db/migrate";
import { publishDatasetVersion, type CohortRowInput } from "../server/db/stores/datasets";
import { SMOKE_ROW } from "../shared/ast/registry";

export function seedSyntheticCohort(databasePath: string, rowCount = 200): string {
  mkdirSync(dirname(databasePath), { recursive: true });
  // Every browser run starts from an empty database so results never depend on a previous run.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
  const database = openDatabase(databasePath);
  migrate(database);

  const rows: CohortRowInput[] = Array.from({ length: rowCount }, (_, i) => {
    const positive = i % 4 === 0;
    return {
      split_key: `synthetic-${i}`,
      row_key: randomUUID(),
      split: i % 10 < 7 ? "calibration" : "review",
      predictors: {
        ...SMOKE_ROW,
        // Overlapping distributions, so the review split shows real
        // disagreements rather than a perfect separation.
        baseline_fasting_plasma_glucose: (positive ? 6.0 : 5.2) + ((i % 9) - 4) * 0.12,
        bmi: 22 + (i % 11) * 0.45,
        age: 40 + (i % 23),
      },
      followup_fasting_plasma_glucose: positive ? 7.3 : 5.2,
      followup_years: 3.1,
      incident_diabetes: positive ? 1 : 0,
    };
  });

  const id = randomUUID();
  publishDatasetVersion(
    database,
    {
      id,
      source_doi: "10.5061/dryad.ft8750v",
      source_url: "https://doi.org/10.5061/dryad.ft8750v",
      source_filename: "synthetic-e2e-fixture.xlsx",
      source_md5: "0".repeat(32),
      source_sha256: "0".repeat(64),
      license: "CC0-1.0",
      citation: "Synthetic fixture — not the published dataset.",
      preprocessing_version: "mvp_complete_case_v1",
      inclusion_policy: "mvp_complete_case_v1",
      outcome_definition: "Synthetic incident diabetes for the browser test.",
      column_contract: { synthetic: true },
      split_seed: "diabetes-prototype-v1",
      source_row_count: rowCount,
      source_event_count: rows.filter((row) => row.incident_diabetes === 1).length,
      admitted_row_count: rowCount,
      admitted_event_count: rows.filter((row) => row.incident_diabetes === 1).length,
      exclusion_counts: {},
      split_counts: {},
      now: new Date().toISOString(),
    },
    rows,
  );
  database.close();
  return id;
}

if (process.argv[1]?.endsWith("seed-fixture.ts")) {
  const path = process.env.RESEARCH_DB_PATH ?? "var/e2e.db";
  console.log(`[e2e] seeded synthetic cohort ${seedSyntheticCohort(path)} into ${path}`);
}
