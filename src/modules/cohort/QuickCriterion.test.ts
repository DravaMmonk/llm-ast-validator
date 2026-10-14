import { describe, expect, it } from "vitest";

import { printExpr } from "../../../shared/workbench/exprText";
import { fuzzyScore } from "../../workstation/CommandPalette";
import { buildCriterion } from "./QuickCriterion";

describe("buildCriterion", () => {
  const text = (result: ReturnType<typeof buildCriterion>) => ("expr" in result ? printExpr(result.expr) : result.error);

  it("builds numeric comparisons and ranges", () => {
    expect(text(buildCriterion("age", "numeric", "ge", "18", "", []))).toBe("age >= 18");
    expect(text(buildCriterion("age", "numeric", "between", "30", "75", []))).toBe("between(age, 30, 75)");
    expect(text(buildCriterion("age", "numeric", "between", "75", "30", []))).toBe("The upper bound is below the lower bound.");
    expect(text(buildCriterion("age", "numeric", "ge", "", "", []))).toBe("Enter a number.");
    expect(text(buildCriterion("age", "numeric", "lt", "1e3", "", []))).toBe("age < 1000");
  });

  it("builds categorical and missing-data criteria", () => {
    expect(text(buildCriterion("sex", "categorical", "eq", "F", "", []))).toBe('sex == "F"');
    expect(text(buildCriterion("smoking", "categorical", "one_of", "", "", ["current", "former"]))).toBe('one_of(smoking, "current, former")');
    expect(text(buildCriterion("smoking", "categorical", "one_of", "", "", []))).toBe("Tick at least one value.");
    expect(text(buildCriterion("ldl", "numeric", "missing", "", "", []))).toBe("is_missing(ldl)");
    expect(text(buildCriterion("ldl", "numeric", "present", "", "", []))).toBe("not is_missing(ldl)");
    expect(text(buildCriterion("flag", "boolean", "no", "", "", []))).toBe("flag == false");
  });

  it("labels criteria readably", () => {
    const result = buildCriterion("age", "numeric", "ge", "18", "", []);
    expect("label" in result && result.label).toBe("age ≥ 18");
  });
});

describe("command palette fuzzy matching", () => {
  it("prefers word starts and contiguous runs, and rejects non-matches", () => {
    expect(fuzzyScore("stat", "Statistics")).toBeGreaterThan(fuzzyScore("stat", "Study Design · status") ?? 0);
    expect(fuzzyScore("ds", "Data Studio")).toBeGreaterThan(0);
    expect(fuzzyScore("zzz", "Data Studio")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});
