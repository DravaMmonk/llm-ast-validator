import { randomUUID } from "node:crypto";

import { Hono } from "hono";

import { canonicalJson } from "../../shared/ast/canonical";
import { admit } from "../../shared/ast/core";
import type { AppDatabase } from "../db/connection";
import {
  appendVersion,
  findCandidateSummary,
  findLatestVersion,
  findVersionReport,
} from "../db/stores/candidates";
import { ApiFailure, readJsonObject, rejectUnknownFields, validationFailed } from "../http";

/** GET /api/candidates/:candidateId, POST /api/candidates/:candidateId/versions */
export function createCandidateRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/:candidateId", (context) => {
    const candidateId = context.req.param("candidateId");
    const candidate = findCandidateSummary(database, candidateId);
    if (!candidate) {
      throw new ApiFailure(404, "CANDIDATE_NOT_FOUND", `Candidate “${candidateId}” does not exist.`);
    }
    return context.json(candidate);
  });

  /**
   * Appends a Blockly-authored child version.
   *
   * The server validates the submitted AST itself. A client cannot supply a
   * validation result, an admission state, or a hash: those are derived here or
   * not at all. A blocked draft is rejected outright rather than stored, because
   * only the generator's own attempts are kept as an audit record.
   */
  routes.post("/:candidateId/versions", async (context) => {
    const candidateId = context.req.param("candidateId");
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["ast", "note"]);

    if (body.ast === undefined) throw validationFailed("An AST document is required.");
    if (body.note !== undefined && typeof body.note !== "string") {
      throw validationFailed("Note must be a string.");
    }

    const candidate = findCandidateSummary(database, candidateId);
    if (!candidate) {
      throw new ApiFailure(404, "CANDIDATE_NOT_FOUND", `Candidate “${candidateId}” does not exist.`);
    }

    const result = admit(body.ast);
    if (result.state !== "admitted" || !result.document) {
      throw new ApiFailure(422, "VERSION_NOT_ADMITTED", "The edited formula did not pass admission.", {
        diagnostics: result.report.diagnostics,
      });
    }

    const parent = findLatestVersion(database, candidateId);
    const version = {
      id: randomUUID(),
      parent_version_id: parent?.id ?? null,
      version_no: (parent?.version_no ?? 0) + 1,
      source: "blockly" as const,
      content_json: JSON.stringify(body.ast),
      ast_json: canonicalJson(result.document),
      ast_hash: result.ast_hash,
      ast_schema_version: result.report.ast_schema_version,
      registry_version: result.report.registry_version,
      registry_hash: result.report.registry_hash,
      validator_version: result.report.validator_version,
      admission_state: result.state,
      validation_json: JSON.stringify(result.report),
      explanation: null,
      assumptions_json: null,
      note: (body.note as string | undefined) ?? null,
    };

    appendVersion(database, {
      candidate_id: candidateId,
      session_id: candidate.session_id,
      version,
      now: new Date().toISOString(),
    });

    return context.json(
      {
        id: version.id,
        parent_version_id: version.parent_version_id,
        version_no: version.version_no,
        source: version.source,
        admission_state: version.admission_state,
        ast_hash: version.ast_hash,
      },
      201,
    );
  });

  return routes;
}

/** GET /api/candidate-versions/:versionId — full diagnostics and raw content. */
export function createCandidateVersionRoutes(database: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/:versionId", (context) => {
    const versionId = context.req.param("versionId");
    const report = findVersionReport(database, versionId);
    if (!report) {
      throw new ApiFailure(404, "VERSION_NOT_FOUND", `Candidate version “${versionId}” does not exist.`);
    }
    return context.json(report);
  });

  return routes;
}
