import { describe, expect, it } from "vitest";

import { OPERATORS } from "../../shared/ast/registry";
import { documentToBlock } from "./diabetesBlocklyAdapter";
import { parseFormula } from "./diabetesExpressionAdapter";
import { formatBlockLatex, formatFormulaLatex } from "./diabetesLatexAdapter";

describe("diabetes LaTeX presentation", () => {
  it("renders the admitted AST and its Blockly twin identically", () => {
    const document = parseFormula("baseline_fasting_plasma_glucose + 0.1 * bmi");
    expect(formatBlockLatex(documentToBlock(document))).toBe(formatFormulaLatex(document));
  });

  it("uses mathematical forms for the protected operators", () => {
    expect(formatFormulaLatex(parseFormula("age / bmi"))).toBe("\\frac{\\mathsf{age}}{\\mathsf{bmi}}");
    expect(formatFormulaLatex(parseFormula("plog(triglycerides)"))).toContain("\\operatorname{plog}");
  });

  it("renders empty Blockly sockets without throwing", () => {
    expect(formatBlockLatex({ type: "diabetes_op_divide" })).toBe("\\frac{\\square}{\\square}");
    expect(
      formatBlockLatex({
        type: "diabetes_op_add",
        inputs: { ARG0: { block: { type: "diabetes_signal_age" } } },
      }),
    ).toBe("\\left(\\mathsf{age} + \\square\\right)");
  });

  it("has a non-empty template for every registered operator", () => {
    for (const operator of OPERATORS) {
      const latex = formatBlockLatex({ type: operator.blockly.type });
      expect(latex, operator.id).not.toBe("\\square");
      expect(latex, operator.id).toContain("\\square");
    }
  });
});
