/**
 * The deterministic AST 1.0 kernel (plan Section 7.3).
 *
 * The kernel is the authority for admission and execution and is shared by the
 * browser and the server. It walks an already parsed tree through the closed
 * operator registry: no `eval`, no `Function`, no SQL, no shell.
 *
 * Every formula is scalar numeric. The pose/video series vocabulary the earlier
 * demo carried is deliberately gone; it is not part of the diabetes contract.
 */

import { canonicalHash, normalizeZero } from "./canonical";
import type { OperatorId, PredictorRow, SignalId } from "./registry";
import {
  FORBIDDEN_SIGNAL_IDS,
  LITERAL_MAX,
  LITERAL_MIN,
  REGISTRY_VERSION,
  SMOKE_ROW,
  findOperator,
  findSignal,
  registryHash,
} from "./registry";

export const AST_VERSION = "1.0";
export const VALIDATOR_VERSION = "v1";

/** Section 7.3 structural limits. */
export const MAX_NODE_COUNT = 128;
export const MAX_DEPTH = 16;

export type AstNode =
  | { node_type: "literal"; value: number }
  | { node_type: "ref"; ref_type: "signal"; id: SignalId }
  | { node_type: "call"; op: OperatorId; args: AstNode[] };

export interface AstDocument {
  ast_version: typeof AST_VERSION;
  root: AstNode;
}

export type DiagnosticPhase = "schema" | "vocabulary" | "limit" | "policy" | "runtime";

export interface Diagnostic {
  phase: DiagnosticPhase;
  code: string;
  path: string;
  message: string;
}

export interface ProtectedOperationNote {
  op: OperatorId;
  path: string;
  fallback: string;
}

export interface ValidationReport {
  validator_version: string;
  ast_schema_version: string;
  registry_version: string;
  registry_hash: string;
  diagnostics: Diagnostic[];
  metrics: { node_count: number; depth: number };
  /** Section 7.3: protected operations must report their fallback explicitly. */
  protected_operations: ProtectedOperationNote[];
  smoke: { value: number | null; finite: boolean } | null;
}

export interface AdmissionResult {
  state: "admitted" | "blocked";
  document: AstDocument | null;
  ast_hash: string | null;
  report: ValidationReport;
}

export interface EvaluationResult {
  value: number | null;
  diagnostics: Diagnostic[];
}

function issue(phase: DiagnosticPhase, code: string, path: string, message: string): Diagnostic {
  return { phase, code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(
        issue("schema", "UNKNOWN_FIELD", `${path}.${key}`, "Payload contains an undeclared field."),
      );
    }
  }
}

function parseNode(input: unknown, path: string, diagnostics: Diagnostic[]): AstNode | null {
  if (!isRecord(input)) {
    diagnostics.push(issue("schema", "NODE_NOT_OBJECT", path, "AST node must be an object."));
    return null;
  }

  if (input.node_type === "literal") {
    rejectUnknownFields(input, ["node_type", "value"], path, diagnostics);
    const value = input.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      diagnostics.push(
        issue("schema", "INVALID_LITERAL", `${path}.value`, "Literal must be a finite number."),
      );
      return null;
    }
    if (value < LITERAL_MIN || value > LITERAL_MAX) {
      diagnostics.push(
        issue(
          "limit",
          "LITERAL_OUT_OF_RANGE",
          `${path}.value`,
          `Literal must lie within [${LITERAL_MIN}, ${LITERAL_MAX}].`,
        ),
      );
      return null;
    }
    return { node_type: "literal", value: normalizeZero(value) };
  }

  if (input.node_type === "ref") {
    rejectUnknownFields(input, ["node_type", "ref_type", "id"], path, diagnostics);
    if (input.ref_type !== "signal") {
      diagnostics.push(
        issue("schema", "INVALID_REFERENCE", `${path}.ref_type`, "Reference must name a signal."),
      );
      return null;
    }
    const id = input.id;
    if (typeof id !== "string" || id === "") {
      diagnostics.push(
        issue("schema", "INVALID_REFERENCE", `${path}.id`, "Signal reference must be a non-empty string."),
      );
      return null;
    }
    // Outcome and follow-up fields are evaluator-only; name them precisely so a
    // leak attempt is unmistakable rather than a generic unknown-signal error.
    if (FORBIDDEN_SIGNAL_IDS.includes(id)) {
      diagnostics.push(
        issue(
          "policy",
          "OUTCOME_REFERENCE_FORBIDDEN",
          `${path}.id`,
          `“${id}” is an evaluator-only field and must not appear in a candidate formula.`,
        ),
      );
      return null;
    }
    if (!findSignal(id)) {
      diagnostics.push(
        issue("vocabulary", "UNKNOWN_SIGNAL", `${path}.id`, `Signal “${id}” is not declared.`),
      );
      return null;
    }
    return { node_type: "ref", ref_type: "signal", id: id as SignalId };
  }

  if (input.node_type === "call") {
    rejectUnknownFields(input, ["node_type", "op", "args"], path, diagnostics);
    const op = input.op;
    if (typeof op !== "string" || !findOperator(op)) {
      diagnostics.push(
        issue(
          "vocabulary",
          "UNKNOWN_OPERATOR",
          `${path}.op`,
          `Operator “${String(op)}” is not in the registered vocabulary.`,
        ),
      );
      return null;
    }
    if (!Array.isArray(input.args)) {
      diagnostics.push(issue("schema", "ARGS_NOT_ARRAY", `${path}.args`, "Operator args must be an array."));
      return null;
    }
    const record = findOperator(op)!;
    if (input.args.length !== record.arity) {
      diagnostics.push(
        issue(
          "schema",
          "ARITY_MISMATCH",
          `${path}.args`,
          `Operator “${op}” expects ${record.arity} argument(s); received ${input.args.length}.`,
        ),
      );
      return null;
    }
    const args = input.args.map((entry, index) => parseNode(entry, `${path}.args[${index}]`, diagnostics));
    if (args.some((entry) => entry === null)) return null;
    return { node_type: "call", op: op as OperatorId, args: args as AstNode[] };
  }

  diagnostics.push(
    issue("schema", "UNKNOWN_NODE_TYPE", `${path}.node_type`, "Node type must be literal, ref, or call."),
  );
  return null;
}

function measure(node: AstNode): { node_count: number; depth: number } {
  if (node.node_type !== "call") return { node_count: 1, depth: 1 };
  let count = 1;
  let deepest = 0;
  for (const arg of node.args) {
    const child = measure(arg);
    count += child.node_count;
    deepest = Math.max(deepest, child.depth);
  }
  return { node_count: count, depth: deepest + 1 };
}

function collectProtectedOperations(node: AstNode, path: string): ProtectedOperationNote[] {
  if (node.node_type !== "call") return [];
  const record = findOperator(node.op)!;
  const here: ProtectedOperationNote[] = record.protected
    ? [{ op: node.op, path, fallback: record.semantics }]
    : [];
  return node.args.reduce<ProtectedOperationNote[]>(
    (all, arg, index) => all.concat(collectProtectedOperations(arg, `${path}.args[${index}]`)),
    here,
  );
}

/**
 * Validates an untrusted document against the schema, vocabulary, limits, and
 * outcome policy, then proves it produces a finite value on one deterministic
 * synthetic smoke row. Only an admitted result carries a canonical AST hash.
 */
export function admit(input: unknown): AdmissionResult {
  const diagnostics: Diagnostic[] = [];

  const blocked = (document: AstDocument | null, extra: Partial<ValidationReport> = {}): AdmissionResult => ({
    state: "blocked",
    document: null,
    ast_hash: null,
    report: {
      validator_version: VALIDATOR_VERSION,
      ast_schema_version: AST_VERSION,
      registry_version: REGISTRY_VERSION,
      registry_hash: registryHash(),
      diagnostics,
      metrics: { node_count: 0, depth: 0 },
      protected_operations: [],
      smoke: null,
      ...extra,
    },
  });

  if (!isRecord(input)) {
    diagnostics.push(issue("schema", "DOCUMENT_NOT_OBJECT", "$", "AST document must be an object."));
    return blocked(null);
  }
  rejectUnknownFields(input, ["ast_version", "root"], "$", diagnostics);
  if (input.ast_version !== AST_VERSION) {
    diagnostics.push(
      issue(
        "schema",
        "UNSUPPORTED_AST_VERSION",
        "$.ast_version",
        `Expected AST version ${AST_VERSION}; received ${JSON.stringify(input.ast_version) ?? "nothing"}.`,
      ),
    );
  }

  const root = parseNode(input.root, "$.root", diagnostics);
  if (!root) return blocked(null);

  const metrics = measure(root);
  if (metrics.node_count > MAX_NODE_COUNT) {
    diagnostics.push(
      issue("limit", "NODE_LIMIT_EXCEEDED", "$.root", `Formula uses ${metrics.node_count} nodes; the limit is ${MAX_NODE_COUNT}.`),
    );
  }
  if (metrics.depth > MAX_DEPTH) {
    diagnostics.push(
      issue("limit", "DEPTH_LIMIT_EXCEEDED", "$.root", `Formula nests ${metrics.depth} levels; the limit is ${MAX_DEPTH}.`),
    );
  }

  const document: AstDocument = { ast_version: AST_VERSION, root };
  const protectedOperations = collectProtectedOperations(root, "$.root");

  if (diagnostics.length > 0) {
    return blocked(document, { metrics, protected_operations: protectedOperations });
  }

  // Section 7.3: an admitted formula must produce a finite value on a smoke row.
  const smoke = evaluate(document, SMOKE_ROW);
  const finite = smoke.value !== null && Number.isFinite(smoke.value);
  if (!finite) {
    diagnostics.push(
      issue(
        "runtime",
        "SMOKE_ROW_NOT_FINITE",
        "$.root",
        "Formula did not produce a finite value on the deterministic smoke row.",
      ),
      ...smoke.diagnostics,
    );
    return blocked(document, {
      metrics,
      protected_operations: protectedOperations,
      smoke: { value: smoke.value, finite: false },
    });
  }

  return {
    state: "admitted",
    document,
    ast_hash: canonicalHash(document),
    report: {
      validator_version: VALIDATOR_VERSION,
      ast_schema_version: AST_VERSION,
      registry_version: REGISTRY_VERSION,
      registry_hash: registryHash(),
      diagnostics: [],
      metrics,
      protected_operations: protectedOperations,
      smoke: { value: smoke.value, finite: true },
    },
  };
}

/**
 * Executes an admitted document against one allowlisted predictor projection.
 * Any unavailable input or non-finite intermediate yields `null`; Section 8.3
 * then fails the whole candidate evaluation rather than storing partial metrics.
 */
export function evaluate(document: AstDocument, row: PredictorRow): EvaluationResult {
  const diagnostics: Diagnostic[] = [];

  const run = (node: AstNode, path: string): number | null => {
    if (node.node_type === "literal") return node.value;

    if (node.node_type === "ref") {
      const value = row[node.id];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        diagnostics.push(
          issue("runtime", "SIGNAL_UNAVAILABLE", `${path}.id`, `Signal “${node.id}” is unavailable for this row.`),
        );
        return null;
      }
      return value;
    }

    const args: number[] = [];
    for (const [index, arg] of node.args.entries()) {
      const value = run(arg, `${path}.args[${index}]`);
      if (value === null) return null;
      args.push(value);
    }

    const record = findOperator(node.op)!;
    const result = record.evaluate(args);
    if (result === null) {
      diagnostics.push(
        issue("runtime", "OPERATION_UNAVAILABLE", path, `Operator “${node.op}” could not produce a value: ${record.semantics}`),
      );
      return null;
    }
    if (!Number.isFinite(result)) {
      diagnostics.push(
        issue("runtime", "NON_FINITE_RESULT", path, `Operator “${node.op}” produced a non-finite value.`),
      );
      return null;
    }
    return result;
  };

  const value = run(document.root, "$.root");
  return { value: value === null ? null : normalizeZero(value), diagnostics };
}

/** Canonical hash of an already admitted document (Section 7.4). */
export function hashDocument(document: AstDocument): string {
  return canonicalHash(document);
}
