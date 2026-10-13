/**
 * Built-in demonstration datasets.
 *
 * Every row here is SYNTHETIC: drawn from a fixed-seed generator with
 * clinically plausible marginal distributions and deliberately planted
 * associations, so every module of the workstation has something meaningful to
 * show on first run. They describe no real person and must never be presented
 * as real-world evidence. Generation is deterministic — the same key always
 * yields the same rows and therefore the same content hash.
 */

import type { ColumnRole, StoredColumn } from "./dataset";

export interface SampleDefinition {
  key: string;
  name: string;
  description: string;
  rows: number;
  highlights: string[];
}

export const SAMPLE_DATASETS: readonly SampleDefinition[] = [
  {
    key: "cardiometabolic",
    name: "Synthetic cardiometabolic cohort",
    description:
      "SYNTHETIC prospective cohort of 1,500 adults with baseline anthropometry, blood pressure, glucose, lipids, renal function and lifestyle, followed for incident diabetes and a time-to-event cardiovascular outcome. Generated data for demonstration — not real patients.",
    rows: 1500,
    highlights: ["Cohort building", "Table 1", "Logistic & Cox regression", "Kaplan–Meier"],
  },
  {
    key: "rct_hypertension",
    name: "Synthetic hypertension RCT",
    description:
      "SYNTHETIC two-arm randomised trial (n = 400) of an antihypertensive versus placebo with baseline and week-12 systolic blood pressure, adherence, site and adverse events. Generated data for demonstration — not a real trial.",
    rows: 400,
    highlights: ["Group comparison", "Paired change", "Sample size", "Effect sizes"],
  },
  {
    key: "sepsis_biomarker",
    name: "Synthetic sepsis biomarker study",
    description:
      "SYNTHETIC diagnostic accuracy study (n = 800) of emergency admissions with CRP, procalcitonin, lactate and vital signs against a reference-standard sepsis diagnosis, plus 28-day mortality. Generated data for demonstration — not real patients.",
    rows: 800,
    highlights: ["ROC & DeLong AUC", "Fagan nomogram", "qSOFA calculator", "Score Forge"],
  },
];

export function findSample(key: string): SampleDefinition | undefined {
  return SAMPLE_DATASETS.find((sample) => sample.key === key);
}

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

/** mulberry32: small, fast, and fully reproducible across engines. */
export function createRng(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = (mean = 0, sd = 1) => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return mean + sd * value;
    }
    let u = 0;
    while (u === 0) u = uniform();
    const v = uniform();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return mean + sd * radius * Math.cos(2 * Math.PI * v);
  };
  const pick = <T,>(options: readonly (readonly [T, number])[]): T => {
    const total = options.reduce((sum, [, weight]) => sum + weight, 0);
    let r = uniform() * total;
    for (const [value, weight] of options) {
      r -= weight;
      if (r <= 0) return value;
    }
    return options[options.length - 1][0];
  };
  return { uniform, normal, pick, bernoulli: (p: number) => uniform() < p };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const round = (x: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
const expit = (x: number) => 1 / (1 + Math.exp(-x));
const pad = (n: number, width: number) => String(n).padStart(width, "0");

interface ColumnSpec {
  name: string;
  kind: "numeric" | "categorical";
  label: string;
  unit?: string;
  role?: ColumnRole;
  description?: string;
}

function assemble(specs: ColumnSpec[], rows: Record<string, number | string | null>[]): StoredColumn[] {
  return specs.map((spec) => ({
    name: spec.name,
    kind: spec.kind,
    label: spec.label,
    unit: spec.unit ?? "",
    role: spec.role ?? "none",
    description: spec.description ?? "",
    values: rows.map((row) => row[spec.name] ?? null) as (number | null)[] | (string | null)[],
  }));
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

function cardiometabolic(): StoredColumn[] {
  const rng = createRng(20261012);
  const rows: Record<string, number | string | null>[] = [];
  for (let i = 0; i < 1500; i += 1) {
    const age = Math.round(clamp(rng.normal(52, 11), 25, 85));
    const sex = rng.bernoulli(0.52) ? "F" : "M";
    const male = sex === "M" ? 1 : 0;
    const height = round(male ? rng.normal(174, 7) : rng.normal(161, 6.5), 1);
    const bmiLatent = clamp(rng.normal(26 + 0.03 * (age - 52), 4.2), 16.5, 48);
    const weight = round(bmiLatent * (height / 100) ** 2, 1);
    const bmi = round(weight / (height / 100) ** 2, 1);
    const waist = round(40 + 1.95 * bmi + 6 * male + rng.normal(0, 5), 1);
    const smoking = rng.pick([["never", 55], ["former", 25], ["current", 20]] as const);
    const activity = rng.pick([["low", 35], ["moderate", 45], ["high", 20]] as const);
    const sbp = Math.round(clamp(100 + 0.45 * age + 0.9 * (bmi - 25) + 4 * male + rng.normal(0, 13), 85, 220));
    const dbp = Math.round(clamp(0.55 * sbp + 8 + rng.normal(0, 7), 45, 130));
    // A minority with impaired glucose, a few already in the diabetic range —
    // the kind of prevalent cases a cohort definition must exclude.
    const prediabetes = rng.bernoulli(0.1) ? 1.3 : 0;
    const fpg = round(clamp(4.85 + 0.012 * (age - 52) + 0.045 * (bmi - 25) + prediabetes + rng.normal(0, 0.45), 3.5, 9.8), 2);
    const hba1c = round(clamp(3.2 + 0.42 * fpg + rng.normal(0, 0.25), 4, 11), 1);
    const tg = round(Math.exp(rng.normal(Math.log(1.3) + 0.03 * (bmi - 25) + 0.1 * male, 0.45)), 2);
    const hdl = round(clamp((male ? 1.25 : 1.55) - 0.025 * (bmi - 25) + rng.normal(0, 0.28), 0.5, 3), 2);
    const ldl = round(clamp(3.0 + 0.01 * (age - 52) + rng.normal(0, 0.8), 0.8, 7), 2);
    const creatinine = Math.round(clamp(rng.normal(male ? 85 : 68, male ? 15 : 12) + 0.3 * (age - 52), 40, 300));
    const statin = rng.bernoulli(clamp(0.04 + 0.006 * (age - 40) + 0.08 * (ldl > 4 ? 1 : 0), 0.01, 0.6)) ? "yes" : "no";

    const diabetesRisk = expit(
      -2.6 +
        1.25 * (fpg - 5.2) +
        0.09 * (bmi - 26) +
        0.025 * (age - 52) +
        0.35 * Math.log(tg / hdl) +
        (smoking === "current" ? 0.25 : 0) -
        (activity === "high" ? 0.3 : 0),
    );
    const incidentDiabetes = rng.bernoulli(diabetesRisk) ? 1 : 0;

    const hazard =
      0.011 *
      Math.exp(
        0.055 * (age - 52) +
          0.016 * (sbp - 130) +
          0.35 * (ldl - 3) +
          0.55 * (smoking === "current" ? 1 : 0) +
          0.3 * male -
          0.35 * (statin === "yes" ? 1 : 0) +
          0.5 * incidentDiabetes,
      );
    const eventTime = -Math.log(1 - rng.uniform()) / hazard;
    const censorTime = 2 + rng.uniform() * 8;
    const followup = round(Math.max(0.05, Math.min(eventTime, censorTime)), 2);
    const cvd = eventTime <= censorTime ? 1 : 0;

    rows.push({
      id: `CM-${pad(i + 1, 4)}`,
      age,
      sex,
      height_cm: height,
      weight_kg: weight,
      bmi,
      waist_cm: rng.bernoulli(0.05) ? null : waist,
      sbp,
      dbp,
      fpg_mmol: fpg,
      hba1c_pct: rng.bernoulli(0.04) ? null : hba1c,
      tg_mmol: tg,
      hdl_mmol: hdl,
      ldl_mmol: rng.bernoulli(0.03) ? null : ldl,
      creatinine_umol: creatinine,
      smoking,
      activity,
      statin,
      incident_diabetes: incidentDiabetes,
      followup_years: followup,
      cvd_event: cvd,
    });
  }
  return assemble(
    [
      { name: "id", kind: "categorical", label: "Participant ID", role: "id" },
      { name: "age", kind: "numeric", label: "Age", unit: "years" },
      { name: "sex", kind: "categorical", label: "Sex", role: "group", description: "F = female, M = male." },
      { name: "height_cm", kind: "numeric", label: "Height", unit: "cm" },
      { name: "weight_kg", kind: "numeric", label: "Weight", unit: "kg" },
      { name: "bmi", kind: "numeric", label: "BMI", unit: "kg/m²" },
      { name: "waist_cm", kind: "numeric", label: "Waist circumference", unit: "cm" },
      { name: "sbp", kind: "numeric", label: "Systolic BP", unit: "mmHg" },
      { name: "dbp", kind: "numeric", label: "Diastolic BP", unit: "mmHg" },
      { name: "fpg_mmol", kind: "numeric", label: "Fasting plasma glucose", unit: "mmol/L" },
      { name: "hba1c_pct", kind: "numeric", label: "HbA1c", unit: "%" },
      { name: "tg_mmol", kind: "numeric", label: "Triglycerides", unit: "mmol/L" },
      { name: "hdl_mmol", kind: "numeric", label: "HDL cholesterol", unit: "mmol/L" },
      { name: "ldl_mmol", kind: "numeric", label: "LDL cholesterol", unit: "mmol/L" },
      { name: "creatinine_umol", kind: "numeric", label: "Serum creatinine", unit: "µmol/L" },
      { name: "smoking", kind: "categorical", label: "Smoking status" },
      { name: "activity", kind: "categorical", label: "Physical activity" },
      { name: "statin", kind: "categorical", label: "Statin use", role: "exposure" },
      {
        name: "incident_diabetes",
        kind: "numeric",
        label: "Incident diabetes",
        role: "outcome",
        description: "1 = developed diabetes during follow-up.",
      },
      { name: "followup_years", kind: "numeric", label: "Follow-up", unit: "years", role: "time" },
      {
        name: "cvd_event",
        kind: "numeric",
        label: "Cardiovascular event",
        role: "event",
        description: "1 = first cardiovascular event, 0 = censored.",
      },
    ],
    rows,
  );
}

function rctHypertension(): StoredColumn[] {
  const rng = createRng(4242);
  // Permuted blocks of four keep the arms balanced within each site.
  const arms: string[] = [];
  while (arms.length < 400) {
    const block = ["treatment", "treatment", "placebo", "placebo"];
    for (let i = block.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng.uniform() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    arms.push(...block);
  }
  const rows: Record<string, number | string | null>[] = [];
  for (let i = 0; i < 400; i += 1) {
    const arm = arms[i];
    const treated = arm === "treatment" ? 1 : 0;
    const site = ["A", "B", "C", "D"][i % 4];
    const age = Math.round(clamp(rng.normal(58, 10), 30, 85));
    const sex = rng.bernoulli(0.47) ? "F" : "M";
    const baseline = Math.round(clamp(rng.normal(152, 10), 135, 190));
    const adherence = Math.round(clamp(100 - Math.abs(rng.normal(0, 14)), 35, 100));
    const effect = (treated ? 14 : 4.5) * (adherence / 100);
    const week12 = Math.round(baseline - effect - 0.15 * (baseline - 152) + rng.normal(0, 10));
    const dropout = rng.bernoulli(0.05 + 0.03 * treated);
    rows.push({
      id: `RCT-${pad(i + 1, 3)}`,
      site,
      arm,
      age,
      sex,
      baseline_sbp: baseline,
      week12_sbp: dropout ? null : week12,
      adherence_pct: adherence,
      adverse_event: rng.bernoulli(treated ? 0.18 : 0.1) ? 1 : 0,
    });
  }
  return assemble(
    [
      { name: "id", kind: "categorical", label: "Participant ID", role: "id" },
      { name: "site", kind: "categorical", label: "Site" },
      { name: "arm", kind: "categorical", label: "Randomised arm", role: "group" },
      { name: "age", kind: "numeric", label: "Age", unit: "years" },
      { name: "sex", kind: "categorical", label: "Sex" },
      { name: "baseline_sbp", kind: "numeric", label: "Baseline systolic BP", unit: "mmHg" },
      {
        name: "week12_sbp",
        kind: "numeric",
        label: "Week-12 systolic BP",
        unit: "mmHg",
        role: "outcome",
        description: "Missing for participants lost to follow-up.",
      },
      { name: "adherence_pct", kind: "numeric", label: "Adherence", unit: "%" },
      { name: "adverse_event", kind: "numeric", label: "Any adverse event", description: "1 = at least one adverse event." },
    ],
    rows,
  );
}

function sepsisBiomarker(): StoredColumn[] {
  const rng = createRng(777);
  const rows: Record<string, number | string | null>[] = [];
  for (let i = 0; i < 800; i += 1) {
    const age = Math.round(clamp(rng.normal(64, 16), 18, 98));
    const sex = rng.bernoulli(0.46) ? "F" : "M";
    const sepsis = rng.bernoulli(expit(-1.25 + 0.012 * (age - 64))) ? 1 : 0;
    const crp = round(Math.exp(rng.normal(Math.log(sepsis ? 115 : 38), sepsis ? 0.7 : 0.9)), 1);
    const pct = round(Math.exp(rng.normal(Math.log(sepsis ? 3.2 : 0.25), sepsis ? 1.1 : 1.0)), 2);
    const lactate = round(clamp(sepsis ? rng.normal(3.0, 1.3) : rng.normal(1.6, 0.6), 0.4, 15), 1);
    const temp = round(sepsis ? rng.normal(38.4, 0.9) : rng.normal(37.2, 0.55), 1);
    const hr = Math.round(clamp(sepsis ? rng.normal(108, 18) : rng.normal(86, 14), 40, 190));
    const rr = Math.round(clamp(sepsis ? rng.normal(23, 5) : rng.normal(17, 3.5), 8, 45));
    const sbp = Math.round(clamp(sepsis ? rng.normal(102, 20) : rng.normal(128, 18), 55, 220));
    const gcs = sepsis
      ? rng.pick([[15, 58], [14, 16], [13, 10], [12, 6], [11, 4], [10, 3], [9, 2], [8, 1]] as const)
      : rng.pick([[15, 90], [14, 7], [13, 3]] as const);
    const wbc = round(clamp(sepsis ? rng.normal(15, 6) : rng.normal(9, 3), 0.5, 45), 1);
    const death = rng.bernoulli(expit(-3.6 + 1.4 * sepsis + 0.035 * (age - 64) + 0.3 * (lactate - 2) + 0.25 * (15 - gcs)))
      ? 1
      : 0;
    rows.push({
      id: `SB-${pad(i + 1, 3)}`,
      age,
      sex,
      crp_mg_l: crp,
      pct_ng_ml: pct,
      lactate_mmol: rng.bernoulli(0.04) ? null : lactate,
      temp_c: temp,
      heart_rate: hr,
      resp_rate: rr,
      sbp,
      gcs,
      wbc: rng.bernoulli(0.02) ? null : wbc,
      sepsis,
      death_28d: death,
    });
  }
  return assemble(
    [
      { name: "id", kind: "categorical", label: "Patient ID", role: "id" },
      { name: "age", kind: "numeric", label: "Age", unit: "years" },
      { name: "sex", kind: "categorical", label: "Sex" },
      { name: "crp_mg_l", kind: "numeric", label: "C-reactive protein", unit: "mg/L" },
      { name: "pct_ng_ml", kind: "numeric", label: "Procalcitonin", unit: "ng/mL" },
      { name: "lactate_mmol", kind: "numeric", label: "Lactate", unit: "mmol/L" },
      { name: "temp_c", kind: "numeric", label: "Temperature", unit: "°C" },
      { name: "heart_rate", kind: "numeric", label: "Heart rate", unit: "/min" },
      { name: "resp_rate", kind: "numeric", label: "Respiratory rate", unit: "/min" },
      { name: "sbp", kind: "numeric", label: "Systolic BP", unit: "mmHg" },
      { name: "gcs", kind: "numeric", label: "Glasgow Coma Scale", unit: "points" },
      { name: "wbc", kind: "numeric", label: "White cell count", unit: "×10⁹/L" },
      {
        name: "sepsis",
        kind: "numeric",
        label: "Sepsis (reference standard)",
        role: "outcome",
        description: "1 = sepsis by the adjudicated reference standard.",
      },
      { name: "death_28d", kind: "numeric", label: "28-day mortality", description: "1 = died within 28 days." },
    ],
    rows,
  );
}

const GENERATORS: Record<string, () => StoredColumn[]> = {
  cardiometabolic,
  rct_hypertension: rctHypertension,
  sepsis_biomarker: sepsisBiomarker,
};

/** Generates the columns of a built-in sample, or `null` for an unknown key. */
export function generateSample(key: string): StoredColumn[] | null {
  const generator = GENERATORS[key];
  return generator ? generator() : null;
}
