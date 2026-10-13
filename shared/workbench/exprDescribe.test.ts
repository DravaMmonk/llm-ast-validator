import { describe, expect, it } from "vitest";

import { describeExpr } from "./exprDescribe";
import { parseExpr } from "./exprText";

describe("describeExpr", () => {
  it.each([
    ["is_missing(ldl_mmol)", "ldl_mmol missing"],
    ["not is_missing(ldl_mmol)", "ldl_mmol recorded"],
    ["between(age, 30, 75)", "age 30–75"],
    ["fpg_mmol >= 7", "fpg_mmol ≥ 7"],
    ['smoking == "current"', "smoking = current"],
    ['one_of(smoking, "current, former")', "smoking is current or former"],
    ["age > 18 and sbp < 180", "age > 18 and sbp < 180"],
    ["smoker == true", "smoker"],
    ["ln(x) > 2", "ln(x) > 2"],
  ])("%s → %s", (text, expected) => {
    expect(describeExpr(parseExpr(text))).toBe(expected);
  });
});
