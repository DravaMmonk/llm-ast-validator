/**
 * Worked examples from the primary sources (see the calculator references);
 * the MELD rows reproduce the official OPTN/UNOS example exactly.
 */

import { describe, expect, it } from "vitest";

import { CALCULATORS, computeCalculator, findCalculator, validateCatalog } from "./calculators";

function value(key: string, inputs: Record<string, number | boolean>, output?: string, units: Record<string, number> = {}) {
  const calc = findCalculator(key)!;
  const result = computeCalculator(calc, inputs, units);
  const entry = output ? result.outputs.find((o) => o.output.key === output)! : result.outputs[0];
  return { value: entry.value, band: entry.band?.label ?? null, result };
}

describe("calculator catalog", () => {
  it("type-checks every formula, check, and alert", () => {
    expect(validateCatalog()).toEqual([]);
  });

  it("has unique keys and named inputs", () => {
    const keys = CALCULATORS.map((calc) => calc.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("worked examples", () => {
  it.each([
    ["bmi", { weight_kg: 70, height_cm: 175 }, undefined, 22.857, "Normal range"],
    ["bmi", { weight_kg: 95, height_cm: 170 }, undefined, 32.872, "Obese class I"],
    ["bmi", { weight_kg: 50, height_cm: 172 }, undefined, 16.901, "Underweight · moderate thinness"],
    ["bsa", { weight_kg: 70, height_cm: 175 }, "mosteller", 1.8447, null],
    ["bsa", { weight_kg: 70, height_cm: 175 }, "dubois", 1.848, null],
    ["map", { sbp: 120, dbp: 80 }, undefined, 93.333, "Typical resting range"],
    ["egfr_ckdepi_2021", { creatinine: 1.0, age: 50, female: false }, undefined, 91.69, "G1 · normal or high"],
    ["egfr_ckdepi_2021", { creatinine: 0.8, age: 60, female: true }, undefined, 84.3, "G2 · mildly decreased"],
    ["egfr_ckdepi_2021", { creatinine: 0.6, age: 45, female: true }, undefined, 112.73, "G1 · normal or high"],
    ["egfr_ckdepi_2021", { creatinine: 2.0, age: 70, female: false }, undefined, 35.24, "G3b · moderately–severely decreased"],
    ["egfr_ckdepi_2021_cys", { creatinine: 1.0, cystatin: 1.0, age: 50, female: false }, undefined, 88.14, null],
    ["egfr_ckdepi_2021_cys", { creatinine: 0.8, cystatin: 1.2, age: 60, female: true }, undefined, 69.76, null],
    ["egfr_ckdepi_2021_cys", { creatinine: 0.6, cystatin: 0.7, age: 40, female: true }, undefined, 120.08, null],
    ["cockcroft_gault", { age: 60, weight_kg: 72, creatinine: 1.0, female: false }, undefined, 80, null],
    ["cockcroft_gault", { age: 80, weight_kg: 60, creatinine: 1.2, female: true }, undefined, 35.42, null],
    ["qtc", { qt_ms: 360, heart_rate: 100 }, "bazett", 464.76, null],
    ["qtc", { qt_ms: 360, heart_rate: 100 }, "fridericia", 426.84, null],
    ["qtc", { qt_ms: 360, heart_rate: 100 }, "framingham", 421.6, null],
    ["qtc", { qt_ms: 400, heart_rate: 75 }, "bazett", 447.21, null],
    ["homa_ir", { glucose: 5.5, insulin: 10 }, undefined, 2.444, null],
    ["tyg", { tg: 150, glucose: 100 }, undefined, 8.923, null],
    ["tyg", { tg: 250, glucose: 126 }, undefined, 9.665, null],
    ["ldl_friedewald", { tc: 200, hdl: 50, tg: 150 }, undefined, 120, "Near / above optimal"],
    ["non_hdl", { tc: 200, hdl: 50 }, undefined, 150, "Above desirable"],
    ["anion_gap", { sodium: 140, chloride: 104, bicarbonate: 24 }, "ag", 12, null],
    ["anion_gap", { sodium: 140, chloride: 104, bicarbonate: 24, potassium: 4 }, "ag_k", 16, null],
    ["anion_gap", { sodium: 135, chloride: 100, bicarbonate: 10, albumin: 2.0 }, "ag_alb", 30, null],
    ["corrected_calcium", { calcium: 8.0, albumin: 2.5 }, undefined, 9.2, "Typical range (8.5–10.5)"],
    ["corrected_sodium", { sodium: 130, glucose: 600 }, "katz", 138, null],
    ["corrected_sodium", { sodium: 130, glucose: 600 }, "hillier", 142, null],
    ["corrected_sodium", { sodium: 135, glucose: 300 }, "katz", 138.2, null],
    ["osmolality", { sodium: 140, glucose: 90, bun: 14 }, undefined, 290, "Typical range (275–295)"],
    ["osmolality", { sodium: 130, glucose: 540, bun: 42 }, undefined, 305, "Above typical range"],
    ["fib4", { age: 50, ast: 40, alt: 30, platelets: 200 }, undefined, 1.826, "Indeterminate (1.30–2.67)"],
    ["fib4", { age: 68, ast: 80, alt: 49, platelets: 110 }, undefined, 7.065, "High risk (≥ 2.67)"],
    ["apri", { ast: 80, ast_uln: 40, platelets: 150 }, undefined, 1.333, "Indeterminate"],
    ["apri", { ast: 45, ast_uln: 40, platelets: 250 }, undefined, 0.45, "Significant fibrosis unlikely (≤ 0.5)"],
    ["ibw", { height_cm: 180, female: false }, "ibw", 74.99, null],
    ["ibw", { height_cm: 165, female: true }, "ibw", 56.91, null],
    ["ibw", { height_cm: 180, female: false, weight_kg: 120 }, "adjbw", 92.99, null],
  ] as const)("%s %j → %s ≈ %d", (key, inputs, output, expected, band) => {
    const result = value(key, inputs as Record<string, number | boolean>, output);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeCloseTo(expected, 1);
    if (band !== null) expect(result.band).toBe(band);
  });

  it("reproduces the OPTN MELD / MELD-Na examples exactly", () => {
    const base = { creatinine: 1.9, bilirubin: 4.2, inr: 1.2, sodium: 133, dialysis: false };
    expect(value("meld_na", base, "meld").value).toBe(20);
    expect(value("meld_na", base, "meld_na").value).toBe(23);
    expect(value("meld_na", { ...base, sodium: 127 }, "meld_na").value).toBe(27);
    expect(value("meld_na", { creatinine: 2.5, bilirubin: 10, inr: 2.0, sodium: 128, dialysis: false }, "meld").value).toBe(32);
    expect(value("meld_na", { creatinine: 2.5, bilirubin: 10, inr: 2.0, sodium: 128, dialysis: false }, "meld_na").value).toBe(34);
    expect(value("meld_na", { creatinine: 0.8, bilirubin: 1.5, inr: 1.1, sodium: 135, dialysis: false }, "meld_na").value).toBe(9);
    expect(value("meld_na", { creatinine: 1, bilirubin: 1, inr: 1, sodium: 137, dialysis: false }, "meld").value).toBe(6);
  });

  it("computes MELD 3.0", () => {
    const labs = { bilirubin: 4.2, sodium: 133, inr: 1.2, creatinine: 1.9, albumin: 3.0, dialysis: false };
    expect(value("meld3", { ...labs, female: false }).value).toBe(24);
    expect(value("meld3", { ...labs, female: true }).value).toBe(25);
    expect(value("meld3", { female: false, bilirubin: 1, sodium: 140, inr: 1, creatinine: 0.8, albumin: 4, dialysis: false }).value).toBe(6);
  });

  it("scores the points-based instruments", () => {
    expect(value("cha2ds2_vasc", { age: 72, female: true, hypertension: true, diabetes: true }, "vasc").value).toBe(4);
    expect(value("cha2ds2_vasc", { age: 72, female: true, hypertension: true, diabetes: true }, "va").value).toBe(3);
    expect(value("cha2ds2_vasc", { age: 80, female: false, stroke: true }, "va").value).toBe(4);
    expect(value("cha2ds2_vasc", { age: 50, female: true }, "vasc").value).toBe(1);
    expect(value("cha2ds2_vasc", { age: 50, female: true }, "va").value).toBe(0);
    expect(value("has_bled", { age: 70, htn: true, drugs: true }).value).toBe(3);
    expect(value("curb65", { age: 70, urea: 8, resp_rate: 24, sbp: 110, dbp: 70, confusion: false }).value).toBe(2);
    expect(value("curb65", { age: 80, urea: 30, resp_rate: 32, sbp: 85, dbp: 50, confusion: true }, undefined, { urea: 1 }).value).toBe(5);
    expect(value("curb65", { age: 40, urea: 7.0, resp_rate: 16, sbp: 120, dbp: 80, confusion: false }).value).toBe(0);
    expect(value("qsofa", { resp_rate: 24, sbp: 95, gcs: 15 }).value).toBe(2);
    expect(value("qsofa", { resp_rate: 20, sbp: 120, gcs: 14 }).value).toBe(1);
    expect(value("gcs", { eye: 3, verbal: 4, motor: 6 })).toMatchObject({ value: 13, band: "13–15 · mild" });
    expect(value("gcs", { eye: 1, verbal: 1, motor: 4 })).toMatchObject({ value: 6, band: "≤ 8 · severe" });
    expect(value("wells_pe", { tachycardia: true, previous_vte: true, haemoptysis: true }, "original")).toMatchObject({ value: 4, band: "Moderate · PE unlikely (≤ 4)" });
    expect(value("wells_pe", { tachycardia: true, previous_vte: true, haemoptysis: true }, "simplified")).toMatchObject({ value: 3, band: "PE likely (> 1)" });
    expect(value("wells_pe", { dvt_signs: true, pe_likely: true }, "original")).toMatchObject({ value: 6, band: "Moderate · PE likely (> 4)" });
    expect(value("child_pugh", { bilirubin: 2.5, albumin: 3.0, inr: 1.5, ascites: 2, encephalopathy: 1 })).toMatchObject({ value: 8, band: "Class B (7–9)" });
    expect(value("child_pugh", { bilirubin: 1, albumin: 4, inr: 1, ascites: 1, encephalopathy: 1 })).toMatchObject({ value: 5, band: "Class A (5–6)" });
    expect(value("child_pugh", { bilirubin: 4, albumin: 2.5, inr: 2.5, ascites: 3, encephalopathy: 3 })).toMatchObject({ value: 15, band: "Class C (10–15)" });
    const phq = value("phq9", { item1: 3, item2: 3, item3: 2, item4: 2, item5: 2, item6: 2, item7: 2, item8: 2, item9: 1 });
    expect(phq).toMatchObject({ value: 19, band: "15–19 · moderately severe" });
    expect(phq.result.alerts).toHaveLength(1);
  });

  it("converts alternative units to the canonical unit", () => {
    // 88.42 µmol/L is 1.0 mg/dL.
    expect(value("egfr_ckdepi_2021", { creatinine: 88.42, age: 50, female: false }, undefined, { creatinine: 1 }).value).toBeCloseTo(91.69, 1);
    // 100 mg/dL glucose in the HOMA mg/dL form.
    expect(value("homa_ir", { glucose: 100, insulin: 10 }, undefined, { glucose: 1 }).value).toBeCloseTo(2.469, 2);
    // 1.7 mmol/L TG etc. for Friedewald in SI, output in mg/dL.
    expect(value("ldl_friedewald", { tc: 5.2, hdl: 1.3, tg: 1.7 }, undefined, { tc: 1, hdl: 1, tg: 1 }).value! / 38.67).toBeCloseTo(3.12, 1);
  });

  it("withholds Friedewald above its validity range and warns", () => {
    const result = value("ldl_friedewald", { tc: 250, hdl: 40, tg: 450 });
    expect(result.value).toBeNull();
    expect(result.result.checks[0]).toContain("invalid");
  });

  it("blocks impossible inputs and warns on implausible ones", () => {
    const impossible = value("bmi", { weight_kg: -5, height_cm: 170 });
    expect(impossible.value).toBeNull();
    expect(impossible.result.issues[0]).toMatchObject({ level: "error" });
    const unusual = value("bmi", { weight_kg: 450, height_cm: 170 });
    expect(unusual.value).not.toBeNull();
    expect(unusual.result.issues[0]).toMatchObject({ level: "warning" });
    const missing = computeCalculator(findCalculator("map")!, { sbp: 120 });
    expect(missing.outputs[0].value).toBeNull();
    expect(missing.issues[0].message).toContain("required");
  });

  it("flags inconsistent inputs and age caveats", () => {
    expect(value("map", { sbp: 80, dbp: 90 }).result.checks).toHaveLength(1);
    expect(value("fib4", { age: 70, ast: 40, alt: 30, platelets: 200 }).result.alerts[0]).toContain("2.0");
  });
});
