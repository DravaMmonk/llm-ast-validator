import { describe, expect, it } from "vitest";

import { E, type ExprNode, hashExpr, normalizeExpr } from "../../shared/workbench/expr";
import { parseExpr } from "../../shared/workbench/exprText";
import { BLOCK, PuzzleError, blockToExpr, blockToPartial, exprToBlock, stackToSteps, stepsToStack } from "./wbAdapter";

const types: Record<string, "number" | "text" | "boolean"> = { age: "number", sbp: "number", sex: "text", smoker: "boolean", bmi: "number" };
const typeOf = (name: string) => types[name];

describe("expression ⇄ puzzle pieces", () => {
  it.each([
    "age >= 18 and sex == \"F\"",
    "not (sbp > 140 or smoker)",
    "if(smoker, 2, 0) + if(age > 65, 1, 0)",
    "weight_missing + 1",
    "round(bmi, 1) - abs(age - 50) / 3 ^ 2",
    "-sqrt(bmi)",
    "ln(bmi) * exp(-1)",
    "clamp(age, 18, 90)",
    "between(age, 30, 75)",
    'one_of(sex, "F, M")',
    "is_missing(sbp)",
    "coalesce(sbp, 120)",
    "valid_if(age >= 18, bmi)",
    "smoker == true",
    'sex != "M"',
    "age == 50",
    "min(age, 80) + max(bmi, 18.5)",
    "floor(age / 10) * 10 + ceil(bmi) + log10(sbp)",
  ])("round-trips %s", (text) => {
    const node = parseExpr(text);
    const block = exprToBlock(node, typeOf);
    expect(hashExpr(blockToExpr(block))).toBe(hashExpr(normalizeExpr(node)));
  });

  it("uses the number comparison piece for numbers and the “is” piece otherwise", () => {
    expect(exprToBlock(parseExpr("age == 50"), typeOf).type).toBe(BLOCK.compare);
    expect(exprToBlock(parseExpr('sex == "F"'), typeOf).type).toBe(BLOCK.equals);
    expect(exprToBlock(parseExpr("smoker == true"), typeOf).type).toBe(BLOCK.equals);
  });

  it("marks unknown columns as untyped pieces", () => {
    const block = exprToBlock(E.col("unknown"), typeOf);
    expect(block.extraState).toEqual({ name: "unknown", valueType: null });
  });

  it("reports an empty socket by name and renders partial trees", () => {
    const partial = { type: BLOCK.arith, fields: { OP: "add" }, inputs: { A: { block: exprToBlock(E.num(1), typeOf) } } };
    expect(() => blockToExpr(partial)).toThrow(PuzzleError);
    expect(() => blockToExpr(partial)).toThrow(/arithmetic/);
    expect(blockToPartial(partial)).toEqual({ k: "call", op: "add", args: [E.num(1), null] });
  });

  it("rejects foreign blocks and corrupt fields", () => {
    expect(() => blockToExpr({ type: "controls_if" })).toThrow(/not a formula piece/);
    expect(() => blockToExpr({ type: BLOCK.arith, fields: { OP: "eval" }, inputs: {} })).toThrow(/unknown operator/);
    expect(() => blockToExpr({ type: BLOCK.num, fields: { VALUE: "abc" } })).toThrow(/finite/);
    expect(() => blockToExpr({ type: BLOCK.col })).toThrow(/lost its column/);
  });

  it("folds a negated number piece into one literal, like the text parser", () => {
    const block = { type: BLOCK.fn1, fields: { OP: "neg" }, inputs: { X: { block: { type: BLOCK.num, fields: { VALUE: 5 } } } } };
    expect(blockToExpr(block)).toEqual(E.num(-5));
  });
});

describe("cohort stacks", () => {
  const steps = [
    { id: "a1", label: "Adults", kind: "include" as const, expr: parseExpr("age >= 18"), on_missing: "drop" as const, enabled: true },
    { id: "b2", label: "", kind: "exclude" as const, expr: parseExpr("smoker"), on_missing: "keep" as const, enabled: false },
  ];

  it("round-trips steps, labels, policies and disabled state", () => {
    const stack = stepsToStack(steps, typeOf, "all rows");
    expect(stack.type).toBe(BLOCK.cohortStart);
    const readout = stackToSteps(stack, () => "fresh");
    expect(readout.problems).toEqual([]);
    expect(readout.steps).toEqual(steps);
  });

  it("reports empty conditions and gives duplicate or missing ids fresh ones", () => {
    let counter = 0;
    const makeId = () => `n${++counter}`;
    const stack = {
      type: BLOCK.cohortStart,
      next: {
        block: {
          type: BLOCK.step,
          extraState: { stepId: "dup" },
          fields: { KIND: "include", LABEL: "x", MISSING: "drop" },
          inputs: { COND: { block: exprToBlock(parseExpr("age > 1"), typeOf) } },
          next: {
            block: {
              type: BLOCK.step,
              extraState: { stepId: "dup" },
              fields: { KIND: "exclude", LABEL: "", MISSING: "drop" },
              next: { block: { type: BLOCK.step, fields: { KIND: "include" }, inputs: { COND: { block: exprToBlock(parseExpr("sbp < 200"), typeOf) } } } },
            },
          },
        },
      },
    };
    const readout = stackToSteps(stack, makeId);
    expect(readout.steps.map((step) => step.id)).toEqual(["dup", "n2"]);
    expect(readout.problems).toEqual([{ stepId: "n1", message: "Snap a yes/no condition into this step." }]);
    expect(readout.partial.map((entry) => entry.stepId)).toEqual(["dup", "n1", "n2"]);
  });

  it("treats a stack without steps as empty", () => {
    expect(stackToSteps(stepsToStack([], typeOf, "all"), () => "x")).toEqual({ steps: [], problems: [], partial: [] });
    expect(stackToSteps(undefined, () => "x").steps).toEqual([]);
  });
});

describe("every operator has a piece", () => {
  it("covers the whole vocabulary", async () => {
    const { OPS } = await import("../../shared/workbench/expr");
    for (const op of OPS) {
      const args: ExprNode[] = op.params.map((param, index) =>
        op.id === "one_of" && index === 1 ? E.text("a, b") : param === "text" ? E.col("sex") : param === "boolean" ? E.col("smoker") : E.col("age"),
      );
      const node = E.call(op.id, ...args);
      expect(() => blockToExpr(exprToBlock(node, typeOf)), op.id).not.toThrow();
    }
  });
});
