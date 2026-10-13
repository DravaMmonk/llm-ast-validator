/** HTTP contracts of the workstation API (`/api/workbench/*`). */

import type { ColumnPatch, DatasetStatus, DatasetSummary, DerivedColumn } from "./dataset";
import type { DocumentKind, DocumentStatus, WorkbenchDocument } from "./documents";
import type { SampleDefinition } from "./samples";

/**
 * Upload bodies carry the whole delimited file as JSON-escaped text; escaping
 * (tabs, quotes) can nearly double it, so the body cap leaves room above the
 * 30 MB file limit that the parser enforces with a clear message.
 */
export const DATASET_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** Patch bodies carry metadata and formulas only. */
export const DATASET_PATCH_MAX_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_BODY_MAX_BYTES = 1024 * 1024;

export interface DatasetListResponse {
  datasets: DatasetSummary[];
}

export interface SampleListResponse {
  samples: SampleDefinition[];
}

export interface CreateDatasetRequest {
  name: string;
  description?: string;
  csv_text: string;
  delimiter?: string;
}

export interface CreateDatasetResponse {
  dataset: DatasetSummary;
  warnings: string[];
}

export interface CreateSampleRequest {
  sample_key: string;
}

export interface PatchDatasetRequest {
  name?: string;
  description?: string;
  status?: DatasetStatus;
  columns?: ColumnPatch[];
  derived?: DerivedColumn[];
}

export interface PatchDatasetResponse {
  dataset: DatasetSummary;
  /** Present values that became missing in a numeric conversion, per column. */
  conversion_losses: Record<string, number>;
  /** Values rewritten by a case merge, per column. */
  case_merges: Record<string, number>;
}

export interface DocumentListResponse<P = unknown> {
  documents: WorkbenchDocument<P>[];
}

export interface CreateDocumentRequest<P = unknown> {
  kind: DocumentKind;
  title: string;
  dataset_id?: string | null;
  payload: P;
  position?: number;
}

export interface PatchDocumentRequest<P = unknown> {
  title?: string;
  payload?: P;
  position?: number;
  status?: DocumentStatus;
  dataset_id?: string | null;
}
