import { Hono } from "hono";

import type { ApiErrorResponse } from "../shared/contracts";
import type { AppDatabase } from "./db/connection";
import type { Generator } from "./generation/generator";
import { ApiFailure } from "./http";
import { InProcessRunner } from "./jobs/inProcessRunner";
import { createCandidateRoutes, createCandidateVersionRoutes } from "./routes/candidates";
import { createHealthRoutes } from "./routes/health";
import { createSessionRoutes } from "./routes/sessions";
import {
  createDatasetRoutes,
  createDecisionRoutes,
  createEvaluationDetailRoutes,
  createEvaluationRunRoutes,
  createVersionEvaluationRoutes,
} from "./routes/evaluations";
import { createSessionTurnRoutes, createTurnDetailRoutes } from "./routes/sessionTurns";
import { type WorkbenchRouteOptions, createWorkbenchRoutes } from "./routes/workbench";

/** The local frontend is the only browser origin this prototype answers. */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export interface AppOptions {
  database: AppDatabase;
  /** Undefined means generation is deliberately unavailable. */
  generator?: Generator;
  runner?: InProcessRunner;
  allowedOrigins?: readonly string[];
  /** Workstation route options (tests stub the public-dataset downloader). */
  workbench?: WorkbenchRouteOptions;
}

export function createApp({
  database,
  generator,
  runner = new InProcessRunner(),
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  workbench,
}: AppOptions): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    const origin = context.req.header("origin");
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      const body: ApiErrorResponse = {
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This origin may not call the local API." },
      };
      return context.json(body, 403);
    }
    await next();
  });

  app.route("/api/health", createHealthRoutes(database, generator));
  app.route("/api/sessions", createSessionRoutes(database));
  app.route("/api/sessions", createSessionTurnRoutes({ database, generator, runner }));
  app.route("/api/session-turns", createTurnDetailRoutes(database));
  app.route("/api/candidates", createCandidateRoutes(database));
  app.route("/api/candidate-versions", createCandidateVersionRoutes(database));
  app.route("/api/candidate-versions", createDecisionRoutes(database));
  app.route("/api/candidate-versions", createVersionEvaluationRoutes(database));
  app.route("/api/dataset-versions", createDatasetRoutes(database));
  app.route("/api/sessions", createEvaluationRunRoutes({ database, runner }));
  app.route("/api/evaluation-runs", createEvaluationDetailRoutes(database));
  app.route("/api/workbench", createWorkbenchRoutes(database, workbench));

  app.notFound((context) => {
    const body: ApiErrorResponse = {
      error: { code: "NOT_FOUND", message: "No such endpoint." },
    };
    return context.json(body, 404);
  });

  app.onError((error, context) => {
    if (error instanceof ApiFailure) {
      return context.json(error.toResponseBody(), error.status);
    }
    // Anything unmodelled is a defect. Log it locally; return nothing specific.
    console.error("[api] unhandled error", error);
    const body: ApiErrorResponse = {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    };
    return context.json(body, 500);
  });

  return app;
}
