import { randomUUID } from "node:crypto";

import { canonicalJson, sha256Hex } from "../../shared/ast/canonical";
import { admit } from "../../shared/ast/core";
import type { CreateTurnResponse } from "../../shared/contracts";
import {
  CANDIDATE_COUNT_DEFAULT,
  CANDIDATE_COUNT_MAX,
  CANDIDATE_COUNT_MIN,
  DEFAULT_SESSION_TITLE,
  DERIVED_TITLE_MAX_LENGTH,
  PROVIDER_ENVELOPE_MAX_BYTES,
  REQUIREMENT_MAX_LENGTH,
  REQUIREMENT_MIN_LENGTH,
} from "../../shared/contracts";
import type { AppDatabase } from "../db/connection";
import type { CandidateInput, VersionInput } from "../db/stores/candidates";
import {
  completeTurnWithCandidates,
  findTurnRow,
  insertTurn,
  markTurnFailed,
  markTurnRunning,
  nextTurnOrdinal,
} from "../db/stores/candidates";
import { findSession } from "../db/stores/sessions";
import type { Generator, ProviderProposal, ProviderResult } from "../generation/generator";
import { ProviderTransportError, buildGenerationRequest } from "../generation/generator";
import { ApiFailure, validationFailed } from "../http";

/**
 * Derives a session title deterministically from the first requirement
 * (Section 11.1). There is no separate model call for titling.
 */
export function deriveSessionTitle(requirement: string): string {
  const normalized = requirement.replace(/\s+/g, " ").trim();
  const title = normalized.slice(0, DERIVED_TITLE_MAX_LENGTH).trim();
  return title === "" ? DEFAULT_SESSION_TITLE : title;
}

export function parseTurnRequest(body: Record<string, unknown>): {
  requirement: string;
  candidate_count: number;
} {
  if (typeof body.requirement !== "string") {
    throw validationFailed("Requirement must be a string.");
  }
  const requirement = body.requirement.trim();
  if (requirement.length < REQUIREMENT_MIN_LENGTH || requirement.length > REQUIREMENT_MAX_LENGTH) {
    throw validationFailed(
      `Requirement must be between ${REQUIREMENT_MIN_LENGTH} and ${REQUIREMENT_MAX_LENGTH} characters.`,
    );
  }

  let candidateCount = CANDIDATE_COUNT_DEFAULT;
  if (body.candidate_count !== undefined) {
    const value = body.candidate_count;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < CANDIDATE_COUNT_MIN ||
      value > CANDIDATE_COUNT_MAX
    ) {
      throw validationFailed(
        `Candidate count must be an integer between ${CANDIDATE_COUNT_MIN} and ${CANDIDATE_COUNT_MAX}.`,
      );
    }
    candidateCount = value;
  }

  return { requirement, candidate_count: candidateCount };
}

/**
 * Persists the turn before any provider call, so a failure is always a durable,
 * retryable record rather than a lost request. A retry creates a new turn; it
 * never rewrites the failed one.
 */
export function createTurn(
  database: AppDatabase,
  sessionId: string,
  body: Record<string, unknown>,
  generator: Generator,
): CreateTurnResponse {
  const { requirement, candidate_count } = parseTurnRequest(body);

  const session = findSession(database, sessionId);
  if (!session) {
    throw new ApiFailure(404, "SESSION_NOT_FOUND", `Session “${sessionId}” does not exist.`);
  }

  const turnId = randomUUID();
  const now = new Date().toISOString();

  const write = database.transaction(() => {
    const isFirstTurn = nextTurnOrdinal(database, sessionId) === 1;
    insertTurn(database, {
      id: turnId,
      session_id: sessionId,
      requirement,
      candidate_count,
      provider: generator.id,
      model: generator.model,
      prompt_version: generator.prompt_version,
      now,
    });

    // Only title a session that the user has not already named.
    const shouldDeriveTitle = isFirstTurn && session.title === DEFAULT_SESSION_TITLE;
    database
      .prepare(
        `UPDATE sessions SET current_requirement = ?, title = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        requirement,
        shouldDeriveTitle ? deriveSessionTitle(requirement) : session.title,
        now,
        sessionId,
      );
  });
  write();

  return { turn_id: turnId, status: "pending" };
}

function safeStringify(value: unknown): string | null {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : text;
  } catch {
    return null;
  }
}

/**
 * Normalizes whatever the provider returned into an ordered proposal list.
 * Missing ids are synthesized and duplicates are disambiguated, because
 * `(turn_id, proposal_id)` is unique and a provider is not trusted to be well
 * behaved.
 */
export function normalizeProposals(result: ProviderResult): ProviderProposal[] {
  if (!result || !Array.isArray(result.proposals) || result.proposals.length === 0) {
    throw new ApiFailure(422, "PROVIDER_MALFORMED", "The provider returned no usable proposals.");
  }

  const seen = new Set<string>();
  return result.proposals.map((proposal, index) => {
    const raw =
      proposal && typeof proposal === "object" && typeof proposal.proposal_id === "string"
        ? proposal.proposal_id.trim()
        : "";
    let id = raw === "" ? `proposal_${index + 1}` : raw;
    let suffix = 2;
    while (seen.has(id)) id = `${raw === "" ? `proposal_${index + 1}` : raw}_${suffix++}`;
    seen.add(id);

    return {
      proposal_id: id,
      content: proposal?.content,
      explanation: typeof proposal?.explanation === "string" ? proposal.explanation : undefined,
      assumptions: Array.isArray(proposal?.assumptions)
        ? proposal.assumptions.filter((entry): entry is string => typeof entry === "string")
        : undefined,
    };
  });
}

function buildVersion(
  content: unknown,
  source: "generated" | "repair",
  versionNo: number,
  parentVersionId: string | null,
  proposal: ProviderProposal,
): VersionInput {
  const result = admit(content);
  return {
    id: randomUUID(),
    parent_version_id: parentVersionId,
    version_no: versionNo,
    source,
    // The exact provider payload is retained even when admission fails.
    content_json: safeStringify(content) ?? JSON.stringify({ unserializable: true }),
    ast_json: result.document ? canonicalJson(result.document) : null,
    ast_hash: result.ast_hash,
    ast_schema_version: result.document ? result.report.ast_schema_version : null,
    registry_version: result.report.registry_version,
    registry_hash: result.report.registry_hash,
    validator_version: result.report.validator_version,
    admission_state: result.state,
    validation_json: JSON.stringify(result.report),
    explanation: proposal.explanation ?? null,
    assumptions_json: proposal.assumptions ? JSON.stringify(proposal.assumptions) : null,
    note: null,
  };
}

/**
 * Runs one persisted turn: provider call, bounded normalization, admission with
 * at most one repair per proposal, then one atomic write of every lineage.
 * Every attempt is retained, including blocked ones.
 */
export async function executeTurn(
  database: AppDatabase,
  turnId: string,
  generator: Generator,
): Promise<void> {
  const turn = findTurnRow(database, turnId);
  if (!turn) return;
  if (turn.status !== "pending") return;

  markTurnRunning(database, turnId);
  const requirement = JSON.parse(turn.requirement_json) as {
    requirement: string;
    candidate_count: number;
  };
  const request = buildGenerationRequest(requirement.requirement, requirement.candidate_count);

  let result: ProviderResult;
  try {
    result = await generator.generate(request);
  } catch (error) {
    markTurnFailed(
      database,
      turnId,
      {
        code: error instanceof ProviderTransportError ? error.code : "PROVIDER_FAILED",
        message: error instanceof Error ? error.message : "The provider call failed.",
      },
      new Date().toISOString(),
    );
    return;
  }

  const envelope = safeStringify(result.raw);
  if (envelope === null) {
    markTurnFailed(
      database,
      turnId,
      { code: "PROVIDER_MALFORMED", message: "The provider envelope could not be serialized." },
      new Date().toISOString(),
    );
    return;
  }

  const byteLength = Buffer.byteLength(envelope, "utf8");
  const envelopeHash = sha256Hex(envelope);
  if (byteLength > PROVIDER_ENVELOPE_MAX_BYTES) {
    // Retain only length and digest — never a truncated pseudo-candidate.
    markTurnFailed(
      database,
      turnId,
      {
        code: "PROVIDER_RESPONSE_TOO_LARGE",
        message: `The provider envelope is ${byteLength} bytes; the limit is ${PROVIDER_ENVELOPE_MAX_BYTES}.`,
      },
      new Date().toISOString(),
      {
        provider_response_json: JSON.stringify({ byte_length: byteLength, sha256: envelopeHash }),
        response_hash: envelopeHash,
      },
    );
    return;
  }

  let proposals: ProviderProposal[];
  try {
    proposals = normalizeProposals(result);
  } catch (error) {
    markTurnFailed(
      database,
      turnId,
      {
        code: error instanceof ApiFailure ? error.code : "PROVIDER_MALFORMED",
        message: error instanceof Error ? error.message : "The provider output was malformed.",
      },
      new Date().toISOString(),
      { provider_response_json: envelope, response_hash: envelopeHash },
    );
    return;
  }

  const candidates: CandidateInput[] = [];
  for (const [index, proposal] of proposals.entries()) {
    const generated = buildVersion(proposal.content, "generated", 1, null, proposal);
    const versions: VersionInput[] = [generated];

    // Exactly one bounded repair attempt per proposal.
    if (generated.admission_state === "blocked") {
      try {
        const report = JSON.parse(generated.validation_json) as { diagnostics: [] };
        const repaired = await generator.repair(request, proposal, report.diagnostics);
        versions.push(buildVersion(repaired.content, "repair", 2, generated.id, repaired));
      } catch {
        // A failed repair leaves the blocked generated version as the record.
      }
    }

    candidates.push({
      id: randomUUID(),
      proposal_id: proposal.proposal_id,
      ordinal: index + 1,
      versions,
    });
  }

  completeTurnWithCandidates(database, {
    turn_id: turnId,
    candidates,
    provider_response_json: envelope,
    response_hash: envelopeHash,
    now: new Date().toISOString(),
  });
}
