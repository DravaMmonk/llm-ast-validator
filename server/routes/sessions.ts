import { randomUUID } from "node:crypto";

import { Hono } from "hono";

import type {
  PatchSessionRequest,
  SessionDetailResponse,
  SessionListResponse,
  SessionStatus,
} from "../../shared/contracts";
import { DEFAULT_SESSION_TITLE, SESSION_TITLE_MAX_LENGTH } from "../../shared/contracts";
import type { AppDatabase } from "../db/connection";
import {
  findSession,
  findSessionIdForVersion,
  insertSession,
  listSessions,
  listTurnDetails,
  updateSession,
} from "../db/stores/sessions";
import {
  ApiFailure,
  readJsonObject,
  readOptionalTitle,
  rejectUnknownFields,
  validationFailed,
} from "../http";

const SESSION_STATUSES: readonly SessionStatus[] = ["active", "archived"];
const PATCH_FIELDS = ["title", "status", "selected_candidate_version_id"] as const;

function sessionNotFound(id: string): ApiFailure {
  return new ApiFailure(404, "SESSION_NOT_FOUND", `Session “${id}” does not exist.`);
}

function readStatus(body: Record<string, unknown>): SessionStatus | undefined {
  if (!("status" in body)) return undefined;
  const value = body.status;
  if (typeof value !== "string" || !SESSION_STATUSES.includes(value as SessionStatus)) {
    throw validationFailed("Status must be “active” or “archived”.");
  }
  return value as SessionStatus;
}

function readSelectedVersionId(body: Record<string, unknown>): string | null | undefined {
  if (!("selected_candidate_version_id" in body)) return undefined;
  const value = body.selected_candidate_version_id;
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw validationFailed("Selected candidate version id must be a non-empty string or null.");
  }
  return value;
}

export function createSessionRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/", (context) => {
    const requested = context.req.query("status") ?? "active";
    if (!SESSION_STATUSES.includes(requested as SessionStatus)) {
      throw validationFailed("Status filter must be “active” or “archived”.");
    }
    const body: SessionListResponse = {
      sessions: listSessions(database, requested as SessionStatus),
    };
    return context.json(body);
  });

  routes.post("/", async (context) => {
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["title"]);
    const title = readOptionalTitle(body, SESSION_TITLE_MAX_LENGTH) ?? DEFAULT_SESSION_TITLE;

    const session = insertSession(database, {
      id: randomUUID(),
      title,
      now: new Date().toISOString(),
    });
    return context.json(session, 201);
  });

  routes.get("/:sessionId", (context) => {
    const sessionId = context.req.param("sessionId");
    const session = findSession(database, sessionId);
    if (!session) throw sessionNotFound(sessionId);

    const body: SessionDetailResponse = {
      session,
      turns: listTurnDetails(database, sessionId),
    };
    return context.json(body);
  });

  routes.patch("/:sessionId", async (context) => {
    const sessionId = context.req.param("sessionId");
    const body = await readJsonObject(context);
    rejectUnknownFields(body, PATCH_FIELDS);

    const patch: PatchSessionRequest = {};
    const title = readOptionalTitle(body, SESSION_TITLE_MAX_LENGTH);
    if (title !== undefined) patch.title = title;
    const status = readStatus(body);
    if (status !== undefined) patch.status = status;
    const selected = readSelectedVersionId(body);
    if (selected !== undefined) patch.selected_candidate_version_id = selected;

    if (Object.keys(patch).length === 0) {
      throw validationFailed("Patch must change at least one supported field.", {
        supported: PATCH_FIELDS,
      });
    }

    const existing = findSession(database, sessionId);
    if (!existing) throw sessionNotFound(sessionId);

    // A selection may only point at a version this session actually owns.
    if (typeof patch.selected_candidate_version_id === "string") {
      const owner = findSessionIdForVersion(database, patch.selected_candidate_version_id);
      if (owner !== sessionId) {
        throw new ApiFailure(
          409,
          "SELECTED_VERSION_NOT_IN_SESSION",
          "The selected candidate version does not belong to this session.",
        );
      }
    }

    const updated = updateSession(database, sessionId, patch, new Date().toISOString());
    if (!updated) throw sessionNotFound(sessionId);
    return context.json(updated);
  });

  return routes;
}
