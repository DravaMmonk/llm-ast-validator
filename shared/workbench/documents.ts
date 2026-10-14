/**
 * Workbench documents: the saved artefacts of the workstation.
 *
 * Every module persists through one document store on the local API — a
 * cohort definition, a Score Forge formula, a study design, a report item. A
 * document has a kind, a title, an optional dataset it belongs to, and a
 * payload whose shape the kind defines. Payloads holding formulas are validated
 * strictly (the expression kernel is the authority); the free-form kinds are
 * validated for shape and size so nothing unbounded reaches the database.
 */

import { type ExprNode, parseExprJson } from "./expr";

export type DocumentKind = "cohort" | "score" | "study" | "report_item";
export const DOCUMENT_KINDS: readonly DocumentKind[] = ["cohort", "score", "study", "report_item"];

export const DOCUMENT_TITLE_MAX_LENGTH = 160;
export const DOCUMENT_PAYLOAD_MAX_BYTES = 768 * 1024;
export const COHORT_MAX_STEPS = 40;
export const NOTE_MAX_LENGTH = 20_000;

export type DocumentStatus = "active" | "archived";

export interface WorkbenchDocument<P = unknown> {
  id: string;
  kind: DocumentKind;
  title: string;
  dataset_id: string | null;
  payload: P;
  position: number;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

/* ---- cohort ---- */

export type CohortStepKind = "include" | "exclude";
export type MissingPolicy = "drop" | "keep";

export interface CohortStep {
  id: string;
  label: string;
  kind: CohortStepKind;
  expr: ExprNode;
  /** What happens to a row whose criterion is missing (unknown). */
  on_missing: MissingPolicy;
  enabled: boolean;
}

export interface CohortPayload {
  steps: CohortStep[];
  notes: string;
}

/* ---- score ---- */

export interface ScorePayload {
  expr: ExprNode | null;
  /** Binary outcome column used to judge discrimination, when set. */
  outcome: string | null;
  /** Whether a higher score means higher risk. */
  direction: "higher" | "lower";
  /** Optional cohort restricting the rows the score is judged on. */
  cohort_id: string | null;
  /** The calculator this score started from, if any. */
  calculator_key: string | null;
  notes: string;
}

/* ---- study design & report: free-form but bounded ---- */

export type StudyPayload = Record<string, unknown>;

export interface ReportTable {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface ReportItemPayload {
  module: string;
  summary: string;
  table: ReportTable | null;
  chart: { type: string; data: unknown } | null;
  provenance: Record<string, string | number | null>;
  notes: string;
}

export class DocumentValidationError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DocumentValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, details?: unknown): never {
  throw new DocumentValidationError(message, details);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${where}.${key} is not a recognised field.`);
  }
}

function text(value: unknown, where: string, max: number, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") fail(`${where} must be text.`);
  if (value.length > max) fail(`${where} must be at most ${max} characters.`);
  return value;
}

function optionalId(value: unknown, where: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) fail(`${where} must be an id or null.`);
  return value;
}

function expr(value: unknown, where: string): ExprNode {
  const parsed = parseExprJson(value, where);
  if (!parsed.node) fail(parsed.diagnostics[0]?.message ?? `${where} is not a valid formula.`, parsed.diagnostics);
  return parsed.node;
}

export function validateTitle(value: unknown): string {
  if (typeof value !== "string") fail("Title must be text.");
  const title = value.trim();
  if (title === "") fail("Title must not be empty.");
  if (title.length > DOCUMENT_TITLE_MAX_LENGTH) fail(`Title must be at most ${DOCUMENT_TITLE_MAX_LENGTH} characters.`);
  return title;
}

export function validateCohortPayload(input: unknown): CohortPayload {
  if (!isRecord(input)) fail("A cohort payload must be an object.");
  onlyKeys(input, ["steps", "notes"], "payload");
  if (!Array.isArray(input.steps)) fail("payload.steps must be an array.");
  if (input.steps.length > COHORT_MAX_STEPS) fail(`A cohort may have at most ${COHORT_MAX_STEPS} steps.`);
  const ids = new Set<string>();
  const steps = input.steps.map((raw, index): CohortStep => {
    const where = `payload.steps[${index}]`;
    if (!isRecord(raw)) fail(`${where} must be an object.`);
    onlyKeys(raw, ["id", "label", "kind", "expr", "on_missing", "enabled"], where);
    if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id)) fail(`${where}.id must be a short identifier.`);
    if (ids.has(raw.id)) fail(`${where}.id is duplicated.`);
    ids.add(raw.id);
    if (raw.kind !== "include" && raw.kind !== "exclude") fail(`${where}.kind must be include or exclude.`);
    if (raw.on_missing !== undefined && raw.on_missing !== "drop" && raw.on_missing !== "keep") {
      fail(`${where}.on_missing must be drop or keep.`);
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") fail(`${where}.enabled must be true or false.`);
    return {
      id: raw.id,
      label: text(raw.label, `${where}.label`, 200),
      kind: raw.kind,
      expr: expr(raw.expr, `${where}.expr`),
      on_missing: (raw.on_missing as MissingPolicy | undefined) ?? "drop",
      enabled: (raw.enabled as boolean | undefined) ?? true,
    };
  });
  return { steps, notes: text(input.notes, "payload.notes", NOTE_MAX_LENGTH) };
}

export function validateScorePayload(input: unknown): ScorePayload {
  if (!isRecord(input)) fail("A score payload must be an object.");
  onlyKeys(input, ["expr", "outcome", "direction", "cohort_id", "calculator_key", "notes"], "payload");
  if (input.direction !== undefined && input.direction !== "higher" && input.direction !== "lower") {
    fail("payload.direction must be higher or lower.");
  }
  return {
    expr: input.expr === null || input.expr === undefined ? null : expr(input.expr, "payload.expr"),
    outcome: input.outcome === null || input.outcome === undefined ? null : text(input.outcome, "payload.outcome", 128),
    direction: (input.direction as "higher" | "lower" | undefined) ?? "higher",
    cohort_id: optionalId(input.cohort_id, "payload.cohort_id"),
    calculator_key: input.calculator_key == null ? null : text(input.calculator_key, "payload.calculator_key", 80),
    notes: text(input.notes, "payload.notes", NOTE_MAX_LENGTH),
  };
}

/** Plain JSON only, bounded in depth — for the free-form kinds. */
function assertPlainJson(value: unknown, where: string, depth = 0): void {
  if (depth > 12) fail(`${where} nests too deeply.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${where} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlainJson(entry, `${where}[${index}]`, depth + 1));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) assertPlainJson(entry, `${where}.${key}`, depth + 1);
    return;
  }
  fail(`${where} contains an unsupported value.`);
}

export function validateStudyPayload(input: unknown): StudyPayload {
  if (!isRecord(input)) fail("A study payload must be an object.");
  assertPlainJson(input, "payload");
  return input;
}

export function validateReportItemPayload(input: unknown): ReportItemPayload {
  if (!isRecord(input)) fail("A report item payload must be an object.");
  onlyKeys(input, ["module", "summary", "table", "chart", "provenance", "notes"], "payload");
  let table: ReportTable | null = null;
  if (input.table !== undefined && input.table !== null) {
    const raw = input.table;
    if (!isRecord(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
      fail("payload.table must have columns and rows arrays.");
    }
    if (raw.columns.length > 60 || raw.rows.length > 2_000) fail("payload.table is too large for a report item.");
    const columns = raw.columns.map((column, index) => text(column, `payload.table.columns[${index}]`, 200));
    const rows = raw.rows.map((row, r) => {
      if (!Array.isArray(row)) fail(`payload.table.rows[${r}] must be an array.`);
      return row.map((cell, c) => {
        if (cell === null || typeof cell === "number" || typeof cell === "string") {
          if (typeof cell === "number" && !Number.isFinite(cell)) fail(`payload.table.rows[${r}][${c}] is not finite.`);
          if (typeof cell === "string" && cell.length > 2_000) fail(`payload.table.rows[${r}][${c}] is too long.`);
          return cell;
        }
        return fail(`payload.table.rows[${r}][${c}] must be text, a number, or null.`);
      });
    });
    table = { columns, rows };
  }
  let chart: ReportItemPayload["chart"] = null;
  if (input.chart !== undefined && input.chart !== null) {
    if (!isRecord(input.chart) || typeof input.chart.type !== "string") fail("payload.chart must have a type.");
    assertPlainJson(input.chart.data, "payload.chart.data");
    chart = { type: text(input.chart.type, "payload.chart.type", 40), data: input.chart.data };
  }
  const provenance: Record<string, string | number | null> = {};
  if (input.provenance !== undefined && input.provenance !== null) {
    if (!isRecord(input.provenance)) fail("payload.provenance must be an object.");
    for (const [key, value] of Object.entries(input.provenance)) {
      if (value !== null && typeof value !== "string" && typeof value !== "number") {
        fail(`payload.provenance.${key} must be text, a number, or null.`);
      }
      provenance[key.slice(0, 60)] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  return {
    module: text(input.module, "payload.module", 60, "workbench"),
    summary: text(input.summary, "payload.summary", NOTE_MAX_LENGTH),
    table,
    chart,
    provenance,
    notes: text(input.notes, "payload.notes", NOTE_MAX_LENGTH),
  };
}

export function validatePayload(kind: DocumentKind, input: unknown): unknown {
  switch (kind) {
    case "cohort":
      return validateCohortPayload(input);
    case "score":
      return validateScorePayload(input);
    case "study":
      return validateStudyPayload(input);
    case "report_item":
      return validateReportItemPayload(input);
  }
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}
