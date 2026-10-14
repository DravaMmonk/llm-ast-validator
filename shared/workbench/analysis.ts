/**
 * Analysis plumbing between frames and the statistics engine: complete-case
 * extraction, dummy coding, group splits, and the choice of descriptive
 * summary and test for each variable. Pure and DOM-free so every rule here is
 * unit-tested.
 */

import {
  chiSquareTest,
  fisherExact2x2,
  kruskalWallis,
  mannWhitneyU,
  oneWayAnova,
  summarize,
  welchTTest,
} from "../stats";
import { type Frame, type FrameColumn, binaryValue, displayValue, isBinaryColumn } from "./dataset";

export const MAX_GROUP_LEVELS = 12;

export function columnByName(frame: Frame, name: string | null): FrameColumn | null {
  if (!name) return null;
  return frame.columns.find((column) => column.name === name && column.error === null) ?? null;
}

/** Levels of a grouping column within the selected rows, most frequent first. */
export function groupLevels(column: FrameColumn, rows: readonly number[]): { level: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = column.values[row];
    if (value === null) continue;
    const key = displayValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level.localeCompare(b.level, "en", { numeric: true }));
}

/** A column usable as a grouping factor: categorical, yes/no, or numeric with few distinct values. */
export function isGroupingColumn(column: FrameColumn, rows?: readonly number[]): boolean {
  if (column.error !== null || column.role === "id") return false;
  if (column.kind !== "numeric") {
    // Stop counting as soon as there are too many levels: id-like text columns are long.
    const seen = new Set<string | boolean>();
    const visit = (value: FrameColumn["values"][number]) => {
      if (value !== null) seen.add(value as string | boolean);
      return seen.size > MAX_GROUP_LEVELS;
    };
    if (rows) {
      for (const row of rows) if (visit(column.values[row])) return false;
    } else {
      for (const value of column.values) if (visit(value)) return false;
    }
    // A grouping needs at least two observed levels to compare anything.
    return seen.size >= 2;
  }
  const distinct = new Set<number>();
  for (const value of column.values) {
    if (typeof value === "number") distinct.add(value);
    if (distinct.size > 6) return false;
  }
  return distinct.size >= 2;
}

/** Splits numeric values of `outcome` by the levels of `group`, dropping rows missing either. */
export function splitByGroup(
  outcome: FrameColumn,
  group: FrameColumn,
  rows: readonly number[],
): { levels: string[]; values: number[][]; excluded: number } {
  const levels = groupLevels(group, rows).map((entry) => entry.level);
  const index = new Map(levels.map((level, i) => [level, i]));
  const values = levels.map(() => [] as number[]);
  let excluded = 0;
  for (const row of rows) {
    const g = group.values[row];
    const y = outcome.values[row];
    if (g === null || typeof y !== "number") {
      excluded += 1;
      continue;
    }
    values[index.get(displayValue(g))!].push(y);
  }
  return { levels, values, excluded };
}

/** r × c contingency table of `outcome` levels (columns) by `group` levels (rows). */
export function crossTab(
  outcome: FrameColumn,
  group: FrameColumn,
  rows: readonly number[],
): { rowLevels: string[]; colLevels: string[]; table: number[][]; excluded: number } {
  // Levels come from complete pairs only, so a level seen only beside a missing
  // value cannot create an all-zero row or column.
  const complete = rows.filter((row) => group.values[row] !== null && outcome.values[row] !== null);
  const rowLevels = groupLevels(group, complete).map((entry) => entry.level);
  const colLevels = groupLevels(outcome, complete).map((entry) => entry.level);
  const r = new Map(rowLevels.map((level, i) => [level, i]));
  const c = new Map(colLevels.map((level, i) => [level, i]));
  const table = rowLevels.map(() => colLevels.map(() => 0));
  let excluded = 0;
  for (const row of rows) {
    const g = group.values[row];
    const y = outcome.values[row];
    if (g === null || y === null) {
      excluded += 1;
      continue;
    }
    table[r.get(displayValue(g))!][c.get(displayValue(y))!] += 1;
  }
  return { rowLevels, colLevels, table, excluded };
}

/* ------------------------------------------------------------------ */
/* Design matrices                                                     */
/* ------------------------------------------------------------------ */

export interface DesignTerm {
  /** Display name of the coefficient. */
  name: string;
  column: string;
  /** For dummy terms, the level coded 1. */
  level: string | null;
  reference: string | null;
}

export interface Design {
  X: number[][];
  terms: DesignTerm[];
  rows: number[];
  excluded: number;
}

/**
 * Builds a complete-case design matrix (without intercept). Numeric columns
 * enter as-is; categorical and yes/no columns are dummy coded against their
 * most frequent level, which keeps the reference group well populated. A
 * column with a single observed level is dropped with a reason.
 */
export function buildDesign(
  frame: Frame,
  rows: readonly number[],
  predictors: readonly string[],
  required: readonly string[] = [],
): Design & { dropped: { column: string; reason: string }[] } {
  const columns = predictors.map((name) => columnByName(frame, name)).filter((column): column is FrameColumn => column !== null);
  const requiredColumns = required.map((name) => columnByName(frame, name)).filter((column): column is FrameColumn => column !== null);
  const complete = rows.filter((row) =>
    [...columns, ...requiredColumns].every((column) => {
      const value = column.values[row];
      return value !== null && (typeof value !== "number" || Number.isFinite(value));
    }),
  );
  const terms: DesignTerm[] = [];
  const dropped: { column: string; reason: string }[] = [];
  const encoders: ((row: number) => number)[] = [];
  for (const column of columns) {
    if (column.kind === "numeric") {
      terms.push({ name: column.name, column: column.name, level: null, reference: null });
      encoders.push((row) => column.values[row] as number);
      continue;
    }
    const levels = groupLevels(column, complete).sort((a, b) => b.count - a.count || a.level.localeCompare(b.level, "en", { numeric: true }));
    if (levels.length < 2) {
      dropped.push({ column: column.name, reason: "only one level in the analysed rows" });
      continue;
    }
    if (levels.length > MAX_GROUP_LEVELS) {
      dropped.push({ column: column.name, reason: `more than ${MAX_GROUP_LEVELS} levels` });
      continue;
    }
    const reference = levels[0].level;
    for (const { level } of levels.slice(1)) {
      terms.push({ name: `${column.name}: ${level} vs ${reference}`, column: column.name, level, reference });
      encoders.push((row) => (displayValue(column.values[row]) === level ? 1 : 0));
    }
  }
  const X = complete.map((row) => encoders.map((encode) => encode(row)));
  return { X, terms, rows: complete, excluded: rows.length - complete.length, dropped };
}

export function numericVector(column: FrameColumn, rows: readonly number[]): number[] {
  return rows.map((row) => column.values[row] as number);
}

export function binaryVector(column: FrameColumn, rows: readonly number[]): (0 | 1)[] {
  return rows.map((row) => binaryValue(column.values[row]) ?? 0);
}

/* ------------------------------------------------------------------ */
/* Table 1                                                             */
/* ------------------------------------------------------------------ */

export type SummaryStyle = "mean_sd" | "median_iqr";

export interface Table1Row {
  label: string;
  /** Indent level: 0 for a variable, 1 for a category level. */
  indent: 0 | 1;
  overall: string;
  groups: string[];
  p: number | null;
  test: string | null;
  missing: number;
}

export interface Table1 {
  groupLevels: string[];
  groupCounts: number[];
  total: number;
  rows: Table1Row[];
  footnotes: string[];
}

const f1 = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function decimalsFor(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const spread = Math.abs(sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)]);
  if (spread >= 20) return 0;
  if (spread >= 2) return 1;
  return 2;
}

/** Skewed variables (|skewness| > 1) are summarised as median [IQR] and tested non-parametrically. */
export function chooseStyle(values: number[]): SummaryStyle {
  const s = summarize(values);
  return s.skewness !== null && Math.abs(s.skewness) > 1 ? "median_iqr" : "mean_sd";
}

function describeNumeric(values: number[], style: SummaryStyle, digits: number): string {
  if (values.length === 0) return "—";
  const s = summarize(values);
  return style === "mean_sd"
    ? `${f1(s.mean, digits)} ± ${f1(s.sd, digits)}`
    : `${f1(s.median, digits)} [${f1(s.q1, digits)}, ${f1(s.q3, digits)}]`;
}

/**
 * The baseline-characteristics table. Each variable gets the summary its
 * distribution warrants and, when a grouping column is given, the matching
 * test: Welch t / ANOVA for roughly symmetric numbers, Mann–Whitney /
 * Kruskal–Wallis for skewed numbers, χ² for categories (Fisher's exact test for
 * sparse 2×2 tables).
 */
export function buildTable1(frame: Frame, rows: readonly number[], variables: readonly string[], groupName: string | null): Table1 {
  const group = columnByName(frame, groupName);
  const levels = group ? groupLevels(group, rows).map((entry) => entry.level) : [];
  const groupRows = levels.map((level) => rows.filter((row) => group!.values[row] !== null && displayValue(group!.values[row]) === level));
  const out: Table1Row[] = [];
  const usedTests = new Set<string>();

  for (const name of variables) {
    const column = columnByName(frame, name);
    if (!column || column.name === groupName) continue;
    const present = rows.filter((row) => column.values[row] !== null);
    const missing = rows.length - present.length;
    const label = `${column.label}${column.unit ? ` (${column.unit})` : ""}`;

    if (column.kind === "numeric" && !isBinaryColumn(column)) {
      const values = present.map((row) => column.values[row] as number);
      const style = chooseStyle(values);
      const digits = decimalsFor(values);
      const perGroup = groupRows.map((subset) => subset.map((row) => column.values[row]).filter((v): v is number => typeof v === "number"));
      let p: number | null = null;
      let test: string | null = null;
      if (group && perGroup.filter((g) => g.length >= 2).length >= 2) {
        const usable = perGroup.filter((g) => g.length >= 2);
        try {
          if (usable.length === 2) {
            if (style === "mean_sd") {
              p = welchTTest(usable[0], usable[1]).pValue;
              test = "Welch t-test";
            } else {
              p = mannWhitneyU(usable[0], usable[1]).pValue;
              test = "Mann–Whitney U";
            }
          } else if (style === "mean_sd") {
            p = oneWayAnova(usable).pValue;
            test = "One-way ANOVA";
          } else {
            p = kruskalWallis(usable).pValue;
            test = "Kruskal–Wallis";
          }
        } catch {
          p = null;
          test = null;
        }
      }
      if (test) usedTests.add(test);
      out.push({
        label: `${label}, ${style === "mean_sd" ? "mean ± SD" : "median [IQR]"}`,
        indent: 0,
        overall: describeNumeric(values, style, digits),
        groups: perGroup.map((values) => describeNumeric(values, style, digits)),
        p,
        test,
        missing,
      });
      continue;
    }

    // Categorical, yes/no, or 0/1: n (%) per level.
    const levelsOf = groupLevels(column, present).map((entry) => entry.level);
    if (levelsOf.length > MAX_GROUP_LEVELS) continue;
    const binary = isBinaryColumn(column);
    const shownLevels = binary ? levelsOf.filter((level) => level === "1" || level === "yes") : levelsOf;
    let p: number | null = null;
    let test: string | null = null;
    if (group && levels.length >= 2 && levelsOf.length >= 2) {
      const full = groupRows.map((subset) => levelsOf.map((level) => subset.filter((row) => column.values[row] !== null && displayValue(column.values[row]) === level).length));
      // Drop levels absent from every group (seen only where the group is missing).
      const keep = levelsOf.map((_, c) => full.some((counts) => counts[c] > 0));
      const table = full.map((counts) => counts.filter((_, c) => keep[c]));
      const nonEmpty = table.filter((counts) => counts.reduce((a, b) => a + b, 0) > 0);
      if (nonEmpty.length >= 2 && (nonEmpty[0]?.length ?? 0) >= 2) {
        try {
          const chi = chiSquareTest(nonEmpty, { yates: false });
          if (chi.lowExpectedWarning && nonEmpty.length === 2 && nonEmpty[0].length === 2) {
            p = fisherExact2x2(nonEmpty[0][0], nonEmpty[0][1], nonEmpty[1][0], nonEmpty[1][1]).pValue;
            test = "Fisher's exact test";
          } else {
            p = chi.pValue;
            test = chi.lowExpectedWarning ? "χ² test (some expected counts < 5)" : "χ² test";
          }
        } catch {
          p = null;
        }
      }
    }
    if (test) usedTests.add(test);
    const pct = (count: number, total: number) => (total === 0 ? "—" : `${count} (${((count / total) * 100).toFixed(1)}%)`);
    if (binary) {
      const level = shownLevels[0] ?? "1";
      const count = (subset: readonly number[]) => subset.filter((row) => column.values[row] !== null && displayValue(column.values[row]) === level).length;
      const presentIn = (subset: readonly number[]) => subset.filter((row) => column.values[row] !== null).length;
      out.push({
        label: `${label}, n (%)`,
        indent: 0,
        overall: pct(count(present), present.length),
        groups: groupRows.map((subset) => pct(count(subset), presentIn(subset))),
        p,
        test,
        missing,
      });
      continue;
    }
    out.push({ label: `${label}, n (%)`, indent: 0, overall: "", groups: groupRows.map(() => ""), p, test, missing });
    for (const level of shownLevels) {
      const count = (subset: readonly number[]) => subset.filter((row) => column.values[row] !== null && displayValue(column.values[row]) === level).length;
      const presentIn = (subset: readonly number[]) => subset.filter((row) => column.values[row] !== null).length;
      out.push({
        label: level,
        indent: 1,
        overall: pct(count(present), present.length),
        groups: groupRows.map((subset) => pct(count(subset), presentIn(subset))),
        p: null,
        test: null,
        missing: 0,
      });
    }
  }

  const footnotes = [
    "Continuous variables with |skewness| > 1 are shown as median [IQR]; others as mean ± SD.",
    ...(group ? [`p-values: ${[...usedTests].join("; ")}.`] : []),
    "Percentages use the non-missing count as denominator.",
  ];
  return { groupLevels: levels, groupCounts: groupRows.map((subset) => subset.length), total: rows.length, rows: out, footnotes };
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/** APA-style p-value text: “p < .001” or “p = .034”. */
export function apaP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "p = n/a";
  if (p < 0.001) return "p < .001";
  return `p = ${p.toFixed(3).replace(/^0/, "")}`;
}

export function num(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}
