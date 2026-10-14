import type {
  DatasetDetail,
  DatasetSource,
  DatasetStatus,
  DatasetSummary,
  DerivedColumn,
  StoredColumn,
} from "../../../shared/workbench/dataset";
import type { DocumentKind, DocumentStatus, WorkbenchDocument } from "../../../shared/workbench/documents";
import type { AppDatabase } from "../connection";

interface DatasetRow {
  id: string;
  name: string;
  description: string;
  source: DatasetSource;
  sample_key: string | null;
  row_count: number;
  column_count: number;
  content_hash: string;
  derived_count: number;
  status: DatasetStatus;
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = `id, name, description, source, sample_key, row_count, column_count, content_hash,
  json_array_length(derived_json) AS derived_count, status, created_at, updated_at`;

export function insertDataset(
  database: AppDatabase,
  input: {
    id: string;
    name: string;
    description: string;
    source: DatasetSource;
    sample_key: string | null;
    row_count: number;
    content_hash: string;
    columns: StoredColumn[];
    now: string;
  },
): DatasetSummary {
  database
    .prepare(
      `INSERT INTO wb_datasets (id, name, description, source, sample_key, row_count, column_count, content_hash,
         columns_json, derived_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?)`,
    )
    .run(
      input.id,
      input.name,
      input.description,
      input.source,
      input.sample_key,
      input.row_count,
      input.columns.length,
      input.content_hash,
      JSON.stringify(input.columns),
      input.now,
      input.now,
    );
  return findDatasetSummary(database, input.id)!;
}

export function findDatasetSummary(database: AppDatabase, id: string): DatasetSummary | undefined {
  return database.prepare<[string], DatasetRow>(`SELECT ${SUMMARY_COLUMNS} FROM wb_datasets WHERE id = ?`).get(id);
}

/** The active copy of a built-in sample or catalogue dataset, if one was already added. */
export function findActiveByKey(database: AppDatabase, source: "sample" | "public", key: string): DatasetSummary | undefined {
  return database
    .prepare<[string, string], DatasetRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM wb_datasets WHERE source = ? AND sample_key = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(source, key);
}

export function findDatasetDetail(database: AppDatabase, id: string): DatasetDetail | undefined {
  const row = database
    .prepare<[string], DatasetRow & { columns_json: string; derived_json: string }>(
      `SELECT ${SUMMARY_COLUMNS}, columns_json, derived_json FROM wb_datasets WHERE id = ?`,
    )
    .get(id);
  if (!row) return undefined;
  const { columns_json, derived_json, ...summary } = row;
  return {
    ...summary,
    columns: JSON.parse(columns_json) as StoredColumn[],
    derived: JSON.parse(derived_json) as DerivedColumn[],
  };
}

export function listDatasets(database: AppDatabase, status: DatasetStatus): DatasetSummary[] {
  return database
    .prepare<[DatasetStatus], DatasetRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM wb_datasets WHERE status = ? ORDER BY updated_at DESC, created_at DESC, id DESC`,
    )
    .all(status);
}

export function updateDataset(
  database: AppDatabase,
  id: string,
  patch: {
    name?: string;
    description?: string;
    status?: DatasetStatus;
    columns?: StoredColumn[];
    content_hash?: string;
    derived?: DerivedColumn[];
    now: string;
  },
): DatasetSummary | undefined {
  const sets: string[] = ["updated_at = @now"];
  const params: Record<string, unknown> = { id, now: patch.now };
  if (patch.name !== undefined) {
    sets.push("name = @name");
    params.name = patch.name;
  }
  if (patch.description !== undefined) {
    sets.push("description = @description");
    params.description = patch.description;
  }
  if (patch.status !== undefined) {
    sets.push("status = @status");
    params.status = patch.status;
  }
  if (patch.columns !== undefined) {
    sets.push("columns_json = @columns", "column_count = @column_count");
    params.columns = JSON.stringify(patch.columns);
    params.column_count = patch.columns.length;
  }
  if (patch.content_hash !== undefined) {
    sets.push("content_hash = @content_hash");
    params.content_hash = patch.content_hash;
  }
  if (patch.derived !== undefined) {
    sets.push("derived_json = @derived");
    params.derived = JSON.stringify(patch.derived);
  }
  const result = database.prepare(`UPDATE wb_datasets SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return result.changes === 0 ? undefined : findDatasetSummary(database, id);
}

/* ---- documents ---- */

interface DocumentRow {
  id: string;
  kind: DocumentKind;
  title: string;
  dataset_id: string | null;
  payload_json: string;
  position: number;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

const DOCUMENT_COLUMNS = `id, kind, title, dataset_id, payload_json, position, status, created_at, updated_at`;

function toDocument(row: DocumentRow): WorkbenchDocument {
  const { payload_json, ...rest } = row;
  return { ...rest, payload: JSON.parse(payload_json) as unknown };
}

export function insertDocument(
  database: AppDatabase,
  input: {
    id: string;
    kind: DocumentKind;
    title: string;
    dataset_id: string | null;
    payload: unknown;
    position: number | null;
    now: string;
  },
): WorkbenchDocument {
  // New documents append to the end of their kind unless placed explicitly.
  const position =
    input.position ??
    (database
      .prepare<[DocumentKind], { next: number }>(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM wb_documents WHERE kind = ?`,
      )
      .get(input.kind)?.next ??
      1);
  database
    .prepare(
      `INSERT INTO wb_documents (id, kind, title, dataset_id, payload_json, position, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(input.id, input.kind, input.title, input.dataset_id, JSON.stringify(input.payload), position, input.now, input.now);
  return findDocument(database, input.id)!;
}

export function findDocument(database: AppDatabase, id: string): WorkbenchDocument | undefined {
  const row = database.prepare<[string], DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM wb_documents WHERE id = ?`).get(id);
  return row ? toDocument(row) : undefined;
}

export function listDocuments(
  database: AppDatabase,
  filter: { kind: DocumentKind; status: DocumentStatus; dataset_id?: string },
): WorkbenchDocument[] {
  const rows =
    filter.dataset_id === undefined
      ? database
          .prepare<[DocumentKind, DocumentStatus], DocumentRow>(
            `SELECT ${DOCUMENT_COLUMNS} FROM wb_documents WHERE kind = ? AND status = ?
             ORDER BY position ASC, created_at ASC, id ASC`,
          )
          .all(filter.kind, filter.status)
      : database
          .prepare<[DocumentKind, DocumentStatus, string], DocumentRow>(
            `SELECT ${DOCUMENT_COLUMNS} FROM wb_documents WHERE kind = ? AND status = ? AND dataset_id = ?
             ORDER BY position ASC, created_at ASC, id ASC`,
          )
          .all(filter.kind, filter.status, filter.dataset_id);
  return rows.map(toDocument);
}

export function updateDocument(
  database: AppDatabase,
  id: string,
  patch: { title?: string; payload?: unknown; position?: number; status?: DocumentStatus; dataset_id?: string | null; now: string },
): WorkbenchDocument | undefined {
  const sets: string[] = ["updated_at = @now"];
  const params: Record<string, unknown> = { id, now: patch.now };
  if (patch.title !== undefined) {
    sets.push("title = @title");
    params.title = patch.title;
  }
  if (patch.payload !== undefined) {
    sets.push("payload_json = @payload");
    params.payload = JSON.stringify(patch.payload);
  }
  if (patch.position !== undefined) {
    sets.push("position = @position");
    params.position = patch.position;
  }
  if (patch.status !== undefined) {
    sets.push("status = @status");
    params.status = patch.status;
  }
  if (patch.dataset_id !== undefined) {
    sets.push("dataset_id = @dataset_id");
    params.dataset_id = patch.dataset_id;
  }
  const result = database.prepare(`UPDATE wb_documents SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return result.changes === 0 ? undefined : findDocument(database, id);
}
