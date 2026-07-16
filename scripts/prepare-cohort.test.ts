import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../server/db/connection";
import { findCurrentDatasetVersion, readSplit } from "../server/db/stores/datasets";
import {
  MANIFEST_PATH,
  PrepareError,
  applyInclusionPolicy,
  assignSplits,
  digestsOf,
  loadManifest,
  pinSourceDigest,
  prepareCohort,
  splitKeyOf,
  verifySource,
  type Manifest,
} from "./prepare-cohort";

let directory: string;
let manifest: Manifest;

/**
 * The fixture header is derived from the manifest rather than restated, so a
 * contract change cannot leave the fixture silently agreeing with itself.
 */
function contractColumns(m: Manifest): string[] {
  return [
    m.column_contract.predictors.age.source_column,
    m.column_contract.predictors.bmi.source_column,
    m.column_contract.predictors.systolic_bp.source_column,
    m.column_contract.predictors.diastolic_bp.source_column,
    m.column_contract.predictors.baseline_fasting_plasma_glucose.source_column,
    m.column_contract.predictors.triglycerides.source_column,
    m.column_contract.predictors.hdl_cholesterol.source_column,
    m.column_contract.predictors.ldl_cholesterol.source_column,
    m.column_contract.predictors.total_cholesterol.source_column,
    m.column_contract.evaluator_only.followup_fasting_plasma_glucose.source_column,
    m.column_contract.evaluator_only.followup_years.source_column,
    m.column_contract.outcome.incident_diabetes.source_column,
  ];
}

interface Row {
  age?: number | null;
  fpg?: number;
  followupFpg?: number | null;
  year?: number;
  censor?: number | null;
}

/** A tiny synthetic workbook. The real workbook is never used by a test. */
async function writeWorkbook(rows: Row[], path: string, columns?: string[]): Promise<void> {
  const header = columns ?? contractColumns(manifest);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow(header);
  rows.forEach((row, i) => {
    sheet.addRow([
      row.age === undefined ? 40 + i : row.age,
      24 + i * 0.1,
      120,
      78,
      row.fpg ?? 5.0 + i * 0.05,
      1.4,
      1.3,
      2.8,
      4.8,
      row.followupFpg === undefined ? 5.2 : row.followupFpg,
      row.year ?? 3.1,
      row.censor === undefined ? (i % 2 === 0 ? 1 : 0) : row.censor,
    ]);
  });
  await workbook.xlsx.writeFile(path);
}

/** Rewrites the manifest so its digest matches whatever fixture we just wrote. */
function manifestFor(path: string, overrides: Partial<Manifest["source_file"]> = {}): Manifest {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const digests = digestsOf(readFileSync(path));
  return {
    ...manifest,
    source_file: {
      ...manifest.source_file,
      expected_filename: "fixture.xlsx",
      expected_path: path,
      reported_md5: digests.md5,
      pinned_sha256: null,
      ...overrides,
    },
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-cohort-"));
  manifest = loadManifest();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("the shipped manifest", () => {
  it("pins the record, licence, and source totals", () => {
    expect(manifest.dataset.doi).toBe("10.5061/dryad.ft8750v");
    expect(manifest.license.spdx_id).toBe("CC0-1.0");
    expect(manifest.source_file.expected_filename).toBe("RC Health Care Data-20180820.xlsx");
    expect(manifest.source_file.reported_md5).toBe("b468cc3704b11ba1bd21532451fe2856");
    expect(manifest.source_totals.rows).toBe(211833);
    expect(manifest.source_totals.events).toBe(4174);
  });

  it("separates baseline FPG from the evaluator-only follow-up FPG", () => {
    // Verified against the real workbook header. These two must never be
    // confused: mapping the follow-up measurement to the baseline predictor
    // would leak the outcome into every formula.
    const baseline = manifest.column_contract.predictors.baseline_fasting_plasma_glucose.source_column;
    const followup = manifest.column_contract.evaluator_only.followup_fasting_plasma_glucose.source_column;

    expect(baseline).toBe("FPG (mmol/L)");
    expect(followup).toBe("FPG of final visit(mmol/L)");
    expect(baseline).not.toBe(followup);

    // The outcome is never a predictor, under any of its source names.
    expect(Object.keys(manifest.column_contract.predictors)).not.toContain("incident_diabetes");
    const predictorColumns = Object.values(manifest.column_contract.predictors).map((p) => p.source_column);
    expect(predictorColumns).not.toContain(manifest.column_contract.outcome.incident_diabetes.source_column);
    expect(predictorColumns).not.toContain(followup);
  });

  it("maps the outcome to the binary censor column, not the diagnosed subset", () => {
    // The workbook also carries "Diabetes diagnosed during followup", which
    // holds only the diagnosed subset (1,304 of the 4,174 events). Choosing it
    // would silently drop two thirds of the outcomes.
    expect(manifest.column_contract.outcome.incident_diabetes.source_column).toBe(
      "censor of diabetes at followup(1, Yes; 0, No)",
    );
  });

  it("declares the fixed split contract", () => {
    expect(manifest.split.seed).toBe("diabetes-prototype-v1");
    expect(manifest.split.calibration_fraction).toBe(0.7);
  });
});

describe("verifySource", () => {
  it("reports a missing workbook with instructions rather than a stack trace", () => {
    expect(() => verifySource(join(directory, "absent.xlsx"), manifest)).toThrow(PrepareError);
    try {
      verifySource(join(directory, "absent.xlsx"), manifest);
    } catch (error) {
      expect((error as PrepareError).code).toBe("DATASET_SOURCE_MISSING");
      expect((error as PrepareError).message).toContain("Download");
    }
  });

  it("refuses an unexpected filename", async () => {
    const path = join(directory, "wrong-name.xlsx");
    await writeWorkbook([{}], path);
    expect(() => verifySource(path, manifestFor(path, { expected_filename: "fixture.xlsx" }))).toThrow(
      /unexpected|Expected/i,
    );
  });

  it("refuses a checksum mismatch", async () => {
    const path = join(directory, "fixture.xlsx");
    await writeWorkbook([{}], path);
    const drifted = manifestFor(path, { reported_md5: "0".repeat(32) });

    expect(() => verifySource(path, drifted)).toThrow(/MD5/);
  });

  it("refuses a pinned SHA-256 mismatch", async () => {
    const path = join(directory, "fixture.xlsx");
    await writeWorkbook([{}], path);
    const drifted = manifestFor(path, { pinned_sha256: "1".repeat(64) });

    expect(() => verifySource(path, drifted)).toThrow(/SHA-256/);
  });

  it("accepts a matching file", async () => {
    const path = join(directory, "fixture.xlsx");
    await writeWorkbook([{}], path);
    expect(verifySource(path, manifestFor(path)).sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("schema drift", () => {
  it("refuses a workbook missing a contracted column", async () => {
    const path = join(directory, "fixture.xlsx");
    const followupFpg = manifest.column_contract.evaluator_only.followup_fasting_plasma_glucose.source_column;
    await writeWorkbook([{}], path, contractColumns(manifest).filter((c) => c !== followupFpg));

    await expect(
      prepareCohort({ workbookPath: path, databasePath: join(directory, "d.db"), manifest: manifestFor(path), checkOnly: true }),
    ).rejects.toThrow(/has no column .* for “followup_fasting_plasma_glucose”/);
  });

  it("refuses a duplicated column", async () => {
    const path = join(directory, "fixture.xlsx");
    const baselineFpg = manifest.column_contract.predictors.baseline_fasting_plasma_glucose.source_column;
    await writeWorkbook([{}], path, [...contractColumns(manifest), baselineFpg]);

    await expect(
      prepareCohort({ workbookPath: path, databasePath: join(directory, "d.db"), manifest: manifestFor(path), checkOnly: true }),
    ).rejects.toThrow(/more than once/);
  });
});

describe("applyInclusionPolicy", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    predictors: Object.fromEntries(
      Object.keys(manifest.column_contract.predictors).map((id) => [id, 1]),
    ) as Record<string, number | null>,
    followup_fpg: 5.2,
    followup_years: 3.1,
    outcome: 0,
    ...over,
  });

  it("counts exclusions by reason", () => {
    const { admitted, exclusions } = applyInclusionPolicy(
      [
        raw(),
        raw({ outcome: null }),
        raw({ outcome: 2 }),
        raw({ followup_years: 0 }),
        raw({ followup_years: -1 }),
        raw({ predictors: { ...raw().predictors, bmi: null } }),
      ],
      manifest,
    );

    expect(admitted).toHaveLength(1);
    expect(exclusions).toEqual({ non_binary_outcome: 2, non_positive_followup: 2, missing_predictor: 1 });
  });

  it("enforces the outcome contract at the FPG cutoff", () => {
    // Follow-up FPG at or above 7.0 must be positive.
    expect(() => applyInclusionPolicy([raw({ followup_fpg: 7.2, outcome: 0 })], manifest)).toThrow(
      /not marked positive/,
    );
  });

  it("allows a positive below the cutoff, since self-report also counts", () => {
    const { admitted } = applyInclusionPolicy([raw({ followup_fpg: 5.4, outcome: 1 })], manifest);
    expect(admitted).toHaveLength(1);
    expect(admitted[0].incident_diabetes).toBe(1);
  });
});

describe("split keys", () => {
  const row = {
    predictors: { age: 40 } as never,
    followup_fasting_plasma_glucose: 5.2,
    followup_years: 3.1,
    incident_diabetes: 0 as const,
  };

  it("is deterministic for the same content and file", () => {
    expect(splitKeyOf("abc", row, 0)).toBe(splitKeyOf("abc", row, 0));
  });

  it("changes with the file digest, so a new file is a new population", () => {
    expect(splitKeyOf("abc", row, 0)).not.toBe(splitKeyOf("def", row, 0));
  });

  it("distinguishes duplicate rows by ordinal", () => {
    expect(splitKeyOf("abc", row, 0)).not.toBe(splitKeyOf("abc", row, 1));
  });

  it("does not embed a source id or row number", () => {
    // The key derives only from digest, payload, and ordinal.
    expect(splitKeyOf("abc", row, 0)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("assignSplits", () => {
  const keyed = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      split_key: splitKeyOf("file", { predictors: { age: i } as never, followup_fasting_plasma_glucose: 5, followup_years: 3, incident_diabetes: (i % 2) as 0 | 1 }, 0),
      incident_diabetes: (i % 2) as 0 | 1,
    }));

  it("is deterministic for the same seed and keys", () => {
    const rows = keyed(40);
    expect([...assignSplits(rows, "seed", 0.7)]).toEqual([...assignSplits(rows, "seed", 0.7)]);
  });

  it("changes with the seed", () => {
    const rows = keyed(40);
    expect([...assignSplits(rows, "seed-a", 0.7)]).not.toEqual([...assignSplits(rows, "seed-b", 0.7)]);
  });

  it("stratifies each class near the requested fraction", () => {
    const rows = keyed(100);
    const assignment = assignSplits(rows, "seed", 0.7);
    for (const label of [0, 1] as const) {
      const group = rows.filter((row) => row.incident_diabetes === label);
      const calibration = group.filter((row) => assignment.get(row.split_key) === "calibration").length;
      expect(calibration / group.length).toBeCloseTo(0.7, 1);
    }
  });

  it("refuses to publish when a split would lack a class", () => {
    // Only positives exist, so the review split can hold no negative.
    const rows = keyed(10).map((row) => ({ ...row, incident_diabetes: 1 as const }));
    expect(() => assignSplits(rows, "seed", 0.7)).toThrow(/no rows with outcome 0/);
  });

  it("does not depend on input order", () => {
    const rows = keyed(40);
    const a = assignSplits(rows, "seed", 0.7);
    const b = assignSplits([...rows].reverse(), "seed", 0.7);
    for (const row of rows) expect(b.get(row.split_key)).toBe(a.get(row.split_key));
  });
});

describe("prepareCohort", () => {
  async function fixture(rows = 40): Promise<{ path: string; manifest: Manifest }> {
    const path = join(directory, "fixture.xlsx");
    await writeWorkbook(
      Array.from({ length: rows }, (_, i) => ({ censor: i % 2 === 0 ? 1 : 0, followupFpg: i % 2 === 0 ? 7.2 : 5.1 })),
      path,
    );
    return { path, manifest: manifestFor(path) };
  }

  it("verifies without writing under --check-only", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "check.db");

    const result = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: true });

    expect(result.checked_only).toBe(true);
    expect(result.dataset_version_id).toBeNull();
    expect(result.admitted_rows).toBe(40);
    expect(result.admitted_events).toBe(20);
  });

  it("imports and publishes one current dataset version", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "import.db");

    const result = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    const database = openDatabase(databasePath);
    const current = findCurrentDatasetVersion(database)!;
    expect(current.id).toBe(result.dataset_version_id);
    expect(current.license).toBe("CC0-1.0");
    expect(current.inclusion_policy).toBe("mvp_complete_case_v1");
    expect(current.split_seed).toBe("diabetes-prototype-v1");
    // Both the published totals and what survived locally are recorded.
    expect(current.source_row_count).toBe(211833);
    expect(current.admitted_row_count).toBe(40);
    database.close();
  });

  it("produces the same dataset version content and split for the same input", async () => {
    const { path, manifest: m } = await fixture();
    const first = await prepareCohort({ workbookPath: path, databasePath: join(directory, "a.db"), manifest: m, checkOnly: false });
    const second = await prepareCohort({ workbookPath: path, databasePath: join(directory, "b.db"), manifest: m, checkOnly: false });

    expect(second.digests.sha256).toBe(first.digests.sha256);
    expect(second.split_counts).toEqual(first.split_counts);
    expect(second.admitted_rows).toBe(first.admitted_rows);
  });

  it("gives each row an opaque display key unrelated to its split key", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "keys.db");
    await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    const database = openDatabase(databasePath);
    const rows = database.prepare("SELECT split_key, row_key FROM cohort_rows").all() as {
      split_key: string;
      row_key: string;
    }[];

    for (const row of rows) {
      expect(row.row_key).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.split_key).not.toBe(row.row_key);
      expect(row.split_key).not.toContain(row.row_key);
    }
    // Row keys are random, so two imports of the same file differ.
    const other = join(directory, "keys2.db");
    await prepareCohort({ workbookPath: path, databasePath: other, manifest: m, checkOnly: false });
    const second = openDatabase(other);
    const otherKeys = (second.prepare("SELECT row_key FROM cohort_rows").all() as { row_key: string }[]).map(
      (r) => r.row_key,
    );
    expect(rows.map((r) => r.row_key).some((key) => otherKeys.includes(key))).toBe(false);

    // ...while the split population is identical.
    const firstSplitKeys = rows.map((r) => r.split_key).sort();
    const secondSplitKeys = (second.prepare("SELECT split_key FROM cohort_rows").all() as { split_key: string }[])
      .map((r) => r.split_key)
      .sort();
    expect(secondSplitKeys).toEqual(firstSplitKeys);
    database.close();
    second.close();
  });

  it("is idempotent by source checksum and preprocessing version", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "idempotent.db");

    const first = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });
    const second = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    // The same file under the same policy reuses the version rather than
    // republishing it — otherwise every re-run would duplicate every row.
    expect(second.reused_existing).toBe(true);
    expect(second.dataset_version_id).toBe(first.dataset_version_id);

    const database = openDatabase(databasePath);
    const versions = database.prepare("SELECT COUNT(*) AS n FROM dataset_versions").get() as { n: number };
    const rows = database.prepare("SELECT COUNT(*) AS n FROM cohort_rows").get() as { n: number };
    expect(versions.n).toBe(1);
    expect(rows.n).toBe(first.admitted_rows);
    database.close();
  });

  it("republishes when the preprocessing policy differs from the stored one", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "policy.db");
    await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    // A version stored under a different policy must not satisfy this import.
    const database = openDatabase(databasePath);
    database.prepare("UPDATE dataset_versions SET preprocessing_version = 'older_policy'").run();
    database.close();

    const again = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });
    expect(again.reused_existing).toBe(false);

    const check = openDatabase(databasePath);
    expect((check.prepare("SELECT COUNT(*) AS n FROM dataset_versions").get() as { n: number }).n).toBe(2);
    check.close();
  });

  it("supersedes the previous version atomically when the source changes", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "supersede.db");
    const first = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    // A genuinely different file: same policy, new content, so a new version.
    const updated = join(directory, "fixture.xlsx");
    await writeWorkbook(
      Array.from({ length: 24 }, (_, i) => ({ censor: i % 2 === 0 ? 1 : 0, followupFpg: i % 2 === 0 ? 7.4 : 5.0 })),
      updated,
    );
    const second = await prepareCohort({
      workbookPath: updated,
      databasePath,
      manifest: manifestFor(updated),
      checkOnly: false,
    });

    expect(second.reused_existing).toBe(false);
    expect(second.dataset_version_id).not.toBe(first.dataset_version_id);

    const database = openDatabase(databasePath);
    expect(findCurrentDatasetVersion(database)!.id).toBe(second.dataset_version_id);
    const superseded = database
      .prepare("SELECT status FROM dataset_versions WHERE id = ?")
      .get(first.dataset_version_id) as { status: string };
    expect(superseded.status).toBe("superseded");
    database.close();
  });

  it("leaves the previous version current when a load fails", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "fail.db");
    const good = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    // A workbook that violates the outcome contract must not unseat the old one.
    const badPath = join(directory, "fixture-bad.xlsx");
    await writeWorkbook([{ censor: 0, followupFpg: 9.9 }], badPath);
    await expect(
      prepareCohort({ workbookPath: badPath, databasePath, manifest: manifestFor(badPath), checkOnly: false }),
    ).rejects.toThrow(PrepareError);

    const database = openDatabase(databasePath);
    expect(findCurrentDatasetVersion(database)!.id).toBe(good.dataset_version_id);
    database.close();
  });

  it("stores the predictor projection the evaluator will read", async () => {
    const { path, manifest: m } = await fixture();
    const databasePath = join(directory, "projection.db");
    const result = await prepareCohort({ workbookPath: path, databasePath, manifest: m, checkOnly: false });

    const database = openDatabase(databasePath);
    const rows = readSplit(database, result.dataset_version_id!, "review");

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.predictors).not.toHaveProperty("incident_diabetes");
      expect(row.predictors).not.toHaveProperty("followup_fasting_plasma_glucose");
      expect(Number.isFinite(row.predictors.baseline_fasting_plasma_glucose)).toBe(true);
    }
    database.close();
  });

  it("creates the database directory a clean checkout does not have", async () => {
    const { path, manifest: m } = await fixture();
    // The documented walkthrough runs this command first, before anything has
    // created var/.
    const nested = join(directory, "does", "not", "exist", "research.db");

    const result = await prepareCohort({ workbookPath: path, databasePath: nested, manifest: m, checkOnly: false });

    expect(result.dataset_version_id).not.toBeNull();
    const database = openDatabase(nested);
    expect(findCurrentDatasetVersion(database)).toBeDefined();
    database.close();
  });

  it("refuses an empty admitted population", async () => {
    const path = join(directory, "fixture.xlsx");
    await writeWorkbook([{ censor: null }], path);

    await expect(
      prepareCohort({ workbookPath: path, databasePath: join(directory, "empty.db"), manifest: manifestFor(path), checkOnly: true }),
    ).rejects.toThrow(/No rows survived/);
  });
});

describe("pinning the source digest", () => {
  /** A throwaway manifest copy, so a test never rewrites the tracked one. */
  function manifestCopy(pinned: string | null = null): string {
    const path = join(directory, "manifest.json");
    const base = loadManifest();
    writeFileSync(
      path,
      JSON.stringify({ ...base, source_file: { ...base.source_file, pinned_sha256: pinned } }, null, 2),
    );
    return path;
  }

  function pinnedIn(path: string): string | null {
    return (JSON.parse(readFileSync(path, "utf8")) as Manifest).source_file.pinned_sha256;
  }

  it("captures the digest on a first import", () => {
    const path = manifestCopy(null);
    expect(pinSourceDigest("a".repeat(64), path)).toBe(true);
    expect(pinnedIn(path)).toBe("a".repeat(64));
  });

  it("never overwrites an existing pin", () => {
    const path = manifestCopy("b".repeat(64));
    // A drifted file must be refused, never silently re-pinned.
    expect(pinSourceDigest("c".repeat(64), path)).toBe(false);
    expect(pinnedIn(path)).toBe("b".repeat(64));
  });

  it("is refused by verifySource once pinned and the file changes", async () => {
    const workbook = join(directory, "fixture.xlsx");
    await writeWorkbook([{}], workbook);
    const m = manifestFor(workbook, { pinned_sha256: "d".repeat(64) });

    expect(() => verifySource(workbook, m)).toThrow(/SHA-256/);
  });

  it("pins during a real import and leaves the tracked manifest alone", async () => {
    const workbook = join(directory, "fixture.xlsx");
    await writeWorkbook(
      Array.from({ length: 20 }, (_, i) => ({ censor: i % 2 === 0 ? 1 : 0, followupFpg: i % 2 === 0 ? 7.2 : 5.1 })),
      workbook,
    );
    const path = manifestCopy(null);
    const m = manifestFor(workbook);

    const result = await prepareCohort({
      workbookPath: workbook,
      databasePath: join(directory, "pin.db"),
      manifest: m,
      checkOnly: false,
      manifestPath: path,
    });

    expect(result.pinned_digest).toBe(true);
    expect(pinnedIn(path)).toBe(result.digests.sha256);
    // The repository's own manifest is untouched by any test. Its pin is
    // whatever the real onboarding import captured; a test must never move it.
    expect(loadManifest(MANIFEST_PATH).source_file.pinned_sha256).toBe(
      manifest.source_file.pinned_sha256,
    );
  });

  it("does not pin under --check-only", async () => {
    const workbook = join(directory, "fixture.xlsx");
    await writeWorkbook(
      Array.from({ length: 20 }, (_, i) => ({ censor: i % 2 === 0 ? 1 : 0, followupFpg: i % 2 === 0 ? 7.2 : 5.1 })),
      workbook,
    );
    const path = manifestCopy(null);

    const result = await prepareCohort({
      workbookPath: workbook,
      databasePath: join(directory, "nopin.db"),
      manifest: manifestFor(workbook),
      checkOnly: true,
      manifestPath: path,
    });

    // A check must not mutate the repository.
    expect(result.pinned_digest).toBe(false);
    expect(pinnedIn(path)).toBeNull();
  });
});
