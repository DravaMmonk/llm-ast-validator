import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { findTurnDetail } from "../db/stores/candidates";
import { insertSession } from "../db/stores/sessions";
import { FixtureGenerator } from "../../test-support/fixtureGenerator";
import { createTurn, executeTurn } from "./generationService";
import { recoverInterruptedRuns } from "./recoveryService";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let database: Database;
const generator = new FixtureGenerator();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-recovery-"));
  database = openDatabase(join(directory, "test.db"));
  migrate(database);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function seedSession(): string {
  return insertSession(database, {
    id: crypto.randomUUID(),
    title: "Session",
    now: new Date().toISOString(),
  }).id;
}

function setStatus(turnId: string, status: string): void {
  database.prepare("UPDATE session_turns SET status = ? WHERE id = ?").run(status, turnId);
}

describe("recoverInterruptedRuns", () => {
  it("fails a turn stranded in pending", () => {
    const created = createTurn(database, seedSession(), { requirement: "Score risk" }, generator);

    const result = recoverInterruptedRuns(database);

    expect(result.failed_turns).toBe(1);
    const detail = findTurnDetail(database, created.turn_id)!;
    expect(detail.status).toBe("failed");
    expect(detail.error?.code).toBe("APP_RESTARTED");
    expect(detail.finished_at).not.toBeNull();
  });

  it("fails a turn stranded in running", () => {
    const created = createTurn(database, seedSession(), { requirement: "Score risk" }, generator);
    setStatus(created.turn_id, "running");

    expect(recoverInterruptedRuns(database).failed_turns).toBe(1);
    expect(findTurnDetail(database, created.turn_id)!.error?.code).toBe("APP_RESTARTED");
  });

  it("leaves a completed turn and its candidates untouched", async () => {
    const created = createTurn(database, seedSession(), { requirement: "Score risk" }, generator);
    await executeTurn(database, created.turn_id, generator);

    expect(recoverInterruptedRuns(database).failed_turns).toBe(0);

    const detail = findTurnDetail(database, created.turn_id)!;
    expect(detail.status).toBe("completed");
    expect(detail.error).toBeNull();
    expect(detail.candidates).toHaveLength(3);
  });

  it("does not overwrite an existing failure reason", () => {
    const sessionId = seedSession();
    const created = createTurn(database, sessionId, { requirement: "Score risk" }, generator);
    database
      .prepare("UPDATE session_turns SET status = 'failed', error_json = ? WHERE id = ?")
      .run(JSON.stringify({ code: "PROVIDER_FAILED", message: "down" }), created.turn_id);

    expect(recoverInterruptedRuns(database).failed_turns).toBe(0);
    expect(findTurnDetail(database, created.turn_id)!.error?.code).toBe("PROVIDER_FAILED");
  });

  it("is idempotent across repeated restarts", () => {
    createTurn(database, seedSession(), { requirement: "Score risk" }, generator);

    expect(recoverInterruptedRuns(database).failed_turns).toBe(1);
    expect(recoverInterruptedRuns(database).failed_turns).toBe(0);
  });

  it("recovers every stranded turn at once", () => {
    const sessionId = seedSession();
    createTurn(database, sessionId, { requirement: "One" }, generator);
    createTurn(database, sessionId, { requirement: "Two" }, generator);

    expect(recoverInterruptedRuns(database).failed_turns).toBe(2);
  });

  it("leaves a recovered turn retryable as a new turn", async () => {
    const sessionId = seedSession();
    const stranded = createTurn(database, sessionId, { requirement: "Score risk" }, generator);
    recoverInterruptedRuns(database);

    const retry = createTurn(database, sessionId, { requirement: "Score risk" }, generator);
    await executeTurn(database, retry.turn_id, generator);

    expect(findTurnDetail(database, stranded.turn_id)!.error?.code).toBe("APP_RESTARTED");
    expect(findTurnDetail(database, retry.turn_id)!.status).toBe("completed");
  });
});
