/** Starts the browser-test API with an explicit test-only Generator. */

import { serve } from "@hono/node-server";

import { createApp } from "../server/app";
import { openDatabase } from "../server/db/connection";
import { migrate } from "../server/db/migrate";
import { InProcessRunner } from "../server/jobs/inProcessRunner";
import { FixtureGenerator } from "../test-support/fixtureGenerator";

const database = openDatabase(process.env.RESEARCH_DB_PATH ?? "var/e2e.db");
const result = migrate(database);
const port = Number.parseInt(process.env.PORT ?? "8788", 10);
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);
const app = createApp({
  database,
  generator: new FixtureGenerator(),
  runner: new InProcessRunner(),
  allowedOrigins,
  // Browser tests never download real data: every public-catalogue source
  // "returns" a synthetic file, which the digest check must refuse.
  workbench: { fetchSource: async () => new TextEncoder().encode("synthetic,stand-in\n1,2\n") },
});

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`[e2e-api] listening on http://127.0.0.1:${info.port} (schema ${result.schemaVersion})`);
});

const shutdown = () => server.close(() => database.close());
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
