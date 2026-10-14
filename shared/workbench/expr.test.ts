import { describe, expect, it } from "vitest";

import {
  E,
  EXPR_MAX_NODES,
  type ExprNode,
  checkExpr,
  compileExpr,
  evaluateColumn,
  evaluateExpr,
  exprColumns,
  hashExpr,
  normalizeExpr,
  parseExprJson,
  renameColumns,
  roundHalfAwayFromZero,
} from "./expr";
import { exprToLatex } from "./exprLatex";
import { ExprSyntaxError, parseExpr, printExpr, tryParseExpr } from "./exprText";

const schema = (name: string) =>
  (
    ({
      age: "number",
      bmi: "number",
      sex: "text",
      smoker: "boolean",
      "Systolic BP": "number",
      max: "number",
    }) as const
  )[name as "age"];

describe("parseExpr / printExpr", () => {
  const cases: [string, string][] = [
    ["1 + 2 * 3", "1 + 2 * 3"],
    ["(1 + 2) * 3", "(1 + 2) * 3"],
    ["a - (b - c)", "a - (b - c)"],
    ["a - b - c", "a - b - c"],
    ["2 ^ 3 ^ 2", "2 ^ 3 ^ 2"],
    ["(2 ^ 3) ^ 2", "(2 ^ 3) ^ 2"],
    ["-2 ^ 2", "-(2 ^ 2)"],
    ["(-2) ^ 2", "(-2) ^ 2"],
    ["2 ^ -1", "2 ^ -1"],
    ["-x * y", "-x * y"],
    ["-(x * y)", "-(x * y)"],
    ["a - -5", "a - -5"],
    ["weight / (height / 100) ^ 2", "weight / (height / 100) ^ 2"],
    ["age >= 18 and sex = 'F'", 'age >= 18 and sex == "F"'],
    ["not (a > 1 or b < 2)", "not (a > 1 or b < 2)"],
    ["not a > 1", "not a > 1"],
    ["a ≥ 1 && b ≠ 2 || !c", "a >= 1 and b != 2 or not c"],
    ["if(smoker, 2, 0) + if(age > 65, 1, 0)", "if(smoker, 2, 0) + if(age > 65, 1, 0)"],
    ["`Systolic BP` > 140", "`Systolic BP` > 140"],
    ["`max` + 1", "`max` + 1"],
    ["round(bmi)", "round(bmi, 0)"],
    ['one_of(sex, "F, M")', 'one_of(sex, "F, M")'],
    ["between(age, 18, 65)", "between(age, 18, 65)"],
    ["1.5e-3 * x", "0.0015 * x"],
    ['"say \\"hi\\""', '"say \\"hi\\""'],
    ["TRUE and false", "true and false"],
    ["`a``b` + 1", "`a``b` + 1"],
    ["(a < b) == true", "(a < b) == true"],
  ];

  it.each(cases)("%s → %s", (input, expected) => {
    const node = parseExpr(input);
    expect(printExpr(node)).toBe(expected);
    // The printed form is a fixed point and reproduces the same tree.
    expect(hashExpr(parseExpr(printExpr(node)))).toBe(hashExpr(node));
  });

  it("folds a negated literal into one number node", () => {
    expect(parseExpr("-5")).toEqual(E.num(-5));
    expect(parseExpr("--5")).toEqual(E.num(5));
  });

  it("parses -2 ^ 2 as the negation of the power", () => {
    expect(evaluateExpr(parseExpr("-2 ^ 2"), {})).toBe(-4);
    expect(evaluateExpr(parseExpr("(-2) ^ 2"), {})).toBe(4);
  });

  it.each([
    ["", "empty"],
    ["1 +", "ends too early"],
    ["(1 + 2", "close the parenthesis"],
    ["1 + 2)", "unmatched"],
    ["a < b < c", "cannot be chained"],
    ["foo(1)", "Unknown function"],
    ["max(1)", "takes 2"],
    ["2x", "cannot run into a name"],
    ['"open', "closing quote"],
    ["`open", "closing backtick"],
    ["1 # 2", "Unexpected character"],
  ])("rejects %j (%s)", (input, fragment) => {
    const result = tryParseExpr(input);
    expect(result.error).toBeInstanceOf(ExprSyntaxError);
    expect(result.error!.message).toContain(fragment);
  });

  it("round-trips every printable tree shape through a random walk", () => {
    // Deterministic pseudo-random trees exercise precedence corners.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const numeric = ["add", "sub", "mul", "div", "pow"] as const;
    const build = (depth: number): ExprNode => {
      if (depth === 0 || rand() < 0.25) {
        const leaf = rand();
        if (leaf < 0.4) return E.col(["a", "b", "c"][Math.floor(rand() * 3)]);
        return E.num(Math.round((rand() - 0.5) * 20));
      }
      if (rand() < 0.15) return E.call("neg", build(depth - 1));
      const op = numeric[Math.floor(rand() * numeric.length)];
      return E.call(op, build(depth - 1), build(depth - 1));
    };
    for (let i = 0; i < 300; i += 1) {
      const tree = build(5);
      const printed = printExpr(tree);
      expect(hashExpr(parseExpr(printed)), printed).toBe(hashExpr(normalizeExpr(tree)));
    }
  });
});

describe("checkExpr", () => {
  it("infers result types", () => {
    expect(checkExpr(parseExpr("age * 2"), schema).type).toBe("number");
    expect(checkExpr(parseExpr('age > 2 and sex == "F"'), schema).type).toBe("boolean");
    expect(checkExpr(parseExpr('if(smoker, "yes", "no")'), schema).type).toBe("text");
    expect(checkExpr(parseExpr("coalesce(bmi, 25)"), schema).type).toBe("number");
    expect(checkExpr(parseExpr("is_missing(sex)"), schema).type).toBe("boolean");
  });

  it("reports type mismatches with paths", () => {
    const result = checkExpr(parseExpr("sex + 1"), schema);
    expect(result.type).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ code: "TYPE_MISMATCH", path: "$.args[0]" });
  });

  it("requires matching types for polymorphic operators", () => {
    const result = checkExpr(parseExpr("if(smoker, 1, \"one\")"), schema);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["TYPE_MISMATCH"]);
    expect(checkExpr(parseExpr("age == sex"), schema).diagnostics[0].code).toBe("TYPE_MISMATCH");
  });

  it("reports unknown columns and collects the columns read", () => {
    const result = checkExpr(parseExpr("age + height + age"), schema);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["UNKNOWN_COLUMN"]);
    expect(result.columns).toEqual(["age", "height"]);
  });

  it("requires a literal member list for one_of", () => {
    const result = checkExpr(E.call("one_of", E.col("sex"), E.col("sex")), schema);
    expect(result.diagnostics.map((d) => d.code)).toContain("LIST_NOT_LITERAL");
  });
});

describe("evaluation", () => {
  const evalText = (text: string, row: Record<string, number | string | boolean | null> = {}) =>
    evaluateExpr(parseExpr(text), row);

  it("computes arithmetic and functions", () => {
    expect(evalText("weight / (height / 100) ^ 2", { weight: 70, height: 175 })).toBeCloseTo(22.857, 3);
    expect(evalText("sqrt(16) + abs(-2) + ln(exp(1))")).toBe(7);
    expect(evalText("clamp(15, 0, 10)")).toBe(10);
    expect(evalText("round(2.5)")).toBe(3);
    expect(evalText("round(-2.5)")).toBe(-3);
    expect(evalText("round(1.005, 2)")).toBe(1.01);
    expect(evalText("floor(-1.5) + ceil(1.2)")).toBe(0);
  });

  it("turns undefined arithmetic into missing, never Infinity or NaN", () => {
    expect(evalText("1 / 0")).toBeNull();
    expect(evalText("ln(0)")).toBeNull();
    expect(evalText("sqrt(-1)")).toBeNull();
    expect(evalText("(-8) ^ 0.5")).toBeNull();
    expect(evalText("exp(1000)")).toBeNull();
    expect(evalText("clamp(1, 5, 0)")).toBeNull();
    expect(evalText("round(1.5, 0.5)")).toBeNull();
  });

  it("propagates missing values", () => {
    expect(evalText("x + 1", { x: null })).toBeNull();
    expect(evalText("x > 1", { x: null })).toBeNull();
    expect(evalText("y + 1")).toBeNull();
  });

  it("uses three-valued logic for and / or", () => {
    expect(evalText("x > 1 and false", { x: null })).toBe(false);
    expect(evalText("x > 1 and true", { x: null })).toBeNull();
    expect(evalText("x > 1 or true", { x: null })).toBe(true);
    expect(evalText("x > 1 or false", { x: null })).toBeNull();
    expect(evalText("not (x > 1)", { x: null })).toBeNull();
  });

  it("handles missing-aware operators and conditions", () => {
    expect(evalText("is_missing(x)", { x: null })).toBe(true);
    expect(evalText("coalesce(x, 7)", { x: null })).toBe(7);
    expect(evalText("if(x > 1, 1, 0)", { x: null })).toBeNull();
    expect(evalText("if(x > 1, 1, 0)", { x: 3 })).toBe(1);
    expect(evalText('one_of(s, "a, b")', { s: "b" })).toBe(true);
    expect(evalText('one_of(s, "a, b")', { s: "c" })).toBe(false);
    expect(evalText("between(x, 1, 3)", { x: 3 })).toBe(true);
  });

  it("compiles over column arrays", () => {
    const columns: Record<string, (number | null)[]> = { a: [1, 2, null], b: [10, 0, 5] };
    const values = evaluateColumn(parseExpr("a / b"), (name) => columns[name], 3);
    expect(values).toEqual([0.1, null, null]);
    expect(compileExpr(parseExpr("missing_col + 1"), () => undefined)(0)).toBeNull();
  });
});

describe("parseExprJson", () => {
  it("accepts a valid tree", () => {
    const node = parseExpr("if(a > 1, b, 0)");
    expect(parseExprJson(JSON.parse(JSON.stringify(node))).node).toEqual(node);
  });

  it.each([
    [{ k: "num", v: "1" }, "INVALID_NUMBER"],
    [{ k: "num", v: 1, extra: true }, "UNKNOWN_FIELD"],
    [{ k: "call", op: "eval", args: [] }, "UNKNOWN_OPERATOR"],
    [{ k: "call", op: "add", args: [{ k: "num", v: 1 }] }, "ARITY_MISMATCH"],
    [{ k: "col", name: "" }, "INVALID_COLUMN_NAME"],
    [{ k: "zzz" }, "UNKNOWN_NODE_KIND"],
    [[1], "NODE_NOT_OBJECT"],
  ])("rejects %j", (input, code) => {
    const result = parseExprJson(input);
    expect(result.node).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain(code);
  });

  it("enforces the node limit", () => {
    let node: ExprNode = E.num(1);
    for (let i = 0; i < EXPR_MAX_NODES; i += 1) node = E.call("add", E.num(1), E.num(1));
    // A wide (not deep) tree that exceeds the node budget.
    const wide = { k: "call", op: "add", args: [node, node] };
    let big: unknown = wide;
    for (let i = 0; i < 8; i += 1) big = { k: "call", op: "add", args: [big, big] };
    expect(parseExprJson(big).diagnostics.map((d) => d.code)).toContain("NODE_LIMIT_EXCEEDED");
  });
});

describe("helpers", () => {
  it("renames and lists columns", () => {
    const node = parseExpr("a + b * a");
    expect(exprColumns(node)).toEqual(["a", "b"]);
    expect(printExpr(renameColumns(node, { a: "x" }))).toBe("x + b * x");
  });

  it("rounds half away from zero", () => {
    expect(roundHalfAwayFromZero(0.125, 2)).toBe(0.13);
    expect(roundHalfAwayFromZero(-0.125, 2)).toBe(-0.13);
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68);
  });

  it("renders LaTeX for full and partial trees", () => {
    expect(exprToLatex(parseExpr("weight / (height / 100) ^ 2"))).toBe(
      "\\dfrac{\\textsf{weight}}{{\\left(\\dfrac{\\textsf{height}}{100}\\right)}^{2}}",
    );
    expect(exprToLatex({ k: "call", op: "add", args: [E.col("a"), null] })).toBe("\\textsf{a} + \\square");
    expect(exprToLatex(parseExpr("a_b > 1"))).toContain("a\\_b");
    expect(exprToLatex(parseExpr("`a~b^c\\\\d` + 1e21"))).toBe("\\textsf{a∼bˆc∖∖d} + 1\\times 10^{21}");
  });
});
