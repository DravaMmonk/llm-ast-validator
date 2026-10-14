import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./connection";
import { loadMigrations, migrate } from "./migrate";

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-migrate-"));
  databasePath = join(directory, "test.db");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function tableNames(database: ReturnType<typeof openDatabase>): string[] {
  return database
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
}

describe("migrate", () => {
  it("creates the session spine tables", () => {
    const database = openDatabase(databasePath);
    migrate(database);

    const names = tableNames(database);
    expect(names).toEqual(
      expect.arrayContaining(["sessions", "session_turns", "candidates", "candidate_versions"]),
    );
    database.close();
  });

  it("is idempotent when run twice", () => {
    const database = openDatabase(databasePath);
    const first = migrate(database);
    const second = migrate(database);

    expect(first.applied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(first.applied);
    database.close();
  });

  it("enables foreign keys, WAL, and a busy timeout", () => {
    const database = openDatabase(databasePath);
    migrate(database);

    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
    database.close();
  });

  it("rejects a turn that references a missing session", () => {
    const database = openDatabase(databasePath);
    migrate(database);

    expect(() =>
      database
        .prepare(
          `INSERT INTO session_turns (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
           VALUES ('t1', 'missing-session', 1, '{}', 'test-fixture', 'fixture-v1', 'v1', 'pending', '2026-07-16T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
    database.close();
  });

  it("enforces the documented uniqueness constraints", () => {
    const database = openDatabase(databasePath);
    migrate(database);
    const now = "2026-07-16T00:00:00.000Z";

    database
      .prepare(
        `INSERT INTO sessions (id, title, status, created_at, updated_at) VALUES ('s1', 'Session', 'active', ?, ?)`,
      )
      .run(now, now);
    const insertTurn = database.prepare(
      `INSERT INTO session_turns (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
       VALUES (?, 's1', ?, '{}', 'test-fixture', 'fixture-v1', 'v1', 'pending', ?)`,
    );
    insertTurn.run("t1", 1, now);
    expect(() => insertTurn.run("t2", 1, now)).toThrow(/UNIQUE/i);

    const insertCandidate = database.prepare(
      `INSERT INTO candidates (id, turn_id, proposal_id, ordinal, created_at) VALUES (?, 't1', ?, ?, ?)`,
    );
    insertCandidate.run("c1", "proposal_direct", 1, now);
    expect(() => insertCandidate.run("c2", "proposal_direct", 2, now)).toThrow(/UNIQUE/i);
    expect(() => insertCandidate.run("c3", "proposal_other", 1, now)).toThrow(/UNIQUE/i);

    const insertVersion = database.prepare(
      `INSERT INTO candidate_versions (id, candidate_id, version_no, source, content_json, admission_state, validation_json, registry_version, registry_hash, validator_version, created_at)
       VALUES (?, 'c1', ?, 'generated', '{}', 'blocked', '{}', 'v1', 'hash', 'v1', ?)`,
    );
    insertVersion.run("v1", 1, now);
    expect(() => insertVersion.run("v2", 1, now)).toThrow(/UNIQUE/i);

    database.close();
  });

  it("refuses an admitted version that carries no canonical AST", () => {
    const database = openDatabase(databasePath);
    migrate(database);
    const now = "2026-07-16T00:00:00.000Z";

    database
      .prepare(
        `INSERT INTO sessions (id, title, status, created_at, updated_at) VALUES ('s1', 'Session', 'active', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO session_turns (id, session_id, ordinal, requirement_json, provider, model, prompt_version, status, started_at)
         VALUES ('t1', 's1', 1, '{}', 'test-fixture', 'fixture-v1', 'v1', 'completed', ?)`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO candidates (id, turn_id, proposal_id, ordinal, created_at) VALUES ('c1', 't1', 'proposal_direct', 1, ?)`,
      )
      .run(now);

    expect(() =>
      database
        .prepare(
          `INSERT INTO candidate_versions (id, candidate_id, version_no, source, content_json, admission_state, validation_json, registry_version, registry_hash, validator_version, created_at)
           VALUES ('v1', 'c1', 1, 'generated', '{}', 'admitted', '{}', 'v1', 'hash', 'v1', ?)`,
        )
        .run(now),
    ).toThrow(/CHECK/i);
    database.close();
  });

  it("permits only declared enum values", () => {
    const database = openDatabase(databasePath);
    migrate(database);
    const now = "2026-07-16T00:00:00.000Z";

    expect(() =>
      database
        .prepare(
          `INSERT INTO sessions (id, title, status, created_at, updated_at) VALUES ('bad', 'Session', 'deleted', ?, ?)`,
        )
        .run(now, now),
    ).toThrow(/CHECK/i);
    database.close();
  });
});

describe("0004 public datasets", () => {
  it("rebuilds wb_datasets without losing rows or foreign keys", () => {
    const database = openDatabase(databasePath);
    // Bring the database to schema 3 exactly as an existing install would be.
    database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of loadMigrations().filter((entry) => entry.version <= 3)) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(migration.version, migration.name, "2026-01-01");
    }
    const now = "2026-01-01T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO wb_datasets (id, name, source, row_count, column_count, content_hash, columns_json, status, created_at, updated_at)
         VALUES ('d1', 'Pilot', 'upload', 1, 1, 'h', '[]', 'active', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO wb_documents (id, kind, title, dataset_id, payload_json, status, created_at, updated_at)
         VALUES ('c1', 'cohort', 'Adults', 'd1', '{}', 'active', ?, ?)`,
      )
      .run(now, now);

    expect(migrate(database).applied).toContain(4);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.prepare("SELECT name FROM wb_datasets WHERE id = 'd1'").get()).toEqual({ name: "Pilot" });
    expect(database.prepare("SELECT dataset_id FROM wb_documents WHERE id = 'c1'").get()).toEqual({ dataset_id: "d1" });
    database
      .prepare(
        `INSERT INTO wb_datasets (id, name, source, sample_key, row_count, column_count, content_hash, columns_json, status, created_at, updated_at)
         VALUES ('d2', 'PBC', 'public', 'pbc_mayo', 1, 1, 'h', '[]', 'active', ?, ?)`,
      )
      .run(now, now);
    // The documents table still points at the rebuilt datasets table.
    expect(() =>
      database
        .prepare(
          `INSERT INTO wb_documents (id, kind, title, dataset_id, payload_json, status, created_at, updated_at)
           VALUES ('c2', 'cohort', 'Orphan', 'missing', '{}', 'active', ?, ?)`,
        )
        .run(now, now),
    ).toThrow(/FOREIGN KEY/);
    database.close();
  });
});
