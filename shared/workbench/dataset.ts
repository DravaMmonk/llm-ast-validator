/**
 * The workbench dataset contract, shared by the browser and the local API.
 *
 * A dataset is stored column-wise: each column has a kind (numeric or
 * categorical), descriptive metadata (label, unit, analysis role), and its
 * values with `null` for missing. Derived columns are stored as *formulas*,
 * never as baked values, so every derived variable stays reproducible and
 * auditable: the browser recomputes them from the source columns on load.
 *
 * This module is pure and must stay free of React, Blockly, and SQLite.
 */

import Papa from "papaparse";

import { canonicalHash } from "../ast/canonical";
import {
  type ExprDiagnostic,
  type ExprNode,
  type Value,
  type ValueType,
  checkExpr,
  evaluateColumn,
  hashExpr,
  isValidColumnName,
  parseExprJson,
} from "./expr";

export const DATASET_NAME_MAX_LENGTH = 120;
export const DATASET_DESCRIPTION_MAX_LENGTH = 2_000;
export const DATASET_MAX_ROWS = 100_000;
export const DATASET_MAX_COLUMNS = 300;
export const DATASET_MAX_CELLS = 3_000_000;
export const DATASET_TEXT_MAX_BYTES = 30 * 1024 * 1024;
export const CATEGORY_VALUE_MAX_LENGTH = 200;
export const DERIVED_MAX_COLUMNS = 100;
export const META_TEXT_MAX_LENGTH = 200;

/** Tokens that mean "no value" in exported research data. Case-insensitive. */
export const MISSING_TOKENS = ["", "na", "n/a", "nan", "null", "none", ".", "-", "?", "missing", "#n/a", "nr"];
const MISSING = new Set(MISSING_TOKENS);

export type ColumnKind = "numeric" | "categorical" | "boolean";
/** Source and derived columns share one set of kinds. */
export type FrameKind = ColumnKind;
export const COLUMN_KINDS: readonly ColumnKind[] = ["numeric", "categorical", "boolean"];

/*
 * Yes/no spellings, case-insensitive. Word pairs may appear alone (a column of
 * only "Yes" is still yes/no); single letters must show both halves, so a
 * column holding only "F" (female) is never read as false.
 */
const BOOLEAN_PAIRS: { yes: string; no: string; letters: boolean }[] = [
  { yes: "yes", no: "no", letters: false },
  { yes: "true", no: "false", letters: false },
  { yes: "y", no: "n", letters: true },
  { yes: "t", no: "f", letters: true },
];
const YES_TOKENS = new Set(["yes", "y", "true", "t", "1"]);
const NO_TOKENS = new Set(["no", "n", "false", "f", "0"]);

/** Reads one yes/no spelling (also 1/0); anything else is null. */
export function parseBooleanToken(raw: string): boolean | null {
  const token = raw.trim().toLowerCase();
  if (YES_TOKENS.has(token)) return true;
  if (NO_TOKENS.has(token)) return false;
  return null;
}

export type ColumnRole = "none" | "id" | "outcome" | "time" | "event" | "group" | "exposure";
export const COLUMN_ROLES: { v: ColumnRole; label: string; hint: string }[] = [
  { v: "none", label: "Variable", hint: "An ordinary analysis variable." },
  { v: "outcome", label: "Outcome", hint: "The primary binary or numeric outcome." },
  { v: "exposure", label: "Exposure", hint: "The main exposure or treatment of interest." },
  { v: "group", label: "Group", hint: "A grouping / stratification variable." },
  { v: "time", label: "Time", hint: "Follow-up time for survival analysis." },
  { v: "event", label: "Event", hint: "Event indicator (1 = event, 0 = censored)." },
  { v: "id", label: "Identifier", hint: "A row identifier; excluded from analyses." },
];

export interface ColumnMeta {
  name: string;
  kind: ColumnKind;
  label: string;
  unit: string;
  role: ColumnRole;
  description: string;
}

export interface StoredColumn extends ColumnMeta {
  values: (number | null)[] | (string | null)[] | (boolean | null)[];
}

export interface DerivedColumn {
  name: string;
  expr: ExprNode;
  label: string;
  unit: string;
  role: ColumnRole;
  description: string;
}

export type DatasetSource = "upload" | "sample" | "public";
export type DatasetStatus = "active" | "archived";

export interface DatasetSummary {
  id: string;
  name: string;
  description: string;
  source: DatasetSource;
  sample_key: string | null;
  row_count: number;
  column_count: number;
  derived_count: number;
  content_hash: string;
  status: DatasetStatus;
  created_at: string;
  updated_at: string;
}

export interface DatasetDetail extends DatasetSummary {
  columns: StoredColumn[];
  derived: DerivedColumn[];
}

export function kindValueType(kind: FrameKind): ValueType {
  return kind === "numeric" ? "number" : kind === "categorical" ? "text" : "boolean";
}

export function valueTypeKind(type: ValueType): FrameKind {
  return type === "number" ? "numeric" : type === "text" ? "categorical" : "boolean";
}

export class DatasetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DatasetError";
  }
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function count(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}

export function isMissingToken(raw: string): boolean {
  return MISSING.has(raw.trim().toLowerCase());
}

export function parseNumberToken(raw: string, decimalComma = false): number | null {
  // European exports use “70,5” for 70.5 when the field delimiter is not a comma.
  const text = decimalComma && /^[+-]?\d+,\d+$/.test(raw.trim()) ? raw.trim().replace(",", ".") : raw.trim();
  if (!NUMBER_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export interface CsvImportResult {
  columns: StoredColumn[];
  rowCount: number;
  delimiter: string;
  warnings: string[];
}

/** Makes header names unique, non-empty, and printable. */
export function cleanHeaders(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((header, index) => {
    let name = header.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (name === "") name = `column_${index + 1}`;
    if (name.length > 100) name = name.slice(0, 100).trim();
    const base = name;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix += 1) name = `${base}_${suffix}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function guessRole(name: string): ColumnRole {
  return /^(id|.*[_\s.]id|patient[_\s]?id|subject[_\s]?id|record[_\s]?id|mrn)$/i.test(name) ? "id" : "none";
}

/** Infers a column's kind: numeric only when every present value is a number. */
export function inferColumn(name: string, raw: string[], decimalComma = false): { column: StoredColumn; truncated: number; overflow?: number } {
  let present = 0;
  let numeric = 0;
  for (const cell of raw) {
    if (isMissingToken(cell)) continue;
    present += 1;
    // Count number-shaped text even if it overflows (1e400): the column is numeric,
    // and the out-of-range value becomes missing with a warning.
    if (NUMBER_PATTERN.test(cell.trim()) || (decimalComma && /^[+-]?\d+,\d+$/.test(cell.trim()))) numeric += 1;
  }
  const meta = { name, label: name, unit: "", role: guessRole(name), description: "" };
  const pair = present > 0 && numeric < present ? booleanPair(raw) : null;
  if (pair) {
    const values = raw.map((cell) => (isMissingToken(cell) ? null : cell.trim().toLowerCase() === pair.yes));
    return { column: { ...meta, kind: "boolean", values }, truncated: 0 };
  }
  if (present > 0 && numeric === present) {
    let overflow = 0;
    const values = raw.map((cell) => {
      if (isMissingToken(cell)) return null;
      const value = parseNumberToken(cell, decimalComma);
      if (value === null) overflow += 1;
      return value;
    });
    return { column: { ...meta, kind: "numeric", values }, truncated: 0, overflow };
  }
  let truncated = 0;
  const values = raw.map((cell) => {
    if (isMissingToken(cell)) return null;
    const text = cell.trim();
    if (text.length > CATEGORY_VALUE_MAX_LENGTH) {
      truncated += 1;
      return text.slice(0, CATEGORY_VALUE_MAX_LENGTH);
    }
    return text;
  });
  return { column: { ...meta, kind: "categorical", values }, truncated };
}

/** The yes/no pair every present value belongs to, if there is exactly one. */
function booleanPair(raw: string[]): (typeof BOOLEAN_PAIRS)[number] | null {
  const seen = new Set<string>();
  for (const cell of raw) {
    if (isMissingToken(cell)) continue;
    seen.add(cell.trim().toLowerCase());
    if (seen.size > 2) return null;
  }
  for (const pair of BOOLEAN_PAIRS) {
    if (![...seen].every((token) => token === pair.yes || token === pair.no)) continue;
    if (pair.letters && seen.size < 2) continue;
    return pair;
  }
  return null;
}

/**
 * Parses delimited text (CSV, TSV, semicolon) into typed columns. The first
 * row is the header. Throws `DatasetError` when the text cannot form a dataset.
 */
export function parseDelimitedText(text: string, options: { delimiter?: string } = {}): CsvImportResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > DATASET_TEXT_MAX_BYTES) {
    throw new DatasetError("DATASET_TOO_LARGE", `The file is larger than ${DATASET_TEXT_MAX_BYTES / 1024 / 1024} MB.`);
  }
  const source = text.replace(/^﻿/, "");
  if (source.trim() === "") throw new DatasetError("DATASET_EMPTY", "The file is empty.");

  const parsed = Papa.parse<string[]>(source, {
    delimiter: options.delimiter ?? "",
    // Only truly blank lines are skipped; a line of bare delimiters is a record of missing values.
    skipEmptyLines: true,
    header: false,
    dynamicTyping: false,
  });
  const rows = parsed.data;
  const warnings: string[] = [];
  const fatal = parsed.errors.find((error) => error.type === "Quotes");
  if (fatal) {
    throw new DatasetError(
      "DATASET_PARSE_FAILED",
      `Row ${(fatal.row ?? 0) + 1}: ${fatal.message}. Check for an unclosed quote.`,
    );
  }
  if (rows.length < 2) {
    throw new DatasetError("DATASET_NO_ROWS", "The file needs a header row and at least one data row.");
  }

  // A trailing delimiter on every line yields an unnamed, empty last column; drop it.
  const rawHeader = [...rows[0]];
  let dropTrailing = 0;
  while (
    rawHeader.length > 1 &&
    rawHeader[rawHeader.length - 1].trim() === "" &&
    rows.slice(1).every((row) => (row[rawHeader.length - 1] ?? "").trim() === "")
  ) {
    rawHeader.pop();
    dropTrailing += 1;
  }
  if (dropTrailing > 0) {
    rows[0] = rawHeader;
    for (let r = 1; r < rows.length; r += 1) if (rows[r].length > rawHeader.length) rows[r] = rows[r].slice(0, rawHeader.length);
  }
  const headers = cleanHeaders(rows[0]);
  if (headers.length > DATASET_MAX_COLUMNS) {
    throw new DatasetError("DATASET_TOO_WIDE", `At most ${DATASET_MAX_COLUMNS} columns are supported; found ${headers.length}.`);
  }
  const body = rows.slice(1);
  if (body.length > DATASET_MAX_ROWS) {
    throw new DatasetError("DATASET_TOO_LONG", `At most ${DATASET_MAX_ROWS.toLocaleString("en-US")} rows are supported; found ${body.length.toLocaleString("en-US")}.`);
  }
  if (body.length * headers.length > DATASET_MAX_CELLS) {
    throw new DatasetError("DATASET_TOO_LARGE", `At most ${DATASET_MAX_CELLS.toLocaleString("en-US")} cells are supported.`);
  }

  let ragged = 0;
  if (dropTrailing > 0) warnings.push(`Ignored ${count(dropTrailing, "empty trailing column")} left by a trailing delimiter.`);
  const cells: string[][] = headers.map(() => new Array<string>(body.length));
  body.forEach((row, r) => {
    if (row.length !== headers.length) ragged += 1;
    for (let c = 0; c < headers.length; c += 1) cells[c][r] = row[c] ?? "";
  });
  if (ragged > 0) {
    warnings.push(
      `${count(ragged, "row")} had a different number of fields than the header; short rows were padded with missing values and extra fields were dropped.`,
    );
  }
  const renamed = headers.filter((header, index) => header !== rows[0][index]?.trim());
  if (renamed.length > 0) warnings.push(`Renamed ${count(renamed.length, "empty or duplicate header")}: ${renamed.slice(0, 5).join(", ")}.`);

  let truncated = 0;
  let overflow = 0;
  const columns = headers.map((name, index) => {
    const result = inferColumn(name, cells[index], parsed.meta.delimiter !== ",");
    truncated += result.truncated;
    overflow += result.overflow ?? 0;
    return result.column;
  });
  if (overflow > 0) warnings.push(`${count(overflow, "number")} too large to represent ${overflow === 1 ? "was" : "were"} read as missing.`);
  if (truncated > 0) warnings.push(`${count(truncated, "text value")} longer than ${CATEGORY_VALUE_MAX_LENGTH} characters were shortened.`);
  const casey = columns.filter((column) => column.kind === "categorical" && caseVariants(column.values).length > 0).map((column) => column.name);
  if (casey.length > 0) {
    warnings.push(
      `${casey.slice(0, 5).join(", ")}${casey.length > 5 ? "…" : ""}: some values differ only in letter case (e.g. Male / male). Merge them in the column inspector if they mean the same thing.`,
    );
  }

  return { columns, rowCount: body.length, delimiter: parsed.meta.delimiter, warnings };
}

/* ------------------------------------------------------------------ */
/* Kind conversion                                                     */
/* ------------------------------------------------------------------ */

/** Converts a column's kind; returns how many present values became missing. */
export function convertColumnKind(column: StoredColumn, kind: ColumnKind): { column: StoredColumn; lost: number } {
  if (column.kind === kind) return { column, lost: 0 };
  const source = column.values as (number | string | boolean | null)[];
  let lost = 0;
  const convert = <T,>(read: (value: number | string | boolean) => T | null): (T | null)[] =>
    source.map((value) => {
      if (value === null) return null;
      const next = read(value);
      if (next === null) lost += 1;
      return next;
    });
  let values: StoredColumn["values"];
  if (kind === "categorical") {
    values = convert((value) => (typeof value === "boolean" ? (value ? "yes" : "no") : String(value)));
  } else if (kind === "numeric") {
    values = convert((value) => (typeof value === "boolean" ? (value ? 1 : 0) : typeof value === "number" ? value : parseNumberToken(value)));
  } else {
    values = convert((value) =>
      typeof value === "boolean" ? value : typeof value === "number" ? (value === 1 ? true : value === 0 ? false : null) : parseBooleanToken(value),
    );
  }
  return { column: { ...column, kind, values }, lost };
}

/** Groups of text values that differ only in letter case or surrounding spaces. */
export function caseVariants(values: readonly (string | number | boolean | null)[]): { canonical: string; variants: string[] }[] {
  const groups = new Map<string, Map<string, number>>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const key = value.trim().toLowerCase();
    const counts = groups.get(key) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    groups.set(key, counts);
  }
  const result: { canonical: string; variants: string[] }[] = [];
  for (const counts of groups.values()) {
    if (counts.size < 2) continue;
    // The most frequent spelling wins; ties go to the alphabetically first.
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
    result.push({ canonical: ranked[0][0].trim(), variants: ranked.map(([spelling]) => spelling) });
  }
  return result.sort((a, b) => a.canonical.localeCompare(b.canonical, "en"));
}

/** Rewrites every case variant of a text column to its most frequent spelling. */
export function mergeCaseVariants(column: StoredColumn): { column: StoredColumn; changed: number } {
  if (column.kind !== "categorical") return { column, changed: 0 };
  const canonical = new Map<string, string>();
  for (const group of caseVariants(column.values)) for (const variant of group.variants) canonical.set(variant, group.canonical);
  let changed = 0;
  const values = (column.values as (string | null)[]).map((value) => {
    if (value === null) return null;
    const next = canonical.get(value);
    if (next === undefined || next === value) return value;
    changed += 1;
    return next;
  });
  return { column: changed ? { ...column, values } : column, changed };
}

/* ------------------------------------------------------------------ */
/* Validation of stored payloads (server authority)                    */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metaText(value: unknown, field: string, max = META_TEXT_MAX_LENGTH): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new DatasetError("VALIDATION_FAILED", `${field} must be text.`);
  if (value.length > max) throw new DatasetError("VALIDATION_FAILED", `${field} must be at most ${max} characters.`);
  return value.trim();
}

function role(value: unknown, field: string): ColumnRole {
  if (value === undefined) return "none";
  if (!COLUMN_ROLES.some((entry) => entry.v === value)) {
    throw new DatasetError("VALIDATION_FAILED", `${field} must be one of ${COLUMN_ROLES.map((r) => r.v).join(", ")}.`);
  }
  return value as ColumnRole;
}

export interface ColumnPatch {
  name: string;
  label?: string;
  unit?: string;
  role?: ColumnRole;
  description?: string;
  kind?: ColumnKind;
  /** Rewrite values that differ only in letter case to one spelling. */
  merge_case?: true;
}

/** Validates a list of column metadata patches against the stored columns. */
export function validateColumnPatches(input: unknown, columns: readonly ColumnMeta[]): ColumnPatch[] {
  if (!Array.isArray(input)) throw new DatasetError("VALIDATION_FAILED", "columns must be an array.");
  const names = new Set(columns.map((column) => column.name));
  return input.map((entry, index) => {
    if (!isRecord(entry)) throw new DatasetError("VALIDATION_FAILED", `columns[${index}] must be an object.`);
    for (const key of Object.keys(entry)) {
      if (!["name", "label", "unit", "role", "description", "kind", "merge_case"].includes(key)) {
        throw new DatasetError("VALIDATION_FAILED", `columns[${index}].${key} is not a recognised field.`);
      }
    }
    if (typeof entry.name !== "string" || !names.has(entry.name)) {
      throw new DatasetError("VALIDATION_FAILED", `columns[${index}].name does not match a column.`);
    }
    const patch: ColumnPatch = { name: entry.name };
    if ("label" in entry) patch.label = metaText(entry.label, "label");
    if ("unit" in entry) patch.unit = metaText(entry.unit, "unit", 40);
    if ("description" in entry) patch.description = metaText(entry.description, "description", 1_000);
    if ("role" in entry) patch.role = role(entry.role, "role");
    if ("kind" in entry) {
      if (!COLUMN_KINDS.includes(entry.kind as ColumnKind)) {
        throw new DatasetError("VALIDATION_FAILED", "kind must be numeric, categorical or boolean.");
      }
      patch.kind = entry.kind as ColumnKind;
    }
    if ("merge_case" in entry) {
      if (entry.merge_case !== true) throw new DatasetError("VALIDATION_FAILED", "merge_case must be true when present.");
      patch.merge_case = true;
    }
    return patch;
  });
}

/**
 * Validates derived column definitions: unique names that do not shadow a
 * source column, structurally valid formulas, and formulas that type-check
 * against the source columns plus every *earlier* derived column — so the
 * definitions always evaluate in order, with no cycles.
 */
export function validateDerived(
  input: unknown,
  columns: readonly ColumnMeta[],
  previous: readonly DerivedColumn[] = [],
): DerivedColumn[] {
  // A formula that was already stored and is unchanged is kept even if it no
  // longer type-checks (e.g. a column changed kind): rejecting it would block
  // every other edit, including the one that repairs or removes it.
  const unchanged = new Set(previous.map((entry) => `${entry.name}\u0000${hashExpr(entry.expr)}`));
  if (!Array.isArray(input)) throw new DatasetError("VALIDATION_FAILED", "derived must be an array.");
  if (input.length > DERIVED_MAX_COLUMNS) {
    throw new DatasetError("VALIDATION_FAILED", `At most ${DERIVED_MAX_COLUMNS} derived columns are supported.`);
  }
  const types = new Map<string, ValueType>(columns.map((column) => [column.name, kindValueType(column.kind)]));
  return input.map((entry, index) => {
    if (!isRecord(entry)) throw new DatasetError("VALIDATION_FAILED", `derived[${index}] must be an object.`);
    for (const key of Object.keys(entry)) {
      if (!["name", "expr", "label", "unit", "role", "description"].includes(key)) {
        throw new DatasetError("VALIDATION_FAILED", `derived[${index}].${key} is not a recognised field.`);
      }
    }
    if (!isValidColumnName(entry.name) || (entry.name as string).length > 100) {
      throw new DatasetError("VALIDATION_FAILED", `derived[${index}].name must be 1–100 printable characters.`);
    }
    const name = (entry.name as string).trim();
    if ([...types.keys()].some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      throw new DatasetError("DUPLICATE_COLUMN", `A column named “${name}” already exists.`);
    }
    const parsed = parseExprJson(entry.expr, `derived[${index}].expr`);
    if (!parsed.node) {
      throw new DatasetError("INVALID_FORMULA", parsed.diagnostics[0]?.message ?? "Invalid formula.", parsed.diagnostics);
    }
    const checked = checkExpr(parsed.node, (column) => types.get(column), `derived[${index}].expr`);
    if (!checked.type) {
      if (!unchanged.has(`${name}\u0000${hashExpr(parsed.node)}`)) {
        throw new DatasetError("INVALID_FORMULA", `${name}: ${checked.diagnostics[0].message}`, checked.diagnostics);
      }
    } else {
      types.set(name, checked.type);
    }
    return {
      name,
      expr: parsed.node,
      label: metaText(entry.label, "label") || name,
      unit: metaText(entry.unit, "unit", 40),
      role: role(entry.role, "role"),
      description: metaText(entry.description, "description", 1_000),
    };
  });
}

/** Validates a dataset display name. */
export function validateDatasetName(value: unknown): string {
  if (typeof value !== "string") throw new DatasetError("VALIDATION_FAILED", "Name must be text.");
  const name = value.trim();
  if (name === "") throw new DatasetError("VALIDATION_FAILED", "Name must not be empty.");
  if (name.length > DATASET_NAME_MAX_LENGTH) {
    throw new DatasetError("VALIDATION_FAILED", `Name must be at most ${DATASET_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

/** Content identity of the source columns — provenance for every analysis. */
export function hashColumns(columns: readonly StoredColumn[]): string {
  return canonicalHash(columns.map((column) => ({ name: column.name, kind: column.kind, values: column.values })));
}

/* ------------------------------------------------------------------ */
/* Frames: source + derived columns, ready for analysis                */
/* ------------------------------------------------------------------ */

export interface FrameColumn {
  name: string;
  kind: FrameKind;
  label: string;
  unit: string;
  role: ColumnRole;
  description: string;
  derived: boolean;
  expr: ExprNode | null;
  values: Value[];
  /** A derived column that could not be computed carries its reason. */
  error: string | null;
}

export interface Frame {
  datasetId: string;
  name: string;
  contentHash: string;
  rowCount: number;
  columns: FrameColumn[];
  /** How to cite the data, for datasets from the public catalogue. */
  citation?: string;
}

/**
 * Materializes the analysis frame: source columns as stored, then each derived
 * column evaluated in order. A derived column that no longer type-checks (for
 * example after a kind conversion) stays listed with an error and all-missing
 * values rather than silently disappearing.
 */
export function buildFrame(detail: Pick<DatasetDetail, "id" | "name" | "content_hash" | "row_count" | "columns" | "derived">): Frame {
  const columns: FrameColumn[] = detail.columns.map((column) => ({
    name: column.name,
    kind: column.kind,
    label: column.label || column.name,
    unit: column.unit,
    role: column.role,
    description: column.description,
    derived: false,
    expr: null,
    values: column.values as Value[],
    error: null,
  }));
  const byName = new Map(columns.map((column) => [column.name, column]));

  for (const derived of detail.derived) {
    const checked = checkExpr(derived.expr, (name) => {
      const column = byName.get(name);
      return column && column.error === null ? kindValueType(column.kind) : undefined;
    });
    const column: FrameColumn = {
      name: derived.name,
      kind: checked.type ? valueTypeKind(checked.type) : "numeric",
      label: derived.label || derived.name,
      unit: derived.unit,
      role: derived.role,
      description: derived.description,
      derived: true,
      expr: derived.expr,
      values: checked.type
        ? evaluateColumn(derived.expr, (name) => byName.get(name)?.values, detail.row_count)
        : new Array<Value>(detail.row_count).fill(null),
      error: checked.type ? null : describeDiagnostics(checked.diagnostics),
    };
    columns.push(column);
    byName.set(column.name, column);
  }

  return {
    datasetId: detail.id,
    name: detail.name,
    contentHash: detail.content_hash,
    rowCount: detail.row_count,
    columns,
  };
}

export function describeDiagnostics(diagnostics: readonly ExprDiagnostic[]): string {
  if (diagnostics.length === 0) return "";
  const first = diagnostics[0].message;
  return diagnostics.length === 1 ? first : `${first} (+${diagnostics.length - 1} more)`;
}

export function frameSchema(frame: Frame): (name: string) => ValueType | undefined {
  const types = new Map(
    frame.columns.filter((column) => column.error === null).map((column) => [column.name, kindValueType(column.kind)]),
  );
  return (name) => types.get(name);
}

export function frameColumn(frame: Frame, name: string): FrameColumn | undefined {
  return frame.columns.find((column) => column.name === name);
}

/** A numeric column whose present values are all 0 or 1 — usable as a binary outcome. */
export function isBinaryColumn(column: FrameColumn): boolean {
  if (column.kind === "boolean") return true;
  if (column.kind !== "numeric") return false;
  let present = 0;
  for (const value of column.values) {
    if (value === null) continue;
    if (value !== 0 && value !== 1) return false;
    present += 1;
  }
  return present > 0;
}

/** Binary coding of a column value: 1, 0, or null. Booleans and 0/1 numbers only. */
export function binaryValue(value: Value): 0 | 1 | null {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return null;
}

/** Distinct present values of a categorical or boolean column, in a stable order. */
export function distinctValues(column: FrameColumn, limit = 1_000): string[] {
  const seen = new Map<string, number>();
  for (const value of column.values) {
    if (value === null) continue;
    const key = displayValue(value);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (seen.size > limit) break;
  }
  return [...seen.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export function displayValue(value: Value): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
