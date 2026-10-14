/**
 * Workstation API: datasets and saved documents.
 *
 * The server is the validation authority here too. An upload is parsed and
 * typed by the same shared module the browser previews with; formulas in
 * derived columns and documents pass the expression kernel before they are
 * stored. Nothing is ever hard-deleted: datasets and documents are archived
 * and can be restored.
 */

import { randomUUID } from "node:crypto";

import { Hono } from "hono";

import {
  type ColumnPatch,
  DATASET_DESCRIPTION_MAX_LENGTH,
  DatasetError,
  type DatasetStatus,
  type StoredColumn,
  convertColumnKind,
  mergeCaseVariants,
  hashColumns,
  parseDelimitedText,
  validateColumnPatches,
  validateDatasetName,
  validateDerived,
} from "../../shared/workbench/dataset";
import {
  DOCUMENT_PAYLOAD_MAX_BYTES,
  DocumentValidationError,
  type DocumentStatus,
  isDocumentKind,
  validatePayload,
  validateTitle,
} from "../../shared/workbench/documents";
import {
  DATASET_PATCH_MAX_BYTES,
  DATASET_UPLOAD_MAX_BYTES,
  DOCUMENT_BODY_MAX_BYTES,
  type CreateDatasetResponse,
  type DatasetListResponse,
  type DocumentListResponse,
  type PatchDatasetResponse,
  type SampleListResponse,
} from "../../shared/workbench/contracts";
import { PUBLIC_DATASETS, type PublicDataset } from "../../shared/workbench/publicDatasets";
import { PublicContractError, publicDatasetDescription } from "../../shared/workbench/publicImport";
import { SAMPLE_DATASETS, findSample, generateSample } from "../../shared/workbench/samples";
import { PublicSourceError, type SourceFetcher, downloadPublicDataset, fetchSource } from "../publicSource";
import type { AppDatabase } from "../db/connection";
import {
  findActiveByKey,
  findDatasetDetail,
  findDatasetSummary,
  findDocument,
  insertDataset,
  insertDocument,
  listDatasets,
  listDocuments,
  updateDataset,
  updateDocument,
} from "../db/stores/workbench";
import { ApiFailure, readJsonObject, rejectUnknownFields, validationFailed } from "../http";

const STATUSES = ["active", "archived"] as const;

function readStatusFilter(value: string | undefined): "active" | "archived" {
  const status = value ?? "active";
  if (!(STATUSES as readonly string[]).includes(status)) throw validationFailed("Status must be active or archived.");
  return status as "active" | "archived";
}

function datasetNotFound(id: string): ApiFailure {
  return new ApiFailure(404, "DATASET_NOT_FOUND", `Dataset “${id}” does not exist.`);
}

function documentNotFound(id: string): ApiFailure {
  return new ApiFailure(404, "DOCUMENT_NOT_FOUND", `Document “${id}” does not exist.`);
}

/** Maps shared validation errors onto the API envelope. */
function translate<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DatasetError) {
      const status = error.code === "DATASET_TOO_LARGE" || error.code === "DATASET_TOO_LONG" || error.code === "DATASET_TOO_WIDE" ? 413 : 422;
      throw new ApiFailure(status, error.code, error.message, error.details);
    }
    if (error instanceof DocumentValidationError) {
      throw new ApiFailure(422, "INVALID_PAYLOAD", error.message, error.details);
    }
    throw error;
  }
}

function readDescription(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw validationFailed("Description must be text.");
  if (value.length > DATASET_DESCRIPTION_MAX_LENGTH) {
    throw validationFailed(`Description must be at most ${DATASET_DESCRIPTION_MAX_LENGTH} characters.`);
  }
  return value.trim();
}

export interface WorkbenchRouteOptions {
  /** Downloads catalogue sources; tests substitute a stub. */
  fetchSource?: SourceFetcher;
  /** The public catalogue; tests substitute synthetic entries. */
  publicCatalog?: readonly PublicDataset[];
}

export function createWorkbenchRoutes(database: AppDatabase, options: WorkbenchRouteOptions = {}): Hono {
  const routes = new Hono();
  const fetcher = options.fetchSource ?? fetchSource;
  const catalog = options.publicCatalog ?? PUBLIC_DATASETS;
  // One download per catalogue key at a time, so a double click cannot add it twice.
  const publicImports = new Map<string, Promise<{ status: 200 | 201; body: CreateDatasetResponse }>>();

  /* ---------------- samples ---------------- */

  routes.get("/samples", (context) => {
    const body: SampleListResponse = { samples: [...SAMPLE_DATASETS] };
    return context.json(body);
  });

  /* ---------------- datasets ---------------- */

  routes.get("/datasets", (context) => {
    const body: DatasetListResponse = { datasets: listDatasets(database, readStatusFilter(context.req.query("status"))) };
    return context.json(body);
  });

  routes.post("/datasets", async (context) => {
    const body = await readJsonObject(context, DATASET_UPLOAD_MAX_BYTES);
    rejectUnknownFields(body, ["name", "description", "csv_text", "delimiter"]);
    const name = translate(() => validateDatasetName(body.name));
    const description = readDescription(body.description);
    if (typeof body.csv_text !== "string") throw validationFailed("csv_text must be the file contents as text.");
    if (body.delimiter !== undefined && (typeof body.delimiter !== "string" || ![",", ";", "\t", "|"].includes(body.delimiter))) {
      throw validationFailed("delimiter must be one of , ; tab |.");
    }
    const parsed = translate(() => parseDelimitedText(body.csv_text as string, { delimiter: body.delimiter as string | undefined }));
    const dataset = insertDataset(database, {
      id: randomUUID(),
      name,
      description,
      source: "upload",
      sample_key: null,
      row_count: parsed.rowCount,
      content_hash: hashColumns(parsed.columns),
      columns: parsed.columns,
      now: new Date().toISOString(),
    });
    const response: CreateDatasetResponse = { dataset, warnings: parsed.warnings };
    return context.json(response, 201);
  });

  routes.post("/datasets/samples", async (context) => {
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["sample_key"]);
    const key = body.sample_key;
    const sample = typeof key === "string" ? findSample(key) : undefined;
    if (!sample) throw new ApiFailure(404, "SAMPLE_NOT_FOUND", `There is no built-in sample “${String(key)}”.`);
    // A sample is reproducible, so a second request reuses the active copy.
    const existing = findActiveByKey(database, "sample", sample.key);
    if (existing) {
      const response: CreateDatasetResponse = { dataset: existing, warnings: [] };
      return context.json(response, 200);
    }
    const columns = generateSample(sample.key)!;
    const dataset = insertDataset(database, {
      id: randomUUID(),
      name: sample.name,
      description: sample.description,
      source: "sample",
      sample_key: sample.key,
      row_count: columns[0]?.values.length ?? 0,
      content_hash: hashColumns(columns),
      columns,
      now: new Date().toISOString(),
    });
    const response: CreateDatasetResponse = { dataset, warnings: [] };
    return context.json(response, 201);
  });

  routes.post("/datasets/public", async (context) => {
    const body = await readJsonObject(context);
    rejectUnknownFields(body, ["key"]);
    const entry = typeof body.key === "string" ? catalog.find((candidate) => candidate.key === body.key) : undefined;
    if (!entry) throw new ApiFailure(404, "PUBLIC_DATASET_NOT_FOUND", `There is no public dataset “${String(body.key)}” in the catalogue.`);

    let pending = publicImports.get(entry.key);
    if (!pending) {
      pending = importPublic(entry).finally(() => publicImports.delete(entry.key));
      publicImports.set(entry.key, pending);
    }
    const result = await pending;
    return context.json(result.body, result.status);
  });

  async function importPublic(entry: PublicDataset): Promise<{ status: 200 | 201; body: CreateDatasetResponse }> {
    // Added before and still active: reuse it rather than download again.
    const existing = findActiveByKey(database, "public", entry.key);
    if (existing) return { status: 200, body: { dataset: existing, warnings: [] } };
    let downloaded: Awaited<ReturnType<typeof downloadPublicDataset>>;
    try {
      downloaded = await downloadPublicDataset(entry, fetcher);
    } catch (error) {
      if (error instanceof PublicSourceError) throw new ApiFailure(502, error.code, error.message);
      if (error instanceof PublicContractError) {
        throw new ApiFailure(502, "PUBLIC_CONTRACT_FAILED", `${error.message} The source format has changed, so nothing was imported.`);
      }
      throw error;
    }
    const dataset = insertDataset(database, {
      id: randomUUID(),
      name: entry.name,
      description: publicDatasetDescription(entry),
      source: "public",
      sample_key: entry.key,
      row_count: downloaded.rowCount,
      content_hash: hashColumns(downloaded.columns),
      columns: downloaded.columns,
      now: new Date().toISOString(),
    });
    return { status: 201, body: { dataset, warnings: [] } };
  }

  routes.get("/datasets/:id", (context) => {
    const id = context.req.param("id");
    const detail = findDatasetDetail(database, id);
    if (!detail) throw datasetNotFound(id);
    return context.json(detail);
  });

  routes.patch("/datasets/:id", async (context) => {
    const id = context.req.param("id");
    const body = await readJsonObject(context, DATASET_PATCH_MAX_BYTES);
    rejectUnknownFields(body, ["name", "description", "status", "columns", "derived"]);
    const detail = findDatasetDetail(database, id);
    if (!detail) throw datasetNotFound(id);

    const name = "name" in body ? translate(() => validateDatasetName(body.name)) : undefined;
    const description = "description" in body ? readDescription(body.description) : undefined;
    let status: DatasetStatus | undefined;
    if ("status" in body) {
      if (!(STATUSES as readonly unknown[]).includes(body.status)) throw validationFailed("Status must be active or archived.");
      status = body.status as DatasetStatus;
    }

    let columns: StoredColumn[] | undefined;
    let contentHash: string | undefined;
    const losses: Record<string, number> = {};
    const caseMerges: Record<string, number> = {};
    if ("columns" in body) {
      const patches = translate(() => validateColumnPatches(body.columns, detail.columns));
      const byName = new Map<string, ColumnPatch>(patches.map((patch) => [patch.name, patch]));
      let valuesChanged = false;
      columns = detail.columns.map((column) => {
        const patch = byName.get(column.name);
        if (!patch) return column;
        let next: StoredColumn = {
          ...column,
          label: patch.label ?? column.label,
          unit: patch.unit ?? column.unit,
          role: patch.role ?? column.role,
          description: patch.description ?? column.description,
        };
        if (patch.kind && patch.kind !== column.kind) {
          const converted = convertColumnKind(next, patch.kind);
          next = converted.column;
          if (converted.lost > 0) losses[column.name] = converted.lost;
          valuesChanged = true;
        }
        if (patch.merge_case) {
          const merged = mergeCaseVariants(next);
          next = merged.column;
          if (merged.changed > 0) {
            caseMerges[column.name] = merged.changed;
            valuesChanged = true;
          }
        }
        return next;
      });
      if (valuesChanged) contentHash = hashColumns(columns);
    }

    // Derived formulas are re-validated against the (possibly converted)
    // columns. When only a kind changes, stored formulas are kept; one that no
    // longer type-checks is surfaced by the browser frame, not silently dropped.
    const effectiveColumns = columns ?? detail.columns;
    const derived = "derived" in body ? translate(() => validateDerived(body.derived, effectiveColumns, detail.derived)) : undefined;

    const summary = updateDataset(database, id, {
      name,
      description,
      status,
      columns,
      content_hash: contentHash,
      derived,
      now: new Date().toISOString(),
    })!;
    const response: PatchDatasetResponse = { dataset: summary, conversion_losses: losses, case_merges: caseMerges };
    return context.json(response);
  });

  /* ---------------- documents ---------------- */

  routes.get("/documents", (context) => {
    const kind = context.req.query("kind");
    if (!isDocumentKind(kind)) throw validationFailed("kind must be cohort, score, study, or report_item.");
    const datasetId = context.req.query("dataset_id");
    const body: DocumentListResponse = {
      documents: listDocuments(database, {
        kind,
        status: readStatusFilter(context.req.query("status")),
        dataset_id: datasetId === undefined || datasetId === "" ? undefined : datasetId,
      }),
    };
    return context.json(body);
  });

  const readPosition = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw validationFailed("position must be a finite number.");
    return value;
  };

  const readDatasetRef = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const summary = typeof value === "string" ? findDatasetSummary(database, value) : undefined;
    if (!summary) throw datasetNotFound(String(value));
    if (summary.status !== "active") {
      throw new ApiFailure(409, "DATASET_ARCHIVED", "This dataset is archived; restore it before attaching new work to it.");
    }
    return summary.id;
  };

  const boundedPayload = (kind: Parameters<typeof validatePayload>[0], payload: unknown) => {
    const validated = translate(() => validatePayload(kind, payload));
    if (Buffer.byteLength(JSON.stringify(validated), "utf8") > DOCUMENT_PAYLOAD_MAX_BYTES) {
      throw new ApiFailure(413, "PAYLOAD_TOO_LARGE", "The document is too large to store.");
    }
    return validated;
  };

  routes.post("/documents", async (context) => {
    const body = await readJsonObject(context, DOCUMENT_BODY_MAX_BYTES);
    rejectUnknownFields(body, ["kind", "title", "dataset_id", "payload", "position"]);
    if (!isDocumentKind(body.kind)) throw validationFailed("kind must be cohort, score, study, or report_item.");
    const kind = body.kind;
    const title = translate(() => validateTitle(body.title));
    const datasetId = readDatasetRef(body.dataset_id);
    if ((kind === "cohort" || kind === "score") && datasetId === null) {
      throw validationFailed(`A ${kind} must belong to a dataset.`);
    }
    const payload = boundedPayload(kind, body.payload);
    const document = insertDocument(database, {
      id: randomUUID(),
      kind,
      title,
      dataset_id: datasetId,
      payload,
      position: body.position === undefined ? null : readPosition(body.position),
      now: new Date().toISOString(),
    });
    return context.json(document, 201);
  });

  routes.get("/documents/:id", (context) => {
    const id = context.req.param("id");
    const document = findDocument(database, id);
    if (!document) throw documentNotFound(id);
    return context.json(document);
  });

  routes.patch("/documents/:id", async (context) => {
    const id = context.req.param("id");
    const body = await readJsonObject(context, DOCUMENT_BODY_MAX_BYTES);
    rejectUnknownFields(body, ["title", "payload", "position", "status", "dataset_id"]);
    const existing = findDocument(database, id);
    if (!existing) throw documentNotFound(id);
    let status: DocumentStatus | undefined;
    if ("status" in body) {
      if (!(STATUSES as readonly unknown[]).includes(body.status)) throw validationFailed("Status must be active or archived.");
      status = body.status as DocumentStatus;
    }
    let datasetId: string | null | undefined;
    if ("dataset_id" in body) {
      // A cohort or score is written against one dataset's columns; moving it would
      // silently re-point its formulas, so only free-form documents may move.
      if ((existing.kind === "cohort" || existing.kind === "score") && body.dataset_id !== existing.dataset_id) {
        throw validationFailed(`A ${existing.kind} cannot be moved to another dataset; duplicate it there instead.`);
      }
      datasetId = body.dataset_id === existing.dataset_id ? existing.dataset_id : readDatasetRef(body.dataset_id);
    }
    const document = updateDocument(database, id, {
      title: "title" in body ? translate(() => validateTitle(body.title)) : undefined,
      payload: "payload" in body ? boundedPayload(existing.kind, body.payload) : undefined,
      position: "position" in body ? readPosition(body.position) : undefined,
      status,
      dataset_id: datasetId,
      now: new Date().toISOString(),
    })!;
    return context.json(document);
  });

  return routes;
}
