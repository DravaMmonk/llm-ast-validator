/**
 * The typed browser client for the local API.
 *
 * The browser holds no business state: every session, turn, candidate, and
 * decision fact comes from here. Nothing is written to localStorage.
 */

import type { AstDocument } from "../../shared/ast/core";
import type {
  CandidateSummary,
  CandidateVersionSummary,
  CreateEvaluationRunsResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  DatasetCurrentResponse,
  EvaluationRowsResponse,
  EvaluationRunDetail,
  HealthResponse,
  LatestEvaluationRunResponse,
  PatchSessionRequest,
  ReviewDecision,
  RowFilterClass,
  Session,
  SessionDetailResponse,
  SessionListResponse,
  SessionStatus,
  SessionTurnDetail,
} from "../../shared/contracts";

/** A structured failure carrying the API's error code, not just a message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch (cause) {
    // A transport failure has no HTTP status; surface it as one shape anyway.
    throw new ApiError(0, "NETWORK_ERROR", "The local API is unreachable. Is it running?");
  }

  if (!response.ok) {
    let code = "UNKNOWN";
    let message = `Request failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Keep the status-derived default.
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  getHealth(): Promise<HealthResponse> {
    return request<HealthResponse>("/api/health");
  },

  listSessions(status: SessionStatus = "active"): Promise<SessionListResponse> {
    return request<SessionListResponse>(`/api/sessions?status=${status}`);
  },

  createSession(title?: string): Promise<Session> {
    return request<Session>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(title === undefined ? {} : { title }),
    });
  },

  getSession(sessionId: string): Promise<SessionDetailResponse> {
    return request<SessionDetailResponse>(`/api/sessions/${sessionId}`);
  },

  patchSession(sessionId: string, patch: PatchSessionRequest): Promise<Session> {
    return request<Session>(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  createTurn(sessionId: string, body: CreateTurnRequest): Promise<CreateTurnResponse> {
    return request<CreateTurnResponse>(`/api/sessions/${sessionId}/turns`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getTurn(turnId: string): Promise<SessionTurnDetail> {
    return request<SessionTurnDetail>(`/api/session-turns/${turnId}`);
  },

  getCandidate(candidateId: string): Promise<CandidateSummary & { turn_id: string; session_id: string }> {
    return request(`/api/candidates/${candidateId}`);
  },

  getVersion(versionId: string): Promise<{ validation: unknown; content: unknown; ast: AstDocument | null }> {
    return request(`/api/candidate-versions/${versionId}`);
  },

  /** The server validates and appends; the browser cannot supply a verdict. */
  saveVersion(
    candidateId: string,
    body: { ast: AstDocument; note?: string },
  ): Promise<CandidateVersionSummary> {
    return request<CandidateVersionSummary>(`/api/candidates/${candidateId}/versions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getCurrentDataset(): Promise<DatasetCurrentResponse> {
    return request<DatasetCurrentResponse>("/api/dataset-versions/current");
  },

  createEvaluationRuns(sessionId: string, versionIds: string[]): Promise<CreateEvaluationRunsResponse> {
    return request<CreateEvaluationRunsResponse>(`/api/sessions/${sessionId}/evaluation-runs`, {
      method: "POST",
      body: JSON.stringify({ candidate_version_ids: versionIds }),
    });
  },

  getEvaluationRun(runId: string): Promise<EvaluationRunDetail> {
    return request<EvaluationRunDetail>(`/api/evaluation-runs/${runId}`);
  },

  getLatestEvaluationRun(versionId: string): Promise<LatestEvaluationRunResponse> {
    return request<LatestEvaluationRunResponse>(
      `/api/candidate-versions/${versionId}/evaluation-runs/latest`,
    );
  },

  getEvaluationRows(
    runId: string,
    query: { error_class?: RowFilterClass; sort?: string; limit?: number; cursor?: number } = {},
  ): Promise<EvaluationRowsResponse> {
    const params = new URLSearchParams();
    if (query.error_class) params.set("error_class", query.error_class);
    if (query.sort) params.set("sort", query.sort);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.cursor !== undefined) params.set("cursor", String(query.cursor));
    const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
    return request<EvaluationRowsResponse>(`/api/evaluation-runs/${runId}/rows${suffix}`);
  },

  getDecisions(versionId: string): Promise<{ decisions: ReviewDecision[] }> {
    return request(`/api/candidate-versions/${versionId}/decisions`);
  },

  createDecision(
    versionId: string,
    body: { decision: "accepted" | "rejected"; evaluation_run_id?: string; note?: string },
  ): Promise<ReviewDecision> {
    return request<ReviewDecision>(`/api/candidate-versions/${versionId}/decisions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
