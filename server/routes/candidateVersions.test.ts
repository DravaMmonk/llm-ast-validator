import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AST_VERSION } from "../../shared/ast/core";
import type { CandidateSummary, Session, SessionTurnDetail } from "../../shared/contracts";
import { createApp } from "../app";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { InProcessRunner } from "../jobs/inProcessRunner";
import { FixtureGenerator } from "../../test-support/fixtureGenerator";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let database: Database;
let app: Hono;
let runner: InProcessRunner;

const doc = (root: unknown) => ({ ast_version: AST_VERSION, root });
const signal = (id: string) => ({ node_type: "ref", ref_type: "signal", id });
const literal = (value: number) => ({ node_type: "literal", value });
const call = (op: string, ...args: unknown[]) => ({ node_type: "call", op, args });

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "research-versions-"));
  database = openDatabase(join(directory, "test.db"));
  migrate(database);
  runner = new InProcessRunner();
  app = createApp({ database, runner, generator: new FixtureGenerator() });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

async function seed(): Promise<{ session: Session; candidate: CandidateSummary }> {
  const session = (await (
    await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
  ).json()) as Session;

  const created = (await (
    await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requirement: "Score risk", candidate_count: 2 }),
    })
  ).json()) as { turn_id: string };
  await runner.whenIdle("generation");

  const turn = (await (await app.request(`/api/session-turns/${created.turn_id}`)).json()) as SessionTurnDetail;
  return { session, candidate: turn.candidates[0] };
}

async function postVersion(candidateId: string, body: unknown): Promise<Response> {
  return app.request(`/api/candidates/${candidateId}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/candidates/:candidateId/versions", () => {
  it("appends an admitted blockly child version", async () => {
    const { candidate } = await seed();
    const parent = candidate.versions[candidate.versions.length - 1];

    const response = await postVersion(candidate.id, { ast: doc(call("add", signal("age"), literal(1))) });

    expect(response.status).toBe(201);
    const version = (await response.json()) as Record<string, unknown>;
    expect(version.source).toBe("blockly");
    expect(version.version_no).toBe(parent.version_no + 1);
    expect(version.parent_version_id).toBe(parent.id);
    expect(version.admission_state).toBe("admitted");
    expect(version.ast_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves the generated parent untouched", async () => {
    const { candidate } = await seed();
    const parent = candidate.versions[0];

    await postVersion(candidate.id, { ast: doc(signal("bmi")) });

    const after = (await (await app.request(`/api/candidates/${candidate.id}`)).json()) as CandidateSummary;
    const stored = after.versions.find((version) => version.id === parent.id)!;
    expect(stored.source).toBe(parent.source);
    expect(stored.ast_hash).toBe(parent.ast_hash);
    expect(stored.version_no).toBe(parent.version_no);
  });

  it("selects the new version on the owning session", async () => {
    const { session, candidate } = await seed();

    const version = (await (await postVersion(candidate.id, { ast: doc(signal("bmi")) })).json()) as { id: string };

    const detail = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { session: Session };
    expect(detail.session.selected_candidate_version_id).toBe(version.id);
  });

  it("chains successive saves onto the newest version", async () => {
    const { candidate } = await seed();

    const first = (await (await postVersion(candidate.id, { ast: doc(signal("bmi")) })).json()) as {
      id: string;
      version_no: number;
    };
    const second = (await (await postVersion(candidate.id, { ast: doc(signal("age")) })).json()) as {
      parent_version_id: string;
      version_no: number;
    };

    expect(second.parent_version_id).toBe(first.id);
    expect(second.version_no).toBe(first.version_no + 1);
  });

  it("stores an optional note", async () => {
    const { candidate } = await seed();

    const response = await postVersion(candidate.id, { ast: doc(signal("bmi")), note: "Dropped the BMI term." });
    expect(response.status).toBe(201);

    const version = (await response.json()) as { id: string };
    const stored = database.prepare("SELECT note FROM candidate_versions WHERE id = ?").get(version.id) as {
      note: string;
    };
    expect(stored.note).toBe("Dropped the BMI term.");
  });
});

describe("the server is the validation authority", () => {
  it("rejects a formula that does not pass admission, with diagnostics", async () => {
    const { candidate } = await seed();

    const response = await postVersion(candidate.id, { ast: doc(signal("invented_signal")) });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; details: { diagnostics: { code: string }[] } } };
    expect(body.error.code).toBe("VERSION_NOT_ADMITTED");
    expect(body.error.details.diagnostics[0].code).toBe("UNKNOWN_SIGNAL");
  });

  it("refuses a formula that references the outcome label", async () => {
    const { candidate } = await seed();

    const response = await postVersion(candidate.id, { ast: doc(signal("incident_diabetes")) });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { details: { diagnostics: { code: string }[] } } };
    expect(body.error.details.diagnostics[0].code).toBe("OUTCOME_REFERENCE_FORBIDDEN");
  });

  it("stores no version when admission fails", async () => {
    const { candidate } = await seed();
    const before = candidate.versions.length;

    await postVersion(candidate.id, { ast: doc(signal("nope")) });

    const after = (await (await app.request(`/api/candidates/${candidate.id}`)).json()) as CandidateSummary;
    expect(after.versions).toHaveLength(before);
  });

  it("ignores a client-supplied validation verdict", async () => {
    const { candidate } = await seed();

    // A client cannot smuggle in its own admission state or hash.
    const response = await postVersion(candidate.id, {
      ast: doc(signal("invented_signal")),
      admission_state: "admitted",
      ast_hash: "0".repeat(64),
      validation: { diagnostics: [] },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("derives the hash itself rather than trusting the client", async () => {
    const { candidate } = await seed();

    const version = (await (await postVersion(candidate.id, { ast: doc(literal(1)) })).json()) as {
      ast_hash: string;
    };
    // The same formula always hashes the same; the client never supplied it.
    const again = (await (await postVersion(candidate.id, { ast: doc(literal(1)) })).json()) as {
      ast_hash: string;
    };
    expect(again.ast_hash).toBe(version.ast_hash);
  });

  it("rejects a missing or malformed body", async () => {
    const { candidate } = await seed();

    expect((await postVersion(candidate.id, {})).status).toBe(400);
    expect((await postVersion(candidate.id, { ast: "not-an-object" })).status).toBe(422);
    expect((await postVersion(candidate.id, { ast: doc(literal(1)), note: 5 })).status).toBe(400);
  });

  it("returns 404 for an unknown candidate", async () => {
    const response = await postVersion("missing", { ast: doc(literal(1)) });
    expect(response.status).toBe(404);
  });
});
