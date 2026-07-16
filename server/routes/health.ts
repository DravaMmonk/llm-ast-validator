import { Hono } from "hono";

import type { HealthResponse } from "../../shared/contracts";
import type { AppDatabase } from "../db/connection";
import type { Generator } from "../generation/generator";

export function createHealthRoutes(database: AppDatabase, generator?: Generator): Hono {
  const routes = new Hono();

  routes.get("/", (context) => {
    const row = database
      .prepare<[], { version: number | null }>("SELECT MAX(version) AS version FROM schema_migrations")
      .get();
    const body: HealthResponse = {
      status: "ok",
      schema_version: row?.version ?? 0,
      generator: generator
        ? { configured: true, provider: generator.id, model: generator.model }
        : { configured: false, provider: null, model: null },
    };
    return context.json(body);
  });

  return routes;
}
