/**
 * Typed client for the workstation API. Like `src/api/client.ts`, the browser
 * holds no business state of its own: datasets and saved documents live
 * behind the local API, and every write is validated there.
 */

import { ApiError } from "../api/client";
import type { DatasetDetail, DatasetStatus } from "../../shared/workbench/dataset";
import type { DocumentKind, DocumentStatus, WorkbenchDocument } from "../../shared/workbench/documents";
import type {
  CreateDatasetRequest,
  CreateDatasetResponse,
  CreateDocumentRequest,
  DatasetListResponse,
  DocumentListResponse,
  PatchDatasetRequest,
  PatchDatasetResponse,
  PatchDocumentRequest,
  SampleListResponse,
} from "../../shared/workbench/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "The local API is unreachable. Start it with `make up`.");
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

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const wbApi = {
  listSamples: () => request<SampleListResponse>("/api/workbench/samples"),
  listDatasets: (status: DatasetStatus = "active") =>
    request<DatasetListResponse>(`/api/workbench/datasets?status=${status}`),
  getDataset: (id: string) => request<DatasetDetail>(`/api/workbench/datasets/${encodeURIComponent(id)}`),
  createDataset: (body: CreateDatasetRequest) =>
    request<CreateDatasetResponse>("/api/workbench/datasets", json("POST", body)),
  createSample: (sampleKey: string) =>
    request<CreateDatasetResponse>("/api/workbench/datasets/samples", json("POST", { sample_key: sampleKey })),
  patchDataset: (id: string, body: PatchDatasetRequest) =>
    request<PatchDatasetResponse>(`/api/workbench/datasets/${encodeURIComponent(id)}`, json("PATCH", body)),

  listDocuments: <P,>(kind: DocumentKind, options: { datasetId?: string | null; status?: DocumentStatus } = {}) => {
    const params = new URLSearchParams({ kind, status: options.status ?? "active" });
    if (options.datasetId) params.set("dataset_id", options.datasetId);
    return request<DocumentListResponse<P>>(`/api/workbench/documents?${params.toString()}`);
  },
  getDocument: <P,>(id: string) => request<WorkbenchDocument<P>>(`/api/workbench/documents/${encodeURIComponent(id)}`),
  createDocument: <P,>(body: CreateDocumentRequest<P>) =>
    request<WorkbenchDocument<P>>("/api/workbench/documents", json("POST", body)),
  patchDocument: <P,>(id: string, body: PatchDocumentRequest<P>) =>
    request<WorkbenchDocument<P>>(`/api/workbench/documents/${encodeURIComponent(id)}`, json("PATCH", body)),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
