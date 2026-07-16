import { describe, expect, it } from "vitest";

import { canonicalHash } from "./canonical";
import {
  FORBIDDEN_SIGNAL_IDS,
  OPERATORS,
  REGISTRY_VERSION,
  SIGNALS,
  SMOKE_ROW,
  findOperator,
  findSignal,
  registryContract,
  registryHash,
} from "./registry";

describe("signal catalog", () => {
  it("exposes exactly the Section 7.1 baseline predictors", () => {
    expect(SIGNALS.map((signal) => signal.id)).toEqual([
      "age",
      "bmi",
      "systolic_bp",
      "diastolic_bp",
      "baseline_fasting_plasma_glucose",
      "triglycerides",
      "hdl_cholesterol",
      "ldl_cholesterol",
      "total_cholesterol",
    ]);
  });

  it("does not expose the outcome label or any follow-up field", () => {
    const ids = SIGNALS.map((signal) => signal.id) as string[];
    for (const forbidden of FORBIDDEN_SIGNAL_IDS) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it("names the outcome label and follow-up fields as forbidden", () => {
    expect(FORBIDDEN_SIGNAL_IDS).toContain("incident_diabetes");
    expect(FORBIDDEN_SIGNAL_IDS).toContain("followup_fasting_plasma_glucose");
  });

  it("distinguishes baseline FPG from the evaluator-only follow-up FPG", () => {
    expect(findSignal("baseline_fasting_plasma_glucose")).toBeDefined();
    expect(findSignal("followup_fasting_plasma_glucose")).toBeUndefined();
  });

  it("gives every signal a unit and a Blockly block type", () => {
    for (const signal of SIGNALS) {
      expect(signal.unit, signal.id).not.toBe("");
      expect(signal.blockly.type, signal.id).toMatch(/^diabetes_signal_/);
    }
  });

  it("covers every signal in the smoke row", () => {
    expect(Object.keys(SMOKE_ROW).sort()).toEqual(SIGNALS.map((signal) => signal.id).sort());
  });
});

describe("operator catalog", () => {
  it("exposes exactly the Section 7.2 vocabulary", () => {
    expect(OPERATORS.map((operator) => operator.id).sort()).toEqual([
      "abs",
      "add",
      "clamp",
      "divide",
      "max",
      "min",
      "multiply",
      "plog",
      "subtract",
    ]);
  });

  it("declares the documented arity for each operator", () => {
    const arities = Object.fromEntries(OPERATORS.map((operator) => [operator.id, operator.arity]));
    expect(arities).toEqual({
      add: 2,
      subtract: 2,
      multiply: 2,
      divide: 2,
      abs: 1,
      plog: 1,
      min: 2,
      max: 2,
      clamp: 3,
    });
  });

  it("marks exactly the protected operators as protected", () => {
    const protectedIds = OPERATORS.filter((operator) => operator.protected).map((o) => o.id);
    expect(protectedIds.sort()).toEqual(["divide", "plog"]);
  });

  it("is numeric in and numeric out for every operator", () => {
    for (const operator of OPERATORS) {
      expect(operator.input_type, operator.id).toBe("number");
      expect(operator.output_type, operator.id).toBe("number");
    }
  });

  it("gives every operator text syntax and a Blockly block type", () => {
    for (const operator of OPERATORS) {
      expect(operator.text.token, operator.id).not.toBe("");
      expect(operator.blockly.type, operator.id).toMatch(/^diabetes_op_/);
      expect(operator.semantics, operator.id).not.toBe("");
    }
  });

  it("maps “/” only to protected divide and “plog” only to protected log", () => {
    expect(findOperator("divide")!.text.token).toBe("/");
    expect(findOperator("divide")!.protected).toBe(true);
    expect(findOperator("plog")!.text.token).toBe("plog");
    expect(findOperator("plog")!.protected).toBe(true);
    // No unprotected division or natural log is reachable from the vocabulary.
    expect(OPERATORS.filter((operator) => operator.text.token === "/")).toHaveLength(1);
    expect(OPERATORS.some((operator) => operator.text.token === "log")).toBe(false);
  });

  it("binds multiply and divide tighter than add and subtract", () => {
    const precedence = Object.fromEntries(
      OPERATORS.map((operator) => [operator.id, operator.text.precedence]),
    );
    expect(precedence.multiply).toBeGreaterThan(precedence.add);
    expect(precedence.divide).toBeGreaterThan(precedence.subtract);
    expect(precedence.abs).toBeGreaterThan(precedence.multiply);
  });
});

describe("registry identity", () => {
  it("declares a semantic registry version", () => {
    expect(REGISTRY_VERSION).toBe("diabetes-v1");
  });

  it("hashes the semantic contract deterministically", () => {
    expect(registryHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(registryHash()).toBe(registryHash());
    expect(registryHash()).toBe(canonicalHash(registryContract()));
  });

  it("covers arity, types, tokens, and semantics in the hashed contract", () => {
    const contract = registryContract() as { operators: Record<string, unknown>[] };
    const add = contract.operators.find((operator) => operator.id === "add")!;
    expect(Object.keys(add).sort()).toEqual([
      "arity",
      "id",
      "input_type",
      "output_type",
      "protected",
      "semantics",
      "text_form",
      "text_precedence",
      "text_token",
    ]);
  });

  it("excludes cosmetic display and Blockly labels from the hash", () => {
    // Renaming a button must not invalidate stored evaluations.
    const serialized = JSON.stringify(registryContract());
    expect(serialized).not.toContain("Protected divide");
    expect(serialized).not.toContain("diabetes_op_add");
    expect(serialized).not.toContain("colour");
  });

  it("changes the hash when documented semantics change", () => {
    const base = registryContract() as { operators: { semantics: string }[] };
    const drifted = structuredClone(base);
    drifted.operators[0].semantics = "Something else entirely.";
    expect(canonicalHash(drifted)).not.toBe(registryHash());
  });

  it("changes the hash when an arity changes", () => {
    const drifted = structuredClone(registryContract()) as { operators: { arity: number }[] };
    drifted.operators[0].arity = 3;
    expect(canonicalHash(drifted)).not.toBe(registryHash());
  });

  it("changes the hash when a signal is added or removed", () => {
    const drifted = structuredClone(registryContract()) as { signals: unknown[] };
    drifted.signals.pop();
    expect(canonicalHash(drifted)).not.toBe(registryHash());
  });
});
