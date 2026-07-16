/**
 * The closed diabetes signal and operator vocabulary (plan Section 7.1-7.2).
 *
 * This registry is the single contract consumed by the UI, the validator, the
 * Blockly adapter, and the server evaluator. `REGISTRY_VERSION` is semantic:
 * changing any evaluator semantics requires a new version, and `registryHash()`
 * covers the semantic surface so a silent drift is detectable.
 *
 * Blockly metadata here is inert data, never a Blockly import — the server must
 * not depend on Blockly.
 */

import { canonicalHash } from "./canonical";

export const REGISTRY_VERSION = "diabetes-v1";

/** Denominator magnitude below which protected divide yields 0. */
export const DIVIDE_EPSILON = 1e-12;
/** Lower bound applied inside protected natural log. */
export const LOG_FLOOR = 1e-12;

export const LITERAL_MIN = -1_000_000;
export const LITERAL_MAX = 1_000_000;

export type SignalId =
  | "age"
  | "bmi"
  | "systolic_bp"
  | "diastolic_bp"
  | "baseline_fasting_plasma_glucose"
  | "triglycerides"
  | "hdl_cholesterol"
  | "ldl_cholesterol"
  | "total_cholesterol";

export type OperatorId =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "abs"
  | "plog"
  | "min"
  | "max"
  | "clamp";

export interface SignalRecord {
  id: SignalId;
  label: string;
  unit: string;
  summary: string;
  blockly: { type: string; message: string; colour: number };
}

export interface OperatorRecord {
  id: OperatorId;
  arity: number;
  input_type: "number";
  output_type: "number";
  /** Deterministic, human-readable semantics; part of the registry hash. */
  semantics: string;
  /** True when the operator substitutes a fallback instead of failing. */
  protected: boolean;
  text: { form: "infix" | "function"; token: string; precedence: number };
  display: { label: string; summary: string };
  blockly: { type: string; message: string; colour: number };
  evaluate: (args: readonly number[]) => number | null;
}

/**
 * The only authorable inputs. The outcome label, follow-up FPG, and follow-up
 * duration are deliberately absent; they are evaluator-only (Section 7.1).
 */
export const SIGNALS: readonly SignalRecord[] = [
  {
    id: "age",
    label: "Age",
    unit: "years",
    summary: "Age at the baseline visit.",
    blockly: { type: "diabetes_signal_age", message: "age", colour: 210 },
  },
  {
    id: "bmi",
    label: "BMI",
    unit: "kg/m²",
    summary: "Body mass index at the baseline visit.",
    blockly: { type: "diabetes_signal_bmi", message: "BMI", colour: 210 },
  },
  {
    id: "systolic_bp",
    label: "Systolic BP",
    unit: "mmHg",
    summary: "Baseline systolic blood pressure.",
    blockly: { type: "diabetes_signal_systolic_bp", message: "systolic BP", colour: 210 },
  },
  {
    id: "diastolic_bp",
    label: "Diastolic BP",
    unit: "mmHg",
    summary: "Baseline diastolic blood pressure.",
    blockly: { type: "diabetes_signal_diastolic_bp", message: "diastolic BP", colour: 210 },
  },
  {
    id: "baseline_fasting_plasma_glucose",
    label: "Baseline FPG",
    unit: "mmol/L",
    summary: "Fasting plasma glucose at the baseline visit, before any follow-up.",
    blockly: {
      type: "diabetes_signal_baseline_fasting_plasma_glucose",
      message: "baseline FPG",
      colour: 210,
    },
  },
  {
    id: "triglycerides",
    label: "Triglycerides",
    unit: "mmol/L",
    summary: "Baseline triglycerides.",
    blockly: { type: "diabetes_signal_triglycerides", message: "triglycerides", colour: 210 },
  },
  {
    id: "hdl_cholesterol",
    label: "HDL cholesterol",
    unit: "mmol/L",
    summary: "Baseline high-density lipoprotein cholesterol.",
    blockly: { type: "diabetes_signal_hdl_cholesterol", message: "HDL", colour: 210 },
  },
  {
    id: "ldl_cholesterol",
    label: "LDL cholesterol",
    unit: "mmol/L",
    summary: "Baseline low-density lipoprotein cholesterol.",
    blockly: { type: "diabetes_signal_ldl_cholesterol", message: "LDL", colour: 210 },
  },
  {
    id: "total_cholesterol",
    label: "Total cholesterol",
    unit: "mmol/L",
    summary: "Baseline total cholesterol.",
    blockly: { type: "diabetes_signal_total_cholesterol", message: "total cholesterol", colour: 210 },
  },
];

/**
 * Evaluator-only fields. A candidate AST that names one of these is blocked with
 * a specific diagnostic rather than a generic unknown-signal message, so the
 * outcome-leak rule in Section 7.1 fails loudly.
 */
export const FORBIDDEN_SIGNAL_IDS: readonly string[] = [
  "incident_diabetes",
  "followup_fasting_plasma_glucose",
  "followup_days",
  "followup_years",
];

export const OPERATORS: readonly OperatorRecord[] = [
  {
    id: "add",
    arity: 2,
    input_type: "number",
    output_type: "number",
    semantics: "Ordinary finite addition of two numbers.",
    protected: false,
    text: { form: "infix", token: "+", precedence: 1 },
    display: { label: "Add", summary: "a + b" },
    blockly: { type: "diabetes_op_add", message: "%1 + %2", colour: 265 },
    evaluate: (args) => args[0] + args[1],
  },
  {
    id: "subtract",
    arity: 2,
    input_type: "number",
    output_type: "number",
    semantics: "Ordinary finite subtraction of two numbers.",
    protected: false,
    text: { form: "infix", token: "-", precedence: 1 },
    display: { label: "Subtract", summary: "a - b" },
    blockly: { type: "diabetes_op_subtract", message: "%1 - %2", colour: 265 },
    evaluate: (args) => args[0] - args[1],
  },
  {
    id: "multiply",
    arity: 2,
    input_type: "number",
    output_type: "number",
    semantics: "Ordinary finite multiplication of two numbers.",
    protected: false,
    text: { form: "infix", token: "*", precedence: 2 },
    display: { label: "Multiply", summary: "a × b" },
    blockly: { type: "diabetes_op_multiply", message: "%1 × %2", colour: 265 },
    evaluate: (args) => args[0] * args[1],
  },
  {
    id: "divide",
    arity: 2,
    input_type: "number",
    output_type: "number",
    semantics: `Protected division: returns 0 when abs(denominator) < ${DIVIDE_EPSILON}.`,
    protected: true,
    text: { form: "infix", token: "/", precedence: 2 },
    display: { label: "Protected divide", summary: "a ÷ b, or 0 when b is ~0" },
    blockly: { type: "diabetes_op_divide", message: "%1 ÷ %2", colour: 38 },
    evaluate: (args) => (Math.abs(args[1]) < DIVIDE_EPSILON ? 0 : args[0] / args[1]),
  },
  {
    id: "abs",
    arity: 1,
    input_type: "number",
    output_type: "number",
    semantics: "Absolute value of one number.",
    protected: false,
    text: { form: "function", token: "abs", precedence: 3 },
    display: { label: "Absolute value", summary: "abs(a)" },
    blockly: { type: "diabetes_op_abs", message: "abs ( %1 )", colour: 265 },
    evaluate: (args) => Math.abs(args[0]),
  },
  {
    id: "plog",
    arity: 1,
    input_type: "number",
    output_type: "number",
    semantics: `Protected natural log: computes log(max(value, ${LOG_FLOOR})).`,
    protected: true,
    text: { form: "function", token: "plog", precedence: 3 },
    display: { label: "Protected log", summary: "log(max(a, 1e-12))" },
    blockly: { type: "diabetes_op_plog", message: "plog ( %1 )", colour: 38 },
    evaluate: (args) => Math.log(Math.max(args[0], LOG_FLOOR)),
  },
  {
    id: "min",
    arity: 2,
    input_type: "number",
    output_type: "number",
    semantics: "Numeric minimum of two numbers.",
    protected: false,
    text: { form: "function", token: "min", precedence: 3 },
    display: { label: "Minimum", summary: "min(a, b)" },
    blockly: { type: "diabetes_op_min", message: "min ( %1 , %2 )", colour: 265 },
    evaluate: (args) => Math.min(args[0], args[1]),
  },
  {
    id: "max",
    arity: 2,
    input_type: "number",
    output_type: "number",
    semantics: "Numeric maximum of two numbers.",
    protected: false,
    text: { form: "function", token: "max", precedence: 3 },
    display: { label: "Maximum", summary: "max(a, b)" },
    blockly: { type: "diabetes_op_max", message: "max ( %1 , %2 )", colour: 265 },
    evaluate: (args) => Math.max(args[0], args[1]),
  },
  {
    id: "clamp",
    arity: 3,
    input_type: "number",
    output_type: "number",
    semantics:
      "Clamps the first argument to [lower, upper]; unavailable when lower is greater than upper.",
    protected: false,
    text: { form: "function", token: "clamp", precedence: 3 },
    display: { label: "Clamp", summary: "clamp(value, lower, upper)" },
    blockly: { type: "diabetes_op_clamp", message: "clamp %1 low %2 high %3", colour: 265 },
    evaluate: (args) => {
      const [value, lower, upper] = args;
      if (lower > upper) return null;
      return Math.min(Math.max(value, lower), upper);
    },
  },
];

const SIGNAL_BY_ID = new Map<string, SignalRecord>(SIGNALS.map((signal) => [signal.id, signal]));
const OPERATOR_BY_ID = new Map<string, OperatorRecord>(
  OPERATORS.map((operator) => [operator.id, operator]),
);

export function findSignal(id: string): SignalRecord | undefined {
  return SIGNAL_BY_ID.get(id);
}

export function findOperator(id: string): OperatorRecord | undefined {
  return OPERATOR_BY_ID.get(id);
}

export function isSignalId(id: string): id is SignalId {
  return SIGNAL_BY_ID.has(id);
}

export function isOperatorId(id: string): id is OperatorId {
  return OPERATOR_BY_ID.has(id);
}

/** The allowlisted predictor projection handed to the interpreter. */
export type PredictorRow = Record<SignalId, number>;

/**
 * One deterministic, clinically plausible row used only for the admission smoke
 * check (Section 7.3). It is synthetic and carries no cohort content.
 */
export const SMOKE_ROW: PredictorRow = {
  age: 52,
  bmi: 24.5,
  systolic_bp: 126,
  diastolic_bp: 78,
  baseline_fasting_plasma_glucose: 5.2,
  triglycerides: 1.4,
  hdl_cholesterol: 1.3,
  ldl_cholesterol: 2.8,
  total_cholesterol: 4.8,
};

/**
 * The semantic contract of the registry. Cosmetic display and Blockly labels are
 * excluded on purpose: renaming a button must not invalidate stored evaluations,
 * while changing arity, types, tokens, or documented semantics must.
 */
export function registryContract(): unknown {
  return {
    registry_version: REGISTRY_VERSION,
    literal_range: [LITERAL_MIN, LITERAL_MAX],
    signals: SIGNALS.map((signal) => ({ id: signal.id, unit: signal.unit })),
    forbidden_signals: [...FORBIDDEN_SIGNAL_IDS].sort(),
    operators: OPERATORS.map((operator) => ({
      id: operator.id,
      arity: operator.arity,
      input_type: operator.input_type,
      output_type: operator.output_type,
      protected: operator.protected,
      semantics: operator.semantics,
      text_form: operator.text.form,
      text_token: operator.text.token,
      text_precedence: operator.text.precedence,
    })),
  };
}

let cachedHash: string | null = null;

export function registryHash(): string {
  cachedHash ??= canonicalHash(registryContract());
  return cachedHash;
}
