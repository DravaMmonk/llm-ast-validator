import { describe, expect, it } from "vitest";

import { computeCalculator, findCalculator } from "../../../shared/workbench/calculators";
import { buildFrame, parseDelimitedText } from "../../../shared/workbench/dataset";
import { evaluateColumn } from "../../../shared/workbench/expr";
import { printExpr } from "../../../shared/workbench/exprText";
import { generateSample } from "../../../shared/workbench/samples";
import { guessMapping, inputReplacement, mappedExpression } from "./mapping";

function sampleFrame(key: string) {
  const columns = generateSample(key)!;
  return buildFrame({ id: key, name: key, content_hash: "h", row_count: columns[0].values.length, columns, derived: [] });
}

describe("calculator → dataset mapping", () => {
  it("maps eGFR onto the cardiometabolic sample, converting µmol/L and coding sex", () => {
    const frame = sampleFrame("cardiometabolic");
    const calc = findCalculator("egfr_ckdepi_2021")!;
    const mapping = guessMapping(calc, frame);
    expect(mapping.creatinine).toMatchObject({ column: "creatinine_umol", unit: 1 });
    expect(mapping.age.column).toBe("age");
    expect(mapping.female).toMatchObject({ column: "sex", yesValue: "F" });

    const { expr, problems } = mappedExpression(calc, "egfr", mapping, frame);
    expect(problems).toEqual([]);
    expect(printExpr(expr!)).toContain("creatinine_umol / 88.42");
    expect(printExpr(expr!)).toContain('sex == "F"');

    // Row-wise values equal the bedside calculator fed the same row by hand.
    const columns = new Map(frame.columns.map((column) => [column.name, column.values]));
    const values = evaluateColumn(expr!, (name) => columns.get(name), frame.rowCount);
    for (const row of [0, 7, 99]) {
      const bedside = computeCalculator(
        calc,
        { creatinine: frame.columns.find((c) => c.name === "creatinine_umol")!.values[row] as number, age: frame.columns.find((c) => c.name === "age")!.values[row] as number, female: frame.columns.find((c) => c.name === "sex")!.values[row] === "F" },
        { creatinine: 1 },
      );
      expect(values[row]).toBeCloseTo(bedside.outputs[0].value!, 9);
    }
  });

  it("maps qSOFA onto the sepsis sample", () => {
    const frame = sampleFrame("sepsis_biomarker");
    const calc = findCalculator("qsofa")!;
    const mapping = guessMapping(calc, frame);
    expect(mapping.resp_rate.column).toBe("resp_rate");
    expect(mapping.sbp.column).toBe("sbp");
    expect(mapping.gcs.column).toBe("gcs");
    expect(mappedExpression(calc, "score", mapping, frame).problems).toEqual([]);
  });

  it("explains what is missing instead of guessing", () => {
    const parsed = parseDelimitedText("id,flag,group\n1,2,a\n2,3,b\n");
    const frame = buildFrame({ id: "x", name: "x", content_hash: "h", row_count: 2, columns: parsed.columns, derived: [] });
    const calc = findCalculator("bmi")!;
    const result = mappedExpression(calc, "bmi", guessMapping(calc, frame), frame);
    expect(result.expr).toBeNull();
    expect(result.problems[0]).toMatch(/Map “Weight”/);
    const female = findCalculator("egfr_ckdepi_2021")!.inputs.find((input) => input.name === "female")!;
    expect(inputReplacement(female, { column: "flag", unit: 0, yesValue: null }, frame)).toMatch(/coded 0\/1/);
    expect(inputReplacement(female, { column: "group", unit: 0, yesValue: null }, frame)).toMatch(/means yes/);
  });
});
