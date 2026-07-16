import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import type { Session } from "../../shared/contracts";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let databasePath: string;
let database: Database;
let app: Hono;

function boot(): { database: Database; app: Hono } {
  const next = openDatabase(databasePath);
  migrate(next);
  return { database: next, app: createApp({ database: next }) };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-sessions-"));
  databasePath = join(directory, "test.db");
  ({ database, app } = boot());
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

async function createSession(body: unknown = {}): Promise<Session> {
  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Session;
}

describe("GET /api/health", () => {
  it("reports readiness", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      generator: { configured: false, provider: null, model: null },
    });
  });
});

describe("POST /api/sessions", () => {
  it("creates an active session with a default title", async () => {
    const session = await createSession();

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.status).toBe("active");
    expect(session.title).toBe("Untitled session");
    expect(session.current_requirement).toBeNull();
    expect(session.selected_candidate_version_id).toBeNull();
    expect(session.created_at).toBe(session.updated_at);
  });

  it("accepts an explicit trimmed title", async () => {
    const session = await createSession({ title: "  Fasting glucose screen  " });
    expect(session.title).toBe("Fasting glucose screen");
  });

  it("rejects a non-string title", async () => {
    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects a title longer than the documented limit", async () => {
    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(201) }),
    });

    expect(response.status).toBe(400);
  });

  it("rejects a malformed JSON body", async () => {
    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_JSON" } });
  });

  it("rejects a body above the size cap", async () => {
    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(200_000) }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });
});

describe("GET /api/sessions", () => {
  it("lists active sessions newest first and hides archived ones", async () => {
    const first = await createSession({ title: "First" });
    const second = await createSession({ title: "Second" });

    await app.request(`/api/sessions/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const response = await app.request("/api/sessions");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessions: Session[] };
    expect(body.sessions.map((session) => session.id)).toEqual([second.id]);
  });

  it("lists archived sessions on request", async () => {
    const session = await createSession({ title: "Archived" });
    await app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const response = await app.request("/api/sessions?status=archived");
    const body = (await response.json()) as { sessions: Session[] };
    expect(body.sessions.map((entry) => entry.id)).toEqual([session.id]);
  });

  it("rejects an unknown status filter", async () => {
    const response = await app.request("/api/sessions?status=everything");
    expect(response.status).toBe(400);
  });
});

describe("GET /api/sessions/:sessionId", () => {
  it("returns the session with its empty turn history", async () => {
    const created = await createSession({ title: "Detail" });

    const response = await app.request(`/api/sessions/${created.id}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      session: { id: created.id, title: "Detail" },
      turns: [],
    });
  });

  it("returns 404 for an unknown session", async () => {
    const response = await app.request("/api/sessions/2f1c0b3e-0000-4000-8000-000000000000");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SESSION_NOT_FOUND" } });
  });
});

describe("PATCH /api/sessions/:sessionId", () => {
  it("renames a session and advances updated_at", async () => {
    const created = await createSession({ title: "Before" });

    const response = await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After" }),
    });

    expect(response.status).toBe(200);
    const session = (await response.json()) as Session;
    expect(session.title).toBe("After");
    expect(Date.parse(session.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));
  });

  it("archives and reopens a session without deleting it", async () => {
    const created = await createSession({ title: "Lifecycle" });

    const archived = await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    expect(((await archived.json()) as Session).status).toBe("archived");

    const reopened = await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    expect(((await reopened.json()) as Session).status).toBe("active");
  });

  it("rejects an empty patch", async () => {
    const created = await createSession();

    const response = await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects an undeclared field", async () => {
    const created = await createSession();

    const response = await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_requirement: "written by the browser" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 404 when patching an unknown session", async () => {
    const response = await app.request("/api/sessions/2f1c0b3e-0000-4000-8000-000000000000", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Ghost" }),
    });

    expect(response.status).toBe(404);
  });
});

describe("PATCH selected_candidate_version_id", () => {
  const now = "2026-07-16T00:00:00.000Z";

  function seedVersion(sessionId: string, suffix: string): string {
    database
      .prepare(
        `INSERT INTO session_turns (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
         VALUES (?, ?, 1, '{}', 'test-fixture', 'fixture-v1', 'v1', 'completed', ?)`,
      )
      .run(`turn-${suffix}`, sessionId, now);
    database
      .prepare(
        `INSERT INTO candidates (id, turn_id, proposal_id, ordinal, created_at) VALUES (?, ?, 'proposal_direct', 1, ?)`,
      )
      .run(`candidate-${suffix}`, `turn-${suffix}`, now);
    database
      .prepare(
        `INSERT INTO candidate_versions (id, candidate_id, version_no, source, content_json, ast_json, ast_hash, ast_schema_version, admission_state, validation_json, registry_version, registry_hash, validator_version, created_at)
         VALUES (?, ?, 1, 'generated', '{}', '{"ast_version":"1.0"}', 'ast-hash', '1.0', 'admitted', '{}', 'v1', 'hash', 'v1', ?)`,
      )
      .run(`version-${suffix}`, `candidate-${suffix}`, now);
    return `version-${suffix}`;
  }

  it("selects a version that belongs to the session", async () => {
    const session = await createSession();
    const versionId = seedVersion(session.id, "own");

    const response = await app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_candidate_version_id: versionId }),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as Session).selected_candidate_version_id).toBe(versionId);
  });

  it("clears the selection with an explicit null", async () => {
    const session = await createSession();
    const versionId = seedVersion(session.id, "clearable");
    await app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_candidate_version_id: versionId }),
    });

    const response = await app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_candidate_version_id: null }),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as Session).selected_candidate_version_id).toBeNull();
  });

  it("refuses a version owned by a different session", async () => {
    const owner = await createSession({ title: "Owner" });
    const other = await createSession({ title: "Other" });
    const versionId = seedVersion(owner.id, "foreign");

    const response = await app.request(`/api/sessions/${other.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_candidate_version_id: versionId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SELECTED_VERSION_NOT_IN_SESSION" },
    });
    const unchanged = await app.request(`/api/sessions/${other.id}`);
    const body = (await unchanged.json()) as { session: Session };
    expect(body.session.selected_candidate_version_id).toBeNull();
  });

  it("refuses a version that does not exist", async () => {
    const session = await createSession();

    const response = await app.request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_candidate_version_id: "missing-version" }),
    });

    expect(response.status).toBe(409);
  });
});

describe("restart recovery", () => {
  it("recovers session state from the same database file", async () => {
    const created = await createSession({ title: "Durable" });
    await app.request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Durable renamed" }),
    });

    database.close();
    ({ database, app } = boot());

    const response = await app.request(`/api/sessions/${created.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: Session };
    expect(body.session.title).toBe("Durable renamed");
    expect(body.session.status).toBe("active");
  });
});

describe("error envelope", () => {
  it("returns 404 with the documented shape for an unknown route", async () => {
    const response = await app.request("/api/nope");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("never leaks a stack trace on an internal failure", async () => {
    database.exec("DROP TABLE sessions");
    const response = await app.request("/api/sessions");

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toMatch(/sqlite|no such table|at Object|\.ts:/i);
  });
});
