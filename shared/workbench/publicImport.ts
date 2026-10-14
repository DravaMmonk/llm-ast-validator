/**
 * Reads a downloaded public dataset through its column contract, and checks
 * the catalogue itself. Shared so the server import, the live verification
 * script and the tests apply exactly the same rules.
 *
 * The reader is strict on purpose: a missing header, a changed column count,
 * a row count that differs from the catalogue, a non-number in a numeric
 * column or a code the contract does not list all fail the import. Real data
 * is never coerced into a shape it does not have.
 */

import Papa from "papaparse";

import {
  CATEGORY_VALUE_MAX_LENGTH,
  COLUMN_KINDS,
  COLUMN_ROLES,
  DATASET_DESCRIPTION_MAX_LENGTH,
  DATASET_NAME_MAX_LENGTH,
  META_TEXT_MAX_LENGTH,
  type StoredColumn,
  isMissingToken,
  parseBooleanToken,
  parseNumberToken,
} from "./dataset";
import { isValidColumnName } from "./expr";
import type { PublicColumnSpec, PublicDataset } from "./publicDatasets";

/** Hosts the importer may download from. Anything else in the catalogue is a bug. */
export const PUBLIC_SOURCE_HOSTS = ["archive.ics.uci.edu", "vincentarelbundock.github.io"] as const;

export class PublicContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicContractError";
  }
}

function fail(dataset: PublicDataset, message: string): never {
  throw new PublicContractError(`${dataset.name}: ${message}`);
}

/** Applies the dataset's contract to the downloaded file text. */
export function applyPublicContract(dataset: PublicDataset, text: string): { columns: StoredColumn[]; rowCount: number } {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter: ",", skipEmptyLines: true });
  if (parsed.errors.some((error) => error.type === "Quotes")) fail(dataset, "the file has unbalanced quotes.");
  let rows = parsed.data;
  const width = dataset.source.columns;
  let header: string[] | null = null;
  if (dataset.source.header) {
    header = (rows[0] ?? []).map((cell) => cell.trim());
    rows = rows.slice(1);
    if (header.length !== width) fail(dataset, `expected ${width} columns in the header, found ${header.length}.`);
  }
  rows.forEach((row, index) => {
    if (row.length !== width) fail(dataset, `row ${index + 1} has ${row.length} fields; expected ${width}.`);
  });

  const indexOf = (from: string): number => {
    if (from.startsWith("#")) {
      const index = Number(from.slice(1));
      if (!Number.isInteger(index) || index < 0 || index >= width) fail(dataset, `column ${from} is outside the file.`);
      return index;
    }
    const index = header ? header.indexOf(from) : -1;
    if (index < 0) fail(dataset, `the source no longer has a column “${from}”.`);
    return index;
  };

  const { filter } = dataset.source;
  if (filter) {
    const at = indexOf(filter.from);
    rows = rows.filter((row) => row[at].trim() === filter.equals);
  }
  if (rows.length !== dataset.rows) fail(dataset, `expected ${dataset.rows.toLocaleString("en-US")} rows, found ${rows.length.toLocaleString("en-US")}.`);

  const extraMissing = new Set(dataset.source.missing ?? []);
  const isMissing = (raw: string) => isMissingToken(raw) || extraMissing.has(raw);

  const columns = dataset.columns.map((spec): StoredColumn => {
    const at = indexOf(spec.from);
    const values = rows.map((row, index) => readCell(dataset, spec, row[at].trim(), index, isMissing));
    return {
      name: spec.name,
      kind: spec.kind,
      label: spec.label,
      unit: spec.unit ?? "",
      role: spec.role ?? "none",
      description: spec.description ?? "",
      values: values as StoredColumn["values"],
    };
  });
  return { columns, rowCount: rows.length };
}

function readCell(
  dataset: PublicDataset,
  spec: PublicColumnSpec,
  raw: string,
  row: number,
  isMissing: (raw: string) => boolean,
): string | number | boolean | null {
  if (spec.codes) {
    if (Object.prototype.hasOwnProperty.call(spec.codes, raw)) return spec.codes[raw];
    if (isMissing(raw)) return null;
    fail(dataset, `${spec.name}: unexpected value “${raw.slice(0, 40)}” in row ${row + 1}.`);
  }
  if (isMissing(raw)) return null;
  if (spec.kind === "numeric") {
    const value = parseNumberToken(raw);
    if (value === null) fail(dataset, `${spec.name}: “${raw.slice(0, 40)}” in row ${row + 1} is not a number.`);
    return value;
  }
  if (spec.kind === "boolean") {
    const value = parseBooleanToken(raw);
    if (value === null) fail(dataset, `${spec.name}: “${raw.slice(0, 40)}” in row ${row + 1} is not yes/no.`);
    return value;
  }
  return raw.slice(0, CATEGORY_VALUE_MAX_LENGTH);
}

/** The description stored with an imported dataset: what it is and how to cite it. */
export function publicDatasetDescription(dataset: PublicDataset): string {
  return [
    dataset.description,
    `Source: ${dataset.source.publisher} — ${dataset.source.page}`,
    `Licence: ${dataset.license.name} (${dataset.license.spdx}).`,
    `Cite: ${dataset.citation}`,
  ].join("\n\n");
}

/** Structural checks on the catalogue — run by the unit tests, so a bad entry never ships. */
export function validatePublicCatalog(catalog: readonly PublicDataset[]): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  const roles = new Set<string>(COLUMN_ROLES.map((role) => role.v));
  for (const dataset of catalog) {
    const where = dataset.key;
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(dataset.key)) problems.push(`${where}: key must be lower_snake_case`);
    if (keys.has(dataset.key)) problems.push(`${where}: duplicate key`);
    keys.add(dataset.key);
    if (dataset.name.length > DATASET_NAME_MAX_LENGTH) problems.push(`${where}: name too long`);
    if (publicDatasetDescription(dataset).length > DATASET_DESCRIPTION_MAX_LENGTH) problems.push(`${where}: description too long`);
    if (!/^[0-9a-f]{64}$/.test(dataset.source.sha256)) problems.push(`${where}: sha256 must be 64 lowercase hex digits`);
    try {
      const url = new URL(dataset.source.url);
      if (url.protocol !== "https:" || !(PUBLIC_SOURCE_HOSTS as readonly string[]).includes(url.hostname)) {
        problems.push(`${where}: source URL must be https on an allowed host`);
      }
    } catch {
      problems.push(`${where}: source URL is not a URL`);
    }
    if (!(dataset.rows > 0) || !(dataset.source.bytes > 0) || !(dataset.source.columns > 0)) problems.push(`${where}: rows, bytes and columns must be positive`);
    if (dataset.columns.length === 0) problems.push(`${where}: no columns`);
    const names = new Set<string>();
    for (const spec of dataset.columns) {
      const at = `${where}.${spec.name}`;
      if (!isValidColumnName(spec.name) || !/^[a-z][a-z0-9_]*$/.test(spec.name)) problems.push(`${at}: name must be a plain lower_snake_case identifier`);
      if (names.has(spec.name.toLowerCase())) problems.push(`${at}: duplicate column name`);
      names.add(spec.name.toLowerCase());
      if (!COLUMN_KINDS.includes(spec.kind)) problems.push(`${at}: unknown kind`);
      if (spec.role && !roles.has(spec.role)) problems.push(`${at}: unknown role`);
      if (spec.label.length === 0 || spec.label.length > META_TEXT_MAX_LENGTH) problems.push(`${at}: label length`);
      if ((spec.unit ?? "").length > 40) problems.push(`${at}: unit too long`);
      if ((spec.description ?? "").length > 1_000) problems.push(`${at}: description too long`);
      if (spec.from.startsWith("#")) {
        const index = Number(spec.from.slice(1));
        if (!Number.isInteger(index) || index < 0 || index >= dataset.source.columns) problems.push(`${at}: ${spec.from} is outside the file`);
      } else if (!dataset.source.header) {
        problems.push(`${at}: a file without a header needs #index sources`);
      }
      for (const value of Object.values(spec.codes ?? {})) {
        if (value === null) continue;
        const ok =
          spec.kind === "numeric" ? typeof value === "number" && Number.isFinite(value) : spec.kind === "boolean" ? typeof value === "boolean" : typeof value === "string" && value.length > 0;
        if (!ok) problems.push(`${at}: code value ${JSON.stringify(value)} does not match kind ${spec.kind}`);
      }
    }
    const roleCount = (role: string) => dataset.columns.filter((spec) => spec.role === role).length;
    if (roleCount("time") > 1 || roleCount("event") > 1 || roleCount("outcome") > 1) problems.push(`${where}: at most one time, event and outcome column`);
    if ((roleCount("time") === 1) !== (roleCount("event") === 1)) problems.push(`${where}: a time column needs an event column and vice versa`);
  }
  return problems;
}
