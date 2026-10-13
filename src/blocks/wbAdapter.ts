/**
 * Workbench puzzle blocks ⇄ expression trees.
 *
 * Pure functions over Blockly's serialization JSON (no live workspace), so the
 * conversion is testable without a DOM — the same approach as the diabetes
 * adapter. The connector checks ("Number", "String", "Boolean") make pieces of
 * the wrong type physically refuse to snap together, which is the point of the
 * puzzle: a criterion slot only accepts a yes/no piece.
 */

import { E, type ExprNode, type ExprOp, type ValueType, checkExpr, normalizeExpr } from "../../shared/workbench/expr";
import type { PartialExpr } from "../../shared/workbench/exprLatex";
import type { CohortStep, CohortStepKind, MissingPolicy } from "../../shared/workbench/documents";

/** Blockly's serialized block shape, narrowed to what these blocks emit. */
export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, string | number>;
  inputs?: Record<string, { block?: BlockState; shadow?: BlockState }>;
  next?: { block?: BlockState };
  extraState?: Record<string, unknown>;
  /** False stacks a piece's sockets vertically (Blockly's external inputs). */
  inline?: boolean;
  disabledReasons?: string[];
  enabled?: boolean;
  deletable?: boolean;
  movable?: boolean;
}

export class PuzzleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PuzzleError";
  }
}

export const CHECK: Record<ValueType, string> = { number: "Number", text: "String", boolean: "Boolean" };

/** Dropdown field values → operator ids, per compound block. */
export const ARITH_OPS: [string, ExprOp][] = [
  ["+", "add"],
  ["−", "sub"],
  ["×", "mul"],
  ["÷", "div"],
  ["^", "pow"],
];
export const FN1_OPS: [string, ExprOp][] = [
  ["abs", "abs"],
  ["√", "sqrt"],
  ["ln", "ln"],
  ["log₁₀", "log10"],
  ["exp", "exp"],
  ["floor", "floor"],
  ["ceil", "ceil"],
  ["negate", "neg"],
];
export const FN2_OPS: [string, ExprOp][] = [
  ["min", "min"],
  ["max", "max"],
  ["round", "round"],
];
export const COMPARE_OPS: [string, ExprOp][] = [
  ["<", "lt"],
  ["≤", "le"],
  [">", "gt"],
  ["≥", "ge"],
  ["=", "eq"],
  ["≠", "ne"],
];
export const EQUALS_OPS: [string, ExprOp][] = [
  ["is", "eq"],
  ["is not", "ne"],
];
export const LOGIC_OPS: [string, ExprOp][] = [
  ["and", "and"],
  ["or", "or"],
];

const lookup = (table: [string, ExprOp][]) => new Map(table.map(([, op]) => [op, op]));
const ARITH = lookup(ARITH_OPS);
const FN1 = lookup(FN1_OPS);
const FN2 = lookup(FN2_OPS);
const COMPARE = new Set(["lt", "le", "gt", "ge"]);
const LOGIC = lookup(LOGIC_OPS);

export const BLOCK = {
  num: "wb_num",
  text: "wb_text",
  bool: "wb_bool",
  col: "wb_col",
  arith: "wb_arith",
  fn1: "wb_fn1",
  fn2: "wb_fn2",
  clamp: "wb_clamp",
  compare: "wb_compare",
  equals: "wb_equals",
  logic: "wb_logic",
  not: "wb_not",
  if: "wb_if",
  missing: "wb_missing",
  coalesce: "wb_coalesce",
  validIf: "wb_valid_if",
  between: "wb_between",
  oneOf: "wb_one_of",
  cohortStart: "wb_cohort_start",
  step: "wb_step",
} as const;

/* ------------------------------------------------------------------ */
/* Expression → blocks                                                 */
/* ------------------------------------------------------------------ */

/** Resolves column types so the right block (and colour, and check) is chosen. */
export type TypeOf = (name: string) => ValueType | undefined;

function inferType(node: ExprNode, typeOf: TypeOf): ValueType | null {
  return checkExpr(node, typeOf).type;
}

/** Sub-formulas larger than this many nodes stack their sockets vertically to stay readable. */
const STACK_ABOVE_NODES = 9;

function size(node: ExprNode): number {
  return node.k === "call" ? 1 + node.args.reduce((sum, arg) => sum + size(arg), 0) : 1;
}

export function exprToBlock(node: ExprNode, typeOf: TypeOf): BlockState {
  const block = exprToBlockInline(node, typeOf);
  // Long sums and conjunctions read better as a vertical stack than as one very wide row.
  if (node.k === "call" && (block.type === BLOCK.arith || block.type === BLOCK.logic || block.type === BLOCK.if) && size(node) > STACK_ABOVE_NODES) {
    block.inline = false;
  }
  return block;
}

function exprToBlockInline(node: ExprNode, typeOf: TypeOf): BlockState {
  switch (node.k) {
    case "num":
      return { type: BLOCK.num, fields: { VALUE: node.v } };
    case "text":
      return { type: BLOCK.text, fields: { VALUE: node.v } };
    case "bool":
      return { type: BLOCK.bool, fields: { VALUE: node.v ? "TRUE" : "FALSE" } };
    case "col":
      return { type: BLOCK.col, extraState: { name: node.name, valueType: typeOf(node.name) ?? null } };
    case "call": {
      const child = (index: number) => ({ block: exprToBlock(node.args[index], typeOf) });
      const op = node.op;
      if (ARITH.has(op)) return { type: BLOCK.arith, fields: { OP: op }, inputs: { A: child(0), B: child(1) } };
      if (FN1.has(op)) return { type: BLOCK.fn1, fields: { OP: op }, inputs: { X: child(0) } };
      if (FN2.has(op)) return { type: BLOCK.fn2, fields: { OP: op }, inputs: { A: child(0), B: child(1) } };
      if (op === "clamp") return { type: BLOCK.clamp, inputs: { X: child(0), LO: child(1), HI: child(2) } };
      if (COMPARE.has(op)) return { type: BLOCK.compare, fields: { OP: op }, inputs: { A: child(0), B: child(1) } };
      if (op === "eq" || op === "ne") {
        // Numbers use the comparison piece; text and yes/no use the "is" piece.
        const numeric =
          inferType(node.args[0], typeOf) === "number" || inferType(node.args[1], typeOf) === "number";
        return numeric
          ? { type: BLOCK.compare, fields: { OP: op }, inputs: { A: child(0), B: child(1) } }
          : { type: BLOCK.equals, fields: { OP: op }, inputs: { A: child(0), B: child(1) } };
      }
      if (LOGIC.has(op)) return { type: BLOCK.logic, fields: { OP: op }, inputs: { A: child(0), B: child(1) } };
      if (op === "not") return { type: BLOCK.not, inputs: { X: child(0) } };
      if (op === "if") return { type: BLOCK.if, inputs: { COND: child(0), THEN: child(1), ELSE: child(2) } };
      if (op === "is_missing") return { type: BLOCK.missing, inputs: { X: child(0) } };
      if (op === "coalesce") return { type: BLOCK.coalesce, inputs: { A: child(0), B: child(1) } };
      if (op === "valid_if") return { type: BLOCK.validIf, inputs: { COND: child(0), X: child(1) } };
      if (op === "between") return { type: BLOCK.between, inputs: { X: child(0), LO: child(1), HI: child(2) } };
      if (op === "one_of") {
        const list = node.args[1];
        if (list.k !== "text") throw new PuzzleError("A “one of” list must be literal text.");
        return { type: BLOCK.oneOf, fields: { LIST: list.v }, inputs: { X: child(0) } };
      }
      throw new PuzzleError(`Operator “${op}” has no puzzle piece.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Blocks → expression                                                 */
/* ------------------------------------------------------------------ */

function field(block: BlockState, name: string): string | number | undefined {
  return block.fields?.[name];
}

function opField(block: BlockState, allowed: Map<string, ExprOp> | Set<string>, label: string): ExprOp {
  const value = String(field(block, "OP") ?? "");
  if (!allowed.has(value)) throw new PuzzleError(`The ${label} piece has an unknown operator “${value}”.`);
  return value as ExprOp;
}

/** Partial conversion: empty sockets become `null` so a preview can render boxes. */
export function blockToPartial(block: BlockState | undefined | null): PartialExpr {
  if (!block) return null;
  try {
    return convert(block, true) as PartialExpr;
  } catch {
    return null;
  }
}

/** Strict conversion: every socket must be filled. Throws `PuzzleError`. */
export function blockToExpr(block: BlockState | undefined | null): ExprNode {
  if (!block) throw new PuzzleError("The canvas is empty.");
  return normalizeExpr(convert(block, false) as ExprNode);
}

function convert(block: BlockState, partial: boolean): PartialExpr {
  const input = (name: string, label: string): PartialExpr => {
    const child = block.inputs?.[name]?.block;
    if (!child) {
      if (partial) return null;
      throw new PuzzleError(`An empty socket in “${label}” — every slot must hold a piece.`);
    }
    return convert(child, partial);
  };
  const call = (op: ExprOp, ...args: PartialExpr[]): PartialExpr => ({ k: "call", op, args }) as PartialExpr;

  switch (block.type) {
    case BLOCK.num: {
      const raw = field(block, "VALUE");
      const value = typeof raw === "string" ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new PuzzleError("A number piece is not a finite number.");
      return E.num(value);
    }
    case BLOCK.text:
      return E.text(String(field(block, "VALUE") ?? ""));
    case BLOCK.bool:
      return E.bool(field(block, "VALUE") === "TRUE");
    case BLOCK.col: {
      const name = block.extraState?.name;
      if (typeof name !== "string" || name === "") throw new PuzzleError("A column piece has lost its column.");
      return E.col(name);
    }
    case BLOCK.arith:
      return call(opField(block, ARITH, "arithmetic"), input("A", "arithmetic"), input("B", "arithmetic"));
    case BLOCK.fn1:
      return call(opField(block, FN1, "function"), input("X", "function"));
    case BLOCK.fn2:
      return call(opField(block, FN2, "function"), input("A", "function"), input("B", "function"));
    case BLOCK.clamp:
      return call("clamp", input("X", "clamp"), input("LO", "clamp"), input("HI", "clamp"));
    case BLOCK.compare: {
      const op = opField(block, new Set(["lt", "le", "gt", "ge", "eq", "ne"]), "comparison");
      return call(op, input("A", "comparison"), input("B", "comparison"));
    }
    case BLOCK.equals:
      return call(opField(block, new Set(["eq", "ne"]), "“is”"), input("A", "is"), input("B", "is"));
    case BLOCK.logic:
      return call(opField(block, LOGIC, "logic"), input("A", "and / or"), input("B", "and / or"));
    case BLOCK.not:
      return call("not", input("X", "not"));
    case BLOCK.if:
      return call("if", input("COND", "if"), input("THEN", "if"), input("ELSE", "if"));
    case BLOCK.missing:
      return call("is_missing", input("X", "is missing"));
    case BLOCK.coalesce:
      return call("coalesce", input("A", "fallback"), input("B", "fallback"));
    case BLOCK.validIf:
      return call("valid_if", input("COND", "valid only if"), input("X", "valid only if"));
    case BLOCK.between:
      return call("between", input("X", "between"), input("LO", "between"), input("HI", "between"));
    case BLOCK.oneOf:
      return call("one_of", input("X", "one of"), E.text(String(field(block, "LIST") ?? "")));
    default:
      throw new PuzzleError(`“${block.type}” is not a formula piece.`);
  }
}

/* ------------------------------------------------------------------ */
/* Cohort stacks                                                       */
/* ------------------------------------------------------------------ */

const MANUALLY_DISABLED = "MANUALLY_DISABLED";

export function stepsToStack(steps: readonly CohortStep[], typeOf: TypeOf, startLabel: string): BlockState {
  let next: BlockState | undefined;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    const block: BlockState = {
      type: BLOCK.step,
      extraState: { stepId: step.id },
      fields: { KIND: step.kind, LABEL: step.label, MISSING: step.on_missing },
      inputs: { COND: { block: exprToBlock(step.expr, typeOf) } },
      ...(step.enabled ? {} : { disabledReasons: [MANUALLY_DISABLED] }),
      ...(next ? { next: { block: next } } : {}),
    };
    next = block;
  }
  return {
    type: BLOCK.cohortStart,
    x: 30,
    y: 30,
    deletable: false,
    fields: { LABEL: startLabel },
    ...(next ? { next: { block: next } } : {}),
  };
}

export interface StackReadout {
  steps: CohortStep[];
  /** Steps whose criterion socket is empty or broken, by step id. */
  problems: { stepId: string; message: string }[];
  partial: { stepId: string; expr: PartialExpr }[];
}

/**
 * Reads the step chain hanging under the start block. Steps with an empty or
 * broken criterion are reported, not silently dropped, and are left out of the
 * evaluable list until fixed.
 */
export function stackToSteps(start: BlockState | undefined, makeId: () => string): StackReadout {
  const steps: CohortStep[] = [];
  const problems: StackReadout["problems"] = [];
  const partial: StackReadout["partial"] = [];
  const seen = new Set<string>();
  let current = start?.next?.block;
  while (current) {
    if (current.type === BLOCK.step) {
      let stepId = typeof current.extraState?.stepId === "string" ? (current.extraState.stepId as string) : "";
      if (!stepId || seen.has(stepId)) stepId = makeId();
      seen.add(stepId);
      const enabled = !(current.disabledReasons?.length || current.enabled === false);
      const label = String(field(current, "LABEL") ?? "").trim();
      const kind = (field(current, "KIND") === "exclude" ? "exclude" : "include") as CohortStepKind;
      const onMissing = (field(current, "MISSING") === "keep" ? "keep" : "drop") as MissingPolicy;
      const condition = current.inputs?.COND?.block;
      partial.push({ stepId, expr: blockToPartial(condition) });
      if (!condition) {
        problems.push({ stepId, message: "Snap a yes/no condition into this step." });
      } else try {
        steps.push({ id: stepId, label, kind, expr: blockToExpr(condition), on_missing: onMissing, enabled });
      } catch (error) {
        problems.push({ stepId, message: error instanceof Error ? error.message : "This step is incomplete." });
      }
    }
    current = current.next?.block;
  }
  return { steps, problems, partial };
}
