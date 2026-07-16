import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateTurnResponse, Session, SessionTurnDetail } from "../../shared/contracts";
import { createApp } from "../app";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import type { Generator, ProviderProposal, ProviderResult } from "../generation/generator";
import { InProcessRunner } from "../jobs/inProcessRunner";
import { FixtureGenerator } from "../../test-support/fixtureGenerator";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let databasePath: string;
let database: Database;
let app: Hono;
let runner: InProcessRunner;

/**
 * A provider that blocks until released, so a test can observe the turn while
 * generation is genuinely still in flight instead of racing the runner.
 */
class GatedGenerator implements Generator {
  readonly id = "gated";
  readonly model = "gated-v1";
  readonly prompt_version = "gated-prompt-v1";
  private release!: () => void;
  readonly started: Promise<void>;
  private markStarted!: () => void;
  private readonly gate: Promise<void>;

  constructor() {
    this.gate = new Promise<void>((resolve) => (this.release = resolve));
    this.started = new Promise<void>((resolve) => (this.markStarted = resolve));
  }

  async generate(): Promise<ProviderResult> {
    this.markStarted();
    await this.gate;
    return { proposals: [{ proposal_id: "p1", content: { ast_version: "1.0", root: { node_type: "literal", value: 1 } } }], raw: {} };
  }

  async repair(_r: never, proposal: ProviderProposal): Promise<ProviderProposal> {
    return proposal;
  }

  open(): void {
    this.release();
  }
}

function boot(generator: Generator | null = new FixtureGenerator()): void {
  database = openDatabase(databasePath);
  migrate(database);
  runner = new InProcessRunner();
  app = createApp({ database, runner, generator: generator ?? undefined });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-turn-routes-"));
  databasePath = join(directory, "test.db");
  boot();
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

async function createSession(): Promise<Session> {
  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return (await response.json()) as Session;
}

async function postTurn(sessionId: string, body: unknown): Promise<Response> {
  return app.request(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getTurn(turnId: string): Promise<SessionTurnDetail> {
  const response = await app.request(`/api/session-turns/${turnId}`);
  expect(response.status).toBe(200);
  return (await response.json()) as SessionTurnDetail;
}

describe("POST /api/sessions/:sessionId/turns", () => {
  it("reports that generation is unavailable when no generator is configured", async () => {
    database.close();
    boot(null);
    const session = await createSession();

    const response = await postTurn(session.id, { requirement: "Score risk" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "GENERATOR_NOT_CONFIGURED" } });
  });

  it("returns 202 with a durable turn id while the provider is still running", async () => {
    database.close();
    const gated = new GatedGenerator();
    boot(gated);

    const session = await createSession();
    const response = await postTurn(session.id, { requirement: "Score incident diabetes risk" });

    expect(response.status).toBe(202);
    const body = (await response.json()) as CreateTurnResponse;
    expect(body.turn_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe("pending");

    // The API answered while the provider is genuinely still in flight, and the
    // turn is already durable and queryable.
    await gated.started;
    const inFlight = await getTurn(body.turn_id);
    expect(inFlight.status).toBe("running");
    expect(inFlight.finished_at).toBeNull();

    gated.open();
    await runner.whenIdle("generation");
    expect((await getTurn(body.turn_id)).status).toBe("completed");
  });

  it("completes the turn with every candidate lineage once the runner drains", async () => {
    const session = await createSession();
    const response = await postTurn(session.id, { requirement: "Score risk", candidate_count: 3 });
    const { turn_id } = (await response.json()) as CreateTurnResponse;

    await runner.whenIdle("generation");

    const detail = await getTurn(turn_id);
    expect(detail.status).toBe("completed");
    expect(detail.candidates).toHaveLength(3);
    expect(detail.requirement).toBe("Score risk");
    expect(detail.provider).toBe("test-fixture");
  });

  it("exposes the blocked proposal and its repair to the reviewer", async () => {
    const session = await createSession();
    const response = await postTurn(session.id, { requirement: "Score risk", candidate_count: 3 });
    const { turn_id } = (await response.json()) as CreateTurnResponse;
    await runner.whenIdle("generation");

    const detail = await getTurn(turn_id);
    const invented = detail.candidates.find((c) => c.proposal_id === "proposal_invented_signal")!;
    expect(invented.versions.map((v) => v.admission_state)).toEqual(["blocked", "admitted"]);
    expect(invented.versions[0].first_diagnostic?.code).toBe("UNKNOWN_SIGNAL");
  });

  it("rejects an unknown session", async () => {
    const response = await postTurn("2f1c0b3e-0000-4000-8000-000000000000", { requirement: "Score" });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SESSION_NOT_FOUND" } });
  });

  it("rejects a missing or oversized requirement", async () => {
    const session = await createSession();
    expect((await postTurn(session.id, {})).status).toBe(400);
    expect((await postTurn(session.id, { requirement: "   " })).status).toBe(400);
    expect((await postTurn(session.id, { requirement: "x".repeat(4001) })).status).toBe(400);
  });

  it("rejects a candidate count outside the documented range", async () => {
    const session = await createSession();
    expect((await postTurn(session.id, { requirement: "Score", candidate_count: 1 })).status).toBe(400);
    expect((await postTurn(session.id, { requirement: "Score", candidate_count: 6 })).status).toBe(400);
  });

  it("rejects an undeclared field so the browser cannot weaken server constraints", async () => {
    const session = await createSession();
    const response = await postTurn(session.id, {
      requirement: "Score",
      vocabulary: { signals: ["incident_diabetes"] },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("appends a retry as a new turn and keeps the earlier one", async () => {
    const session = await createSession();
    const first = (await (await postTurn(session.id, { requirement: "First" })).json()) as CreateTurnResponse;
    await runner.whenIdle("generation");
    const second = (await (await postTurn(session.id, { requirement: "Second" })).json()) as CreateTurnResponse;
    await runner.whenIdle("generation");

    expect((await getTurn(first.turn_id)).ordinal).toBe(1);
    expect((await getTurn(second.turn_id)).ordinal).toBe(2);

    const detail = await app.request(`/api/sessions/${session.id}`);
    const body = (await detail.json()) as { turns: { id: string }[] };
    expect(body.turns.map((turn) => turn.id)).toEqual([first.turn_id, second.turn_id]);
  });
});

describe("GET /api/session-turns/:turnId", () => {
  it("returns 404 for an unknown turn", async () => {
    const response = await app.request("/api/session-turns/2f1c0b3e-0000-4000-8000-000000000000");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "TURN_NOT_FOUND" } });
  });

  it("never embeds the raw provider envelope in the turn detail", async () => {
    const session = await createSession();
    const { turn_id } = (await (await postTurn(session.id, { requirement: "Score risk" })).json()) as CreateTurnResponse;
    await runner.whenIdle("generation");

    const response = await app.request(`/api/session-turns/${turn_id}`);
    const text = await response.text();
    expect(text).not.toContain("provider_response_json");
    expect(text).not.toContain("response_hash");
  });
});

describe("GET /api/candidates/:candidateId", () => {
  it("returns the lineage with its owning turn and session", async () => {
    const session = await createSession();
    const { turn_id } = (await (await postTurn(session.id, { requirement: "Score risk" })).json()) as CreateTurnResponse;
    await runner.whenIdle("generation");
    const candidateId = (await getTurn(turn_id)).candidates[0].id;

    const response = await app.request(`/api/candidates/${candidateId}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: candidateId,
      turn_id,
      session_id: session.id,
    });
  });

  it("returns 404 for an unknown candidate", async () => {
    const response = await app.request("/api/candidates/nope");
    expect(response.status).toBe(404);
  });
});

describe("GET /api/candidate-versions/:versionId", () => {
  it("returns the full validation report and the exact stored content", async () => {
    const session = await createSession();
    const { turn_id } = (await (await postTurn(session.id, { requirement: "Score risk", candidate_count: 3 })).json()) as CreateTurnResponse;
    await runner.whenIdle("generation");

    const invented = (await getTurn(turn_id)).candidates.find(
      (c) => c.proposal_id === "proposal_invented_signal",
    )!;
    const response = await app.request(`/api/candidate-versions/${invented.versions[0].id}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { validation: { diagnostics: unknown[] }; content: unknown; ast: unknown };
    expect(body.validation.diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.content)).toContain("fasting_glucose_mgdl");
    expect(body.ast).toBeNull();
  });
});

describe("restart recovery through the API", () => {
  it("turns a stranded in-flight turn into a retryable failure", async () => {
    database.close();
    const gated = new GatedGenerator();
    boot(gated);

    const session = await createSession();
    const { turn_id } = (await (await postTurn(session.id, { requirement: "Score risk" })).json()) as CreateTurnResponse;
    await gated.started;
    expect((await getTurn(turn_id)).status).toBe("running");

    // Simulate a crash while the provider was mid-call, then restart.
    database.close();
    boot();
    const { recoverInterruptedRuns } = await import("../services/recoveryService");
    expect(recoverInterruptedRuns(database).failed_turns).toBe(1);

    const detail = await getTurn(turn_id);
    expect(detail.status).toBe("failed");
    expect(detail.error?.code).toBe("APP_RESTARTED");

    // The abandoned in-flight call cannot resurrect the recovered turn.
    gated.open();
    expect((await getTurn(turn_id)).status).toBe("failed");
  });
});
