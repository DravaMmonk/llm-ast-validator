import { describe, expect, it } from "vitest";

import { admit, hashDocument, type AstDocument } from "../../shared/ast/core";
import { ExpressionError, parseFormula, printFormula } from "./diabetesExpressionAdapter";

/** Round trips are compared by canonical hash, not by text (Section 7.4). */
function roundTrips(text: string): void {
  const first = parseFormula(text);
  const second = parseFormula(printFormula(first));
  expect(hashDocument(second), `round trip of: ${text}`).toBe(hashDocument(first));
}

function admitted(text: string): AstDocument {
  const document = parseFormula(text);
  const result = admit(document);
  expect(result.report.diagnostics, JSON.stringify(result.report.diagnostics)).toEqual([]);
  return result.document!;
}

describe("parseFormula — vocabulary", () => {
  it("parses every declared signal", () => {
    for (const id of [
      "age",
      "bmi",
      "systolic_bp",
      "diastolic_bp",
      "baseline_fasting_plasma_glucose",
      "triglycerides",
      "hdl_cholesterol",
      "ldl_cholesterol",
      "total_cholesterol",
    ]) {
      expect(admitted(id).root).toEqual({ node_type: "ref", ref_type: "signal", id });
    }
  });

  it("parses decimal literals", () => {
    expect(parseFormula("0.85").root).toEqual({ node_type: "literal", value: 0.85 });
    expect(parseFormula("42").root).toEqual({ node_type: "literal", value: 42 });
  });

  it("maps / only to protected divide", () => {
    expect(parseFormula("age / bmi").root).toMatchObject({ op: "divide" });
  });

  it("maps plog only to the protected natural log", () => {
    expect(parseFormula("plog(age)").root).toMatchObject({ op: "plog" });
  });

  it("has no unprotected division or log to parse into", () => {
    expect(() => parseFormula("log(age)")).toThrow(/Unknown function/);
    expect(() => parseFormula("div(age, bmi)")).toThrow(/Unknown function/);
  });

  it("parses every function form", () => {
    expect(parseFormula("abs(age)").root).toMatchObject({ op: "abs" });
    expect(parseFormula("min(age, bmi)").root).toMatchObject({ op: "min" });
    expect(parseFormula("max(age, bmi)").root).toMatchObject({ op: "max" });
    expect(parseFormula("clamp(age, 0, 100)").root).toMatchObject({ op: "clamp" });
  });
});

describe("parseFormula — precedence", () => {
  it("binds multiply and divide before add and subtract", () => {
    expect(parseFormula("age + bmi * 2").root).toMatchObject({
      op: "add",
      args: [{ id: "age" }, { op: "multiply" }],
    });
  });

  it("honours parentheses over precedence", () => {
    expect(parseFormula("(age + bmi) * 2").root).toMatchObject({
      op: "multiply",
      args: [{ op: "add" }, { value: 2 }],
    });
  });

  it("is left-associative for equal precedence", () => {
    // a - b - c must be (a - b) - c, not a - (b - c).
    expect(parseFormula("age - bmi - 1").root).toMatchObject({
      op: "subtract",
      args: [{ op: "subtract", args: [{ id: "age" }, { id: "bmi" }] }, { value: 1 }],
    });
  });

  it("folds a unary minus on a literal", () => {
    expect(parseFormula("-5").root).toEqual({ node_type: "literal", value: -5 });
  });

  it("expresses unary minus on a signal as subtraction from zero", () => {
    expect(parseFormula("-age").root).toMatchObject({
      op: "subtract",
      args: [{ value: 0 }, { id: "age" }],
    });
  });
});

describe("parseFormula — rejection", () => {
  it("rejects an unknown signal", () => {
    expect(() => parseFormula("fasting_glucose_mgdl")).toThrow(/Unknown signal/);
  });

  it("refuses the outcome label like any other undeclared name", () => {
    expect(() => parseFormula("incident_diabetes")).toThrow(/Unknown signal/);
    expect(() => parseFormula("followup_fasting_plasma_glucose")).toThrow(/Unknown signal/);
  });

  it("rejects the wrong arity", () => {
    expect(() => parseFormula("abs(age, bmi)")).toThrow(/expects 1 argument/);
    expect(() => parseFormula("clamp(age, 1)")).toThrow(/expects 3 argument/);
  });

  it("rejects unbalanced parentheses", () => {
    expect(() => parseFormula("(age + bmi")).toThrow(ExpressionError);
    expect(() => parseFormula("age + bmi)")).toThrow(/trailing/);
  });

  it("rejects an empty formula", () => {
    expect(() => parseFormula("   ")).toThrow(/empty/);
  });

  it("rejects a literal outside the declared range", () => {
    expect(() => parseFormula("1000001")).toThrow(/must lie within/);
  });

  it("reports a position for the editor to point at", () => {
    try {
      parseFormula("age + nope");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).position).toBe(6);
    }
  });
});

describe("printFormula", () => {
  it("prints infix operators without redundant parentheses", () => {
    expect(printFormula(parseFormula("age + bmi * 2"))).toBe("age + bmi * 2");
  });

  it("parenthesizes only where precedence requires it", () => {
    expect(printFormula(parseFormula("(age + bmi) * 2"))).toBe("(age + bmi) * 2");
  });

  it("parenthesizes a right operand at equal precedence", () => {
    // Printing a - (b - c) as a - b - c would change the formula.
    const document = parseFormula("age - (bmi - 1)");
    expect(printFormula(document)).toBe("age - (bmi - 1)");
    roundTrips("age - (bmi - 1)");
  });

  it("prints function calls", () => {
    expect(printFormula(parseFormula("clamp(age,0,100)"))).toBe("clamp(age, 0, 100)");
    expect(printFormula(parseFormula("plog( triglycerides )"))).toBe("plog(triglycerides)");
  });
});

describe("text round trip by canonical hash", () => {
  it("round-trips every operator", () => {
    for (const text of [
      "age",
      "0.5",
      "age + bmi",
      "age - bmi",
      "age * 2",
      "age / bmi",
      "abs(age - bmi)",
      "plog(triglycerides)",
      "min(age, bmi)",
      "max(age, bmi)",
      "clamp(age, 0, 100)",
    ]) {
      roundTrips(text);
    }
  });

  it("round-trips a nested formula", () => {
    roundTrips(
      "baseline_fasting_plasma_glucose + 0.1 * bmi + clamp(plog(triglycerides / hdl_cholesterol), 0, 5)",
    );
  });

  it("is insensitive to incidental whitespace", () => {
    expect(hashDocument(parseFormula("age+bmi*2"))).toBe(hashDocument(parseFormula("  age  +  bmi * 2 ")));
  });
});
