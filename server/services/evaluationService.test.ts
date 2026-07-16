import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../shared/ast/canonical";
import { AST_VERSION, admit } from "../../shared/ast/core";
import { SMOKE_ROW, registryHash } from "../../shared/ast/registry";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { insertSession } from "../db/stores/sessions";
import { publishDatasetVersion, readSplit, type CohortRowInput } from "../db/stores/datasets";
import { findRun } from "../db/stores/evaluations";
import { createEvaluationRuns, executeEvaluationRun } from "./evaluationService";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let database: Database;
let sessionId: string;

const doc = (root: unknown) => ({ ast_version: AST_VERSION, root });
const signal = (id: string) => ({ node_type: "ref", ref_type: "signal", id });
const literal = (value: number) => ({ node_type: "literal", value });
const call = (op: string, ...args: unknown[]) => ({ node_type: "call", op, args });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-eval-"));
  database = openDatabase(join(directory, "test.db"));
  migrate(database);
  sessionId = insertSession(database, { id: randomUUID(), title: "S", now: new Date().toISOString() }).id;
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

/** A synthetic cohort: glucose separates the classes cleanly. */
function syntheticRows(count = 20): CohortRowInput[] {
  return Array.from({ length: count }, (_, i) => {
    const positive = i % 2 === 0;
    return {
      split_key: `key-${i}`,
      row_key: `row-${i}`,
      split: i < count / 2 ? "calibration" : "review",
      predictors: {
        ...SMOKE_ROW,
        // Positives get a clearly higher baseline glucose.
        baseline_fasting_plasma_glucose: positive ? 6.5 + i * 0.01 : 4.5 + i * 0.01,
        bmi: 24 + i * 0.1,
      },
      followup_fasting_plasma_glucose: positive ? 7.2 : 5.1,
      followup_years: 3.1,
      incident_diabetes: positive ? 1 : 0,
    } as CohortRowInput;
  });
}

function publish(rows: CohortRowInput[] = syntheticRows()): string {
  const id = randomUUID();
  publishDatasetVersion(
    database,
    {
      id,
      source_doi: "10.5061/dryad.test",
      source_url: "https://example.invalid/test",
      source_filename: "synthetic.xlsx",
      source_md5: "0".repeat(32),
      source_sha256: "0".repeat(64),
      license: "CC0-1.0",
      citation: "Synthetic fixture",
      preprocessing_version: "test-v1",
      inclusion_policy: "mvp_complete_case_v1",
      outcome_definition: "synthetic",
      column_contract: {},
      split_seed: "diabetes-prototype-v1",
      source_row_count: rows.length,
      source_event_count: rows.filter((r) => r.incident_diabetes === 1).length,
      admitted_row_count: rows.length,
      admitted_event_count: rows.filter((r) => r.incident_diabetes === 1).length,
      exclusion_counts: {},
      split_counts: {},
      now: new Date().toISOString(),
    },
    rows,
  );
  return id;
}

/** Seeds an admitted candidate version and returns its id. */
function seedVersion(root: unknown): string {
  const result = admit(doc(root));
  expect(result.state).toBe("admitted");
  const now = new Date().toISOString();
  const turnId = randomUUID();
  const candidateId = randomUUID();
  const versionId = randomUUID();

  database
    .prepare(
      `INSERT INTO session_turns (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(ordinal),0)+1 FROM session_turns WHERE session_id = ?), '{}', 'demo', 'm', 'p', 'completed', ?)`,
    )
    .run(turnId, sessionId, sessionId, now);
  database
    .prepare("INSERT INTO candidates (id, turn_id, proposal_id, ordinal, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(candidateId, turnId, `p-${versionId.slice(0, 6)}`, now);
  database
    .prepare(
      `INSERT INTO candidate_versions
         (id, candidate_id, version_no, source, content_json, ast_json, ast_hash, ast_schema_version,
          registry_version, registry_hash, validator_version, admission_state, validation_json, created_at)
       VALUES (?, ?, 1, 'generated', '{}', ?, ?, '1.0', 'diabetes-v1', ?, 'v1', 'admitted', '{}', ?)`,
    )
    .run(versionId, candidateId, canonicalJson(result.document!), result.ast_hash, registryHash(), now);
  return versionId;
}

async function runOne(root: unknown): Promise<ReturnType<typeof findRun>> {
  publish();
  const versionId = seedVersion(root);
  const { run_ids } = createEvaluationRuns(database, sessionId, [versionId]);
  await executeEvaluationRun(database, run_ids[0]);
  return findRun(database, run_ids[0]);
}

describe("createEvaluationRuns", () => {
  it("refuses when no dataset is prepared", () => {
    const versionId = seedVersion(signal("age"));
    expect(() => createEvaluationRuns(database, sessionId, [versionId])).toThrow(/DATASET_NOT_PREPARED|current dataset/);
  });

  it("creates one independent run per version", () => {
    publish();
    const ids = [seedVersion(signal("age")), seedVersion(signal("bmi"))];

    const { run_ids } = createEvaluationRuns(database, sessionId, ids);

    expect(run_ids).toHaveLength(2);
    expect(new Set(run_ids).size).toBe(2);
    for (const id of run_ids) expect(findRun(database, id)!.status).toBe("pending");
  });

  it("records the exact AST, dataset, registry, and policy versions", () => {
    const datasetId = publish();
    const versionId = seedVersion(signal("age"));

    const { run_ids } = createEvaluationRuns(database, sessionId, [versionId]);
    const run = findRun(database, run_ids[0])!;

    expect(run.dataset_version_id).toBe(datasetId);
    expect(run.ast_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.registry_hash).toBe(registryHash());
    expect(run.evaluator_version).toBe("v1");
    expect(run.threshold_policy_version).toBe("youden-v1");
    expect(run.metric_policy_version).toBe("exploratory-v1");
  });

  it("refuses a version from another session", () => {
    publish();
    const other = insertSession(database, { id: randomUUID(), title: "O", now: new Date().toISOString() }).id;
    const versionId = seedVersion(signal("age"));

    expect(() => createEvaluationRuns(database, other, [versionId])).toThrow(/does not belong/);
  });

  it("refuses an unknown version", () => {
    publish();
    expect(() => createEvaluationRuns(database, sessionId, ["missing"])).toThrow(/does not exist/);
  });

  it("does not leave partial runs when a batch contains an invalid version", () => {
    publish();
    const validVersionId = seedVersion(signal("age"));

    expect(() => createEvaluationRuns(database, sessionId, [validVersionId, "missing"])).toThrow(/does not exist/);

    const result = database.prepare("SELECT COUNT(*) AS count FROM evaluation_runs").get() as { count: number };
    expect(result.count).toBe(0);
  });
});

describe("executeEvaluationRun", () => {
  it("completes and freezes a direction and threshold", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));

    expect(run!.status).toBe("completed");
    expect(run!.score_direction).toBe("higher");
    expect(run!.threshold).not.toBeNull();
    expect(run!.finished_at).not.toBeNull();
  });

  it("detects an inverted score", async () => {
    // Negating glucose makes lower mean more positive.
    const run = await runOne(call("subtract", literal(0), signal("baseline_fasting_plasma_glucose")));
    expect(run!.score_direction).toBe("lower");
  });

  it("reports exploratory review metrics with their denominator", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));
    const metrics = JSON.parse(run!.review_metrics_json!) as Record<string, unknown>;

    expect(metrics.interpretation).toBe("exploratory");
    expect(metrics.auroc).toBe(1);
    expect(metrics.review_row_count).toBe(10);
    expect(metrics.observed_positive_count).toBe(5);
    expect(metrics.prevalence).toBe(0.5);
    expect(metrics.confusion).toEqual({
      true_positive: 5,
      true_negative: 5,
      false_positive: 0,
      false_negative: 0,
    });
  });

  it("records a calibration summary separate from review metrics", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));
    const calibration = JSON.parse(run!.calibration_summary_json!) as Record<string, unknown>;

    expect(calibration.row_count).toBe(10);
    expect(calibration.policy).toBe("youden-v1");
    expect(run!.calibration_row_count).toBe(10);
    expect(run!.review_row_count).toBe(10);
  });

  it("stores one row per review row and none from calibration", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));
    const count = database
      .prepare("SELECT COUNT(*) AS n FROM evaluation_rows WHERE evaluation_run_id = ?")
      .get(run!.id) as { n: number };

    expect(count.n).toBe(10);
    // Calibration scores are used to freeze the threshold and then discarded.
    const keys = database
      .prepare("SELECT row_key FROM evaluation_rows WHERE evaluation_run_id = ?")
      .all(run!.id) as { row_key: string }[];
    const reviewKeys = readSplit(database, run!.dataset_version_id, "review").map((r) => r.row_key);
    expect(keys.map((k) => k.row_key).sort()).toEqual(reviewKeys.sort());
  });

  it("classifies every row into one of the four cells", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));
    const classes = database
      .prepare("SELECT DISTINCT error_class FROM evaluation_rows WHERE evaluation_run_id = ?")
      .all(run!.id) as { error_class: string }[];

    for (const entry of classes) {
      expect(["true_positive", "true_negative", "false_positive", "false_negative"]).toContain(entry.error_class);
    }
  });

  it("stores only formula-referenced signals as row evidence", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));
    const row = database
      .prepare("SELECT explanation_inputs_json FROM evaluation_rows WHERE evaluation_run_id = ? LIMIT 1")
      .get(run!.id) as { explanation_inputs_json: string };

    const inputs = JSON.parse(row.explanation_inputs_json) as Record<string, unknown>;
    expect(Object.keys(inputs)).toEqual(["baseline_fasting_plasma_glucose"]);
    // The outcome and the follow-up must never travel with the row evidence.
    expect(inputs).not.toHaveProperty("incident_diabetes");
    expect(inputs).not.toHaveProperty("followup_fasting_plasma_glucose");
    expect(inputs).not.toHaveProperty("followup_years");
  });

  it("is deterministic across repeated runs", async () => {
    const datasetId = publish();
    const versionId = seedVersion(signal("baseline_fasting_plasma_glucose"));

    const first = createEvaluationRuns(database, sessionId, [versionId]);
    await executeEvaluationRun(database, first.run_ids[0]);
    const second = createEvaluationRuns(database, sessionId, [versionId]);
    await executeEvaluationRun(database, second.run_ids[0]);

    const a = findRun(database, first.run_ids[0])!;
    const b = findRun(database, second.run_ids[0])!;
    expect(b.threshold).toBe(a.threshold);
    expect(b.score_direction).toBe(a.score_direction);
    expect(b.review_metrics_json).toBe(a.review_metrics_json);
    expect(a.dataset_version_id).toBe(datasetId);
  });

  it("does not re-run a completed run", async () => {
    const run = await runOne(signal("baseline_fasting_plasma_glucose"));
    await executeEvaluationRun(database, run!.id);

    const count = database
      .prepare("SELECT COUNT(*) AS n FROM evaluation_rows WHERE evaluation_run_id = ?")
      .get(run!.id) as { n: number };
    expect(count.n).toBe(10);
  });
});

describe("the AST interpreter never sees the outcome", () => {
  it("gives the evaluator only the allowlisted predictor projection", () => {
    publish();
    const rows = readSplit(database, findRun(database, "x")?.dataset_version_id ?? currentDatasetId(), "review");

    for (const row of rows) {
      expect(Object.keys(row.predictors).sort()).toEqual(Object.keys(SMOKE_ROW).sort());
      expect(row.predictors).not.toHaveProperty("incident_diabetes");
      expect(row.predictors).not.toHaveProperty("followup_fasting_plasma_glucose");
    }
  });

  function currentDatasetId(): string {
    return (database.prepare("SELECT id FROM dataset_versions WHERE status = 'current'").get() as { id: string }).id;
  }
});

describe("non-finite scores fail the whole evaluation", () => {
  it("fails with NON_FINITE_SCORE and stores no partial results", async () => {
    // clamp with inverted bounds is unavailable on rows where bmi < 0.
    const rows = syntheticRows().map((row, i) =>
      i === 3 ? { ...row, predictors: { ...row.predictors, bmi: -1 } } : row,
    );
    publish(rows);
    const versionId = seedVersion(call("clamp", signal("age"), literal(0), signal("bmi")));

    const { run_ids } = createEvaluationRuns(database, sessionId, [versionId]);
    await executeEvaluationRun(database, run_ids[0]);

    const run = findRun(database, run_ids[0])!;
    expect(run.status).toBe("failed");
    expect(JSON.parse(run.error_json!).code).toBe("NON_FINITE_SCORE");
    expect(run.review_metrics_json).toBeNull();
    expect(run.threshold).toBeNull();

    const count = database
      .prepare("SELECT COUNT(*) AS n FROM evaluation_rows WHERE evaluation_run_id = ?")
      .get(run.id) as { n: number };
    expect(count.n).toBe(0);
  });

  it("cannot hide a low-coverage formula behind a smaller denominator", async () => {
    const rows = syntheticRows().map((row, i) =>
      i === 15 ? { ...row, predictors: { ...row.predictors, bmi: -1 } } : row,
    );
    publish(rows);
    const versionId = seedVersion(call("clamp", signal("age"), literal(0), signal("bmi")));

    const { run_ids } = createEvaluationRuns(database, sessionId, [versionId]);
    await executeEvaluationRun(database, run_ids[0]);

    // One bad review row fails everything rather than reporting 9 of 10.
    expect(findRun(database, run_ids[0])!.status).toBe("failed");
  });
});

describe("one formula's failure does not roll back another's results", () => {
  it("keeps a completed run when a sibling fails", async () => {
    const rows = syntheticRows().map((row, i) =>
      i === 3 ? { ...row, predictors: { ...row.predictors, bmi: -1 } } : row,
    );
    publish(rows);
    const good = seedVersion(signal("baseline_fasting_plasma_glucose"));
    const bad = seedVersion(call("clamp", signal("age"), literal(0), signal("bmi")));

    const { run_ids } = createEvaluationRuns(database, sessionId, [good, bad]);
    await executeEvaluationRun(database, run_ids[0]);
    await executeEvaluationRun(database, run_ids[1]);

    expect(findRun(database, run_ids[0])!.status).toBe("completed");
    expect(findRun(database, run_ids[1])!.status).toBe("failed");
  });
});
