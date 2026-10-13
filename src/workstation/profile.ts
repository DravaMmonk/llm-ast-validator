/**
 * Column profiling for Data Studio and the piece library's hover card.
 */

import type { FrameColumn } from "../../shared/workbench/dataset";
import { displayValue } from "../../shared/workbench/dataset";
import { histogram, summarize } from "../../shared/stats";
import { fmt } from "./ui";

export interface NumericProfile {
  kind: "numeric";
  n: number;
  missing: number;
  unique: number;
  summary: ReturnType<typeof summarize>;
  bins: { x0: number; x1: number; count: number }[];
  binary: boolean;
}

export interface CategoricalProfile {
  kind: "categorical" | "boolean";
  n: number;
  missing: number;
  unique: number;
  levels: { value: string; count: number; proportion: number }[];
}

export type ColumnProfile = NumericProfile | CategoricalProfile;

export function numericValues(column: FrameColumn, rows?: readonly number[]): number[] {
  const out: number[] = [];
  if (rows) {
    for (const row of rows) {
      const value = column.values[row];
      if (typeof value === "number" && Number.isFinite(value)) out.push(value);
    }
  } else {
    for (const value of column.values) if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

export function profileColumn(column: FrameColumn, rows?: readonly number[]): ColumnProfile {
  const total = rows ? rows.length : column.values.length;
  if (column.kind === "numeric") {
    const values = numericValues(column, rows);
    const unique = new Set(values).size;
    return {
      kind: "numeric",
      n: values.length,
      missing: total - values.length,
      unique,
      summary: summarize(values),
      bins: values.length > 0 ? histogram(values).bins : [],
      binary: values.length > 0 && values.every((value) => value === 0 || value === 1),
    };
  }
  const counts = new Map<string, number>();
  let present = 0;
  const visit = (value: FrameColumn["values"][number]) => {
    if (value === null) return;
    present += 1;
    const key = displayValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  if (rows) for (const row of rows) visit(column.values[row]);
  else for (const value of column.values) visit(value);
  const levels = [...counts.entries()]
    .map(([value, count]) => ({ value, count, proportion: present === 0 ? 0 : count / present }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "en", { numeric: true }));
  return { kind: column.kind, n: present, missing: total - present, unique: counts.size, levels };
}

/** A few lines for a hover card. */
export function quickProfile(column: FrameColumn): { lines: [string, string][] } {
  const profile = profileColumn(column);
  const lines: [string, string][] = [
    ["present", `${profile.n.toLocaleString("en-US")}`],
    ["missing", `${profile.missing.toLocaleString("en-US")}${profile.n + profile.missing > 0 ? ` (${((profile.missing / (profile.n + profile.missing)) * 100).toFixed(1)}%)` : ""}`],
  ];
  if (profile.kind === "numeric") {
    const s = profile.summary;
    if (profile.binary) {
      const ones = numericValues(column).filter((v) => v === 1).length;
      lines.push(["coded", "0 / 1"], ["share = 1", profile.n ? `${((ones / profile.n) * 100).toFixed(1)}%` : "—"]);
    } else {
      lines.push(["mean ± sd", `${fmt(s.mean)} ± ${fmt(s.sd)}`], ["median", fmt(s.median)], ["range", `${fmt(s.min)} – ${fmt(s.max)}`]);
    }
  } else {
    lines.push(["levels", String(profile.unique)]);
    for (const level of profile.levels.slice(0, 4)) lines.push([`“${level.value}”`, `${level.count} (${(level.proportion * 100).toFixed(0)}%)`]);
  }
  return { lines };
}
