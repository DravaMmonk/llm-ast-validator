import { Hono } from "hono";

import type { AppDatabase } from "../db/connection";
import { findTurnDetail } from "../db/stores/candidates";
import type { Generator } from "../generation/generator";
import { ApiFailure, readJsonObject, rejectUnknownFields } from "../http";
import type { InProcessRunner } from "../jobs/inProcessRunner";
import { createTurn, executeTurn } from "../services/generationService";

export interface TurnRouteOptions {
  database: AppDatabase;
  generator?: Generator;
  runner: InProcessRunner;
}

/** POST /api/sessions/:sessionId/turns */
export function createSessionTurnRoutes({ database, generator, runner }: TurnRouteOptions): Hono {
  const routes = new Hono();

  routes.post("/:sessionId/turns", async (context) => {
    if (!generator) {
      throw new ApiFailure(
        503,
        "GENERATOR_NOT_CONFIGURED",
        "No generator is configured in the API server environment.",
      );
    }
    const sessionId = context.req.param("sessionId");
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["requirement", "candidate_count"]);

    // The turn is durable before the provider is called.
    const created = createTurn(database, sessionId, body, generator);
    runner.enqueue("generation", () => executeTurn(database, created.turn_id, generator));

    return context.json(created, 202);
  });

  return routes;
}

/** GET /api/session-turns/:turnId */
export function createTurnDetailRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/:turnId", (context) => {
    const turnId = context.req.param("turnId");
    const detail = findTurnDetail(database, turnId);
    if (!detail) throw new ApiFailure(404, "TURN_NOT_FOUND", `Turn “${turnId}” does not exist.`);
    return context.json(detail);
  });

  return routes;
}
