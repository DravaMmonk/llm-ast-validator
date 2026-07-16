import "dotenv/config";

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { openDatabase } from "./db/connection";
import { backupDatabase, currentSchemaVersion, migrate, pendingMigrationCount } from "./db/migrate";
import { generatorFromEnvironment } from "./generation/openaiGenerator";
import { recoverInterruptedRuns } from "./services/recoveryService";

const DEFAULT_DATABASE_PATH = "var/research.db";
const DEFAULT_PORT = 8787;
const HOST = "127.0.0.1";

async function main(): Promise<void> {
  const databasePath = resolve(process.env.RESEARCH_DB_PATH ?? DEFAULT_DATABASE_PATH);
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = openDatabase(databasePath);

  // Back up before a schema change, never after — and only when there is prior
  // state to protect. A first-run database has nothing worth copying.
  if (pendingMigrationCount(database) > 0 && currentSchemaVersion(database) > 0) {
    const backup = await backupDatabase(database, databasePath);
    if (backup) console.log(`[api] backed up ${databasePath} to ${backup}`);
  }

  const result = migrate(database);
  if (result.applied.length > 0) {
    console.log(`[api] applied migrations ${result.applied.join(", ")}`);
  }

  // Nothing resumes across a restart: work stranded in flight becomes a visible,
  // retryable failure rather than a row that can never progress.
  const recovery = recoverInterruptedRuns(database);
  if (recovery.failed_turns > 0 || recovery.failed_evaluations > 0) {
    console.log(
      `[api] marked ${recovery.failed_turns} generation turn(s) and ${recovery.failed_evaluations} evaluation run(s) APP_RESTARTED`,
    );
  }

  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  // The frontend does not always sit on the default port (the browser smoke
  // path runs its own), so the allowlist is configurable rather than fixed.
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const generator = generatorFromEnvironment();
  if (!generator) {
    console.warn("[api] no generator configured; set OPENAI_API_KEY and OPENAI_MODEL to enable generation");
  }
  const app = createApp({ database, generator, allowedOrigins });

  const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
    console.log(`[api] listening on http://${HOST}:${info.port} (schema ${result.schemaVersion})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[api] failed to start", error);
  process.exit(1);
});
