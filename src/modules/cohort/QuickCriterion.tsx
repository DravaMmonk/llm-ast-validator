/**
 * The fast path to a criterion: pick a column, an operator, a value, and add it
 * as an include or exclude step. It writes the same expression the puzzle
 * pieces do, so the step appears on the canvas ready to refine.
 */

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { distinctValues, type Frame } from "../../../shared/workbench/dataset";
import { E, type ExprNode } from "../../../shared/workbench/expr";
import { inputSmCls, selectSmCls, softBtn } from "../../shared-console/src";
import { ColumnSelect } from "../../workstation/ui";

type NumericOp = "ge" | "gt" | "le" | "lt" | "eq" | "ne" | "between" | "missing" | "present";
type TextOp = "eq" | "ne" | "one_of" | "missing" | "present";
type BoolOp = "yes" | "no" | "missing";

const NUMERIC_OPS: [NumericOp, string][] = [
  ["ge", "≥"],
  ["gt", ">"],
  ["le", "≤"],
  ["lt", "<"],
  ["eq", "="],
  ["ne", "≠"],
  ["between", "between"],
  ["missing", "is missing"],
  ["present", "is recorded"],
];
const TEXT_OPS: [TextOp, string][] = [
  ["eq", "is"],
  ["ne", "is not"],
  ["one_of", "is one of"],
  ["missing", "is missing"],
  ["present", "is recorded"],
];
const BOOL_OPS: [BoolOp, string][] = [
  ["yes", "is yes"],
  ["no", "is no"],
  ["missing", "is missing"],
];

export function buildCriterion(
  column: string,
  kind: "numeric" | "categorical" | "boolean",
  op: string,
  value: string,
  value2: string,
  chosen: string[],
): { expr: ExprNode; label: string } | { error: string } {
  const col = E.col(column);
  if (op === "missing") return { expr: E.call("is_missing", col), label: `${column} missing` };
  if (op === "present") return { expr: E.call("not", E.call("is_missing", col)), label: `${column} recorded` };
  if (kind === "boolean") return { expr: E.call("eq", col, E.bool(op === "yes")), label: `${column} ${op}` };
  if (kind === "categorical") {
    if (op === "one_of") {
      if (chosen.length === 0) return { error: "Tick at least one value." };
      const label = `${column} ∈ {${chosen.join(", ")}}`.slice(0, 200);
      // one_of splits its list on commas, so values that contain one become an or-chain.
      if (chosen.some((value) => value.includes(","))) {
        const [first, ...rest] = chosen.map((value) => E.call("eq", col, E.text(value)));
        return { expr: rest.reduce((acc, next) => E.call("or", acc, next), first), label };
      }
      return { expr: E.call("one_of", col, E.text(chosen.join(", "))), label };
    }
    if (value === "") return { error: "Choose a value." };
    return { expr: E.call(op as "eq" | "ne", col, E.text(value)), label: `${column} ${op === "eq" ? "=" : "≠"} ${value}`.slice(0, 200) };
  }
  const a = Number(value);
  if (value.trim() === "" || !Number.isFinite(a)) return { error: "Enter a number." };
  if (op === "between") {
    const b = Number(value2);
    if (value2.trim() === "" || !Number.isFinite(b)) return { error: "Enter the upper bound." };
    if (b < a) return { error: "The upper bound is below the lower bound." };
    return { expr: E.call("between", col, E.num(a), E.num(b)), label: `${column} ${a}–${b}` };
  }
  const symbol = NUMERIC_OPS.find(([id]) => id === op)?.[1] ?? op;
  return { expr: E.call(op as "ge", col, E.num(a)), label: `${column} ${symbol} ${a}` };
}

export function QuickCriterion({
  frame,
  onAdd,
}: {
  frame: Frame;
  onAdd: (step: { kind: "include" | "exclude"; expr: ExprNode; label: string }) => void;
}) {
  const [column, setColumn] = useState<string | null>(null);
  const [op, setOp] = useState<string>("ge");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = frame.columns.find((entry) => entry.name === column) ?? null;
  const kind = meta?.kind ?? "numeric";
  const levels = useMemo(() => (meta && meta.kind !== "numeric" ? distinctValues(meta, 60) : []), [meta]);
  const ops = kind === "numeric" ? NUMERIC_OPS : kind === "categorical" ? TEXT_OPS : BOOL_OPS;

  const pickColumn = (name: string | null) => {
    setColumn(name);
    const next = frame.columns.find((entry) => entry.name === name);
    setOp(next?.kind === "categorical" ? "eq" : next?.kind === "boolean" ? "yes" : "ge");
    setValue("");
    setValue2("");
    setChosen([]);
    setError(null);
  };

  const add = (stepKind: "include" | "exclude") => {
    if (!column) {
      setError("Choose a column.");
      return;
    }
    const built = buildCriterion(column, kind, op, value, value2, chosen);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    onAdd({ kind: stepKind, expr: built.expr, label: built.label });
  };

  const needsValue = !["missing", "present", "yes", "no"].includes(op);

  return (
    <div className="flex flex-none flex-col gap-1 border-b border-border-2 bg-card-2 px-[11px] py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Quick criterion</span>
        <ColumnSelect frame={frame} value={column} onChange={pickColumn} ariaLabel="Criterion column" className="w-[190px]" />
        <select aria-label="Criterion operator" className={`${selectSmCls} h-7`} value={op} onChange={(event) => setOp(event.target.value)} disabled={!column}>
          {ops.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {column && needsValue && kind === "numeric" && (
          <>
            <input
              aria-label="Criterion value"
              className={`${inputSmCls} ui-num h-7 w-[84px]`}
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && add("include")}
              placeholder="value"
            />
            {op === "between" && (
              <input
                aria-label="Upper bound"
                className={`${inputSmCls} ui-num h-7 w-[84px]`}
                inputMode="decimal"
                value={value2}
                onChange={(event) => setValue2(event.target.value)}
                placeholder="and"
              />
            )}
          </>
        )}
        {column && needsValue && kind === "categorical" && op !== "one_of" && (
          <select aria-label="Criterion value" className={`${selectSmCls} h-7 max-w-[160px]`} value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="">value…</option>
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-1.5">
          <button type="button" className={`${softBtn} flex items-center gap-1`} onClick={() => add("include")} disabled={!column} aria-label="Add as inclusion criterion">
            <Plus size={12} aria-hidden /> Include
          </button>
          <button
            type="button"
            className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-transparent px-3 text-ui font-semibold disabled:cursor-default disabled:opacity-40"
            style={{ background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)" }}
            onClick={() => add("exclude")}
            disabled={!column}
            aria-label="Add as exclusion criterion"
          >
            <Minus size={12} aria-hidden /> Exclude
          </button>
        </div>
      </div>
      {column && kind === "categorical" && op === "one_of" && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1">
          {levels.map((level) => (
            <label key={level} className="flex cursor-pointer items-center gap-1 text-body text-fg">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--primary)]"
                checked={chosen.includes(level)}
                onChange={(event) => setChosen(event.target.checked ? [...chosen, level] : chosen.filter((entry) => entry !== level))}
              />
              {level}
            </label>
          ))}
        </div>
      )}
      {error && (
        <div className="text-dense" style={{ color: "var(--bad)" }} role="alert">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
