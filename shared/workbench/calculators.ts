/**
 * The clinical calculator library.
 *
 * Every calculator is expressed in the workbench expression language, so the
 * same definition computes a bedside value for one patient, renders as LaTeX,
 * opens as puzzle pieces in Score Forge, and applies to a whole dataset as a
 * derived variable. Formulas, cut-offs and citations were checked against the
 * primary papers or official bodies (NKF/KDIGO, OPTN/UNOS, NICE, WHO); the
 * worked examples from those sources are the unit tests.
 *
 * Research and education only — not a medical device and not for individual
 * clinical decisions.
 */

import { type ExprNode, type Value, checkExpr, evaluateExpr } from "./expr";
import { parseExpr } from "./exprText";

export type CalcCategory = "Anthropometry" | "Renal" | "Cardiology" | "Metabolic" | "Lipids" | "Electrolytes" | "Critical care" | "Hepatology" | "Mental health";

export const CALC_CATEGORIES: readonly CalcCategory[] = [
  "Anthropometry",
  "Renal",
  "Cardiology",
  "Metabolic",
  "Lipids",
  "Electrolytes",
  "Critical care",
  "Hepatology",
  "Mental health",
];

export interface CalcUnit {
  label: string;
  /** canonical value = entered value × factor */
  factor: number;
}

export interface CalcInput {
  name: string;
  label: string;
  kind: "number" | "boolean";
  /** Canonical unit the formula expects. */
  unit?: string;
  /** Alternative entry units, converted to the canonical unit. */
  units?: CalcUnit[];
  /** Outside these bounds the value is impossible and nothing is computed. */
  hard?: [number, number];
  /** Outside these bounds the value is accepted with a warning. */
  plausible?: [number, number];
  /** Discrete choices for scored items (value is the points). */
  options?: { value: number; label: string }[];
  optional?: boolean;
  defaultValue?: number | boolean;
  hint?: string;
}

export type BandTone = "ok" | "info" | "warn" | "bad";

export interface Band {
  /** The band applies while the value is below this (exclusive). Omitted on the last band. */
  below?: number;
  label: string;
  tone: BandTone;
}

export interface CalcOutput {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  expr: ExprNode;
  bands?: Band[];
}

export interface Calculator {
  key: string;
  name: string;
  short: string;
  category: CalcCategory;
  summary: string;
  inputs: CalcInput[];
  outputs: CalcOutput[];
  /** Conditions that should hold; each failing one is shown as a warning. */
  checks?: { expr: ExprNode; message: string }[];
  /** Conditions that raise an alert when true, regardless of the total. */
  alerts?: { expr: ExprNode; message: string }[];
  notes: string[];
  references: { citation: string; doi?: string; url?: string }[];
}

const x = parseExpr;
const yes = (label: string, hint?: string): CalcInput => ({ name: "", label, kind: "boolean", defaultValue: false, hint });
const bool = (name: string, label: string, hint?: string): CalcInput => ({ ...yes(label, hint), name });
const num = (
  name: string,
  label: string,
  unit: string,
  plausible: [number, number],
  hard: [number, number],
  extra: Partial<CalcInput> = {},
): CalcInput => ({ name, label, kind: "number", unit, plausible, hard, ...extra });

const FEMALE = bool("female", "Female (sex used in the equation)");
const AGE = num("age", "Age", "years", [18, 110], [0, 130]);
const CREATININE = num("creatinine", "Serum creatinine", "mg/dL", [0.2, 20], [0.01, 50], {
  units: [
    { label: "mg/dL", factor: 1 },
    { label: "µmol/L", factor: 1 / 88.42 },
  ],
});

const POINTS_BANDS = (cuts: [number, string, BandTone][], last: [string, BandTone]): Band[] => [
  ...cuts.map(([below, label, tone]) => ({ below, label, tone })),
  { label: last[0], tone: last[1] },
];

const KDIGO: Band[] = [
  { below: 15, label: "G5 · kidney failure", tone: "bad" },
  { below: 30, label: "G4 · severely decreased", tone: "bad" },
  { below: 45, label: "G3b · moderately–severely decreased", tone: "warn" },
  { below: 60, label: "G3a · mildly–moderately decreased", tone: "warn" },
  { below: 90, label: "G2 · mildly decreased", tone: "info" },
  { label: "G1 · normal or high", tone: "ok" },
];

const MELD_I = "round(10 * round(0.957 * ln(clamp(if(dialysis, 4, creatinine), 1, 4)) + 0.378 * ln(max(bilirubin, 1)) + 1.12 * ln(max(inr, 1)) + 0.643, 1))";
const NA_B = "clamp(sodium, 125, 137)";

export const CALCULATORS: readonly Calculator[] = [
  {
    key: "bmi",
    name: "Body mass index",
    short: "BMI",
    category: "Anthropometry",
    summary: "Weight relative to height squared, with WHO adult categories.",
    inputs: [
      num("weight_kg", "Weight", "kg", [2, 400], [0.1, 1000], { units: [{ label: "kg", factor: 1 }, { label: "lb", factor: 0.45359237 }] }),
      num("height_cm", "Height", "cm", [50, 250], [10, 300], { units: [{ label: "cm", factor: 1 }, { label: "in", factor: 2.54 }] }),
    ],
    outputs: [
      {
        key: "bmi",
        label: "BMI",
        unit: "kg/m²",
        decimals: 1,
        expr: x("weight_kg / (height_cm / 100) ^ 2"),
        bands: [
          { below: 16, label: "Underweight · severe thinness", tone: "bad" },
          { below: 17, label: "Underweight · moderate thinness", tone: "warn" },
          { below: 18.5, label: "Underweight · mild thinness", tone: "warn" },
          { below: 25, label: "Normal range", tone: "ok" },
          { below: 30, label: "Pre-obese (overweight)", tone: "info" },
          { below: 35, label: "Obese class I", tone: "warn" },
          { below: 40, label: "Obese class II", tone: "bad" },
          { label: "Obese class III", tone: "bad" },
        ],
      },
    ],
    notes: [
      "WHO adult cut-offs apply from age 20 for both sexes. Asian populations often use lower action points (23 / 27.5).",
      "For children use BMI-for-age z-scores, not these bands.",
    ],
    references: [
      { citation: "WHO. Obesity: preventing and managing the global epidemic. Technical Report Series 894, 2000." },
      { citation: "WHO Expert Consultation. Lancet 2004;363:157–63.", doi: "10.1016/S0140-6736(03)15268-3" },
    ],
  },
  {
    key: "bsa",
    name: "Body surface area",
    short: "BSA",
    category: "Anthropometry",
    summary: "Mosteller and DuBois body surface area for dosing and indexing.",
    inputs: [
      num("weight_kg", "Weight", "kg", [0.5, 400], [0.1, 1000]),
      num("height_cm", "Height", "cm", [30, 250], [10, 300]),
    ],
    outputs: [
      { key: "mosteller", label: "BSA (Mosteller)", unit: "m²", decimals: 2, expr: x("sqrt(height_cm * weight_kg / 3600)") },
      { key: "dubois", label: "BSA (DuBois)", unit: "m²", decimals: 2, expr: x("0.007184 * weight_kg ^ 0.425 * height_cm ^ 0.725") },
    ],
    notes: ["DuBois was derived on nine subjects and underestimates BSA in obesity; Mosteller is the usual oncology default."],
    references: [
      { citation: "Mosteller RD. N Engl J Med 1987;317:1098.", doi: "10.1056/NEJM198710223171717" },
      { citation: "Du Bois D, Du Bois EF. Arch Intern Med 1916;17:863–71." },
    ],
  },
  {
    key: "ibw",
    name: "Ideal and adjusted body weight",
    short: "IBW",
    category: "Anthropometry",
    summary: "Devine ideal body weight and the 0.4-factor adjusted body weight.",
    inputs: [num("height_cm", "Height", "cm", [152.4, 250], [100, 300]), FEMALE, num("weight_kg", "Actual weight", "kg", [30, 400], [1, 1000], { optional: true })],
    outputs: [
      { key: "ibw", label: "Ideal body weight", unit: "kg", decimals: 1, expr: x("if(female, 45.5, 50) + 2.3 * (height_cm / 2.54 - 60)") },
      {
        key: "adjbw",
        label: "Adjusted body weight",
        unit: "kg",
        decimals: 1,
        expr: x("if(female, 45.5, 50) + 2.3 * (height_cm / 2.54 - 60) + 0.4 * (weight_kg - (if(female, 45.5, 50) + 2.3 * (height_cm / 2.54 - 60)))"),
      },
    ],
    notes: ["Below 152.4 cm (60 in) the Devine formula is extrapolated.", "Adjusted weight is usually applied when actual weight exceeds ~120% of IBW; some protocols use a factor of 0.3 or 0.25."],
    references: [{ citation: "Pai MP, Paloucek FP. Ann Pharmacother 2000;34:1066–9.", doi: "10.1345/aph.19381" }],
  },
  {
    key: "egfr_ckdepi_2021",
    name: "eGFR — CKD-EPI 2021 (creatinine)",
    short: "eGFR",
    category: "Renal",
    summary: "Race-free CKD-EPI 2021 creatinine equation with KDIGO G categories.",
    inputs: [CREATININE, AGE, FEMALE],
    outputs: [
      {
        key: "egfr",
        label: "eGFR",
        unit: "mL/min/1.73 m²",
        decimals: 0,
        expr: x(
          "142 * min(creatinine / if(female, 0.7, 0.9), 1) ^ if(female, -0.241, -0.302) * max(creatinine / if(female, 0.7, 0.9), 1) ^ -1.2 * 0.9938 ^ age * if(female, 1.012, 1)",
        ),
        bands: KDIGO,
      },
    ],
    notes: ["Adults only (≥ 18 years). Requires IDMS-traceable creatinine.", "G1–G2 are not CKD without markers of kidney damage persisting > 3 months."],
    references: [
      { citation: "Inker LA et al. N Engl J Med 2021;385:1737–49.", doi: "10.1056/NEJMoa2102953" },
      { citation: "KDIGO 2024 CKD Guideline. Kidney Int 2024;105(4S):S117–S314.", doi: "10.1016/j.kint.2023.10.018" },
    ],
  },
  {
    key: "egfr_ckdepi_2021_cys",
    name: "eGFR — CKD-EPI 2021 (creatinine–cystatin C)",
    short: "eGFRcr-cys",
    category: "Renal",
    summary: "The 2021 combined creatinine–cystatin C equation.",
    inputs: [CREATININE, num("cystatin", "Cystatin C", "mg/L", [0.2, 10], [0.01, 30]), AGE, FEMALE],
    outputs: [
      {
        key: "egfr",
        label: "eGFR",
        unit: "mL/min/1.73 m²",
        decimals: 0,
        expr: x(
          "135 * min(creatinine / if(female, 0.7, 0.9), 1) ^ if(female, -0.219, -0.144) * max(creatinine / if(female, 0.7, 0.9), 1) ^ -0.544 * min(cystatin / 0.8, 1) ^ -0.323 * max(cystatin / 0.8, 1) ^ -0.778 * 0.9961 ^ age * if(female, 0.963, 1)",
        ),
        bands: KDIGO,
      },
    ],
    notes: ["Adults only. Uses standardized cystatin C."],
    references: [{ citation: "Inker LA et al. N Engl J Med 2021;385:1737–49.", doi: "10.1056/NEJMoa2102953" }],
  },
  {
    key: "cockcroft_gault",
    name: "Creatinine clearance — Cockcroft–Gault",
    short: "CrCl",
    category: "Renal",
    summary: "Estimated creatinine clearance for drug dosing (not BSA-indexed).",
    inputs: [AGE, num("weight_kg", "Weight", "kg", [30, 300], [1, 1000]), CREATININE, FEMALE],
    outputs: [{ key: "crcl", label: "CrCl", unit: "mL/min", decimals: 0, expr: x("(140 - age) * weight_kg / (72 * creatinine) * if(female, 0.85, 1)") }],
    notes: [
      "Uses actual body weight as in the original; many dosing protocols use ideal or adjusted weight instead.",
      "Derived with non-IDMS creatinine; modern assays read lower, so CrCl tends to be overestimated.",
    ],
    references: [{ citation: "Cockcroft DW, Gault MH. Nephron 1976;16:31–41.", doi: "10.1159/000180580" }],
  },
  {
    key: "map",
    name: "Mean arterial pressure",
    short: "MAP",
    category: "Cardiology",
    summary: "Diastolic pressure plus one third of the pulse pressure.",
    inputs: [num("sbp", "Systolic BP", "mmHg", [40, 300], [1, 400]), num("dbp", "Diastolic BP", "mmHg", [20, 200], [1, 300])],
    outputs: [
      {
        key: "map",
        label: "MAP",
        unit: "mmHg",
        decimals: 0,
        expr: x("dbp + (sbp - dbp) / 3"),
        bands: [
          { below: 65, label: "Below the Sepsis-3 target (65 mmHg)", tone: "bad" },
          { below: 70, label: "Low", tone: "warn" },
          { below: 101, label: "Typical resting range", tone: "ok" },
          { label: "High", tone: "warn" },
        ],
      },
    ],
    checks: [{ expr: x("sbp >= dbp"), message: "Systolic pressure must be at least the diastolic pressure." }],
    notes: ["A textbook approximation assuming diastole fills two thirds of the cycle; less accurate at high heart rates."],
    references: [{ citation: "Singer M et al. JAMA 2016;315:801–10 (Sepsis-3, MAP target).", doi: "10.1001/jama.2016.0287" }],
  },
  {
    key: "qtc",
    name: "Corrected QT interval",
    short: "QTc",
    category: "Cardiology",
    summary: "Bazett, Fridericia and Framingham rate corrections side by side.",
    inputs: [num("qt_ms", "QT interval", "ms", [200, 700], [50, 1500]), num("heart_rate", "Heart rate", "bpm", [30, 250], [5, 400])],
    outputs: [
      {
        key: "bazett",
        label: "QTc (Bazett)",
        unit: "ms",
        decimals: 0,
        expr: x("qt_ms / sqrt(60 / heart_rate)"),
        bands: [
          { below: 391, label: "Short QTc (≤ 390 ms)", tone: "warn" },
          { below: 450, label: "Normal", tone: "ok" },
          { below: 500, label: "Prolonged (≥ 450 men, ≥ 460 women)", tone: "warn" },
          { label: "≥ 500 ms — high torsades risk", tone: "bad" },
        ],
      },
      { key: "fridericia", label: "QTc (Fridericia)", unit: "ms", decimals: 0, expr: x("qt_ms / (60 / heart_rate) ^ (1 / 3)") },
      { key: "framingham", label: "QTc (Framingham)", unit: "ms", decimals: 0, expr: x("qt_ms + 154 * (1 - 60 / heart_rate)") },
    ],
    notes: ["Bazett over-corrects at high heart rates and under-corrects at low rates.", "Rate correction is unreliable in atrial fibrillation."],
    references: [
      { citation: "Sagie A et al. Am J Cardiol 1992;70:797–801 (Framingham).", doi: "10.1016/0002-9149(92)90562-d" },
      { citation: "Rautaharju PM et al. Circulation 2009;119:e241–50 (AHA/ACCF/HRS thresholds).", doi: "10.1161/CIRCULATIONAHA.108.191096" },
    ],
  },
  {
    key: "cha2ds2_vasc",
    name: "CHA₂DS₂-VASc / CHA₂DS₂-VA",
    short: "CHA₂DS₂",
    category: "Cardiology",
    summary: "Stroke risk in atrial fibrillation; the 2024 ESC variant drops the sex item.",
    inputs: [
      AGE,
      FEMALE,
      bool("chf", "Congestive heart failure / LV dysfunction"),
      bool("hypertension", "Hypertension"),
      bool("diabetes", "Diabetes mellitus"),
      bool("stroke", "Prior stroke / TIA / thromboembolism"),
      bool("vascular", "Vascular disease (MI, PAD, aortic plaque)"),
    ],
    outputs: [
      {
        key: "va",
        label: "CHA₂DS₂-VA (ESC 2024)",
        unit: "points",
        decimals: 0,
        expr: x("if(age >= 75, 2, if(age >= 65, 1, 0)) + if(chf, 1, 0) + if(hypertension, 1, 0) + if(diabetes, 1, 0) + if(stroke, 2, 0) + if(vascular, 1, 0)"),
        bands: POINTS_BANDS([[1, "0 · very low risk", "ok"], [2, "1 · oral anticoagulation should be considered", "warn"]], ["≥ 2 · oral anticoagulation recommended", "bad"]),
      },
      {
        key: "vasc",
        label: "CHA₂DS₂-VASc",
        unit: "points",
        decimals: 0,
        expr: x("if(age >= 75, 2, if(age >= 65, 1, 0)) + if(chf, 1, 0) + if(hypertension, 1, 0) + if(diabetes, 1, 0) + if(stroke, 2, 0) + if(vascular, 1, 0) + if(female, 1, 0)"),
      },
    ],
    notes: ["Under the older guidelines (CHA₂DS₂-VASc): men ≥ 2 and women ≥ 3 → anticoagulate; men 1 and women 2 → consider."],
    references: [
      { citation: "Lip GYH et al. Chest 2010;137:263–72.", doi: "10.1378/chest.09-1584" },
      { citation: "Van Gelder IC et al. 2024 ESC AF Guidelines. Eur Heart J 2024;45:3314–414.", doi: "10.1093/eurheartj/ehae176" },
    ],
  },
  {
    key: "has_bled",
    name: "HAS-BLED",
    short: "HAS-BLED",
    category: "Cardiology",
    summary: "Bleeding risk on anticoagulation in atrial fibrillation.",
    inputs: [
      bool("htn", "Uncontrolled hypertension (SBP > 160)"),
      bool("renal", "Abnormal renal function"),
      bool("liver", "Abnormal liver function"),
      bool("stroke", "Prior stroke"),
      bool("bleeding", "Bleeding history or predisposition"),
      bool("labile_inr", "Labile INR (TTR < 60%)"),
      num("age", "Age", "years", [18, 110], [0, 130]),
      bool("drugs", "Antiplatelets or NSAIDs"),
      bool("alcohol", "Alcohol ≥ 8 drinks/week"),
    ],
    outputs: [
      {
        key: "score",
        label: "HAS-BLED",
        unit: "points",
        decimals: 0,
        expr: x("if(htn, 1, 0) + if(renal, 1, 0) + if(liver, 1, 0) + if(stroke, 1, 0) + if(bleeding, 1, 0) + if(labile_inr, 1, 0) + if(age > 65, 1, 0) + if(drugs, 1, 0) + if(alcohol, 1, 0)"),
        bands: POINTS_BANDS([[3, "Lower bleeding risk", "ok"]], ["≥ 3 · high bleeding risk — review modifiable factors", "warn"]),
      },
    ],
    notes: ["A high score prompts closer review; it is not by itself a reason to withhold anticoagulation."],
    references: [{ citation: "Pisters R et al. Chest 2010;138:1093–100.", doi: "10.1378/chest.10-0134" }],
  },
  {
    key: "wells_pe",
    name: "Wells score for pulmonary embolism",
    short: "Wells PE",
    category: "Cardiology",
    summary: "Pre-test probability of PE, original and simplified versions.",
    inputs: [
      bool("dvt_signs", "Clinical signs of DVT"),
      bool("pe_likely", "PE is the most likely diagnosis"),
      bool("tachycardia", "Heart rate > 100"),
      bool("immobilisation", "Immobilisation ≥ 3 days or surgery in past 4 weeks"),
      bool("previous_vte", "Previous DVT / PE"),
      bool("haemoptysis", "Haemoptysis"),
      bool("malignancy", "Active malignancy"),
    ],
    outputs: [
      {
        key: "original",
        label: "Wells (original)",
        unit: "points",
        decimals: 1,
        expr: x("if(dvt_signs, 3, 0) + if(pe_likely, 3, 0) + if(tachycardia, 1.5, 0) + if(immobilisation, 1.5, 0) + if(previous_vte, 1.5, 0) + if(haemoptysis, 1, 0) + if(malignancy, 1, 0)"),
        bands: POINTS_BANDS([[2, "Low probability", "ok"], [4.0001, "Moderate · PE unlikely (≤ 4)", "info"], [6.0001, "Moderate · PE likely (> 4)", "warn"]], ["High probability (> 6)", "bad"]),
      },
      {
        key: "simplified",
        label: "Wells (simplified)",
        unit: "points",
        decimals: 0,
        expr: x("if(dvt_signs, 1, 0) + if(pe_likely, 1, 0) + if(tachycardia, 1, 0) + if(immobilisation, 1, 0) + if(previous_vte, 1, 0) + if(haemoptysis, 1, 0) + if(malignancy, 1, 0)"),
        bands: POINTS_BANDS([[2, "PE unlikely (≤ 1)", "ok"]], ["PE likely (> 1)", "warn"]),
      },
    ],
    notes: ["The original and simplified versions can disagree for the same patient."],
    references: [
      { citation: "Wells PS et al. Thromb Haemost 2000;83:416–20." },
      { citation: "Gibson NS et al. Thromb Haemost 2008;99:229–34.", doi: "10.1160/TH07-05-0321" },
    ],
  },
  {
    key: "homa_ir",
    name: "HOMA-IR",
    short: "HOMA-IR",
    category: "Metabolic",
    summary: "Insulin resistance from fasting glucose and insulin (Matthews 1985).",
    inputs: [
      num("glucose", "Fasting glucose", "mmol/L", [2.2, 33], [0.1, 100], { units: [{ label: "mmol/L", factor: 1 }, { label: "mg/dL", factor: 1 / 18 }] }),
      num("insulin", "Fasting insulin", "µU/mL", [0.5, 300], [0.01, 2000], { units: [{ label: "µU/mL", factor: 1 }, { label: "pmol/L", factor: 1 / 6 }] }),
    ],
    outputs: [{ key: "homa", label: "HOMA-IR", unit: "", decimals: 2, expr: x("glucose * insulin / 22.5") }],
    notes: ["There is no universal cut-off; published thresholds range from about 1.7 to 3.0 and are population- and assay-specific.", "Fasting samples only; not valid on insulin therapy."],
    references: [{ citation: "Matthews DR et al. Diabetologia 1985;28:412–9.", doi: "10.1007/BF00280883" }],
  },
  {
    key: "tyg",
    name: "Triglyceride–glucose index",
    short: "TyG",
    category: "Metabolic",
    summary: "ln(TG × glucose / 2) in mg/dL — a surrogate of insulin resistance.",
    inputs: [
      num("tg", "Fasting triglycerides", "mg/dL", [10, 5000], [1, 20000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 88.57 }] }),
      num("glucose", "Fasting glucose", "mg/dL", [40, 600], [1, 3000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 18.016 }] }),
    ],
    outputs: [{ key: "tyg", label: "TyG index", unit: "", decimals: 2, expr: x("ln(tg * glucose / 2)") }],
    notes: ["No universally accepted cut-off; studies use population-specific thresholds around 8.3–8.8."],
    references: [{ citation: "Simental-Mendía LE et al. Metab Syndr Relat Disord 2008;6:299–304.", doi: "10.1089/met.2008.0034" }],
  },
  {
    key: "ldl_friedewald",
    name: "LDL cholesterol — Friedewald",
    short: "LDL-C",
    category: "Lipids",
    summary: "Calculated LDL-C, withheld when triglycerides are ≥ 400 mg/dL.",
    inputs: [
      num("tc", "Total cholesterol", "mg/dL", [50, 1000], [1, 3000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 38.67 }] }),
      num("hdl", "HDL cholesterol", "mg/dL", [5, 200], [1, 500], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 38.67 }] }),
      num("tg", "Triglycerides", "mg/dL", [10, 4000], [1, 20000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 88.57 }] }),
    ],
    outputs: [
      {
        key: "ldl",
        label: "LDL-C",
        unit: "mg/dL",
        decimals: 0,
        expr: x("valid_if(tg < 400, tc - hdl - tg / 5)"),
        bands: [
          { below: 100, label: "Optimal", tone: "ok" },
          { below: 130, label: "Near / above optimal", tone: "info" },
          { below: 160, label: "Borderline high", tone: "warn" },
          { below: 190, label: "High", tone: "bad" },
          { label: "Very high", tone: "bad" },
        ],
      },
    ],
    checks: [{ expr: x("tg < 400"), message: "Friedewald is invalid at triglycerides ≥ 400 mg/dL (4.5 mmol/L); measure LDL directly." }],
    notes: ["Not valid for non-fasting samples with chylomicrons or type III dysbetalipoproteinaemia; less accurate below 70 mg/dL.", "Bands follow NCEP ATP III; current guidelines use risk-based targets."],
    references: [
      { citation: "Friedewald WT, Levy RI, Fredrickson DS. Clin Chem 1972;18:499–502." },
      { citation: "NCEP ATP III. Circulation 2002;106:3143–421." },
    ],
  },
  {
    key: "non_hdl",
    name: "Non-HDL cholesterol",
    short: "non-HDL",
    category: "Lipids",
    summary: "Total minus HDL cholesterol; valid without fasting.",
    inputs: [
      num("tc", "Total cholesterol", "mg/dL", [50, 1000], [1, 3000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 38.67 }] }),
      num("hdl", "HDL cholesterol", "mg/dL", [5, 200], [1, 500], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 38.67 }] }),
    ],
    outputs: [
      {
        key: "non_hdl",
        label: "Non-HDL-C",
        unit: "mg/dL",
        decimals: 0,
        expr: x("tc - hdl"),
        bands: [
          { below: 130, label: "Desirable", tone: "ok" },
          { below: 160, label: "Above desirable", tone: "info" },
          { below: 190, label: "Borderline high", tone: "warn" },
          { below: 220, label: "High", tone: "bad" },
          { label: "Very high", tone: "bad" },
        ],
      },
    ],
    notes: ["Bands are the ATP III LDL bands plus 30 mg/dL."],
    references: [{ citation: "NCEP ATP III. Circulation 2002;106:3143–421." }],
  },
  {
    key: "anion_gap",
    name: "Anion gap",
    short: "AG",
    category: "Electrolytes",
    summary: "Na − (Cl + HCO₃), optionally with potassium and albumin adjustment.",
    inputs: [
      num("sodium", "Sodium", "mmol/L", [100, 200], [50, 300]),
      num("chloride", "Chloride", "mmol/L", [60, 150], [20, 250]),
      num("bicarbonate", "Bicarbonate", "mmol/L", [2, 60], [0, 100]),
      num("potassium", "Potassium", "mmol/L", [1, 10], [0, 20], { optional: true }),
      num("albumin", "Albumin", "g/dL", [0.5, 6], [0, 15], { optional: true, units: [{ label: "g/dL", factor: 1 }, { label: "g/L", factor: 0.1 }] }),
    ],
    outputs: [
      { key: "ag", label: "Anion gap", unit: "mmol/L", decimals: 0, expr: x("sodium - (chloride + bicarbonate)") },
      { key: "ag_k", label: "Anion gap with K⁺", unit: "mmol/L", decimals: 0, expr: x("sodium + potassium - (chloride + bicarbonate)") },
      { key: "ag_alb", label: "Albumin-adjusted gap", unit: "mmol/L", decimals: 1, expr: x("sodium - (chloride + bicarbonate) + 2.5 * (4 - albumin)") },
    ],
    notes: ["Reference ranges are analyser-specific: about 3–11 mmol/L with modern ion-selective electrodes, about 4 higher with K⁺."],
    references: [
      { citation: "Kraut JA, Madias NE. Clin J Am Soc Nephrol 2007;2:162–74.", doi: "10.2215/CJN.03020906" },
      { citation: "Figge J et al. Crit Care Med 1998;26:1807–10.", doi: "10.1097/00003246-199811000-00019" },
    ],
  },
  {
    key: "corrected_calcium",
    name: "Albumin-corrected calcium",
    short: "Ca corr",
    category: "Electrolytes",
    summary: "Total calcium adjusted to an albumin of 4.0 g/dL (0.8 convention).",
    inputs: [
      num("calcium", "Total calcium", "mg/dL", [4, 18], [0.5, 30], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 4.008 }] }),
      num("albumin", "Albumin", "g/dL", [0.5, 6], [0.1, 15], { units: [{ label: "g/dL", factor: 1 }, { label: "g/L", factor: 0.1 }] }),
    ],
    outputs: [
      {
        key: "ca",
        label: "Corrected calcium",
        unit: "mg/dL",
        decimals: 1,
        expr: x("calcium + 0.8 * (4 - albumin)"),
        bands: [
          { below: 8.5, label: "Below typical range", tone: "warn" },
          { below: 10.51, label: "Typical range (8.5–10.5)", tone: "ok" },
          { label: "Above typical range", tone: "warn" },
        ],
      },
    ],
    notes: ["Payne 1973 originally published a factor of 1.0; 0.8 is the later convention.", "Unreliable in CKD and critical illness — prefer ionized calcium."],
    references: [{ citation: "Payne RB et al. BMJ 1973;4:643–6.", doi: "10.1136/bmj.4.5893.643" }],
  },
  {
    key: "corrected_sodium",
    name: "Sodium corrected for hyperglycaemia",
    short: "Na corr",
    category: "Electrolytes",
    summary: "Katz (1.6) and Hillier (2.4) corrections per 100 mg/dL of glucose above 100.",
    inputs: [
      num("sodium", "Measured sodium", "mmol/L", [100, 180], [50, 250]),
      num("glucose", "Glucose", "mg/dL", [40, 2000], [1, 5000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 18.016 }] }),
    ],
    outputs: [
      { key: "hillier", label: "Corrected Na (Hillier 2.4)", unit: "mmol/L", decimals: 1, expr: x("sodium + 2.4 * max(0, glucose - 100) / 100") },
      { key: "katz", label: "Corrected Na (Katz 1.6)", unit: "mmol/L", decimals: 1, expr: x("sodium + 1.6 * max(0, glucose - 100) / 100") },
    ],
    notes: ["Hillier found the relation non-linear above 400 mg/dL (≈ 4.0 per 100 mg/dL); not applied here."],
    references: [
      { citation: "Katz MA. N Engl J Med 1973;289:843–4.", doi: "10.1056/NEJM197310182891607" },
      { citation: "Hillier TA et al. Am J Med 1999;106:399–403.", doi: "10.1016/s0002-9343(99)00055-8" },
    ],
  },
  {
    key: "osmolality",
    name: "Calculated serum osmolality",
    short: "Osm",
    category: "Electrolytes",
    summary: "2 × Na + glucose/18 + BUN/2.8.",
    inputs: [
      num("sodium", "Sodium", "mmol/L", [100, 200], [50, 300]),
      num("glucose", "Glucose", "mg/dL", [20, 2000], [1, 5000], { units: [{ label: "mg/dL", factor: 1 }, { label: "mmol/L", factor: 18 }] }),
      num("bun", "Blood urea nitrogen", "mg/dL", [1, 300], [0, 600], { units: [{ label: "BUN mg/dL", factor: 1 }, { label: "urea mmol/L", factor: 2.8 }] }),
    ],
    outputs: [
      {
        key: "osm",
        label: "Calculated osmolality",
        unit: "mOsm/kg",
        decimals: 0,
        expr: x("2 * sodium + glucose / 18 + bun / 2.8"),
        bands: [
          { below: 275, label: "Below typical range", tone: "warn" },
          { below: 296, label: "Typical range (275–295)", tone: "ok" },
          { label: "Above typical range", tone: "warn" },
        ],
      },
    ],
    notes: ["Osmolal gap = measured − calculated; a gap above ~10 suggests unmeasured osmoles such as toxic alcohols."],
    references: [{ citation: "Dorwart WV, Chalmers L. Clin Chem 1975;21:190–4." }],
  },
  {
    key: "curb65",
    name: "CURB-65",
    short: "CURB-65",
    category: "Critical care",
    summary: "Severity of community-acquired pneumonia.",
    inputs: [
      bool("confusion", "New confusion"),
      num("urea", "Urea", "mmol/L", [0.5, 60], [0, 150], { units: [{ label: "urea mmol/L", factor: 1 }, { label: "BUN mg/dL", factor: 1 / 2.801 }] }),
      num("resp_rate", "Respiratory rate", "/min", [4, 80], [0, 120]),
      num("sbp", "Systolic BP", "mmHg", [40, 300], [1, 400]),
      num("dbp", "Diastolic BP", "mmHg", [20, 200], [1, 300]),
      num("age", "Age", "years", [18, 110], [0, 130]),
    ],
    outputs: [
      {
        key: "score",
        label: "CURB-65",
        unit: "points",
        decimals: 0,
        expr: x("if(confusion, 1, 0) + if(urea > 7, 1, 0) + if(resp_rate >= 30, 1, 0) + if(sbp < 90 or dbp <= 60, 1, 0) + if(age >= 65, 1, 0)"),
        bands: POINTS_BANDS([[2, "0–1 · low risk (30-day mortality < 3%)", "ok"], [3, "2 · intermediate risk (3–15%)", "warn"]], ["3–5 · high risk (> 15%)", "bad"]),
      },
    ],
    notes: ["Urea must exceed 7 mmol/L (strictly) to score."],
    references: [
      { citation: "Lim WS et al. Thorax 2003;58:377–82.", doi: "10.1136/thorax.58.5.377" },
      { citation: "NICE QS110 statement 4.", url: "https://www.nice.org.uk/guidance/QS110/chapter/quality-statement-4-mortality-risk-assessment-in-hospital-using-curb65-score" },
    ],
  },
  {
    key: "qsofa",
    name: "qSOFA",
    short: "qSOFA",
    category: "Critical care",
    summary: "Quick SOFA bedside prompt for poor outcome in suspected infection.",
    inputs: [
      num("resp_rate", "Respiratory rate", "/min", [4, 80], [0, 120]),
      num("sbp", "Systolic BP", "mmHg", [40, 300], [1, 400]),
      num("gcs", "Glasgow Coma Scale", "points", [3, 15], [3, 15]),
    ],
    outputs: [
      {
        key: "score",
        label: "qSOFA",
        unit: "points",
        decimals: 0,
        expr: x("if(resp_rate >= 22, 1, 0) + if(gcs < 15, 1, 0) + if(sbp <= 100, 1, 0)"),
        bands: POINTS_BANDS([[2, "Negative (< 2)", "ok"]], ["Positive (≥ 2) · higher risk of poor outcome", "bad"]),
      },
    ],
    notes: ["A prompt to consider sepsis outside the ICU — not a diagnostic criterion (Sepsis-3 uses a SOFA rise ≥ 2)."],
    references: [{ citation: "Seymour CW et al. JAMA 2016;315:762–74.", doi: "10.1001/jama.2016.0288" }],
  },
  {
    key: "gcs",
    name: "Glasgow Coma Scale",
    short: "GCS",
    category: "Critical care",
    summary: "Eye, verbal and motor responses; total 3–15.",
    inputs: [
      { name: "eye", label: "Eye opening", kind: "number", options: [
        { value: 4, label: "4 · spontaneous" },
        { value: 3, label: "3 · to sound" },
        { value: 2, label: "2 · to pressure" },
        { value: 1, label: "1 · none" },
      ], defaultValue: 4, hard: [1, 4] },
      { name: "verbal", label: "Verbal response", kind: "number", options: [
        { value: 5, label: "5 · oriented" },
        { value: 4, label: "4 · confused" },
        { value: 3, label: "3 · words" },
        { value: 2, label: "2 · sounds" },
        { value: 1, label: "1 · none" },
      ], defaultValue: 5, hard: [1, 5] },
      { name: "motor", label: "Motor response", kind: "number", options: [
        { value: 6, label: "6 · obeys commands" },
        { value: 5, label: "5 · localising" },
        { value: 4, label: "4 · normal flexion" },
        { value: 3, label: "3 · abnormal flexion" },
        { value: 2, label: "2 · extension" },
        { value: 1, label: "1 · none" },
      ], defaultValue: 6, hard: [1, 6] },
    ],
    outputs: [
      {
        key: "total",
        label: "GCS",
        unit: "points",
        decimals: 0,
        expr: x("eye + verbal + motor"),
        bands: POINTS_BANDS([[9, "≤ 8 · severe", "bad"], [13, "9–12 · moderate", "warn"]], ["13–15 · mild", "ok"]),
      },
    ],
    notes: ["Describe individual patients by their components (e.g. E3 V4 M6); use totals mainly for groups.", "Non-testable components (e.g. intubated: VT) have no total."],
    references: [
      { citation: "Teasdale G, Jennett B. Lancet 1974;2:81–4.", doi: "10.1016/s0140-6736(74)91639-0" },
      { citation: "Teasdale G et al. Lancet Neurol 2014;13:844–54.", doi: "10.1016/S1474-4422(14)70120-6" },
    ],
  },
  {
    key: "fib4",
    name: "FIB-4 index",
    short: "FIB-4",
    category: "Hepatology",
    summary: "Non-invasive estimate of advanced liver fibrosis with age-aware cut-offs.",
    inputs: [
      num("age", "Age", "years", [35, 100], [1, 130]),
      num("ast", "AST", "U/L", [5, 5000], [1, 20000]),
      num("alt", "ALT", "U/L", [5, 5000], [1, 20000]),
      num("platelets", "Platelets", "×10⁹/L", [5, 1500], [1, 3000]),
    ],
    outputs: [
      {
        key: "fib4",
        label: "FIB-4",
        unit: "",
        decimals: 2,
        expr: x("age * ast / (platelets * sqrt(alt))"),
        bands: [
          { below: 1.3, label: "Low risk of advanced fibrosis (< 1.30)", tone: "ok" },
          { below: 2.67, label: "Indeterminate (1.30–2.67)", tone: "warn" },
          { label: "High risk (≥ 2.67)", tone: "bad" },
        ],
      },
    ],
    alerts: [
      { expr: x("age < 35"), message: "FIB-4 performs poorly below age 35 — do not use." },
      { expr: x("age >= 65"), message: "At age ≥ 65 use a lower rule-out cut-off of 2.0 (McPherson 2017)." },
    ],
    notes: ["Bands are the NAFLD/MASLD cut-offs (Shah 2009); the HIV/HCV derivation used < 1.45 and > 3.25."],
    references: [
      { citation: "Sterling RK et al. Hepatology 2006;43:1317–25.", doi: "10.1002/hep.21178" },
      { citation: "Shah AG et al. Clin Gastroenterol Hepatol 2009;7:1104–12.", doi: "10.1016/j.cgh.2009.05.033" },
      { citation: "McPherson S et al. Am J Gastroenterol 2017;112:740–51.", doi: "10.1038/ajg.2016.453" },
    ],
  },
  {
    key: "apri",
    name: "APRI",
    short: "APRI",
    category: "Hepatology",
    summary: "AST-to-platelet ratio index for fibrosis in chronic hepatitis C.",
    inputs: [
      num("ast", "AST", "U/L", [5, 5000], [1, 20000]),
      num("ast_uln", "AST upper limit of normal", "U/L", [20, 60], [1, 200], { defaultValue: 40 }),
      num("platelets", "Platelets", "×10⁹/L", [5, 1500], [1, 3000]),
    ],
    outputs: [
      {
        key: "apri",
        label: "APRI",
        unit: "",
        decimals: 2,
        expr: x("ast / ast_uln / platelets * 100"),
        bands: [
          { below: 0.50001, label: "Significant fibrosis unlikely (≤ 0.5)", tone: "ok" },
          { below: 1.50001, label: "Indeterminate", tone: "warn" },
          { label: "Significant fibrosis likely (> 1.5)", tone: "bad" },
        ],
      },
    ],
    notes: ["Cirrhosis: rule out ≤ 1.0, rule in > 2.0. Results depend on the ULN chosen.", "Less accurate in hepatitis B and NAFLD."],
    references: [{ citation: "Wai CT et al. Hepatology 2003;38:518–26.", doi: "10.1053/jhep.2003.50346" }],
  },
  {
    key: "meld_na",
    name: "MELD and MELD-Na (OPTN 2016)",
    short: "MELD-Na",
    category: "Hepatology",
    summary: "End-stage liver disease severity, with the OPTN rounding and bounds.",
    inputs: [
      num("creatinine", "Creatinine", "mg/dL", [0.1, 20], [0.01, 50], { units: [{ label: "mg/dL", factor: 1 }, { label: "µmol/L", factor: 1 / 88.42 }] }),
      num("bilirubin", "Bilirubin", "mg/dL", [0.1, 80], [0.01, 150], { units: [{ label: "mg/dL", factor: 1 }, { label: "µmol/L", factor: 1 / 17.1 }] }),
      num("inr", "INR", "", [0.8, 15], [0.1, 30]),
      num("sodium", "Sodium", "mmol/L", [100, 180], [50, 250]),
      bool("dialysis", "Dialysis ≥ 2× or CVVHD 24 h in the past week"),
    ],
    outputs: [
      { key: "meld_na", label: "MELD-Na", unit: "", decimals: 0, expr: x(`min(if(${MELD_I} > 11, round(${MELD_I} + 1.32 * (137 - ${NA_B}) - 0.033 * ${MELD_I} * (137 - ${NA_B})), ${MELD_I}), 40)`) },
      { key: "meld", label: "MELD", unit: "", decimals: 0, expr: x(`min(${MELD_I}, 40)`) },
    ],
    notes: ["Lab values below 1.0 are set to 1.0; creatinine is capped at 4.0 mg/dL (4.0 on dialysis). The Na adjustment applies only when MELD > 11."],
    references: [
      { citation: "Kamath PS et al. Hepatology 2001;33:464–70.", doi: "10.1053/jhep.2001.22172" },
      { citation: "Kim WR et al. N Engl J Med 2008;359:1018–26.", doi: "10.1056/NEJMoa0801209" },
    ],
  },
  {
    key: "meld3",
    name: "MELD 3.0",
    short: "MELD 3.0",
    category: "Hepatology",
    summary: "The 2023 OPTN MELD with sex and albumin terms (adults).",
    inputs: [
      FEMALE,
      num("bilirubin", "Bilirubin", "mg/dL", [0.1, 80], [0.01, 150]),
      num("sodium", "Sodium", "mmol/L", [100, 180], [50, 250]),
      num("inr", "INR", "", [0.8, 15], [0.1, 30]),
      num("creatinine", "Creatinine", "mg/dL", [0.1, 20], [0.01, 50]),
      num("albumin", "Albumin", "g/dL", [0.5, 6], [0.1, 15]),
      bool("dialysis", "Dialysis ≥ 2× or CVVHD 24 h in the past week"),
    ],
    outputs: [
      {
        key: "meld3",
        label: "MELD 3.0",
        unit: "",
        decimals: 0,
        expr: x(
          "clamp(round(1.33 * if(female, 1, 0) + 4.56 * ln(max(bilirubin, 1)) + 0.82 * (137 - clamp(sodium, 125, 137)) - 0.24 * (137 - clamp(sodium, 125, 137)) * ln(max(bilirubin, 1)) + 9.09 * ln(max(inr, 1)) + 11.14 * ln(clamp(if(dialysis, 3, creatinine), 1, 3)) + 1.85 * (3.5 - clamp(albumin, 1.5, 3.5)) - 1.83 * (3.5 - clamp(albumin, 1.5, 3.5)) * ln(clamp(if(dialysis, 3, creatinine), 1, 3)) + 6), 6, 40)",
        ),
      },
    ],
    notes: ["Adult form. Coefficients verified against Kim 2021 via an academic reference calculator; check OPTN Policy 9.1.D before clinical-grade use."],
    references: [{ citation: "Kim WR et al. Gastroenterology 2021;161:1887–95.", doi: "10.1053/j.gastro.2021.08.050" }],
  },
  {
    key: "child_pugh",
    name: "Child–Pugh score",
    short: "Child–Pugh",
    category: "Hepatology",
    summary: "Cirrhosis severity class A–C.",
    inputs: [
      num("bilirubin", "Total bilirubin", "mg/dL", [0.1, 50], [0.01, 150], { units: [{ label: "mg/dL", factor: 1 }, { label: "µmol/L", factor: 1 / 17.1 }] }),
      num("albumin", "Albumin", "g/dL", [0.5, 6], [0.1, 15], { units: [{ label: "g/dL", factor: 1 }, { label: "g/L", factor: 0.1 }] }),
      num("inr", "INR", "", [0.8, 10], [0.1, 30]),
      { name: "ascites", label: "Ascites", kind: "number", options: [
        { value: 1, label: "None" },
        { value: 2, label: "Mild / controlled with diuretics" },
        { value: 3, label: "Moderate–severe / refractory" },
      ], defaultValue: 1, hard: [1, 3] },
      { name: "encephalopathy", label: "Hepatic encephalopathy", kind: "number", options: [
        { value: 1, label: "None" },
        { value: 2, label: "Grade 1–2 / controlled" },
        { value: 3, label: "Grade 3–4 / refractory" },
      ], defaultValue: 1, hard: [1, 3] },
    ],
    outputs: [
      {
        key: "score",
        label: "Child–Pugh",
        unit: "points",
        decimals: 0,
        expr: x("if(bilirubin < 2, 1, if(bilirubin <= 3, 2, 3)) + if(albumin > 3.5, 1, if(albumin >= 2.8, 2, 3)) + if(inr < 1.7, 1, if(inr <= 2.3, 2, 3)) + ascites + encephalopathy"),
        bands: POINTS_BANDS([[7, "Class A (5–6)", "ok"], [10, "Class B (7–9)", "warn"]], ["Class C (10–15)", "bad"]),
      },
    ],
    notes: ["Middle intervals are closed (bilirubin 2–3, albumin 2.8–3.5, INR 1.7–2.3 score 2). For PBC/PSC a modified bilirubin scale is often used."],
    references: [{ citation: "Pugh RNH et al. Br J Surg 1973;60:646–9.", doi: "10.1002/bjs.1800600817" }],
  },
  {
    key: "phq9",
    name: "PHQ-9 depression severity",
    short: "PHQ-9",
    category: "Mental health",
    summary: "Sum of nine items scored 0–3, with severity bands and an item-9 safety flag.",
    inputs: Array.from({ length: 9 }, (_, index) => ({
      name: `item${index + 1}`,
      label: `Item ${index + 1}${index === 8 ? " (thoughts of self-harm)" : ""}`,
      kind: "number" as const,
      options: [
        { value: 0, label: "0 · not at all" },
        { value: 1, label: "1 · several days" },
        { value: 2, label: "2 · more than half the days" },
        { value: 3, label: "3 · nearly every day" },
      ],
      defaultValue: 0,
      hard: [0, 3] as [number, number],
    })),
    outputs: [
      {
        key: "total",
        label: "PHQ-9",
        unit: "points",
        decimals: 0,
        expr: x("item1 + item2 + item3 + item4 + item5 + item6 + item7 + item8 + item9"),
        bands: POINTS_BANDS(
          [[5, "0–4 · none / minimal", "ok"], [10, "5–9 · mild", "info"], [15, "10–14 · moderate", "warn"], [20, "15–19 · moderately severe", "bad"]],
          ["20–27 · severe", "bad"],
        ),
      },
    ],
    alerts: [{ expr: x("item9 > 0"), message: "Item 9 is above zero: follow up on thoughts of self-harm regardless of the total." }],
    notes: ["Item wording is not reproduced here; administer the official questionnaire (Pfizer, free to reproduce)."],
    references: [{ citation: "Kroenke K, Spitzer RL, Williams JBW. J Gen Intern Med 2001;16:606–13.", doi: "10.1046/j.1525-1497.2001.016009606.x" }],
  },
];

// Fill the names of shared boolean/number templates created through `yes()`.
for (const calc of CALCULATORS) {
  for (const input of calc.inputs) if (!input.name) throw new Error(`${calc.key}: an input has no name`);
}

export function findCalculator(key: string): Calculator | undefined {
  return CALCULATORS.find((calc) => calc.key === key);
}

/** Value types of a calculator's inputs, for the type checker. */
export function calculatorSchema(calc: Calculator): (name: string) => "number" | "boolean" | undefined {
  const types = new Map(calc.inputs.map((input) => [input.name, input.kind === "boolean" ? ("boolean" as const) : ("number" as const)]));
  return (name) => types.get(name);
}

export function bandFor(output: CalcOutput, value: number): Band | null {
  if (!output.bands) return null;
  const shown = Number(value.toFixed(output.decimals));
  return output.bands.find((band) => band.below === undefined || shown < band.below) ?? null;
}

export interface InputIssue {
  name: string;
  level: "error" | "warning";
  message: string;
}

export interface CalcResult {
  outputs: { output: CalcOutput; value: number | null; band: Band | null }[];
  issues: InputIssue[];
  checks: string[];
  alerts: string[];
}

/**
 * Computes every output for one patient. `entered` holds values in the
 * selected units; `unitIndex` picks each input's unit (default: canonical).
 * An impossible value blocks computation; an implausible one only warns.
 */
export function computeCalculator(
  calc: Calculator,
  entered: Readonly<Record<string, number | boolean | null | undefined>>,
  unitIndex: Readonly<Record<string, number>> = {},
): CalcResult {
  const issues: InputIssue[] = [];
  const row: Record<string, Value> = {};
  for (const input of calc.inputs) {
    const raw = entered[input.name];
    if (input.kind === "boolean") {
      row[input.name] = raw === true;
      continue;
    }
    if (raw === null || raw === undefined || (typeof raw === "number" && !Number.isFinite(raw))) {
      row[input.name] = null;
      if (!input.optional) issues.push({ name: input.name, level: "error", message: `${input.label} is required.` });
      continue;
    }
    const unit = input.units?.[unitIndex[input.name] ?? 0];
    const factor = unit?.factor ?? 1;
    const value = Number(raw) * factor;
    // Ranges are defined in the canonical unit but reported in the unit the user chose.
    const shown = (bound: number) => Number((bound / factor).toPrecision(3));
    const unitLabel = unit?.label ?? input.unit ?? "";
    if (input.hard && (value < input.hard[0] || value > input.hard[1])) {
      issues.push({ name: input.name, level: "error", message: `${input.label} must lie between ${shown(input.hard[0])} and ${shown(input.hard[1])} ${unitLabel}`.trim() + "." });
      row[input.name] = null;
      continue;
    }
    if (input.plausible && (value < input.plausible[0] || value > input.plausible[1])) {
      issues.push({ name: input.name, level: "warning", message: `${input.label} is outside the usual range ${shown(input.plausible[0])}–${shown(input.plausible[1])} ${unitLabel}`.trim() + "." });
    }
    row[input.name] = value;
  }
  const blocked = issues.some((issue) => issue.level === "error");
  const outputs = calc.outputs.map((output) => {
    if (blocked) return { output, value: null, band: null };
    const value = evaluateExpr(output.expr, row);
    const numeric = typeof value === "number" ? value : null;
    return { output, value: numeric, band: numeric === null ? null : bandFor(output, numeric) };
  });
  const checks = blocked ? [] : (calc.checks ?? []).filter((check) => evaluateExpr(check.expr, row) === false).map((check) => check.message);
  const alerts = blocked ? [] : (calc.alerts ?? []).filter((alert) => evaluateExpr(alert.expr, row) === true).map((alert) => alert.message);
  return { outputs, issues, checks, alerts };
}

/** Every calculator formula must type-check against its own inputs. */
export function validateCatalog(): string[] {
  const problems: string[] = [];
  for (const calc of CALCULATORS) {
    const schema = calculatorSchema(calc);
    for (const output of calc.outputs) {
      const checked = checkExpr(output.expr, schema);
      if (checked.type !== "number") problems.push(`${calc.key}.${output.key}: ${checked.diagnostics[0]?.message ?? `gives ${checked.type}`}`);
    }
    for (const check of [...(calc.checks ?? []), ...(calc.alerts ?? [])]) {
      if (checkExpr(check.expr, schema).type !== "boolean") problems.push(`${calc.key}: a check is not a yes/no condition`);
    }
  }
  return problems;
}
