import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatasetDetail, DatasetSummary } from "../../shared/workbench/dataset";
import type { WorkbenchDocument } from "../../shared/workbench/documents";
import { parseExpr } from "../../shared/workbench/exprText";
import type { PublicDataset } from "../../shared/workbench/publicDatasets";
import { createApp } from "../app";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";

let directory: string;
let database: ReturnType<typeof openDatabase>;
let app: Hono;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-workbench-"));
  database = openDatabase(join(directory, "test.db"));
  migrate(database);
  app = createApp({ database });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const response = await app.request(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as T };
}

async function upload(csv = "id,age,sex\nA,50,F\nB,61,M\nC,,F\n"): Promise<DatasetSummary> {
  const { status, json } = await call<{ dataset: DatasetSummary }>("POST", "/api/workbench/datasets", {
    name: "Pilot",
    csv_text: csv,
  });
  expect(status).toBe(201);
  return json.dataset;
}

describe("datasets", () => {
  it("uploads, lists, and returns a typed dataset", async () => {
    const dataset = await upload();
    expect(dataset).toMatchObject({ name: "Pilot", row_count: 3, column_count: 3, derived_count: 0, source: "upload" });
    const list = await call<{ datasets: DatasetSummary[] }>("GET", "/api/workbench/datasets");
    expect(list.json.datasets.map((d) => d.id)).toEqual([dataset.id]);
    const detail = await call<DatasetDetail>("GET", `/api/workbench/datasets/${dataset.id}`);
    expect(detail.json.columns[1]).toMatchObject({ name: "age", kind: "numeric", values: [50, 61, null] });
  });

  it("rejects malformed uploads with a coded error", async () => {
    const empty = await call<{ error: { code: string } }>("POST", "/api/workbench/datasets", { name: "x", csv_text: "" });
    expect(empty.status).toBe(422);
    expect(empty.json.error.code).toBe("DATASET_EMPTY");
    const noName = await call<{ error: { code: string } }>("POST", "/api/workbench/datasets", { csv_text: "a\n1" });
    expect(noName.status).toBe(422);
    const extra = await call<{ error: { code: string } }>("POST", "/api/workbench/datasets", {
      name: "x",
      csv_text: "a\n1",
      sql: "drop",
    });
    expect(extra.status).toBe(400);
  });

  it("creates each built-in sample once", async () => {
    const first = await call<{ dataset: DatasetSummary }>("POST", "/api/workbench/datasets/samples", {
      sample_key: "rct_hypertension",
    });
    expect(first.status).toBe(201);
    expect(first.json.dataset.row_count).toBe(400);
    const again = await call<{ dataset: DatasetSummary }>("POST", "/api/workbench/datasets/samples", {
      sample_key: "rct_hypertension",
    });
    expect(again.status).toBe(200);
    expect(again.json.dataset.id).toBe(first.json.dataset.id);
    const missing = await call("POST", "/api/workbench/datasets/samples", { sample_key: "nope" });
    expect(missing.status).toBe(404);
  });

  it("patches metadata, converts kinds, and validates derived formulas", async () => {
    const dataset = await upload();
    const patched = await call<{ dataset: DatasetSummary; conversion_losses: Record<string, number> }>(
      "PATCH",
      `/api/workbench/datasets/${dataset.id}`,
      {
        name: "Renamed",
        columns: [{ name: "age", unit: "years", role: "none" }, { name: "id", kind: "numeric" }],
        derived: [{ name: "older", expr: parseExpr("age >= 60") }],
      },
    );
    expect(patched.status).toBe(200);
    expect(patched.json.dataset).toMatchObject({ name: "Renamed", derived_count: 1 });
    expect(patched.json.conversion_losses).toEqual({ id: 3 });
    expect(patched.json.dataset.content_hash).not.toBe(dataset.content_hash);

    const bad = await call<{ error: { code: string } }>("PATCH", `/api/workbench/datasets/${dataset.id}`, {
      derived: [{ name: "x", expr: parseExpr("sex * 2") }],
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("INVALID_FORMULA");

    const archived = await call<{ dataset: DatasetSummary }>("PATCH", `/api/workbench/datasets/${dataset.id}`, {
      status: "archived",
    });
    expect(archived.json.dataset.status).toBe("archived");
    const active = await call<{ datasets: DatasetSummary[] }>("GET", "/api/workbench/datasets");
    expect(active.json.datasets).toEqual([]);
  });

  it("stores yes/no columns and merges case variants on request", async () => {
    const dataset = await upload("id,smoker,sex\nA,Yes,male\nB,no,Male\nC,YES,Male\n");
    const detail = await call<{ columns: { name: string; kind: string; values: unknown[] }[] }>("GET", `/api/workbench/datasets/${dataset.id}`);
    expect(detail.json.columns[1]).toMatchObject({ kind: "boolean", values: [true, false, true] });

    const merged = await call<{ dataset: DatasetSummary; case_merges: Record<string, number> }>("PATCH", `/api/workbench/datasets/${dataset.id}`, {
      columns: [{ name: "sex", merge_case: true }, { name: "smoker", kind: "numeric" }],
    });
    expect(merged.status).toBe(200);
    expect(merged.json.case_merges).toEqual({ sex: 1 });
    expect(merged.json.dataset.content_hash).not.toBe(dataset.content_hash);
    const after = await call<{ columns: { name: string; values: unknown[] }[] }>("GET", `/api/workbench/datasets/${dataset.id}`);
    expect(after.json.columns[1].values).toEqual([1, 0, 1]);
    expect(after.json.columns[2].values).toEqual(["Male", "Male", "Male"]);
  });

  it("returns 404 for unknown datasets", async () => {
    expect((await call("GET", "/api/workbench/datasets/nope")).status).toBe(404);
    expect((await call("PATCH", "/api/workbench/datasets/nope", { name: "x" })).status).toBe(404);
  });
});

describe("documents", () => {
  it("creates, lists in position order, patches, and archives", async () => {
    const dataset = await upload();
    const make = (title: string) =>
      call<WorkbenchDocument>("POST", "/api/workbench/documents", {
        kind: "cohort",
        title,
        dataset_id: dataset.id,
        payload: { steps: [{ id: "s1", label: "Adults", kind: "include", expr: parseExpr("age >= 18") }] },
      });
    const a = await make("A");
    const b = await make("B");
    expect(a.status).toBe(201);
    expect(b.json.position).toBeGreaterThan(a.json.position);
    await call("PATCH", `/api/workbench/documents/${b.json.id}`, { position: 0 });
    const list = await call<{ documents: WorkbenchDocument[] }>("GET", `/api/workbench/documents?kind=cohort&dataset_id=${dataset.id}`);
    expect(list.json.documents.map((d) => d.title)).toEqual(["B", "A"]);

    const archived = await call<WorkbenchDocument>("PATCH", `/api/workbench/documents/${a.json.id}`, { status: "archived" });
    expect(archived.json.status).toBe("archived");
    const after = await call<{ documents: WorkbenchDocument[] }>("GET", "/api/workbench/documents?kind=cohort");
    expect(after.json.documents.map((d) => d.title)).toEqual(["B"]);
  });

  it("validates payloads and references", async () => {
    const dataset = await upload();
    const badExpr = await call<{ error: { code: string } }>("POST", "/api/workbench/documents", {
      kind: "score",
      title: "S",
      dataset_id: dataset.id,
      payload: { expr: { k: "call", op: "eval", args: [] } },
    });
    expect(badExpr.status).toBe(422);
    expect(badExpr.json.error.code).toBe("INVALID_PAYLOAD");

    const noDataset = await call("POST", "/api/workbench/documents", { kind: "cohort", title: "C", payload: { steps: [] } });
    expect(noDataset.status).toBe(400);

    const unknownDataset = await call("POST", "/api/workbench/documents", {
      kind: "cohort",
      title: "C",
      dataset_id: "nope",
      payload: { steps: [] },
    });
    expect(unknownDataset.status).toBe(404);

    const moved = await call<WorkbenchDocument>("POST", "/api/workbench/documents", {
      kind: "cohort",
      title: "C",
      dataset_id: dataset.id,
      payload: { steps: [] },
    });
    const other = await upload("a\n1\n");
    expect((await call("PATCH", `/api/workbench/documents/${moved.json.id}`, { dataset_id: other.id })).status).toBe(400);
    await call("PATCH", `/api/workbench/datasets/${other.id}`, { status: "archived" });
    const onArchived = await call<{ error: { code: string } }>("POST", "/api/workbench/documents", {
      kind: "cohort",
      title: "C",
      dataset_id: other.id,
      payload: { steps: [] },
    });
    expect(onArchived.status).toBe(409);
    expect(onArchived.json.error.code).toBe("DATASET_ARCHIVED");

    const badKind = await call("GET", "/api/workbench/documents?kind=secret");
    expect(badKind.status).toBe(400);

    const report = await call<WorkbenchDocument>("POST", "/api/workbench/documents", {
      kind: "report_item",
      title: "Table 1",
      payload: { module: "stats", summary: "Baseline", table: { columns: ["a"], rows: [[1]] } },
    });
    expect(report.status).toBe(201);
    expect(report.json.dataset_id).toBeNull();
  });
});

describe("public catalogue datasets", () => {
  const text = "rownames,arm,days,status\n1,1,400,2\n2,2,4500,1\n3,1,1012,2\n";
  const bytes = new TextEncoder().encode(text);
  const synthetic: PublicDataset = {
    key: "synthetic_trial",
    name: "Synthetic trial",
    summary: "A made-up trial.",
    description: "Made-up rows for tests.",
    domain: "Oncology",
    design: "Randomised trial",
    topics: [],
    rows: 3,
    source: {
      publisher: "Test publisher",
      url: "https://archive.ics.uci.edu/test.csv",
      page: "https://archive.ics.uci.edu/test",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      header: true,
      columns: 4,
    },
    license: { spdx: "CC0-1.0", name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    citation: "Test data (synthetic).",
    columns: [
      { from: "arm", name: "treatment", label: "Treatment", kind: "categorical", codes: { "1": "drug", "2": "placebo" }, role: "group" },
      { from: "days", name: "followup_days", label: "Follow-up", kind: "numeric", unit: "days", role: "time" },
      { from: "status", name: "death", label: "Died", kind: "numeric", codes: { "1": 0, "2": 1 }, role: "event" },
    ],
  };

  function appWith(fetchSource: (url: string, maxBytes: number) => Promise<Uint8Array>) {
    app = createApp({ database, workbench: { fetchSource, publicCatalog: [synthetic] } });
  }

  it("downloads, verifies and stores a dataset once, with its citation", async () => {
    let downloads = 0;
    appWith(async (url) => {
      downloads += 1;
      expect(url).toBe(synthetic.source.url);
      return bytes;
    });
    // Two clicks at once still add it once.
    const [first, second] = await Promise.all([
      call<{ dataset: DatasetSummary }>("POST", "/api/workbench/datasets/public", { key: "synthetic_trial" }),
      call<{ dataset: DatasetSummary }>("POST", "/api/workbench/datasets/public", { key: "synthetic_trial" }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.json.dataset.id).toBe(first.json.dataset.id);
    expect(first.json.dataset).toMatchObject({ source: "public", sample_key: "synthetic_trial", row_count: 3, column_count: 3 });
    expect(first.json.dataset.description).toContain("Cite: Test data (synthetic).");

    const detail = await call<DatasetDetail>("GET", `/api/workbench/datasets/${first.json.dataset.id}`);
    expect(detail.json.columns.map((column) => [column.name, column.role, column.values])).toEqual([
      ["treatment", "group", ["drug", "placebo", "drug"]],
      ["followup_days", "time", [400, 4500, 1012]],
      ["death", "event", [1, 0, 1]],
    ]);

    const again = await call<{ dataset: DatasetSummary }>("POST", "/api/workbench/datasets/public", { key: "synthetic_trial" });
    expect(again.status).toBe(200);
    expect(again.json.dataset.id).toBe(first.json.dataset.id);
    expect(downloads).toBe(1);
  });

  it("refuses a changed source, an unreachable source and a broken contract", async () => {
    appWith(async () => new TextEncoder().encode(text.replace("4500", "4501")));
    const changed = await call<{ error: { code: string; message: string } }>("POST", "/api/workbench/datasets/public", { key: "synthetic_trial" });
    expect(changed.status).toBe(502);
    expect(changed.json.error.code).toBe("PUBLIC_SOURCE_CHANGED");
    expect(changed.json.error.message).toMatch(/no longer matches the verified version/);

    appWith(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const offline = await call<{ error: { code: string; message: string } }>("POST", "/api/workbench/datasets/public", { key: "synthetic_trial" });
    expect(offline.status).toBe(502);
    expect(offline.json.error).toMatchObject({ code: "PUBLIC_SOURCE_UNAVAILABLE" });
    expect(offline.json.error.message).toMatch(/Check the internet connection/);

    const brokenText = text.replace("1,1,400,2", "1,7,400,2");
    const broken = new TextEncoder().encode(brokenText);
    app = createApp({
      database,
      workbench: {
        fetchSource: async () => broken,
        publicCatalog: [{ ...synthetic, source: { ...synthetic.source, sha256: createHash("sha256").update(broken).digest("hex") } }],
      },
    });
    const contract = await call<{ error: { code: string; message: string } }>("POST", "/api/workbench/datasets/public", { key: "synthetic_trial" });
    expect(contract.status).toBe(502);
    expect(contract.json.error.code).toBe("PUBLIC_CONTRACT_FAILED");
    expect(contract.json.error.message).toMatch(/treatment: unexpected value “7”/);

    const datasets = await call<{ datasets: DatasetSummary[] }>("GET", "/api/workbench/datasets");
    expect(datasets.json.datasets).toEqual([]);
  });

  it("only knows catalogue keys", async () => {
    appWith(async () => bytes);
    expect((await call("POST", "/api/workbench/datasets/public", { key: "nope" })).status).toBe(404);
    expect((await call("POST", "/api/workbench/datasets/public", { key: "synthetic_trial", url: "https://evil.example" })).status).toBe(400);
  });
});
