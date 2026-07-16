import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../shared/ast/canonical";
import { AST_VERSION, admit } from "../../shared/ast/core";
import { SMOKE_ROW, registryHash } from "../../shared/ast/registry";
import { createApp } from "../app";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { publishDatasetVersion, type CohortRowInput } from "../db/stores/datasets";
import { insertSession } from "../db/stores/sessions";
import { InProcessRunner } from "../jobs/inProcessRunner";
import { createEvaluationRuns } from "../services/evaluationService";
import { recoverInterruptedRuns } from "../services/recoveryService";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let database: Database;
let app: Hono;
let runner: InProcessRunner;
let sessionId: string;

const signal = (id: string) => ({ node_type: "ref", ref_type: "signal", id });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-decisions-"));
  database = openDatabase(join(directory, "test.db"));
  migrate(database);
  runner = new InProcessRunner();
  app = createApp({ database, runner });
  sessionId = insertSession(database, { id: randomUUID(), title: "S", now: new Date().toISOString() }).id;
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function rows(): CohortRowInput[] {
  return Array.from({ length: 8 }, (_, i) => {
    const positive = i % 2 === 0;
    return {
      split_key: `k${i}`,
      row_key: `r${i}`,
      split: i < 4 ? "calibration" : "review",
      predictors: { ...SMOKE_ROW, baseline_fasting_plasma_glucose: positive ? 6.5 : 4.5 },
      followup_fasting_plasma_glucose: positive ? 7.2 : 5.0,
      followup_years: 3.1,
      incident_diabetes: positive ? 1 : 0,
    } as CohortRowInput;
  });
}

function publish(): string {
  const id = randomUUID();
  publishDatasetVersion(
    database,
    {
      id,
      source_doi: "10.5061/dryad.test",
      source_url: "https://example.invalid",
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
      source_row_count: 8,
      source_event_count: 4,
      admitted_row_count: 8,
      admitted_event_count: 4,
      exclusion_counts: {},
      split_counts: {},
      now: new Date().toISOString(),
    },
    rows(),
  );
  return id;
}

function seedVersion(admitted = true): string {
  const now = new Date().toISOString();
  const turnId = randomUUID();
  const candidateId = randomUUID();
  const versionId = randomUUID();
  const result = admit({ ast_version: AST_VERSION, root: signal("baseline_fasting_plasma_glucose") });

  database
    .prepare(
      `INSERT INTO session_turns (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(ordinal),0)+1 FROM session_turns WHERE session_id = ?), '{}', 'd', 'm', 'p', 'completed', ?)`,
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
       VALUES (?, ?, 1, 'generated', '{}', ?, ?, '1.0', 'diabetes-v1', ?, 'v1', ?, '{}', ?)`,
    )
    .run(
      versionId,
      candidateId,
      admitted ? canonicalJson(result.document!) : null,
      admitted ? result.ast_hash : null,
      registryHash(),
      admitted ? "admitted" : "blocked",
      now,
    );
  return versionId;
}

async function evaluateVersion(versionId: string): Promise<string> {
  const response = await app.request(`/api/sessions/${sessionId}/evaluation-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidate_version_ids: [versionId] }),
  });
  expect(response.status).toBe(202);
  const { run_ids } = (await response.json()) as { run_ids: string[] };
  await runner.whenIdle("evaluation");
  return run_ids[0];
}

async function decide(versionId: string, body: unknown): Promise<Response> {
  return app.request(`/api/candidate-versions/${versionId}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("rejection", () => {
  it("needs no evaluation evidence", async () => {
    const versionId = seedVersion();
    const response = await decide(versionId, { decision: "rejected", note: "Not clinically sensible." });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      decision: "rejected",
      decision_no: 1,
      evaluation_run_id: null,
      note: "Not clinically sensible.",
    });
  });

  it("refuses evaluation evidence because rejection is not bound to a run", async () => {
    const versionId = seedVersion();
    const response = await decide(versionId, {
      decision: "rejected",
      evaluation_run_id: randomUUID(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});

describe("acceptance", () => {
  it("requires a completed evaluation of the exact version", async () => {
    publish();
    const versionId = seedVersion();

    const withoutEvidence = await decide(versionId, { decision: "accepted" });
    expect(withoutEvidence.status).toBe(409);
    await expect(withoutEvidence.json()).resolves.toMatchObject({ error: { code: "EVALUATION_REQUIRED" } });

    const runId = await evaluateVersion(versionId);
    const accepted = await decide(versionId, { decision: "accepted", evaluation_run_id: runId, note: "Reasonable." });
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toMatchObject({ decision: "accepted", evaluation_run_id: runId });
  });

  it("refuses evidence from a different version", async () => {
    publish();
    const versionA = seedVersion();
    const versionB = seedVersion();
    const runA = await evaluateVersion(versionA);

    const response = await decide(versionB, { decision: "accepted", evaluation_run_id: runA });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RUN_VERSION_MISMATCH" } });
  });

  it("refuses an incomplete evaluation", async () => {
    publish();
    const versionId = seedVersion();
    // Create the run through the service so it stays pending: going through the
    // route would enqueue it and the lane drains on a microtask.
    const { run_ids } = createEvaluationRuns(database, sessionId, [versionId]);

    const attempt = await decide(versionId, { decision: "accepted", evaluation_run_id: run_ids[0] });
    expect(attempt.status).toBe(409);
    await expect(attempt.json()).resolves.toMatchObject({ error: { code: "EVALUATION_INCOMPLETE" } });
  });

  it("refuses evidence from a superseded dataset", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);

    // A new dataset version supersedes the one the run used.
    publish();

    const response = await decide(versionId, { decision: "accepted", evaluation_run_id: runId });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "STALE_DATASET" } });
  });

  it("refuses a blocked version", async () => {
    publish();
    const versionId = seedVersion(false);
    const response = await decide(versionId, { decision: "accepted" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VERSION_NOT_ADMITTED" } });
  });

  it("refuses an unknown run", async () => {
    publish();
    const versionId = seedVersion();
    const response = await decide(versionId, { decision: "accepted", evaluation_run_id: randomUUID() });
    expect(response.status).toBe(404);
  });
});

describe("decision history", () => {
  it("appends in order and keeps earlier decisions", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);

    await decide(versionId, { decision: "rejected", note: "First look: no." });
    await decide(versionId, { decision: "accepted", evaluation_run_id: runId, note: "On reflection: yes." });

    const listed = await app.request(`/api/candidate-versions/${versionId}/decisions`);
    const body = (await listed.json()) as { decisions: { decision: string; decision_no: number }[] };

    expect(body.decisions.map((d) => [d.decision_no, d.decision])).toEqual([
      [1, "rejected"],
      [2, "accepted"],
    ]);
  });

  it("marks a decision stale once its dataset is superseded", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);
    await decide(versionId, { decision: "accepted", evaluation_run_id: runId });

    publish();

    const listed = await app.request(`/api/candidate-versions/${versionId}/decisions`);
    const body = (await listed.json()) as { decisions: { stale_dataset: boolean }[] };
    // The decision stays visible and historical, but reads as stale.
    expect(body.decisions[0].stale_dataset).toBe(true);
  });

  it("rejects a malformed decision", async () => {
    const versionId = seedVersion();
    expect((await decide(versionId, { decision: "maybe" })).status).toBe(400);
    expect((await decide(versionId, {})).status).toBe(400);
    expect((await decide(versionId, { decision: "rejected", note: 5 })).status).toBe(400);
    expect((await decide(versionId, { decision: "rejected", extra: 1 })).status).toBe(400);
  });
});

describe("evaluation run recovery", () => {
  it("turns a stranded run into a retryable failure", async () => {
    publish();
    const versionId = seedVersion();
    // A run created but never executed is exactly what a crash leaves behind.
    const { run_ids } = createEvaluationRuns(database, sessionId, [versionId]);

    expect(recoverInterruptedRuns(database).failed_evaluations).toBe(1);

    const response = await app.request(`/api/evaluation-runs/${run_ids[0]}`);
    const body = (await response.json()) as { status: string; error: { code: string } };
    expect(body.status).toBe("failed");
    expect(body.error.code).toBe("APP_RESTARTED");
  });

  it("leaves completed runs untouched", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);

    expect(recoverInterruptedRuns(database).failed_evaluations).toBe(0);

    const response = await app.request(`/api/evaluation-runs/${runId}`);
    await expect(response.json()).resolves.toMatchObject({ status: "completed" });
  });
});

describe("GET /api/dataset-versions/current", () => {
  it("returns metadata and counts but never cohort rows", async () => {
    publish();
    const response = await app.request("/api/dataset-versions/current");

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("mvp_complete_case_v1");
    // No predictor values, no outcome column, no row keys.
    expect(text).not.toContain("baseline_fasting_plasma_glucose");
    expect(text).not.toContain("incident_diabetes");
    expect(text).not.toContain("r0");
  });

  it("reports 409 when no dataset is prepared", async () => {
    const response = await app.request("/api/dataset-versions/current");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DATASET_NOT_PREPARED" } });
  });
});

describe("GET /api/evaluation-runs/:runId/rows", () => {
  it("defaults to bounded pagination and filters to disagreements", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);

    const all = await app.request(`/api/evaluation-runs/${runId}/rows`);
    const body = (await all.json()) as { rows: unknown[]; next_cursor: number | null };
    expect(body.rows).toHaveLength(4);

    const disagreements = await app.request(`/api/evaluation-runs/${runId}/rows?error_class=disagreement`);
    const filtered = (await disagreements.json()) as { rows: unknown[] };
    // The synthetic score separates the classes perfectly, so there are none.
    expect(filtered.rows).toHaveLength(0);
  });

  it("refuses an unbounded or unknown filter", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);

    expect((await app.request(`/api/evaluation-runs/${runId}/rows?limit=500`)).status).toBe(400);
    expect((await app.request(`/api/evaluation-runs/${runId}/rows?error_class=DROP+TABLE`)).status).toBe(400);
    expect((await app.request(`/api/evaluation-runs/${runId}/rows?sort=score;--`)).status).toBe(400);
  });

  it("paginates a sorted result without skipping or repeating rows", async () => {
    publish();
    const versionId = seedVersion();
    const runId = await evaluateVersion(versionId);
    const rowKeys: string[] = [];
    let cursor: number | null = null;

    do {
      const suffix = cursor === null ? "" : `&cursor=${cursor}`;
      const response = await app.request(`/api/evaluation-runs/${runId}/rows?sort=score_desc&limit=1${suffix}`);
      const body = (await response.json()) as { rows: { row_key: string }[]; next_cursor: number | null };
      rowKeys.push(...body.rows.map((row) => row.row_key));
      cursor = body.next_cursor;
    } while (cursor !== null);

    expect(rowKeys).toHaveLength(4);
    expect(new Set(rowKeys).size).toBe(4);
  });
});

describe("GET /api/candidate-versions/:versionId/evaluation-runs/latest", () => {
  it("returns null before evaluation and restores the newest run afterward", async () => {
    publish();
    const versionId = seedVersion();

    const empty = await app.request(`/api/candidate-versions/${versionId}/evaluation-runs/latest`);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ run: null });

    const runId = await evaluateVersion(versionId);
    const restored = await app.request(`/api/candidate-versions/${versionId}/evaluation-runs/latest`);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ run: { id: runId, status: "completed" } });
  });
});
