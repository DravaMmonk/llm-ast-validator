/**
 * The workbench expression kernel.
 *
 * One typed, closed expression language serves every "puzzle" surface of the
 * workstation: cohort criteria, derived variables, Score Forge formulas, and the
 * clinical calculator library. It generalizes the diabetes AST kernel in
 * `shared/ast` from a fixed signal registry to any dataset schema, and from
 * numbers only to three value types.
 *
 * Like that kernel it never uses `eval`, `Function`, SQL, or a shell: an
 * already parsed tree is walked through the operator table below.
 *
 * Missing data is first-class. Any value may be `null` (missing); operators
 * propagate it unless they are defined over it (`is_missing`, `coalesce`, and
 * the three-valued `and` / `or`). An undefined arithmetic result — division by
 * zero, the log of a non-positive number — is also `null`, never `Infinity` or
 * `NaN`, so a derived column can never smuggle a non-finite value into an
 * analysis.
 */

import { canonicalHash, normalizeZero } from "../ast/canonical";

export const EXPR_VERSION = "wb-expr-1";

/** Structural limits, generous enough for clinical scores with many branches. */
export const EXPR_MAX_NODES = 400;
export const EXPR_MAX_DEPTH = 40;
export const EXPR_TEXT_MAX_LENGTH = 400;
export const COLUMN_NAME_MAX_LENGTH = 128;

export type ValueType = "number" | "boolean" | "text";
export type Value = number | boolean | string | null;

export type ExprOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "pow"
  | "neg"
  | "abs"
  | "sqrt"
  | "ln"
  | "log10"
  | "exp"
  | "floor"
  | "ceil"
  | "round"
  | "min"
  | "max"
  | "clamp"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "eq"
  | "ne"
  | "and"
  | "or"
  | "not"
  | "if"
  | "is_missing"
  | "coalesce"
  | "valid_if"
  | "between"
  | "one_of";

export type ExprNode =
  | { k: "num"; v: number }
  | { k: "text"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "col"; name: string }
  | { k: "call"; op: ExprOp; args: ExprNode[] };

/** A parameter type; `T` binds every `T` of one call to the same type. */
type ParamType = ValueType | "T" | "any";

export type OpGroup = "arithmetic" | "function" | "compare" | "logic" | "conditional" | "missing";

export type OpText =
  | { kind: "infix"; token: string; prec: number; assoc: "left" | "right" | "none" }
  | { kind: "prefix"; token: string; prec: number }
  | { kind: "function"; name: string };

export interface OpSpec {
  id: ExprOp;
  label: string;
  summary: string;
  group: OpGroup;
  params: ParamType[];
  result: ValueType | "T";
  text: OpText;
  /** Receives possibly-missing arguments; returns `null` for "undefined". */
  evaluate: (args: Value[]) => Value;
}

/** Infix and prefix binding power, low → high. */
export const PREC = { or: 1, and: 2, not: 3, compare: 4, additive: 5, multiplicative: 6, unary: 7, power: 8 } as const;

const num = (value: Value): value is number => typeof value === "number";
const finite = (value: number): number | null => (Number.isFinite(value) ? normalizeZero(value) : null);

/** Every argument present, else `null`: the default missing-data policy. */
function strict(fn: (args: Value[]) => Value): (args: Value[]) => Value {
  return (args) => (args.some((arg) => arg === null) ? null : fn(args));
}

function numeric1(fn: (x: number) => number | null): (args: Value[]) => Value {
  return strict(([x]) => {
    const out = fn(x as number);
    return out === null ? null : finite(out);
  });
}

function numeric2(fn: (a: number, b: number) => number | null): (args: Value[]) => Value {
  return strict(([a, b]) => {
    const out = fn(a as number, b as number);
    return out === null ? null : finite(out);
  });
}

/** Round half away from zero — the convention clinicians expect on paper. */
export function roundHalfAwayFromZero(x: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = Math.abs(x) * factor;
  // A tiny relative nudge absorbs binary representation error (1.005 → 1.01).
  const rounded = Math.round(scaled * (1 + Number.EPSILON * 4)) / factor;
  return Math.sign(x) * rounded;
}

function compare(fn: (a: number, b: number) => boolean) {
  return strict(([a, b]) => fn(a as number, b as number));
}

const infix = (token: string, prec: number, assoc: "left" | "right" | "none" = "left"): OpText => ({
  kind: "infix",
  token,
  prec,
  assoc,
});
const fn = (name: string): OpText => ({ kind: "function", name });

export const OPS: readonly OpSpec[] = [
  {
    id: "add",
    label: "Add",
    summary: "a + b",
    group: "arithmetic",
    params: ["number", "number"],
    result: "number",
    text: infix("+", PREC.additive),
    evaluate: numeric2((a, b) => a + b),
  },
  {
    id: "sub",
    label: "Subtract",
    summary: "a − b",
    group: "arithmetic",
    params: ["number", "number"],
    result: "number",
    text: infix("-", PREC.additive),
    evaluate: numeric2((a, b) => a - b),
  },
  {
    id: "mul",
    label: "Multiply",
    summary: "a × b",
    group: "arithmetic",
    params: ["number", "number"],
    result: "number",
    text: infix("*", PREC.multiplicative),
    evaluate: numeric2((a, b) => a * b),
  },
  {
    id: "div",
    label: "Divide",
    summary: "a ÷ b — missing when b is 0",
    group: "arithmetic",
    params: ["number", "number"],
    result: "number",
    text: infix("/", PREC.multiplicative),
    evaluate: numeric2((a, b) => (b === 0 ? null : a / b)),
  },
  {
    id: "pow",
    label: "Power",
    summary: "a ^ b — missing when undefined (e.g. negative base, fractional power)",
    group: "arithmetic",
    params: ["number", "number"],
    result: "number",
    text: infix("^", PREC.power, "right"),
    evaluate: numeric2((a, b) => a ** b),
  },
  {
    id: "neg",
    label: "Negate",
    summary: "−a",
    group: "arithmetic",
    params: ["number"],
    result: "number",
    text: { kind: "prefix", token: "-", prec: PREC.unary },
    evaluate: numeric1((x) => -x),
  },
  {
    id: "abs",
    label: "Absolute value",
    summary: "|a|",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("abs"),
    evaluate: numeric1(Math.abs),
  },
  {
    id: "sqrt",
    label: "Square root",
    summary: "√a — missing when a < 0",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("sqrt"),
    evaluate: numeric1((x) => (x < 0 ? null : Math.sqrt(x))),
  },
  {
    id: "ln",
    label: "Natural log",
    summary: "ln(a) — missing when a ≤ 0",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("ln"),
    evaluate: numeric1((x) => (x <= 0 ? null : Math.log(x))),
  },
  {
    id: "log10",
    label: "Log base 10",
    summary: "log₁₀(a) — missing when a ≤ 0",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("log10"),
    evaluate: numeric1((x) => (x <= 0 ? null : Math.log10(x))),
  },
  {
    id: "exp",
    label: "Exponential",
    summary: "eᵃ",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("exp"),
    evaluate: numeric1(Math.exp),
  },
  {
    id: "floor",
    label: "Floor",
    summary: "largest integer ≤ a",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("floor"),
    evaluate: numeric1(Math.floor),
  },
  {
    id: "ceil",
    label: "Ceiling",
    summary: "smallest integer ≥ a",
    group: "function",
    params: ["number"],
    result: "number",
    text: fn("ceil"),
    evaluate: numeric1(Math.ceil),
  },
  {
    id: "round",
    label: "Round",
    summary: "round(a, digits) — half away from zero; digits 0–10",
    group: "function",
    params: ["number", "number"],
    result: "number",
    text: fn("round"),
    evaluate: numeric2((x, digits) =>
      Number.isInteger(digits) && digits >= 0 && digits <= 10 ? roundHalfAwayFromZero(x, digits) : null,
    ),
  },
  {
    id: "min",
    label: "Minimum",
    summary: "min(a, b)",
    group: "function",
    params: ["number", "number"],
    result: "number",
    text: fn("min"),
    evaluate: numeric2(Math.min),
  },
  {
    id: "max",
    label: "Maximum",
    summary: "max(a, b)",
    group: "function",
    params: ["number", "number"],
    result: "number",
    text: fn("max"),
    evaluate: numeric2(Math.max),
  },
  {
    id: "clamp",
    label: "Clamp",
    summary: "clamp(a, low, high) — missing when low > high",
    group: "function",
    params: ["number", "number", "number"],
    result: "number",
    text: fn("clamp"),
    evaluate: strict(([x, lo, hi]) => {
      const [a, l, h] = [x as number, lo as number, hi as number];
      return l > h ? null : Math.min(Math.max(a, l), h);
    }),
  },
  {
    id: "lt",
    label: "Less than",
    summary: "a < b",
    group: "compare",
    params: ["number", "number"],
    result: "boolean",
    text: infix("<", PREC.compare, "none"),
    evaluate: compare((a, b) => a < b),
  },
  {
    id: "le",
    label: "At most",
    summary: "a ≤ b",
    group: "compare",
    params: ["number", "number"],
    result: "boolean",
    text: infix("<=", PREC.compare, "none"),
    evaluate: compare((a, b) => a <= b),
  },
  {
    id: "gt",
    label: "Greater than",
    summary: "a > b",
    group: "compare",
    params: ["number", "number"],
    result: "boolean",
    text: infix(">", PREC.compare, "none"),
    evaluate: compare((a, b) => a > b),
  },
  {
    id: "ge",
    label: "At least",
    summary: "a ≥ b",
    group: "compare",
    params: ["number", "number"],
    result: "boolean",
    text: infix(">=", PREC.compare, "none"),
    evaluate: compare((a, b) => a >= b),
  },
  {
    id: "eq",
    label: "Equals",
    summary: "a = b (numbers, text, or yes/no)",
    group: "compare",
    params: ["T", "T"],
    result: "boolean",
    text: infix("==", PREC.compare, "none"),
    evaluate: strict(([a, b]) => a === b),
  },
  {
    id: "ne",
    label: "Not equal",
    summary: "a ≠ b (numbers, text, or yes/no)",
    group: "compare",
    params: ["T", "T"],
    result: "boolean",
    text: infix("!=", PREC.compare, "none"),
    evaluate: strict(([a, b]) => a !== b),
  },
  {
    id: "and",
    label: "And",
    summary: "both true — false wins over missing",
    group: "logic",
    params: ["boolean", "boolean"],
    result: "boolean",
    text: infix("and", PREC.and),
    evaluate: ([a, b]) => (a === false || b === false ? false : a === null || b === null ? null : true),
  },
  {
    id: "or",
    label: "Or",
    summary: "either true — true wins over missing",
    group: "logic",
    params: ["boolean", "boolean"],
    result: "boolean",
    text: infix("or", PREC.or),
    evaluate: ([a, b]) => (a === true || b === true ? true : a === null || b === null ? null : false),
  },
  {
    id: "not",
    label: "Not",
    summary: "negates a condition",
    group: "logic",
    params: ["boolean"],
    result: "boolean",
    text: { kind: "prefix", token: "not", prec: PREC.not },
    evaluate: strict(([a]) => !a),
  },
  {
    id: "if",
    label: "If / then / else",
    summary: "if(condition, then, else) — missing when the condition is missing",
    group: "conditional",
    params: ["boolean", "T", "T"],
    result: "T",
    text: fn("if"),
    evaluate: ([condition, then, otherwise]) => (condition === null ? null : condition ? then : otherwise),
  },
  {
    id: "is_missing",
    label: "Is missing",
    summary: "true when the value is missing",
    group: "missing",
    params: ["any"],
    result: "boolean",
    text: fn("is_missing"),
    evaluate: ([value]) => value === null,
  },
  {
    id: "coalesce",
    label: "Fallback",
    summary: "coalesce(a, b) — a, or b when a is missing",
    group: "missing",
    params: ["T", "T"],
    result: "T",
    text: fn("coalesce"),
    evaluate: ([a, b]) => (a === null ? b : a),
  },
  {
    id: "valid_if",
    label: "Valid only if",
    summary: "valid_if(condition, value) — the value, or missing when the condition is not met",
    group: "missing",
    params: ["boolean", "T"],
    result: "T",
    text: fn("valid_if"),
    evaluate: ([condition, value]) => (condition === true ? value : null),
  },
  {
    id: "between",
    label: "Between",
    summary: "between(a, low, high) — inclusive range check",
    group: "compare",
    params: ["number", "number", "number"],
    result: "boolean",
    text: fn("between"),
    evaluate: strict(([x, lo, hi]) => (x as number) >= (lo as number) && (x as number) <= (hi as number)),
  },
  {
    id: "one_of",
    label: "Is one of",
    summary: 'one_of(text, "a, b, c") — membership in a comma-separated list',
    group: "compare",
    params: ["text", "text"],
    result: "boolean",
    text: fn("one_of"),
    evaluate: strict(([value, list]) => splitList(list as string).includes(value as string)),
  },
];

/** The comma-separated member list of `one_of`, trimmed, empties dropped. */
export function splitList(list: string): string[] {
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

const OP_BY_ID = new Map<string, OpSpec>(OPS.map((op) => [op.id, op]));
const OP_BY_FUNCTION = new Map<string, OpSpec>(
  OPS.filter((op) => op.text.kind === "function").map((op) => [(op.text as { name: string }).name, op]),
);

export function findOp(id: string): OpSpec | undefined {
  return OP_BY_ID.get(id);
}

export function findFunctionOp(name: string): OpSpec | undefined {
  return OP_BY_FUNCTION.get(name);
}

/* ------------------------------------------------------------------ */
/* Constructors — terse builders for code and tests.                   */
/* ------------------------------------------------------------------ */

export const E = {
  num: (v: number): ExprNode => ({ k: "num", v: normalizeZero(v) }),
  text: (v: string): ExprNode => ({ k: "text", v }),
  bool: (v: boolean): ExprNode => ({ k: "bool", v }),
  col: (name: string): ExprNode => ({ k: "col", name }),
  call: (op: ExprOp, ...args: ExprNode[]): ExprNode => ({ k: "call", op, args }),
};

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface ExprDiagnostic {
  code: string;
  path: string;
  message: string;
}

const diag = (code: string, path: string, message: string): ExprDiagnostic => ({ code, path, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structurally validates untrusted JSON (a stored document, a request body)
 * into an expression tree. It is schema-free: column existence and types are
 * checked separately by `checkExpr`, against the dataset at hand.
 */
export function parseExprJson(
  input: unknown,
  path = "$",
): { node: ExprNode | null; diagnostics: ExprDiagnostic[] } {
  const diagnostics: ExprDiagnostic[] = [];
  let count = 0;

  const walk = (value: unknown, at: string, depth: number): ExprNode | null => {
    count += 1;
    if (count > EXPR_MAX_NODES) {
      if (count === EXPR_MAX_NODES + 1) {
        diagnostics.push(diag("NODE_LIMIT_EXCEEDED", at, `Expressions are limited to ${EXPR_MAX_NODES} nodes.`));
      }
      return null;
    }
    if (depth > EXPR_MAX_DEPTH) {
      diagnostics.push(diag("DEPTH_LIMIT_EXCEEDED", at, `Expressions may nest at most ${EXPR_MAX_DEPTH} levels.`));
      return null;
    }
    if (!isRecord(value)) {
      diagnostics.push(diag("NODE_NOT_OBJECT", at, "An expression node must be an object."));
      return null;
    }
    const allow = (keys: string[]) => {
      for (const key of Object.keys(value)) {
        if (!keys.includes(key)) diagnostics.push(diag("UNKNOWN_FIELD", `${at}.${key}`, "Undeclared field."));
      }
    };
    switch (value.k) {
      case "num": {
        allow(["k", "v"]);
        if (typeof value.v !== "number" || !Number.isFinite(value.v)) {
          diagnostics.push(diag("INVALID_NUMBER", `${at}.v`, "A number must be finite."));
          return null;
        }
        return { k: "num", v: normalizeZero(value.v) };
      }
      case "text": {
        allow(["k", "v"]);
        if (typeof value.v !== "string" || value.v.length > EXPR_TEXT_MAX_LENGTH) {
          diagnostics.push(
            diag("INVALID_TEXT", `${at}.v`, `Text must be a string of at most ${EXPR_TEXT_MAX_LENGTH} characters.`),
          );
          return null;
        }
        return { k: "text", v: value.v };
      }
      case "bool": {
        allow(["k", "v"]);
        if (typeof value.v !== "boolean") {
          diagnostics.push(diag("INVALID_BOOLEAN", `${at}.v`, "A yes/no value must be true or false."));
          return null;
        }
        return { k: "bool", v: value.v };
      }
      case "col": {
        allow(["k", "name"]);
        if (!isValidColumnName(value.name)) {
          diagnostics.push(
            diag("INVALID_COLUMN_NAME", `${at}.name`, `A column name must be 1–${COLUMN_NAME_MAX_LENGTH} characters.`),
          );
          return null;
        }
        return { k: "col", name: value.name as string };
      }
      case "call": {
        allow(["k", "op", "args"]);
        const spec = typeof value.op === "string" ? findOp(value.op) : undefined;
        if (!spec) {
          diagnostics.push(diag("UNKNOWN_OPERATOR", `${at}.op`, `Operator “${String(value.op)}” is not in the vocabulary.`));
          return null;
        }
        if (!Array.isArray(value.args)) {
          diagnostics.push(diag("ARGS_NOT_ARRAY", `${at}.args`, "Operator arguments must be an array."));
          return null;
        }
        if (value.args.length !== spec.params.length) {
          diagnostics.push(
            diag(
              "ARITY_MISMATCH",
              `${at}.args`,
              `${spec.label} takes ${spec.params.length} argument(s); received ${value.args.length}.`,
            ),
          );
          return null;
        }
        const args = value.args.map((arg, index) => walk(arg, `${at}.args[${index}]`, depth + 1));
        if (args.some((arg) => arg === null)) return null;
        return { k: "call", op: spec.id, args: args as ExprNode[] };
      }
      default:
        diagnostics.push(diag("UNKNOWN_NODE_KIND", `${at}.k`, "Node kind must be num, text, bool, col, or call."));
        return null;
    }
  };

  const node = walk(input, path, 1);
  return { node: diagnostics.length === 0 ? node : null, diagnostics };
}

export function isValidColumnName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= COLUMN_NAME_MAX_LENGTH &&
    // Control characters would make the text form unprintable.
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

/* ------------------------------------------------------------------ */
/* Type checking                                                       */
/* ------------------------------------------------------------------ */

/** Resolves a column name to its value type, or `undefined` when unknown. */
export type SchemaLookup = (name: string) => ValueType | undefined;

export interface TypeCheckResult {
  type: ValueType | null;
  diagnostics: ExprDiagnostic[];
  /** Distinct column names the expression reads, in first-use order. */
  columns: string[];
}

export const TYPE_LABEL: Record<ValueType, string> = { number: "number", boolean: "yes/no", text: "text" };

/**
 * Infers the result type and reports every type error with its path. A result
 * with diagnostics has `type: null`.
 */
export function checkExpr(node: ExprNode, schema: SchemaLookup, path = "$"): TypeCheckResult {
  const diagnostics: ExprDiagnostic[] = [];
  const columns: string[] = [];

  const visit = (current: ExprNode, at: string): ValueType | null => {
    switch (current.k) {
      case "num":
        return "number";
      case "text":
        return "text";
      case "bool":
        return "boolean";
      case "col": {
        if (!columns.includes(current.name)) columns.push(current.name);
        const type = schema(current.name);
        if (!type) {
          diagnostics.push(diag("UNKNOWN_COLUMN", at, `Column “${current.name}” does not exist in this dataset.`));
          return null;
        }
        return type;
      }
      case "call": {
        const spec = findOp(current.op)!;
        const argTypes = current.args.map((arg, index) => visit(arg, `${at}.args[${index}]`));
        let bound: ValueType | null = null;
        let failed = argTypes.some((type) => type === null);

        spec.params.forEach((param, index) => {
          const actual = argTypes[index];
          if (actual === null || param === "any") return;
          if (param === "T") {
            if (bound === null) bound = actual;
            else if (bound !== actual) {
              failed = true;
              diagnostics.push(
                diag(
                  "TYPE_MISMATCH",
                  `${at}.args[${index}]`,
                  `${spec.label} needs matching types; got ${TYPE_LABEL[bound]} and ${TYPE_LABEL[actual]}.`,
                ),
              );
            }
            return;
          }
          if (param !== actual) {
            failed = true;
            diagnostics.push(
              diag(
                "TYPE_MISMATCH",
                `${at}.args[${index}]`,
                `${spec.label} expects ${TYPE_LABEL[param]} here, not ${TYPE_LABEL[actual]}.`,
              ),
            );
          }
        });

        // `one_of` reads its member list at authoring time, so it must be literal.
        if (current.op === "one_of" && current.args[1]?.k !== "text") {
          failed = true;
          diagnostics.push(diag("LIST_NOT_LITERAL", `${at}.args[1]`, "The list of values must be literal text."));
        }

        if (failed) return null;
        return spec.result === "T" ? bound : spec.result;
      }
    }
  };

  const type = visit(node, path);
  return { type: diagnostics.length === 0 ? type : null, diagnostics, columns };
}

/**
 * The canonical tree: a negated literal is folded into the literal, exactly as
 * the text parser does, so a puzzle and its text twin hash identically.
 */
export function normalizeExpr(node: ExprNode): ExprNode {
  if (node.k !== "call") return node;
  const args = node.args.map(normalizeExpr);
  if (node.op === "neg" && args[0].k === "num") return E.num(-args[0].v);
  return { k: "call", op: node.op, args };
}

/** Node count and nesting depth, as the limits count them. */
export function measureExpr(node: ExprNode): { nodes: number; depth: number } {
  if (node.k !== "call") return { nodes: 1, depth: 1 };
  let nodes = 1;
  let depth = 0;
  for (const arg of node.args) {
    const child = measureExpr(arg);
    nodes += child.nodes;
    depth = Math.max(depth, child.depth);
  }
  return { nodes, depth: depth + 1 };
}

/** Every column the expression reads, in first-use order. */
export function exprColumns(node: ExprNode): string[] {
  const out: string[] = [];
  const visit = (current: ExprNode) => {
    if (current.k === "col") {
      if (!out.includes(current.name)) out.push(current.name);
    } else if (current.k === "call") current.args.forEach(visit);
  };
  visit(node);
  return out;
}

/** Returns a copy with column references replaced by whole expressions. */
export function substituteColumns(node: ExprNode, mapping: Readonly<Record<string, ExprNode>>): ExprNode {
  if (node.k === "col") return mapping[node.name] ?? node;
  if (node.k === "call") return { k: "call", op: node.op, args: node.args.map((arg) => substituteColumns(arg, mapping)) };
  return node;
}

/** Returns a copy with column references renamed through `mapping`. */
export function renameColumns(node: ExprNode, mapping: Record<string, string>): ExprNode {
  if (node.k === "col") return { k: "col", name: mapping[node.name] ?? node.name };
  if (node.k === "call") return { k: "call", op: node.op, args: node.args.map((arg) => renameColumns(arg, mapping)) };
  return node;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/** Evaluates against one record — calculators and single-patient previews. */
export function evaluateExpr(node: ExprNode, row: Readonly<Record<string, Value | undefined>>): Value {
  switch (node.k) {
    case "num":
    case "text":
    case "bool":
      return node.v;
    case "col": {
      const value = row[node.name];
      return value === undefined || (typeof value === "number" && !Number.isFinite(value)) ? null : value;
    }
    case "call": {
      const spec = findOp(node.op)!;
      return spec.evaluate(node.args.map((arg) => evaluateExpr(arg, row)));
    }
  }
}

/** Column storage the compiler reads from: one array per column. */
export type ColumnSource = (name: string) => ArrayLike<Value> | undefined;

/**
 * Compiles an expression into a row-index closure for fast evaluation over a
 * whole dataset. Unknown columns read as missing; callers type-check first.
 */
export function compileExpr(node: ExprNode, source: ColumnSource): (row: number) => Value {
  switch (node.k) {
    case "num":
    case "text":
    case "bool": {
      const value = node.v;
      return () => value;
    }
    case "col": {
      const column = source(node.name);
      if (!column) return () => null;
      return (row) => {
        const value = column[row];
        return value === undefined || (typeof value === "number" && !Number.isFinite(value)) ? null : value;
      };
    }
    case "call": {
      const spec = findOp(node.op)!;
      const args = node.args.map((arg) => compileExpr(arg, source));
      if (args.length === 1) {
        const [a] = args;
        return (row) => spec.evaluate([a(row)]);
      }
      if (args.length === 2) {
        const [a, b] = args;
        return (row) => spec.evaluate([a(row), b(row)]);
      }
      return (row) => spec.evaluate(args.map((arg) => arg(row)));
    }
  }
}

/** Evaluates over `rowCount` rows into a fresh array. */
export function evaluateColumn(node: ExprNode, source: ColumnSource, rowCount: number): Value[] {
  const run = compileExpr(node, source);
  const out = new Array<Value>(rowCount);
  for (let row = 0; row < rowCount; row += 1) out[row] = run(row);
  return out;
}

/** Stable identity of an expression for provenance and caching. */
export function hashExpr(node: ExprNode): string {
  return canonicalHash({ version: EXPR_VERSION, node });
}

export function isNumberValue(value: Value): value is number {
  return num(value);
}
