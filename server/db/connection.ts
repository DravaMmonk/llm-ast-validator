import BetterSqlite3 from "better-sqlite3";

export type AppDatabase = BetterSqlite3.Database;

/**
 * Opens the local SQLite file with the durability settings the prototype relies on:
 * WAL journaling, enforced foreign keys, and a bounded busy timeout.
 */
export function openDatabase(path: string): AppDatabase {
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  return database;
}
