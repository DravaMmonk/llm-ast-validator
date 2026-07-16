/**
 * prepare:cohort — verifies and imports the local cohort workbook (Section 8).
 *
 * The repository never downloads or redistributes the workbook: the user places
 * it at the documented path and this command verifies it. Preparation is
 * deterministic and idempotent by source checksum and preprocessing version, and
 * a failed load leaves the previous dataset version current.
 *
 * ExcelJS is used here and only here — the server never reads a workbook.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import ExcelJS from "exceljs";

import { canonicalJson } from "../shared/ast/canonical";
import type { PredictorRow, SignalId } from "../shared/ast/registry";
import { openDatabase } from "../server/db/connection";
import { migrate } from "../server/db/migrate";
import {
  findDatasetVersionBySource,
  publishDatasetVersion,
  type CohortRowInput,
  type Split,
} from "../server/db/stores/datasets";

export const PREPROCESSING_VERSION = "mvp_complete_case_v1";

export class PrepareError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PrepareError";
  }
}

export interface Manifest {
  license: { spdx_id: string; recommended_citation: string };
  dataset: { doi: string; record_url: string };
  source_file: {
    expected_filename: string;
    expected_path: string;
    reported_md5: string;
    pinned_sha256: string | null;
  };
  source_totals: { rows: number; events: number };
  column_contract: {
    predictors: Record<string, { source_column: string }>;
    evaluator_only: Record<string, { source_column: string }>;
    outcome: Record<string, { source_column: string }>;
  };
  outcome_contract: { fpg_positive_cutoff_mmol_l: number };
  inclusion_policy: { id: string };
  split: { seed: string; calibration_fraction: number };
}

export const MANIFEST_PATH = "data/source-manifest.json";

export function loadManifest(path = MANIFEST_PATH): Manifest {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as Manifest;
}

/**
 * Captures the SHA-256 on the first verified import (plan Section 8.1: a
 * repository-pinned digest captured during controlled source onboarding).
 *
 * This is trust-on-first-use and only ever narrows: the digest is written once,
 * after the file has already matched the MD5 the record publishes, and every
 * later import must match it. It never overwrites an existing pin — a mismatch
 * is a refusal, not a re-pin.
 */
export function pinSourceDigest(sha256: string, path = MANIFEST_PATH): boolean {
  const resolved = resolve(path);
  const manifest = JSON.parse(readFileSync(resolved, "utf8")) as {
    source_file: { pinned_sha256: string | null };
  };
  if (manifest.source_file.pinned_sha256) return false;

  manifest.source_file.pinned_sha256 = sha256;
  writeFileSync(resolved, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

export interface Digests {
  md5: string;
  sha256: string;
}

export function digestsOf(bytes: Buffer): Digests {
  return {
    md5: createHash("md5").update(bytes).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Refuses an unexpected filename or digest before any parsing happens. */
export function verifySource(path: string, manifest: Manifest): Digests {
  if (!existsSync(path)) {
    throw new PrepareError(
      "DATASET_SOURCE_MISSING",
      [
        `The cohort workbook is not at ${manifest.source_file.expected_path}.`,
        `Download “${manifest.source_file.expected_filename}” from ${manifest.dataset.record_url}`,
        "and place it there. The repository never downloads it for you.",
      ].join("\n"),
    );
  }
  if (basename(path) !== manifest.source_file.expected_filename) {
    throw new PrepareError(
      "DATASET_SOURCE_UNEXPECTED_NAME",
      `Expected “${manifest.source_file.expected_filename}”; found “${basename(path)}”.`,
    );
  }

  const digests = digestsOf(readFileSync(path));
  if (digests.md5 !== manifest.source_file.reported_md5) {
    throw new PrepareError(
      "DATASET_SOURCE_DIGEST_MISMATCH",
      `MD5 ${digests.md5} does not match the digest the record reports (${manifest.source_file.reported_md5}).`,
    );
  }
  // Null until first controlled onboarding; afterwards any drift is refused.
  if (manifest.source_file.pinned_sha256 && manifest.source_file.pinned_sha256 !== digests.sha256) {
    throw new PrepareError(
      "DATASET_SOURCE_DIGEST_MISMATCH",
      `SHA-256 ${digests.sha256} does not match the pinned digest.`,
    );
  }
  return digests;
}

export interface RawRow {
  predictors: Record<string, number | null>;
  followup_fpg: number | null;
  followup_years: number | null;
  outcome: number | null;
}

function numberOf(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "result" in value) return numberOf(value.result as ExcelJS.CellValue);
  return null;
}

/**
 * Reads the workbook against the manifest's column contract.
 *
 * An unknown or ambiguous fasting-glucose mapping is fatal: confusing baseline
 * FPG with the follow-up measurement would leak the outcome into a predictor.
 */
export async function readWorkbook(path: string, manifest: Manifest): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new PrepareError("DATASET_SCHEMA_DRIFT", "The workbook has no worksheet.");

  const header = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    const name = String(cell.value ?? "").trim();
    if (name === "") return;
    if (header.has(name)) {
      throw new PrepareError("DATASET_SCHEMA_DRIFT", `Column “${name}” appears more than once.`);
    }
    header.set(name, column);
  });

  const required: [string, string][] = [
    ...Object.entries(manifest.column_contract.predictors).map(
      ([id, spec]) => [id, spec.source_column] as [string, string],
    ),
    ...Object.entries(manifest.column_contract.evaluator_only).map(
      ([id, spec]) => [id, spec.source_column] as [string, string],
    ),
    ...Object.entries(manifest.column_contract.outcome).map(
      ([id, spec]) => [id, spec.source_column] as [string, string],
    ),
  ];

  for (const [id, column] of required) {
    if (!header.has(column)) {
      throw new PrepareError(
        "DATASET_SCHEMA_DRIFT",
        `The workbook has no column “${column}” for “${id}”. The column contract does not match this file.`,
      );
    }
  }

  const rows: RawRow[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const predictors: Record<string, number | null> = {};
    for (const [id, spec] of Object.entries(manifest.column_contract.predictors)) {
      predictors[id] = numberOf(row.getCell(header.get(spec.source_column)!).value);
    }
    rows.push({
      predictors,
      followup_fpg: numberOf(row.getCell(header.get(manifest.column_contract.evaluator_only.followup_fasting_plasma_glucose.source_column)!).value),
      followup_years: numberOf(row.getCell(header.get(manifest.column_contract.evaluator_only.followup_years.source_column)!).value),
      outcome: numberOf(row.getCell(header.get(manifest.column_contract.outcome.incident_diabetes.source_column)!).value),
    });
  });
  return rows;
}

export interface AdmissionOutcome {
  admitted: {
    predictors: PredictorRow;
    followup_fasting_plasma_glucose: number | null;
    followup_years: number;
    incident_diabetes: 0 | 1;
  }[];
  exclusions: Record<string, number>;
}

/** The deterministic inclusion policy `mvp_complete_case_v1` (Section 8.2). */
export function applyInclusionPolicy(rows: readonly RawRow[], manifest: Manifest): AdmissionOutcome {
  const exclusions: Record<string, number> = {
    non_binary_outcome: 0,
    non_positive_followup: 0,
    missing_predictor: 0,
  };
  const admitted: AdmissionOutcome["admitted"] = [];

  for (const row of rows) {
    if (row.outcome !== 0 && row.outcome !== 1) {
      exclusions.non_binary_outcome += 1;
      continue;
    }
    if (row.followup_years === null || row.followup_years <= 0) {
      exclusions.non_positive_followup += 1;
      continue;
    }
    if (Object.values(row.predictors).some((value) => value === null)) {
      exclusions.missing_predictor += 1;
      continue;
    }

    // Outcome contract: a follow-up FPG at or above the cutoff must be positive.
    // A positive below it stays valid — the published definition also includes
    // self-report.
    const cutoff = manifest.outcome_contract.fpg_positive_cutoff_mmol_l;
    if (row.followup_fpg !== null && row.followup_fpg >= cutoff && row.outcome !== 1) {
      throw new PrepareError(
        "DATASET_OUTCOME_CONTRACT_VIOLATED",
        `A row has follow-up FPG ${row.followup_fpg} >= ${cutoff} but is not marked positive.`,
      );
    }

    admitted.push({
      predictors: row.predictors as PredictorRow,
      followup_fasting_plasma_glucose: row.followup_fpg,
      followup_years: row.followup_years,
      incident_diabetes: row.outcome === 1 ? 1 : 0,
    });
  }
  return { admitted, exclusions };
}

/**
 * The internal split key: SHA-256 over the file digest, the canonical row
 * payload, and a duplicate ordinal. It never derives from a source subject id or
 * a workbook row number, so identical content recreates the same population
 * while the public row key stays unlinkable.
 */
export function splitKeyOf(fileSha256: string, row: AdmissionOutcome["admitted"][number], ordinal: number): string {
  const payload = canonicalJson({
    predictors: row.predictors as unknown as Record<string, number>,
    followup_fasting_plasma_glucose: row.followup_fasting_plasma_glucose,
    followup_years: row.followup_years,
    incident_diabetes: row.incident_diabetes,
  });
  return createHash("sha256").update(`${fileSha256}\n${payload}\n${ordinal}`).digest("hex");
}

/** Deterministic position in [0,1) from the seed and split key. */
function splitPosition(seed: string, splitKey: string): number {
  const digest = createHash("sha256").update(`${seed}\n${splitKey}`).digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16) / 2 ** 52;
}

/**
 * Label-stratified split, deterministic in the seed and the split keys alone.
 * Refuses to publish unless both splits carry both classes.
 */
export function assignSplits(
  keyed: { split_key: string; incident_diabetes: 0 | 1 }[],
  seed: string,
  calibrationFraction: number,
): Map<string, Split> {
  const assignment = new Map<string, Split>();

  for (const label of [0, 1] as const) {
    const group = keyed
      .filter((row) => row.incident_diabetes === label)
      .map((row) => ({ key: row.split_key, position: splitPosition(seed, row.split_key) }))
      .sort((a, b) => (a.position === b.position ? (a.key < b.key ? -1 : 1) : a.position - b.position));

    const cut = Math.round(group.length * calibrationFraction);
    group.forEach((row, index) => assignment.set(row.key, index < cut ? "calibration" : "review"));
  }

  for (const split of ["calibration", "review"] as const) {
    for (const label of [0, 1] as const) {
      const present = keyed.some(
        (row) => assignment.get(row.split_key) === split && row.incident_diabetes === label,
      );
      if (!present) {
        throw new PrepareError(
          "DATASET_SPLIT_CLASS_MISSING",
          `The ${split} split has no rows with outcome ${label}. Both splits need both classes.`,
        );
      }
    }
  }
  return assignment;
}

export interface PrepareResult {
  dataset_version_id: string | null;
  /** True when an identical import already existed and nothing was written. */
  reused_existing: boolean;
  digests: Digests;
  admitted_rows: number;
  admitted_events: number;
  exclusions: Record<string, number>;
  split_counts: Record<string, { rows: number; events: number }>;
  checked_only: boolean;
  /** True when this import captured the SHA-256 pin for the first time. */
  pinned_digest: boolean;
}

export async function prepareCohort(options: {
  workbookPath: string;
  databasePath: string;
  manifest: Manifest;
  checkOnly: boolean;
  /** When set, a first verified import pins the digest here. */
  manifestPath?: string;
}): Promise<PrepareResult> {
  const digests = verifySource(options.workbookPath, options.manifest);
  const raw = await readWorkbook(options.workbookPath, options.manifest);
  const { admitted, exclusions } = applyInclusionPolicy(raw, options.manifest);

  if (admitted.length === 0) {
    throw new PrepareError("DATASET_EMPTY", "No rows survived the inclusion policy.");
  }

  // A duplicate ordinal keeps identical rows distinct without ever touching a
  // source id or row number.
  const seen = new Map<string, number>();
  const keyed = admitted.map((row) => {
    const base = splitKeyOf(digests.sha256, row, 0);
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    return { row, split_key: ordinal === 0 ? base : splitKeyOf(digests.sha256, row, ordinal) };
  });

  const assignment = assignSplits(
    keyed.map((entry) => ({ split_key: entry.split_key, incident_diabetes: entry.row.incident_diabetes })),
    options.manifest.split.seed,
    options.manifest.split.calibration_fraction,
  );

  const splitCounts: Record<string, { rows: number; events: number }> = {
    calibration: { rows: 0, events: 0 },
    review: { rows: 0, events: 0 },
  };
  for (const entry of keyed) {
    const split = assignment.get(entry.split_key)!;
    splitCounts[split].rows += 1;
    splitCounts[split].events += entry.row.incident_diabetes;
  }

  const admittedEvents = admitted.filter((row) => row.incident_diabetes === 1).length;
  const result: PrepareResult = {
    dataset_version_id: null,
    digests,
    admitted_rows: admitted.length,
    admitted_events: admittedEvents,
    exclusions,
    split_counts: splitCounts,
    checked_only: options.checkOnly,
    pinned_digest: false,
    reused_existing: false,
  };
  // A check must not mutate the repository, so pinning belongs to a real import.
  if (options.checkOnly) return result;

  const rows: CohortRowInput[] = keyed.map((entry) => ({
    split_key: entry.split_key,
    // The only row identity an API may expose, and it is not derived from data.
    row_key: randomUUID(),
    split: assignment.get(entry.split_key)!,
    predictors: entry.row.predictors,
    followup_fasting_plasma_glucose: entry.row.followup_fasting_plasma_glucose,
    followup_years: entry.row.followup_years,
    incident_diabetes: entry.row.incident_diabetes,
  }));

  // The database directory does not exist on a clean checkout, and this command
  // is the first thing the documented walkthrough runs.
  mkdirSync(dirname(resolve(options.databasePath)), { recursive: true });
  const database = openDatabase(options.databasePath);
  try {
    migrate(database);

    // Idempotent by source checksum and preprocessing version: the same file
    // under the same policy reuses the existing version rather than
    // republishing it and duplicating every row.
    const existing = findDatasetVersionBySource(database, digests.sha256, PREPROCESSING_VERSION);
    if (existing?.status === "current") {
      result.dataset_version_id = existing.id;
      result.reused_existing = true;
      return result;
    }

    const id = randomUUID();
    publishDatasetVersion(
      database,
      {
        id,
        source_doi: options.manifest.dataset.doi,
        source_url: options.manifest.dataset.record_url,
        source_filename: basename(options.workbookPath),
        source_md5: digests.md5,
        source_sha256: digests.sha256,
        license: options.manifest.license.spdx_id,
        citation: options.manifest.license.recommended_citation,
        preprocessing_version: PREPROCESSING_VERSION,
        inclusion_policy: options.manifest.inclusion_policy.id,
        outcome_definition: `Incident diabetes observed during follow-up; follow-up FPG >= ${options.manifest.outcome_contract.fpg_positive_cutoff_mmol_l} mmol/L is positive.`,
        column_contract: options.manifest.column_contract,
        split_seed: options.manifest.split.seed,
        source_row_count: options.manifest.source_totals.rows,
        source_event_count: options.manifest.source_totals.events,
        admitted_row_count: admitted.length,
        admitted_event_count: admittedEvents,
        exclusion_counts: exclusions,
        split_counts: splitCounts,
        now: new Date().toISOString(),
      },
      rows,
    );
    result.dataset_version_id = id;
  } finally {
    database.close();
  }

  if (options.manifestPath) {
    result.pinned_digest = pinSourceDigest(digests.sha256, options.manifestPath);
  }
  return result;
}

async function main(): Promise<void> {
  const manifest = loadManifest();
  const checkOnly = process.argv.includes("--check-only");
  const workbookPath = resolve(manifest.source_file.expected_path);
  const databasePath = resolve(process.env.RESEARCH_DB_PATH ?? "var/research.db");

  try {
    const result = await prepareCohort({ workbookPath, databasePath, manifest, checkOnly, manifestPath: MANIFEST_PATH });
    // Aggregate output only: never a cohort row.
    console.log(checkOnly ? "[cohort] check only — nothing was written" : "[cohort] imported");
    console.log(`  sha256           ${result.digests.sha256}`);
    console.log(`  admitted rows    ${result.admitted_rows} (${result.admitted_events} events)`);
    console.log(`  exclusions       ${JSON.stringify(result.exclusions)}`);
    console.log(`  calibration      ${result.split_counts.calibration.rows} rows / ${result.split_counts.calibration.events} events`);
    console.log(`  review           ${result.split_counts.review.rows} rows / ${result.split_counts.review.events} events`);
    if (result.dataset_version_id) {
      console.log(
        `  dataset version  ${result.dataset_version_id}${result.reused_existing ? " (unchanged — same file and policy)" : ""}`,
      );
    }
    if (result.pinned_digest) {
      console.log(`  pinned sha256 into ${MANIFEST_PATH} — commit it; later imports must match.`);
    }
  } catch (error) {
    if (error instanceof PrepareError) {
      console.error(`[cohort] ${error.code}\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

// Only run as a CLI, so the tests can import the pure functions.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  void main();
}
