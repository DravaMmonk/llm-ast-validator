import { describe, expect, it } from "vitest";

import {
  AST_VERSION,
  MAX_DEPTH,
  MAX_NODE_COUNT,
  type AstDocument,
  type AstNode,
  admit,
  evaluate,
  hashDocument,
} from "./core";
import { DIVIDE_EPSILON, LOG_FLOOR, SMOKE_ROW, type PredictorRow } from "./registry";

const literal = (value: number): AstNode => ({ node_type: "literal", value });
const signal = (id: string): AstNode => ({ node_type: "ref", ref_type: "signal", id }) as AstNode;
const call = (op: string, ...args: AstNode[]): AstNode => ({ node_type: "call", op, args }) as AstNode;
const doc = (root: AstNode): unknown => ({ ast_version: AST_VERSION, root });

function admitted(root: AstNode): AstDocument {
  const result = admit(doc(root));
  expect(result.report.diagnostics, JSON.stringify(result.report.diagnostics)).toEqual([]);
  expect(result.state).toBe("admitted");
  return result.document!;
}

function codes(input: unknown): string[] {
  return admit(input).report.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("admit — schema", () => {
  it("admits a minimal literal formula", () => {
    const result = admit(doc(literal(1)));
    expect(result.state).toBe("admitted");
    expect(result.ast_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.report.metrics).toEqual({ node_count: 1, depth: 1 });
  });

  it("preserves AST version 1.0", () => {
    expect(AST_VERSION).toBe("1.0");
    expect(codes({ ast_version: "2.0", root: literal(1) })).toContain("UNSUPPORTED_AST_VERSION");
  });

  it("rejects a non-object document", () => {
    expect(codes("nope")).toContain("DOCUMENT_NOT_OBJECT");
    expect(codes(null)).toContain("DOCUMENT_NOT_OBJECT");
    expect(codes([])).toContain("DOCUMENT_NOT_OBJECT");
  });

  it("rejects undeclared fields at document and node level", () => {
    expect(codes({ ast_version: AST_VERSION, root: literal(1), notes: "hi" })).toContain("UNKNOWN_FIELD");
    expect(codes(doc({ node_type: "literal", value: 1, hint: "x" } as unknown as AstNode))).toContain(
      "UNKNOWN_FIELD",
    );
  });

  it("rejects an unknown node type", () => {
    expect(codes(doc({ node_type: "lambda" } as unknown as AstNode))).toContain("UNKNOWN_NODE_TYPE");
  });

  it("rejects a non-finite or non-numeric literal", () => {
    expect(codes(doc({ node_type: "literal", value: "5" } as unknown as AstNode))).toContain("INVALID_LITERAL");
    expect(codes(doc({ node_type: "literal", value: Number.NaN } as unknown as AstNode))).toContain(
      "INVALID_LITERAL",
    );
  });

  it("rejects a literal outside the declared range", () => {
    expect(codes(doc(literal(1_000_001)))).toContain("LITERAL_OUT_OF_RANGE");
    expect(codes(doc(literal(-1_000_001)))).toContain("LITERAL_OUT_OF_RANGE");
    expect(admit(doc(literal(1_000_000))).state).toBe("admitted");
  });

  it("rejects a malformed reference", () => {
    expect(codes(doc({ node_type: "ref", ref_type: "column", id: "age" } as unknown as AstNode))).toContain(
      "INVALID_REFERENCE",
    );
    expect(codes(doc({ node_type: "ref", ref_type: "signal", id: "" } as unknown as AstNode))).toContain(
      "INVALID_REFERENCE",
    );
  });

  it("rejects args that are not an array", () => {
    expect(codes(doc({ node_type: "call", op: "add", args: {} } as unknown as AstNode))).toContain(
      "ARGS_NOT_ARRAY",
    );
  });
});

describe("admit — vocabulary and policy", () => {
  it("rejects an unknown signal", () => {
    expect(codes(doc(signal("invented_glucose")))).toContain("UNKNOWN_SIGNAL");
  });

  it("rejects an unknown operator", () => {
    expect(codes(doc(call("regress", literal(1))))).toContain("UNKNOWN_OPERATOR");
  });

  it("refuses the outcome label with a specific diagnostic", () => {
    const report = admit(doc(signal("incident_diabetes"))).report;
    expect(report.diagnostics[0].code).toBe("OUTCOME_REFERENCE_FORBIDDEN");
    expect(report.diagnostics[0].phase).toBe("policy");
  });

  it("refuses evaluator-only follow-up fields", () => {
    for (const id of ["followup_fasting_plasma_glucose", "followup_days", "followup_years"]) {
      expect(codes(doc(signal(id))), id).toContain("OUTCOME_REFERENCE_FORBIDDEN");
    }
  });

  it("refuses the outcome label nested deep inside an otherwise valid formula", () => {
    expect(codes(doc(call("add", signal("age"), signal("incident_diabetes"))))).toContain(
      "OUTCOME_REFERENCE_FORBIDDEN",
    );
  });

  it("admits every declared signal", () => {
    for (const id of Object.keys(SMOKE_ROW)) {
      expect(admit(doc(signal(id))).state, id).toBe("admitted");
    }
  });

  it("checks arity for every operator", () => {
    expect(codes(doc(call("add", literal(1))))).toContain("ARITY_MISMATCH");
    expect(codes(doc(call("abs", literal(1), literal(2))))).toContain("ARITY_MISMATCH");
    expect(codes(doc(call("clamp", literal(1), literal(2))))).toContain("ARITY_MISMATCH");
  });
});

describe("admit — limits", () => {
  it("admits a formula at the depth limit and rejects one past it", () => {
    const nest = (depth: number): AstNode =>
      depth <= 1 ? literal(1) : call("abs", nest(depth - 1));

    expect(admit(doc(nest(MAX_DEPTH))).state).toBe("admitted");
    expect(codes(doc(nest(MAX_DEPTH + 1)))).toContain("DEPTH_LIMIT_EXCEEDED");
  });

  it("rejects a formula past the node limit", () => {
    // A left-leaning chain of adds: each step adds one call and one literal.
    let node: AstNode = literal(1);
    for (let i = 0; i < MAX_NODE_COUNT; i += 1) node = call("add", node, literal(1));
    const report = admit(doc(node)).report;
    expect(report.diagnostics.map((entry) => entry.code)).toContain("NODE_LIMIT_EXCEEDED");
  });

  it("reports node count and depth", () => {
    const result = admit(doc(call("add", signal("age"), literal(2))));
    expect(result.report.metrics).toEqual({ node_count: 3, depth: 2 });
  });
});

describe("admit — protected operation reporting", () => {
  it("reports the divide fallback explicitly", () => {
    const result = admit(doc(call("divide", signal("age"), signal("bmi"))));
    expect(result.report.protected_operations).toEqual([
      { op: "divide", path: "$.root", fallback: expect.stringContaining("Protected division") },
    ]);
  });

  it("reports the protected log fallback explicitly", () => {
    const result = admit(doc(call("plog", signal("triglycerides"))));
    expect(result.report.protected_operations[0]).toMatchObject({ op: "plog" });
  });

  it("reports nested protected operations with their paths", () => {
    const result = admit(doc(call("add", call("plog", signal("age")), call("divide", literal(1), literal(2)))));
    expect(result.report.protected_operations.map((entry) => entry.path)).toEqual([
      "$.root.args[0]",
      "$.root.args[1]",
    ]);
  });

  it("reports no protected operations for plain arithmetic", () => {
    expect(admit(doc(call("add", signal("age"), literal(1)))).report.protected_operations).toEqual([]);
  });
});

describe("admit — smoke row", () => {
  it("records the finite smoke value for an admitted formula", () => {
    const result = admit(doc(call("add", signal("age"), literal(1))));
    expect(result.report.smoke).toEqual({ value: 53, finite: true });
  });

  it("blocks a formula that cannot produce a finite smoke value", () => {
    // clamp rejects lower > upper, so this is unavailable on every row.
    const result = admit(doc(call("clamp", signal("age"), literal(10), literal(5))));
    expect(result.state).toBe("blocked");
    expect(result.ast_hash).toBeNull();
    expect(result.report.diagnostics.map((entry) => entry.code)).toContain("SMOKE_ROW_NOT_FINITE");
  });

  it("carries the registry and validator identity on every report", () => {
    const report = admit(doc(literal(1))).report;
    expect(report.registry_version).toBe("diabetes-v1");
    expect(report.registry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.validator_version).toBe("v1");
    expect(report.ast_schema_version).toBe("1.0");
  });

  it("never returns a hash for a blocked document", () => {
    expect(admit(doc(signal("nope"))).ast_hash).toBeNull();
    expect(admit(doc(signal("nope"))).document).toBeNull();
  });
});

describe("evaluate — operator semantics", () => {
  const row: PredictorRow = { ...SMOKE_ROW };

  it("adds, subtracts, and multiplies with ordinary arithmetic", () => {
    expect(evaluate(admitted(call("add", literal(2), literal(3))), row).value).toBe(5);
    expect(evaluate(admitted(call("subtract", literal(2), literal(3))), row).value).toBe(-1);
    expect(evaluate(admitted(call("multiply", literal(2), literal(3))), row).value).toBe(6);
  });

  it("divides normally when the denominator is material", () => {
    expect(evaluate(admitted(call("divide", literal(6), literal(3))), row).value).toBe(2);
  });

  it("returns 0 from protected divide at and below the epsilon", () => {
    expect(evaluate(admitted(call("divide", literal(6), literal(0))), row).value).toBe(0);
    expect(evaluate(admitted(call("divide", literal(6), literal(DIVIDE_EPSILON / 2))), row).value).toBe(0);
  });

  it("divides normally just above the epsilon", () => {
    const result = evaluate(admitted(call("divide", literal(1), literal(DIVIDE_EPSILON * 10))), row);
    expect(result.value).toBeCloseTo(1e11, 0);
  });

  it("takes absolute value", () => {
    expect(evaluate(admitted(call("abs", literal(-4.5))), row).value).toBe(4.5);
    expect(evaluate(admitted(call("abs", literal(4.5))), row).value).toBe(4.5);
  });

  it("floors protected log at the log floor rather than diverging", () => {
    expect(evaluate(admitted(call("plog", literal(0))), row).value).toBe(Math.log(LOG_FLOOR));
    expect(evaluate(admitted(call("plog", literal(-5))), row).value).toBe(Math.log(LOG_FLOOR));
    expect(evaluate(admitted(call("plog", literal(1))), row).value).toBe(0);
  });

  it("takes minimum and maximum", () => {
    expect(evaluate(admitted(call("min", literal(2), literal(3))), row).value).toBe(2);
    expect(evaluate(admitted(call("max", literal(2), literal(3))), row).value).toBe(3);
  });

  it("clamps to the lower and upper bounds", () => {
    expect(evaluate(admitted(call("clamp", literal(15), literal(0), literal(10))), row).value).toBe(10);
    expect(evaluate(admitted(call("clamp", literal(-5), literal(0), literal(10))), row).value).toBe(0);
    expect(evaluate(admitted(call("clamp", literal(5), literal(0), literal(10))), row).value).toBe(5);
  });

  it("reads declared signals from the predictor projection", () => {
    expect(evaluate(admitted(signal("age")), row).value).toBe(52);
    expect(evaluate(admitted(signal("baseline_fasting_plasma_glucose")), row).value).toBe(5.2);
  });

  it("normalizes a negative zero result", () => {
    const result = evaluate(admitted(call("multiply", literal(0), literal(-1))), row);
    expect(Object.is(result.value, -0)).toBe(false);
    expect(result.value).toBe(0);
  });
});

describe("evaluate — unavailable inputs", () => {
  it("returns null and a diagnostic when a signal is missing from the row", () => {
    const partial = { ...SMOKE_ROW } as Partial<PredictorRow>;
    delete partial.age;
    const result = evaluate(admitted(signal("age")), partial as PredictorRow);

    expect(result.value).toBeNull();
    expect(result.diagnostics[0].code).toBe("SIGNAL_UNAVAILABLE");
  });

  it("returns null when a signal value is non-finite", () => {
    const row = { ...SMOKE_ROW, age: Number.NaN };
    expect(evaluate(admitted(signal("age")), row).value).toBeNull();
  });

  it("propagates an unavailable input through the whole tree", () => {
    const row = { ...SMOKE_ROW, bmi: Number.NaN };
    const result = evaluate(admitted(call("add", signal("age"), signal("bmi"))), row);
    expect(result.value).toBeNull();
  });

  it("returns null when clamp bounds invert on a row the smoke row did not expose", () => {
    // Bounds are [0, bmi]: valid on the smoke row (bmi 24.5), inverted when bmi
    // is negative. Admission cannot catch this; execution must.
    const document = admitted(call("clamp", signal("age"), literal(0), signal("bmi")));

    expect(evaluate(document, SMOKE_ROW).value).toBe(24.5);

    const result = evaluate(document, { ...SMOKE_ROW, bmi: -5 });
    expect(result.value).toBeNull();
    expect(result.diagnostics[0].code).toBe("OPERATION_UNAVAILABLE");
  });

  it("blocks a formula that overflows to infinity within the structural limits", () => {
    // Repeated squaring reaches 1e6^64 with 127 nodes at depth 7, so neither the
    // node nor the depth limit masks the overflow.
    let node: AstNode = literal(1_000_000);
    for (let i = 0; i < 6; i += 1) node = call("multiply", node, node);

    const result = admit(doc(node));
    expect(result.report.metrics).toEqual({ node_count: 127, depth: 7 });
    expect(result.state).toBe("blocked");
    expect(result.report.diagnostics.map((entry) => entry.code)).toContain("SMOKE_ROW_NOT_FINITE");
    expect(result.report.diagnostics.map((entry) => entry.code)).toContain("NON_FINITE_RESULT");
  });

  it("ignores fields outside the predictor projection", () => {
    const contaminated = { ...SMOKE_ROW, incident_diabetes: 1 } as unknown as PredictorRow;
    // The formula cannot name the outcome, so a stray field cannot influence it.
    expect(evaluate(admitted(signal("age")), contaminated).value).toBe(52);
  });
});

describe("hashDocument", () => {
  it("is stable across structurally identical documents", () => {
    const left = admitted(call("add", signal("age"), literal(1)));
    const right = admitted(call("add", signal("age"), literal(1)));
    expect(hashDocument(left)).toBe(hashDocument(right));
  });

  it("differs when the formula differs", () => {
    const left = admitted(call("add", signal("age"), literal(1)));
    const right = admitted(call("add", signal("age"), literal(2)));
    expect(hashDocument(left)).not.toBe(hashDocument(right));
  });

  it("is insensitive to argument order only when the formula truly differs", () => {
    const left = admitted(call("subtract", signal("age"), signal("bmi")));
    const right = admitted(call("subtract", signal("bmi"), signal("age")));
    expect(hashDocument(left)).not.toBe(hashDocument(right));
  });

  it("matches the hash reported at admission", () => {
    const result = admit(doc(call("add", signal("age"), literal(1))));
    expect(result.ast_hash).toBe(hashDocument(result.document!));
  });
});
