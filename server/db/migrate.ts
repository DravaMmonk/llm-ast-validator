import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AppDatabase } from "./connection";
import { openDatabase } from "./connection";

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./migrations/", import.meta.url));
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number[];
  schemaVersion: number;
}

export function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .map((file) => ({ file, match: FILE_PATTERN.exec(file) }))
    .filter((entry): entry is { file: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ file, match }) => ({
      version: Number.parseInt(match[1], 10),
      name: match[2],
      sql: readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8"),
    }))
    .sort((left, right) => left.version - right.version);
}

function ensureMigrationTable(database: AppDatabase): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
}

function appliedVersions(database: AppDatabase): number[] {
  return database
    .prepare<[], { version: number }>("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => row.version);
}

/**
 * Applies every numbered migration that has not run yet. Each migration is one
 * transaction, so a failure leaves the previous schema version intact.
 */
export function migrate(database: AppDatabase): MigrationResult {
  ensureMigrationTable(database);
  const already = appliedVersions(database);
  const pending = loadMigrations().filter((migration) => !already.includes(migration.version));
  const record = database.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of pending) {
    const apply = database.transaction(() => {
      database.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
  }

  const applied = pending.map((migration) => migration.version);
  return {
    applied,
    alreadyApplied: already,
    schemaVersion: Math.max(0, ...already, ...applied),
  };
}

export function pendingMigrationCount(database: AppDatabase): number {
  ensureMigrationTable(database);
  const already = appliedVersions(database);
  return loadMigrations().filter((migration) => !already.includes(migration.version)).length;
}

/** Zero for a database that has never had a migration applied. */
export function currentSchemaVersion(database: AppDatabase): number {
  ensureMigrationTable(database);
  return Math.max(0, ...appliedVersions(database));
}

/**
 * Takes a timestamped copy through SQLite's online backup API and verifies that
 * the copy opens. Copying only the main file would be unsafe while WAL
 * connections are active, so `db.backup` is the required path.
 */
export async function backupDatabase(
  database: AppDatabase,
  databasePath: string,
): Promise<string | null> {
  if (!existsSync(databasePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = `${databasePath}.${stamp}.backup`;

  await database.backup(destination);
  const verification = openDatabase(destination);
  try {
    verification.prepare("SELECT 1").get();
  } finally {
    verification.close();
  }
  return destination;
}
