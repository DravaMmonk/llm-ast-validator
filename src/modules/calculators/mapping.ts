/**
 * Mapping a calculator's inputs onto a dataset's columns: guess sensible
 * matches, then rewrite the calculator formula so each input becomes the
 * mapped column — converted to the formula's unit, or turned into a yes/no
 * test for categorical columns such as sex.
 */

import type { CalcInput, Calculator } from "../../../shared/workbench/calculators";
import { type Frame, type FrameColumn, distinctValues } from "../../../shared/workbench/dataset";
import { E, type ExprNode, exprColumns, substituteColumns } from "../../../shared/workbench/expr";

export interface InputMapping {
  column: string | null;
  /** Index into the input's `units` (numeric inputs). */
  unit: number;
  /** For yes/no inputs read from a categorical column: the value meaning yes. */
  yesValue: string | null;
}

const SYNONYMS: Record<string, string[]> = {
  age: ["age"],
  female: ["sex", "gender", "female"],
  weight_kg: ["weight", "wt"],
  height_cm: ["height", "ht"],
  creatinine: ["creatinine", "creat", "scr"],
  cystatin: ["cystatin", "cysc"],
  sbp: ["sbp", "systolic"],
  dbp: ["dbp", "diastolic"],
  heart_rate: ["heart_rate", "heartrate", "pulse", "hr"],
  resp_rate: ["resp_rate", "respiratory", "resp", "rr"],
  gcs: ["gcs", "glasgow"],
  glucose: ["glucose", "fpg", "glu"],
  insulin: ["insulin"],
  tg: ["triglycer", "tg"],
  hdl: ["hdl"],
  tc: ["total_chol", "tchol", "cholesterol_total", "tc"],
  sodium: ["sodium", "na"],
  potassium: ["potassium", "k"],
  chloride: ["chloride", "cl"],
  bicarbonate: ["bicarbonate", "hco3", "bicarb"],
  albumin: ["albumin", "alb"],
  calcium: ["calcium", "ca"],
  bun: ["bun", "urea"],
  urea: ["urea", "bun"],
  bilirubin: ["bilirubin", "bili"],
  inr: ["inr"],
  ast: ["ast", "sgot"],
  alt: ["alt", "sgpt"],
  platelets: ["platelet", "plt"],
  qt_ms: ["qt"],
};

function tokens(input: CalcInput): string[] {
  return SYNONYMS[input.name] ?? [input.name];
}

function matches(column: FrameColumn, token: string): boolean {
  const name = column.name.toLowerCase();
  const label = column.label.toLowerCase();
  if (token.length <= 3) {
    // Short tokens must match a whole word, or "na" would match "name".
    const words = `${name} ${label}`.split(/[^a-z0-9]+/);
    return words.includes(token);
  }
  return name.includes(token) || label.includes(token);
}

const YES_WORDS = ["yes", "y", "true", "1", "present"];

export function guessYesValue(input: CalcInput, column: FrameColumn): string | null {
  const levels = distinctValues(column, 50);
  if (input.name === "female") {
    return levels.find((level) => ["f", "female", "woman", "w"].includes(level.toLowerCase())) ?? null;
  }
  return levels.find((level) => YES_WORDS.includes(level.toLowerCase())) ?? null;
}

export function guessUnit(input: CalcInput, column: FrameColumn): number {
  if (!input.units || !column.unit) return 0;
  const unit = column.unit.toLowerCase().replace(/\s/g, "");
  const index = input.units.findIndex((option) => option.label.toLowerCase().replace(/\s/g, "").includes(unit) || unit.includes(option.label.toLowerCase().replace(/\s/g, "")));
  if (index >= 0) return index;
  // Column names often carry the unit (creatinine_umol, fpg_mmol).
  const name = column.name.toLowerCase();
  const byName = input.units.findIndex((option) => {
    const label = option.label.toLowerCase();
    return (label.includes("µmol") && name.includes("umol")) || (label.includes("mmol") && name.includes("mmol")) || (label.includes("mg/dl") && name.includes("mgdl"));
  });
  return byName >= 0 ? byName : 0;
}

/** Best-effort automatic mapping; every guess stays editable. */
export function guessMapping(calc: Calculator, frame: Frame): Record<string, InputMapping> {
  const used = new Set<string>();
  const usable = frame.columns.filter((column) => column.error === null && column.role !== "id");
  const out: Record<string, InputMapping> = {};
  for (const input of calc.inputs) {
    const wantNumeric = input.kind === "number";
    const candidates = usable.filter((column) =>
      wantNumeric ? column.kind === "numeric" : column.kind !== "numeric" || isZeroOne(column),
    );
    let column: FrameColumn | undefined;
    for (const token of tokens(input)) {
      column = candidates.find((candidate) => !used.has(candidate.name) && matches(candidate, token));
      if (column) break;
    }
    if (column) used.add(column.name);
    out[input.name] = {
      column: column?.name ?? null,
      unit: column && wantNumeric ? guessUnit(input, column) : 0,
      yesValue: column && column.kind === "categorical" ? guessYesValue(input, column) : column && !wantNumeric && column.kind === "numeric" ? "1" : null,
    };
  }
  return out;
}

export function isZeroOne(column: FrameColumn): boolean {
  return column.kind === "numeric" && column.values.every((value) => value === null || value === 0 || value === 1);
}

/** The expression replacing one input, or an explanation of why it cannot. */
export function inputReplacement(input: CalcInput, mapping: InputMapping | undefined, frame: Frame): ExprNode | string {
  if (!mapping?.column) return `Map “${input.label}” to a column.`;
  const column = frame.columns.find((entry) => entry.name === mapping.column);
  if (!column) return `Column “${mapping.column}” no longer exists.`;
  const ref = E.col(column.name);
  if (input.kind === "number") {
    if (column.kind !== "numeric") return `“${column.name}” is not numeric.`;
    const factor = input.units?.[mapping.unit]?.factor ?? 1;
    if (factor === 1) return ref;
    const inverse = 1 / factor;
    // Prefer “÷ 88.42” over “× 0.0113096…” when the inverse is a tidy number.
    return Math.abs(inverse - Number(inverse.toFixed(4))) < 1e-9 ? E.call("div", ref, E.num(Number(inverse.toFixed(4)))) : E.call("mul", ref, E.num(factor));
  }
  if (column.kind === "boolean") return ref;
  if (column.kind === "numeric") {
    if (!isZeroOne(column)) return `“${column.name}” must be coded 0/1 to stand for “${input.label}”.`;
    // Which code means yes is explicit: a sex column coded 1 = male must not read as female.
    return E.call("eq", ref, E.num(mapping.yesValue === "0" ? 0 : 1));
  }
  if (!mapping.yesValue) return `Choose which value of “${column.name}” means yes.`;
  return E.call("eq", ref, E.text(mapping.yesValue));
}

/**
 * The calculator output rewritten over the dataset. Only inputs the output
 * actually reads must be mapped.
 */
export function mappedExpression(
  calc: Calculator,
  outputKey: string,
  mapping: Record<string, InputMapping>,
  frame: Frame,
): { expr: ExprNode | null; problems: string[] } {
  const output = calc.outputs.find((entry) => entry.key === outputKey) ?? calc.outputs[0];
  const needed = new Set(exprColumns(output.expr));
  const replacements: Record<string, ExprNode> = {};
  const problems: string[] = [];
  for (const input of calc.inputs) {
    if (!needed.has(input.name)) continue;
    const replacement = inputReplacement(input, mapping[input.name], frame);
    if (typeof replacement === "string") problems.push(replacement);
    else replacements[input.name] = replacement;
  }
  if (problems.length > 0) return { expr: null, problems };
  return { expr: substituteColumns(output.expr, replacements), problems: [] };
}
