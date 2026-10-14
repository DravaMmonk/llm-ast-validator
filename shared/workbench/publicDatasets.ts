/**
 * Catalogue of public, de-identified research datasets.
 *
 * This module holds metadata only — never row data. Following the repository's
 * data policy (data/README.md), a dataset is fetched from its official source
 * when a user asks for it, checked against the SHA-256 pinned here, read
 * through a strict column contract, and stored only in the git-ignored local
 * database. A changed upstream file is refused, never silently re-pinned.
 *
 * Each contract maps source columns to typed workstation columns with labels,
 * units, analysis roles and readable codings. A present value that the
 * contract does not expect fails the import instead of being guessed at.
 */

import type { ColumnKind, ColumnRole } from "./dataset";

export interface PublicColumnSpec {
  /** Source header name, or `#i` (0-based) for a file without a header row. */
  from: string;
  name: string;
  label: string;
  kind: ColumnKind;
  unit?: string;
  role?: ColumnRole;
  description?: string;
  /**
   * Raw value → stored value. When present, every non-missing raw value must
   * be listed; `null` marks a source code that means "missing".
   */
  codes?: Record<string, string | number | boolean | null>;
}

export type PublicDomain =
  | "Cardiology"
  | "Oncology"
  | "Hepatology"
  | "Endocrinology"
  | "Gastroenterology"
  | "Infectious disease"
  | "Obstetrics"
  | "Anaesthesia"
  | "Epidemiology"
  | "Haematology";

export interface PublicLicense {
  /** SPDX expression. */
  spdx: string;
  name: string;
  url: string;
}

export interface PublicSource {
  publisher: string;
  /** The file that is downloaded. Only catalogue URLs are ever fetched. */
  url: string;
  /** Human-readable landing page with the documentation. */
  page: string;
  doi?: string;
  sha256: string;
  bytes: number;
  header: boolean;
  /** Columns in the source file, including any that are not imported. */
  columns: number;
  /** Extra tokens that mean "missing" in this file (on top of the usual NA, ?, blank…). */
  missing?: string[];
  /** Keep only rows whose source column equals this value (e.g. one record per patient). */
  filter?: { from: string; equals: string; note: string };
}

export interface PublicDataset {
  key: string;
  name: string;
  /** One sentence for cards and lists. */
  summary: string;
  /** Who, where, when, and what the outcome is. */
  description: string;
  domain: PublicDomain;
  design: string;
  /** Analyses the dataset is well suited to — shown as chips. */
  topics: string[];
  rows: number;
  source: PublicSource;
  license: PublicLicense;
  /** Recommended dataset citation. */
  citation: string;
  /** The study or paper that describes the data. */
  reference?: string;
  columns: PublicColumnSpec[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Extra = Omit<Partial<PublicColumnSpec>, "from" | "name" | "label" | "kind">;

const num = (from: string, name: string, label: string, extra: Extra = {}): PublicColumnSpec => ({ from, name, label, kind: "numeric", ...extra });
const cat = (from: string, name: string, label: string, codes?: PublicColumnSpec["codes"], extra: Extra = {}): PublicColumnSpec => ({
  from,
  name,
  label,
  kind: "categorical",
  ...(codes ? { codes } : {}),
  ...extra,
});
const flag = (from: string, name: string, label: string, codes: PublicColumnSpec["codes"] = { "0": false, "1": true }, extra: Extra = {}): PublicColumnSpec => ({
  from,
  name,
  label,
  kind: "boolean",
  codes,
  ...extra,
});
/** A 0/1 indicator kept numeric — the convention for outcomes and survival events. */
const event = (from: string, name: string, label: string, codes: PublicColumnSpec["codes"], role: ColumnRole, description: string): PublicColumnSpec => ({
  from,
  name,
  label,
  kind: "numeric",
  codes,
  role,
  description,
});

const CC_BY_4: PublicLicense = { spdx: "CC-BY-4.0", name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const LGPL_2_PLUS: PublicLicense = {
  spdx: "LGPL-2.0-or-later",
  name: "GNU LGPL ≥ 2 (R package survival)",
  url: "https://cran.r-project.org/package=survival",
};
const GPL_2_OR_3: PublicLicense = { spdx: "GPL-2.0-only OR GPL-3.0-only", name: "GNU GPL 2 or 3 (R package MASS)", url: "https://cran.r-project.org/package=MASS" };
const MIT_MEDICALDATA: PublicLicense = { spdx: "MIT", name: "MIT (R package medicaldata)", url: "https://cran.r-project.org/package=medicaldata" };
const MIT_CAUSALDATA: PublicLicense = { spdx: "MIT", name: "MIT (R package causaldata)", url: "https://cran.r-project.org/package=causaldata" };

const UCI = "UCI Machine Learning Repository";
const RDATASETS = "Rdatasets (Arel-Bundock), CSV export of an R package dataset";
const rdatasets = (path: string) => ({
  url: `https://vincentarelbundock.github.io/Rdatasets/csv/${path}.csv`,
  page: `https://vincentarelbundock.github.io/Rdatasets/doc/${path}.html`,
});
const yesNoCodes = { "0_no": false, "1_yes": true, NA_NA: null };

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

const WDBC_FEATURES = [
  ["radius", "Radius"],
  ["texture", "Texture"],
  ["perimeter", "Perimeter"],
  ["area", "Area"],
  ["smoothness", "Smoothness"],
  ["compactness", "Compactness"],
  ["concavity", "Concavity"],
  ["concave_points", "Concave points"],
  ["symmetry", "Symmetry"],
  ["fractal_dimension", "Fractal dimension"],
] as const;
const WDBC_STATS = [
  ["mean", "mean"],
  ["se", "standard error"],
  ["worst", "worst"],
] as const;

export const PUBLIC_DATASETS: readonly PublicDataset[] = [
  {
    key: "heart_failure",
    name: "Heart failure clinical records",
    summary: "299 patients with heart failure followed for death, with ejection fraction, creatinine and sodium.",
    description:
      "Patients with left-ventricular systolic dysfunction (NYHA class III–IV) treated at the Faisalabad Institute of Cardiology and Allied Hospital, Pakistan, April–December 2015, and followed for death for 4–285 days (median 115).",
    domain: "Cardiology",
    design: "Prospective cohort",
    topics: ["Kaplan–Meier", "Cox regression", "Logistic regression"],
    rows: 299,
    source: {
      publisher: UCI,
      url: "https://archive.ics.uci.edu/ml/machine-learning-databases/00519/heart_failure_clinical_records_dataset.csv",
      page: "https://archive.ics.uci.edu/dataset/519/heart+failure+clinical+records",
      doi: "10.24432/C5Z89R",
      sha256: "9c73cea7468ff5d517801ec050fe9993da5912fce4b56f296f8df3b38dd75912",
      bytes: 12239,
      header: true,
      columns: 13,
    },
    license: CC_BY_4,
    citation: "Heart Failure Clinical Records [Dataset] (2020). UCI Machine Learning Repository. https://doi.org/10.24432/C5Z89R",
    reference:
      "Chicco D, Jurman G. Machine learning can predict survival of patients with heart failure from serum creatinine and ejection fraction alone. BMC Med Inform Decis Mak 2020;20:16.",
    columns: [
      num("age", "age", "Age", { unit: "years" }),
      cat("sex", "sex", "Sex", { "0": "female", "1": "male" }),
      flag("anaemia", "anaemia", "Anaemia"),
      flag("diabetes", "diabetes", "Diabetes"),
      flag("high_blood_pressure", "hypertension", "Hypertension"),
      flag("smoking", "smoking", "Smoking"),
      num("ejection_fraction", "ejection_fraction", "Ejection fraction", { unit: "%" }),
      num("serum_creatinine", "creatinine", "Serum creatinine", { unit: "mg/dL" }),
      num("serum_sodium", "sodium", "Serum sodium", { unit: "mEq/L" }),
      num("creatinine_phosphokinase", "cpk", "Creatine phosphokinase", { unit: "mcg/L" }),
      num("platelets", "platelets", "Platelets", { unit: "kiloplatelets/mL" }),
      num("time", "followup_days", "Follow-up", { unit: "days", role: "time" }),
      event("DEATH_EVENT", "death", "Died during follow-up", { "0": 0, "1": 1 }, "event", "1 = died, 0 = censored."),
    ],
  },
  {
    key: "cleveland_heart",
    name: "Cleveland heart disease (angiography)",
    summary: "303 patients referred for coronary angiography: exercise test, ECG and chest-pain features versus angiographic disease.",
    description:
      "Patients undergoing coronary angiography at the Cleveland Clinic Foundation, the most widely analysed of the four centres in the original multicentre study. The reference standard is > 50% diameter narrowing in any major vessel.",
    domain: "Cardiology",
    design: "Diagnostic accuracy study",
    topics: ["ROC", "Logistic regression", "Table 1"],
    rows: 303,
    source: {
      publisher: UCI,
      url: "https://archive.ics.uci.edu/ml/machine-learning-databases/heart-disease/processed.cleveland.data",
      page: "https://archive.ics.uci.edu/dataset/45/heart+disease",
      doi: "10.24432/C52P4X",
      sha256: "a74b7efa387bc9d108d7d0115d831fe9b414b29ae7124f331b622b4efa0427c8",
      bytes: 18461,
      header: false,
      columns: 14,
    },
    license: CC_BY_4,
    citation: "Janosi A, Steinbrunn W, Pfisterer M, Detrano R. Heart Disease [Dataset] (1989). UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X",
    reference:
      "Detrano R, Janosi A, Steinbrunn W, et al. International application of a new probability algorithm for the diagnosis of coronary artery disease. Am J Cardiol 1989;64:304–310.",
    columns: [
      num("#0", "age", "Age", { unit: "years" }),
      cat("#1", "sex", "Sex", { "0.0": "female", "1.0": "male" }),
      cat("#2", "chest_pain", "Chest pain type", { "1.0": "typical angina", "2.0": "atypical angina", "3.0": "non-anginal pain", "4.0": "asymptomatic" }),
      num("#3", "resting_bp", "Resting blood pressure", { unit: "mmHg" }),
      num("#4", "cholesterol", "Serum cholesterol", { unit: "mg/dL" }),
      flag("#5", "fbs_over_120", "Fasting glucose > 120 mg/dL", { "0.0": false, "1.0": true }),
      cat("#6", "resting_ecg", "Resting ECG", { "0.0": "normal", "1.0": "ST-T abnormality", "2.0": "LV hypertrophy" }),
      num("#7", "max_heart_rate", "Maximum heart rate (exercise)", { unit: "beats/min" }),
      flag("#8", "exercise_angina", "Exercise-induced angina", { "0.0": false, "1.0": true }),
      num("#9", "st_depression", "ST depression (exercise vs rest)", { unit: "mm" }),
      cat("#10", "st_slope", "Peak exercise ST slope", { "1.0": "upsloping", "2.0": "flat", "3.0": "downsloping" }),
      num("#11", "vessels_fluoroscopy", "Major vessels coloured by fluoroscopy", { description: "0–3" }),
      cat("#12", "thallium", "Thallium scan", { "3.0": "normal", "6.0": "fixed defect", "7.0": "reversible defect" }),
      num("#13", "disease_grade", "Angiographic disease grade", { description: "0 = < 50% narrowing; 1–4 = increasing disease." }),
      event("#13", "heart_disease", "Coronary artery disease", { "0": 0, "1": 1, "2": 1, "3": 1, "4": 1 }, "outcome", "1 = > 50% diameter narrowing in any major vessel (grade 1–4)."),
    ],
  },
  {
    key: "breast_cancer_wisconsin",
    name: "Breast cancer Wisconsin (diagnostic)",
    summary: "569 fine-needle aspirates: 30 nuclear shape features versus malignant or benign diagnosis.",
    description:
      "Features computed from digitised images of fine-needle aspirates of breast masses at the University of Wisconsin Hospitals, Madison. For each of ten nuclear features the mean, standard error and worst (mean of the three largest) value are given.",
    domain: "Oncology",
    design: "Diagnostic accuracy study",
    topics: ["ROC", "Logistic regression", "Score Forge"],
    rows: 569,
    source: {
      publisher: UCI,
      url: "https://archive.ics.uci.edu/ml/machine-learning-databases/breast-cancer-wisconsin/wdbc.data",
      page: "https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic",
      doi: "10.24432/C5DW2B",
      sha256: "d606af411f3e5be8a317a5a8b652b425aaf0ff38ca683d5327ffff94c3695f4a",
      bytes: 124103,
      header: false,
      columns: 32,
    },
    license: CC_BY_4,
    citation: "Wolberg W, Mangasarian O, Street N, Street W. Breast Cancer Wisconsin (Diagnostic) [Dataset] (1993). UCI Machine Learning Repository. https://doi.org/10.24432/C5DW2B",
    reference: "Street WN, Wolberg WH, Mangasarian OL. Nuclear feature extraction for breast tumor diagnosis. Proc SPIE 1905, Biomedical Image Processing and Biomedical Visualization, 1993.",
    columns: [
      cat("#0", "id", "Sample ID", undefined, { role: "id" }),
      event("#1", "malignant", "Malignant", { M: 1, B: 0 }, "outcome", "1 = malignant, 0 = benign."),
      ...WDBC_STATS.flatMap(([stat, statLabel], s) =>
        WDBC_FEATURES.map(([feature, featureLabel], f) => num(`#${2 + s * 10 + f}`, `${feature}_${stat}`, `${featureLabel} (${statLabel})`)),
      ),
    ],
  },
  {
    key: "early_diabetes",
    name: "Early-stage diabetes symptoms (Sylhet)",
    summary: "520 questionnaire responses: 14 yes/no symptoms such as polyuria and polydipsia versus a diabetes diagnosis.",
    description:
      "Direct questionnaires completed by patients of Sylhet Diabetes Hospital, Bangladesh, under a doctor's supervision. Every symptom is a yes/no answer, which makes it a good showcase for yes/no columns and simple point scores.",
    domain: "Endocrinology",
    design: "Cross-sectional",
    topics: ["Score Forge", "Logistic regression", "Diagnostic 2×2"],
    rows: 520,
    source: {
      publisher: UCI,
      url: "https://archive.ics.uci.edu/ml/machine-learning-databases/00529/diabetes_data_upload.csv",
      page: "https://archive.ics.uci.edu/dataset/529/early+stage+diabetes+risk+prediction+dataset",
      doi: "10.24432/C5VG8H",
      sha256: "7889d9d0beb7dd1ccc58da99f72763f16afb259b5dbbaa086f8195366ff66137",
      bytes: 34682,
      header: true,
      columns: 17,
    },
    license: CC_BY_4,
    citation: "Early Stage Diabetes Risk Prediction [Dataset] (2020). UCI Machine Learning Repository. https://doi.org/10.24432/C5VG8H",
    reference:
      "Islam MMF, Ferdousi R, Rahman S, Bushra HY. Likelihood prediction of diabetes at early stage using data mining techniques. In: Computer Vision and Machine Intelligence in Medical Image Analysis. Springer, 2019.",
    columns: [
      num("Age", "age", "Age", { unit: "years" }),
      cat("Gender", "sex", "Sex", { Female: "female", Male: "male" }),
      ...(
        [
          ["Polyuria", "polyuria", "Polyuria"],
          ["Polydipsia", "polydipsia", "Polydipsia"],
          ["sudden weight loss", "sudden_weight_loss", "Sudden weight loss"],
          ["weakness", "weakness", "Weakness"],
          ["Polyphagia", "polyphagia", "Polyphagia"],
          ["Genital thrush", "genital_thrush", "Genital thrush"],
          ["visual blurring", "visual_blurring", "Visual blurring"],
          ["Itching", "itching", "Itching"],
          ["Irritability", "irritability", "Irritability"],
          ["delayed healing", "delayed_healing", "Delayed healing"],
          ["partial paresis", "partial_paresis", "Partial paresis"],
          ["muscle stiffness", "muscle_stiffness", "Muscle stiffness"],
          ["Alopecia", "alopecia", "Alopecia"],
          ["Obesity", "obesity", "Obesity"],
        ] as const
      ).map(([from, name, label]) => flag(from, name, label, { Yes: true, No: false })),
      event("class", "diabetes", "Diabetes", { Positive: 1, Negative: 0 }, "outcome", "1 = diagnosed with diabetes."),
    ],
  },
  {
    key: "indian_liver",
    name: "Indian liver patient records",
    summary: "583 patients with liver function tests — bilirubin, enzymes, proteins — labelled as liver patients or not.",
    description:
      "Records collected from the north-east of Andhra Pradesh, India: 416 liver patients and 167 people without liver disease. Ages above 89 are recorded as 90. Units are not stated by the source.",
    domain: "Hepatology",
    design: "Case–control",
    topics: ["ROC", "Logistic regression", "Compare groups"],
    rows: 583,
    source: {
      publisher: UCI,
      url: "https://archive.ics.uci.edu/ml/machine-learning-databases/00225/Indian%20Liver%20Patient%20Dataset%20(ILPD).csv",
      page: "https://archive.ics.uci.edu/dataset/225/ilpd+indian+liver+patient+dataset",
      doi: "10.24432/C5D02C",
      sha256: "84feac16488de5cf89bd22bd802c77f25841fe93e9ddd32355683e94d46c3425",
      bytes: 23755,
      header: false,
      columns: 11,
    },
    license: CC_BY_4,
    citation: "Ramana B, Venkateswarlu N. ILPD (Indian Liver Patient Dataset) [Dataset] (2022). UCI Machine Learning Repository. https://doi.org/10.24432/C5D02C",
    columns: [
      num("#0", "age", "Age", { unit: "years", description: "Ages above 89 are recorded as 90." }),
      cat("#1", "sex", "Sex", { Female: "female", Male: "male" }),
      num("#2", "total_bilirubin", "Total bilirubin"),
      num("#3", "direct_bilirubin", "Direct bilirubin"),
      num("#4", "alk_phos", "Alkaline phosphatase"),
      num("#5", "alt", "Alanine aminotransferase (ALT)"),
      num("#6", "ast", "Aspartate aminotransferase (AST)"),
      num("#7", "total_protein", "Total protein"),
      num("#8", "albumin", "Albumin"),
      num("#9", "ag_ratio", "Albumin/globulin ratio"),
      event("#10", "liver_disease", "Liver patient", { "1": 1, "2": 0 }, "outcome", "1 = liver patient, 0 = no liver disease."),
    ],
  },
  {
    key: "breast_cancer_coimbra",
    name: "Breast cancer Coimbra (biomarkers)",
    summary: "116 women: glucose, insulin, HOMA, leptin, adiponectin, resistin and MCP-1 in breast cancer patients and controls.",
    description:
      "Routine blood analyses and anthropometry from 64 women with newly diagnosed breast cancer and 52 healthy controls at the University Hospital Centre of Coimbra, Portugal.",
    domain: "Oncology",
    design: "Case–control",
    topics: ["ROC", "Logistic regression", "Compare groups"],
    rows: 116,
    source: {
      publisher: UCI,
      url: "https://archive.ics.uci.edu/ml/machine-learning-databases/00451/dataR2.csv",
      page: "https://archive.ics.uci.edu/dataset/451/breast+cancer+coimbra",
      doi: "10.24432/C52P59",
      sha256: "68c56c7e7a38dfff1046a8b35e5b3afc17229eff7fb9d8dca7053442b1c37e7e",
      bytes: 7665,
      header: true,
      columns: 10,
    },
    license: CC_BY_4,
    citation:
      "Patrício M, Pereira J, Crisóstomo J, Matafome P, Seiça R, Caramelo F. Breast Cancer Coimbra [Dataset] (2018). UCI Machine Learning Repository. https://doi.org/10.24432/C52P59",
    reference:
      "Patrício M, Pereira J, Crisóstomo J, et al. Using resistin, glucose, age and BMI to predict the presence of breast cancer. BMC Cancer 2018;18:29.",
    columns: [
      num("Age", "age", "Age", { unit: "years" }),
      num("BMI", "bmi", "Body mass index", { unit: "kg/m²" }),
      num("Glucose", "glucose", "Glucose", { unit: "mg/dL" }),
      num("Insulin", "insulin", "Insulin", { unit: "µU/mL" }),
      num("HOMA", "homa", "HOMA-IR"),
      num("Leptin", "leptin", "Leptin", { unit: "ng/mL" }),
      num("Adiponectin", "adiponectin", "Adiponectin", { unit: "µg/mL" }),
      num("Resistin", "resistin", "Resistin", { unit: "ng/mL" }),
      num("MCP.1", "mcp1", "MCP-1", { unit: "pg/dL" }),
      event("Classification", "breast_cancer", "Breast cancer", { "1": 0, "2": 1 }, "outcome", "1 = patient, 0 = healthy control."),
    ],
  },
  {
    key: "pbc_mayo",
    name: "Mayo Clinic primary biliary cholangitis trial",
    summary: "418 patients with PBC: D-penicillamine versus placebo, liver tests and survival over up to 13 years.",
    description:
      "Mayo Clinic, 1974–1984. The first 312 patients took part in the randomised placebo-controlled trial of D-penicillamine; 106 more consented to baseline measurements and survival follow-up only (treatment missing). The basis of the Mayo PBC risk score.",
    domain: "Hepatology",
    design: "Randomised trial + cohort",
    topics: ["Kaplan–Meier", "Cox regression", "Table 1"],
    rows: 418,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/pbc"),
      sha256: "797ea9b6abfec34297ef07f361a2e0bfdd90c3c2def180adf8547ea30e75b613",
      bytes: 32887,
      header: true,
      columns: 21,
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset pbc. Data: Mayo Clinic PBC trial 1974–1984.",
    reference: "Fleming TR, Harrington DP. Counting Processes and Survival Analysis. Wiley, 1991. Therneau TM, Grambsch PM. Modeling Survival Data. Springer, 2000.",
    columns: [
      cat("id", "id", "Case number", undefined, { role: "id" }),
      cat("trt", "treatment", "Treatment", { "1": "D-penicillamine", "2": "placebo" }, { role: "group", description: "Missing for the 106 patients who were not randomised." }),
      num("age", "age", "Age", { unit: "years" }),
      cat("sex", "sex", "Sex", { f: "female", m: "male" }),
      flag("ascites", "ascites", "Ascites"),
      flag("hepato", "hepatomegaly", "Hepatomegaly"),
      flag("spiders", "spiders", "Spider angiomas"),
      num("edema", "oedema", "Oedema", { description: "0 = none; 0.5 = untreated or responsive to diuretics; 1 = despite diuretics." }),
      num("bili", "bilirubin", "Serum bilirubin", { unit: "mg/dL" }),
      num("chol", "cholesterol", "Serum cholesterol", { unit: "mg/dL" }),
      num("albumin", "albumin", "Serum albumin", { unit: "g/dL" }),
      num("copper", "urine_copper", "Urine copper", { unit: "µg/day" }),
      num("alk.phos", "alk_phos", "Alkaline phosphatase", { unit: "U/L" }),
      num("ast", "ast", "Aspartate aminotransferase", { unit: "U/mL" }),
      num("trig", "triglycerides", "Triglycerides", { unit: "mg/dL" }),
      num("platelet", "platelets", "Platelet count"),
      num("protime", "prothrombin_time", "Prothrombin time (standardised)"),
      num("stage", "stage", "Histologic stage", { description: "1–4, from biopsy." }),
      num("time", "followup_days", "Follow-up", { unit: "days", role: "time" }),
      event("status", "death", "Died", { "0": 0, "1": 0, "2": 1 }, "event", "1 = died; alive and transplanted patients are censored."),
      cat("status", "endpoint", "Status at end of follow-up", { "0": "censored", "1": "transplant", "2": "died" }),
    ],
  },
  {
    key: "ncctg_lung",
    name: "NCCTG advanced lung cancer",
    summary: "228 patients with advanced lung cancer: survival, ECOG and Karnofsky performance, appetite and weight loss.",
    description:
      "North Central Cancer Treatment Group study of patient-completed questionnaires as prognostic variables. A classic dataset for comparing physician- and patient-rated performance status.",
    domain: "Oncology",
    design: "Prospective cohort",
    topics: ["Kaplan–Meier", "Cox regression", "Correlation"],
    rows: 228,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/cancer"),
      sha256: "4045e3fee76936bb8bd9312243d7b81b36ed224a12800fcef12e8a361883cfb6",
      bytes: 7252,
      header: true,
      columns: 11,
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset lung (cancer). Data: North Central Cancer Treatment Group.",
    reference:
      "Loprinzi CL, Laurie JA, Wieand HS, et al. Prospective evaluation of prognostic variables from patient-completed questionnaires. J Clin Oncol 1994;12:601–607.",
    columns: [
      cat("inst", "institution", "Institution code"),
      num("age", "age", "Age", { unit: "years" }),
      cat("sex", "sex", "Sex", { "1": "male", "2": "female" }),
      num("ph.ecog", "ecog", "ECOG performance (physician)", { description: "0 = asymptomatic … 4 = bedbound." }),
      num("ph.karno", "karnofsky_physician", "Karnofsky score (physician)", { description: "0–100, higher is better." }),
      num("pat.karno", "karnofsky_patient", "Karnofsky score (patient)", { description: "0–100, higher is better." }),
      num("meal.cal", "meal_calories", "Calories consumed at meals", { unit: "kcal" }),
      num("wt.loss", "weight_loss", "Weight loss in last 6 months", { unit: "lb" }),
      num("time", "survival_days", "Survival time", { unit: "days", role: "time" }),
      event("status", "death", "Died", { "1": 0, "2": 1 }, "event", "1 = died, 0 = censored."),
    ],
  },
  {
    key: "gbsg_breast",
    name: "German Breast Cancer Study Group trial",
    summary: "686 women with node-positive breast cancer: hormone therapy, receptors, grade and recurrence-free survival.",
    description:
      "GBSG trial 1984–1989 of 720 patients with node-positive breast cancer, restricted to the 686 with complete prognostic data. Used by Royston and Altman to validate a Cox model developed in the Rotterdam data.",
    domain: "Oncology",
    design: "Randomised trial cohort",
    topics: ["Kaplan–Meier", "Cox regression", "Table 1"],
    rows: 686,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/gbsg"),
      sha256: "9fa0fef0575d04d3273869be28405307f1b02993751498e8a0c844541cccd5d9",
      bytes: 24052,
      header: true,
      columns: 12,
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset gbsg. Data: German Breast Cancer Study Group.",
    reference: "Royston P, Altman DG. External validation of a Cox prognostic model: principles and methods. BMC Med Res Methodol 2013;13:33.",
    columns: [
      cat("pid", "id", "Patient ID", undefined, { role: "id" }),
      num("age", "age", "Age", { unit: "years" }),
      flag("meno", "postmenopausal", "Postmenopausal"),
      num("size", "tumour_size", "Tumour size", { unit: "mm" }),
      num("grade", "grade", "Tumour grade", { description: "1–3." }),
      num("nodes", "positive_nodes", "Positive lymph nodes"),
      num("pgr", "progesterone_receptor", "Progesterone receptor", { unit: "fmol/L" }),
      num("er", "oestrogen_receptor", "Oestrogen receptor", { unit: "fmol/L" }),
      cat("hormon", "hormone_therapy", "Hormone therapy", { "0": "no", "1": "yes" }, { role: "group" }),
      num("rfstime", "rfs_days", "Recurrence-free survival time", { unit: "days", role: "time" }),
      event("status", "recurrence_or_death", "Recurrence or death", { "0": 0, "1": 1 }, "event", "1 = recurrence or death, 0 = alive without recurrence."),
    ],
  },
  {
    key: "rotterdam_breast",
    name: "Rotterdam breast cancer cohort",
    summary: "2,982 primary breast cancers from the Rotterdam tumour bank: relapse and death with up to 19 years' follow-up.",
    description:
      "Patients whose tumours were stored in the Rotterdam tumour bank, operated on 1978–1993. The development cohort of Royston and Altman's prognostic model; pair it with the GBSG trial for external validation.",
    domain: "Oncology",
    design: "Retrospective cohort",
    topics: ["Kaplan–Meier", "Cox regression", "Table 1"],
    rows: 2982,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/rotterdam"),
      sha256: "62703670d3be5d49c5476fb7131b020bdca9f1c25bb4522fd6abe8f9dab61f1b",
      bytes: 156609,
      header: true,
      columns: 16,
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset rotterdam. Data: Rotterdam tumour bank.",
    reference: "Royston P, Altman DG. External validation of a Cox prognostic model: principles and methods. BMC Med Res Methodol 2013;13:33.",
    columns: [
      cat("pid", "id", "Patient ID", undefined, { role: "id" }),
      num("year", "surgery_year", "Year of surgery"),
      num("age", "age", "Age at surgery", { unit: "years" }),
      flag("meno", "postmenopausal", "Postmenopausal"),
      cat("size", "tumour_size", "Tumour size", { "<=20": "≤ 20 mm", "20-50": "20–50 mm", ">50": "> 50 mm" }),
      num("grade", "grade", "Differentiation grade"),
      num("nodes", "positive_nodes", "Positive lymph nodes"),
      num("pgr", "progesterone_receptor", "Progesterone receptor", { unit: "fmol/L" }),
      num("er", "oestrogen_receptor", "Oestrogen receptor", { unit: "fmol/L" }),
      flag("hormon", "hormone_therapy", "Hormone therapy"),
      flag("chemo", "chemotherapy", "Chemotherapy"),
      num("rtime", "relapse_days", "Time to relapse or last follow-up", { unit: "days" }),
      event("recur", "relapse", "Relapse", { "0": 0, "1": 1 }, "none", "1 = relapse, 0 = no relapse."),
      num("dtime", "death_days", "Time to death or last follow-up", { unit: "days", role: "time" }),
      event("death", "death", "Died", { "0": 0, "1": 1 }, "event", "1 = died, 0 = alive at last follow-up."),
    ],
  },
  {
    key: "colon_adjuvant",
    name: "Adjuvant chemotherapy for colon cancer",
    summary: "929 patients with stage B/C colon cancer randomised to observation, levamisole, or levamisole + 5-FU.",
    description:
      "One of the first successful trials of adjuvant chemotherapy for colon cancer (NCCTG and Mayo Clinic). The source holds one record for recurrence and one for death per patient; this import keeps the death record, giving overall survival.",
    domain: "Oncology",
    design: "Randomised trial",
    topics: ["Kaplan–Meier", "Cox regression", "Compare groups"],
    rows: 929,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/colon"),
      sha256: "6f3472a64f696e3195daa198f054180c3e4c66408f7fb8c548c6f4c7b8f898ee",
      bytes: 84108,
      header: true,
      columns: 17,
      filter: { from: "etype", equals: "2", note: "Keeps the death record of each patient (overall survival)." },
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset colon. Data: NCCTG / Mayo Clinic adjuvant colon cancer trial.",
    reference: "Moertel CG, Fleming TR, Macdonald JS, et al. Levamisole and fluorouracil for adjuvant therapy of resected colon carcinoma. N Engl J Med 1990;322:352–358.",
    columns: [
      cat("id", "id", "Patient ID", undefined, { role: "id" }),
      cat("rx", "treatment", "Treatment", { Obs: "observation", Lev: "levamisole", "Lev+5FU": "levamisole + 5-FU" }, { role: "group" }),
      cat("sex", "sex", "Sex", { "0": "female", "1": "male" }),
      num("age", "age", "Age", { unit: "years" }),
      flag("obstruct", "obstruction", "Colon obstruction by tumour"),
      flag("perfor", "perforation", "Colon perforation"),
      flag("adhere", "adherence", "Adherence to nearby organs"),
      num("nodes", "positive_nodes", "Positive lymph nodes"),
      flag("node4", "nodes_over_4", "More than 4 positive nodes"),
      cat("differ", "differentiation", "Tumour differentiation", { "1": "well", "2": "moderate", "3": "poor" }),
      cat("extent", "extent", "Extent of local spread", { "1": "submucosa", "2": "muscle", "3": "serosa", "4": "contiguous structures" }),
      cat("surg", "time_to_registration", "Time from surgery to registration", { "0": "short", "1": "long" }),
      num("time", "followup_days", "Follow-up", { unit: "days", role: "time" }),
      event("status", "death", "Died", { "0": 0, "1": 1 }, "event", "1 = died, 0 = censored."),
    ],
  },
  {
    key: "va_lung",
    name: "Veterans' Administration lung cancer trial",
    summary: "137 patients with inoperable lung cancer randomised to standard or test chemotherapy, with cell type and Karnofsky score.",
    description:
      "Randomised trial of two chemotherapy regimens in advanced, inoperable lung cancer at Veterans' Administration hospitals; almost every patient died during follow-up. The textbook example for Kalbfleisch and Prentice.",
    domain: "Oncology",
    design: "Randomised trial",
    topics: ["Kaplan–Meier", "Cox regression", "Log-rank"],
    rows: 137,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/veteran"),
      sha256: "3fba5cb9b15a10ab94d54e28b54d2c39d95c27b0fcff1c57aee0eb7edfd93950",
      bytes: 4073,
      header: true,
      columns: 9,
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset veteran. Data: Veterans' Administration lung cancer trial.",
    reference: "Kalbfleisch JD, Prentice RL. The Statistical Analysis of Failure Time Data. Wiley, 1980.",
    columns: [
      cat("trt", "treatment", "Treatment", { "1": "standard", "2": "test" }, { role: "group" }),
      cat("celltype", "cell_type", "Cell type", { squamous: "squamous", smallcell: "small cell", adeno: "adenocarcinoma", large: "large cell" }),
      num("karno", "karnofsky", "Karnofsky score", { description: "0–100, higher is better." }),
      num("diagtime", "months_since_diagnosis", "Diagnosis to randomisation", { unit: "months" }),
      num("age", "age", "Age", { unit: "years" }),
      flag("prior", "prior_therapy", "Prior therapy", { "0": false, "10": true }),
      num("time", "survival_days", "Survival time", { unit: "days", role: "time" }),
      event("status", "death", "Died", { "0": 0, "1": 1 }, "event", "1 = died, 0 = censored."),
    ],
  },
  {
    key: "mgus_mayo",
    name: "Monoclonal gammopathy (MGUS) natural history",
    summary: "1,384 patients with MGUS from Mayo Clinic: progression to plasma-cell malignancy and death over decades.",
    description:
      "Sequential patients diagnosed with monoclonal gammopathy of undetermined significance at Mayo Clinic, enrolled through 1994 and followed through 1999. Age is rounded to the year and follow-up to the month.",
    domain: "Haematology",
    design: "Retrospective cohort",
    topics: ["Kaplan–Meier", "Cox regression", "Compare groups"],
    rows: 1384,
    source: {
      publisher: RDATASETS,
      ...rdatasets("survival/mgus2"),
      sha256: "5138ec8d8477f031f60e475c11b4fa6b048b1544682afb4fb675af74a5551567",
      bytes: 56932,
      header: true,
      columns: 12,
    },
    license: LGPL_2_PLUS,
    citation: "Therneau T. survival: Survival Analysis. R package, dataset mgus2. Data: Mayo Clinic, courtesy of Dr Robert Kyle.",
    reference:
      "Kyle RA, Therneau TM, Rajkumar SV, et al. A long-term study of prognosis in monoclonal gammopathy of undetermined significance. N Engl J Med 2002;346:564–569.",
    columns: [
      cat("id", "id", "Subject ID", undefined, { role: "id" }),
      num("age", "age", "Age at diagnosis", { unit: "years" }),
      cat("sex", "sex", "Sex", { F: "female", M: "male" }),
      num("dxyr", "diagnosis_year", "Year of diagnosis"),
      num("hgb", "haemoglobin", "Haemoglobin"),
      num("creat", "creatinine", "Creatinine"),
      num("mspike", "m_spike", "Monoclonal serum spike size"),
      num("ptime", "progression_months", "Time to progression or last contact", { unit: "months" }),
      event("pstat", "progression", "Progressed to plasma-cell malignancy", { "0": 0, "1": 1 }, "none", "1 = progressed, 0 = no progression observed."),
      num("futime", "followup_months", "Time to death or last contact", { unit: "months", role: "time" }),
      event("death", "death", "Died", { "0": 0, "1": 1 }, "event", "1 = died, 0 = alive at last contact."),
    ],
  },
  {
    key: "low_birthweight",
    name: "Low infant birth weight (Baystate)",
    summary: "189 births at Baystate Medical Center, 1986: maternal smoking, hypertension and weight versus low birth weight.",
    description:
      "Collected at Baystate Medical Center, Springfield, Massachusetts, during 1986. The worked example of Hosmer and Lemeshow's Applied Logistic Regression.",
    domain: "Obstetrics",
    design: "Cohort",
    topics: ["Logistic regression", "Compare groups", "Table 1"],
    rows: 189,
    source: {
      publisher: RDATASETS,
      ...rdatasets("MASS/birthwt"),
      sha256: "29e8aa49c536dc72f9cbabd5658a9fd39cb5c0bd43dde4cb870f775f3fd259be",
      bytes: 5626,
      header: true,
      columns: 11,
    },
    license: GPL_2_OR_3,
    citation: "Venables WN, Ripley BD. MASS: Modern Applied Statistics with S. R package, dataset birthwt.",
    reference: "Hosmer DW, Lemeshow S. Applied Logistic Regression. Wiley, 1989.",
    columns: [
      num("age", "mother_age", "Mother's age", { unit: "years" }),
      num("lwt", "mother_weight", "Mother's weight at last menstrual period", { unit: "lb" }),
      cat("race", "race", "Mother's race", { "1": "white", "2": "black", "3": "other" }),
      flag("smoke", "smoking", "Smoked during pregnancy"),
      num("ptl", "previous_preterm", "Previous premature labours"),
      flag("ht", "hypertension", "History of hypertension"),
      flag("ui", "uterine_irritability", "Uterine irritability"),
      num("ftv", "first_trimester_visits", "Physician visits in first trimester"),
      num("bwt", "birth_weight", "Birth weight", { unit: "g" }),
      event("low", "low_birth_weight", "Low birth weight (< 2.5 kg)", { "0": 0, "1": 1 }, "outcome", "1 = birth weight below 2,500 g."),
    ],
  },
  {
    key: "indomethacin_ercp",
    name: "Rectal indomethacin to prevent post-ERCP pancreatitis",
    summary: "602 high-risk patients randomised to rectal indomethacin or placebo; outcome post-ERCP pancreatitis.",
    description:
      "Multicentre, double-blind, placebo-controlled trial at four US centres (Elmunzer et al., NEJM 2012). Includes the procedural risk factors used to stratify risk.",
    domain: "Gastroenterology",
    design: "Randomised trial",
    topics: ["Compare groups", "Logistic regression", "Table 1"],
    rows: 602,
    source: {
      publisher: RDATASETS,
      ...rdatasets("medicaldata/indo_rct"),
      sha256: "f9df4fc224dbd40e69508ca0003f2ec96545a84d444f2bef4c94b31534423fad",
      bytes: 114581,
      header: true,
      columns: 34,
    },
    license: MIT_MEDICALDATA,
    citation: "Higgins P. medicaldata: Data Package for Medical Datasets. R package, dataset indo_rct.",
    reference: "Elmunzer BJ, Scheiman JM, Lehman GA, et al. A randomized trial of rectal indomethacin to prevent post-ERCP pancreatitis. N Engl J Med 2012;366:1414–1422.",
    columns: [
      cat("id", "id", "Subject ID", undefined, { role: "id" }),
      cat("site", "site", "Study site", { "1_UM": "University of Michigan", "2_IU": "Indiana University", "3_UK": "University of Kentucky", "4_Case": "Case Western Reserve" }),
      cat("rx", "treatment", "Treatment", { "0_placebo": "placebo", "1_indomethacin": "indomethacin" }, { role: "group" }),
      num("age", "age", "Age", { unit: "years" }),
      cat("gender", "sex", "Sex", { "1_female": "female", "2_male": "male" }),
      num("risk", "risk_score", "Risk score", { description: "1–5.5; higher means higher risk of pancreatitis." }),
      cat("type", "sod_type", "Sphincter of Oddi dysfunction type", { "0_no SOD": "none", "1_type 1": "type 1", "2_type 2": "type 2", "3_type 3": "type 3" }),
      flag("sod", "sod", "Sphincter of Oddi dysfunction", yesNoCodes),
      flag("pep", "previous_pep", "Previous post-ERCP pancreatitis", yesNoCodes),
      flag("recpanc", "recurrent_pancreatitis", "Recurrent pancreatitis", yesNoCodes),
      flag("psphinc", "pancreatic_sphincterotomy", "Pancreatic sphincterotomy", yesNoCodes),
      flag("precut", "precut", "Pre-cut sphincterotomy", yesNoCodes),
      flag("difcan", "difficult_cannulation", "Difficult cannulation", yesNoCodes),
      flag("pneudil", "pneumatic_dilation", "Pneumatic dilation of papilla", yesNoCodes),
      flag("amp", "ampullectomy", "Ampullectomy", yesNoCodes),
      flag("paninj", "pancreatic_injection", "Pancreatic contrast injection", yesNoCodes),
      flag("acinar", "acinarisation", "Acinarisation", yesNoCodes),
      flag("brush", "pancreatic_brushings", "Pancreatic duct brushings", yesNoCodes),
      flag("asa81", "aspirin_81", "Aspirin 81 mg/day", yesNoCodes),
      flag("asa325", "aspirin_325", "Aspirin 325 mg/day", yesNoCodes),
      flag("asa", "aspirin", "Aspirin (any dose)", yesNoCodes),
      flag("prophystent", "prophylactic_stent", "Prophylactic pancreatic stent", yesNoCodes),
      flag("therastent", "therapeutic_stent", "Therapeutic pancreatic stent", yesNoCodes),
      flag("pdstent", "pancreatic_stent", "Pancreatic stent (any reason)", yesNoCodes),
      flag("sodsom", "sod_manometry", "Sphincter of Oddi manometry", yesNoCodes),
      flag("bsphinc", "biliary_sphincterotomy", "Biliary sphincterotomy", yesNoCodes),
      flag("bstent", "biliary_stent", "Biliary stent", yesNoCodes),
      flag("chole", "choledocholithiasis", "Choledocholithiasis", yesNoCodes),
      flag("pbmal", "pancreatobiliary_malignancy", "Pancreatobiliary malignancy", yesNoCodes),
      flag("train", "trainee", "Trainee involved", yesNoCodes),
      cat("status", "setting", "Setting", { "0_inpatient": "inpatient", "1_outpatient": "outpatient" }),
      flag("bleed", "gi_bleed", "Gastrointestinal bleed", { "1": false, "2": true }, { description: "Recorded for few patients." }),
      event("outcome", "pancreatitis", "Post-ERCP pancreatitis", { "0_no": 0, "1_yes": 1 }, "outcome", "1 = developed post-ERCP pancreatitis."),
    ],
  },
  {
    key: "licorice_gargle",
    name: "Licorice gargle before intubation",
    summary: "235 adults having thoracic surgery randomised to licorice or sugar-water gargle; sore throat and cough after extubation.",
    description:
      "Double-blind randomised trial of a licorice versus sugar-water gargle before intubation with a double-lumen tube (Ruetzler et al. 2013); the dataset was contributed to the TSHS Resources Portal by Dr Amy Nowacki. Throat pain is scored 0–10; cough 0 (none) to 3 (severe).",
    domain: "Anaesthesia",
    design: "Randomised trial",
    topics: ["Compare groups", "Paired change", "Table 1"],
    rows: 235,
    source: {
      publisher: RDATASETS,
      ...rdatasets("medicaldata/licorice_gargle"),
      sha256: "2cc1078d1478095fd252e4d0cb9aa5ab5d71c9c41fdccb50af60a2756c937f4a",
      bytes: 11208,
      header: true,
      columns: 20,
    },
    license: MIT_MEDICALDATA,
    citation: "Nowacki AS. Licorice Gargle Dataset. TSHS Resources Portal, 2017; via Higgins P. medicaldata R package, dataset licorice_gargle.",
    reference:
      "Ruetzler K, Fleck M, Nabecker S, et al. A randomized, double-blind comparison of licorice versus sugar-water gargle for prevention of postoperative sore throat and postextubation coughing. Anesth Analg 2013;117:614–621.",
    columns: [
      cat("treat", "treatment", "Gargle", { "0": "sugar water", "1": "licorice" }, { role: "group" }),
      cat("preOp_gender", "sex", "Sex", { "0": "male", "1": "female" }),
      num("preOp_age", "age", "Age", { unit: "years" }),
      num("preOp_calcBMI", "bmi", "Body mass index", { unit: "kg/m²" }),
      num("preOp_asa", "asa_class", "ASA physical status", { description: "1 = healthy … 3 = severe systemic disease." }),
      num("preOp_mallampati", "mallampati", "Mallampati score", { description: "1 = easy … 4 = difficult intubation." }),
      cat("preOp_smoking", "smoking", "Smoking", { "1": "current", "2": "past", "3": "never" }),
      flag("preOp_pain", "preop_pain", "Preoperative pain"),
      cat("intraOp_surgerySize", "surgery_size", "Surgery size", { "1": "small", "2": "medium", "3": "large" }),
      num("extubation_cough", "cough_extubation", "Cough at extubation", { description: "0 = none … 3 = severe." }),
      num("pacu30min_cough", "cough_30min", "Cough at 30 min (PACU)"),
      num("pacu30min_throatPain", "throat_pain_30min", "Sore throat at rest, 30 min", { role: "outcome", description: "0–10; the trial's primary time point." }),
      num("pacu30min_swallowPain", "swallow_pain_30min", "Pain on swallowing, 30 min"),
      num("pacu90min_cough", "cough_90min", "Cough at 90 min (PACU)"),
      num("pacu90min_throatPain", "throat_pain_90min", "Sore throat at rest, 90 min"),
      num("postOp4hour_cough", "cough_4h", "Cough at 4 h"),
      num("postOp4hour_throatPain", "throat_pain_4h", "Sore throat at rest, 4 h"),
      num("pod1am_cough", "cough_pod1", "Cough, first postoperative morning"),
      num("pod1am_throatPain", "throat_pain_pod1", "Sore throat, first postoperative morning"),
    ],
  },
  {
    key: "streptomycin_tb",
    name: "Streptomycin for tuberculosis (MRC 1948)",
    summary: "107 young adults with pulmonary TB: streptomycin plus bed rest versus bed rest alone — the first modern randomised trial.",
    description:
      "Medical Research Council trial reported in the BMJ in 1948, reconstructed from the published paper. Outcome is radiological improvement at 6 months.",
    domain: "Infectious disease",
    design: "Randomised trial",
    topics: ["Compare groups", "Diagnostic 2×2", "Table 1"],
    rows: 107,
    source: {
      publisher: RDATASETS,
      ...rdatasets("medicaldata/strep_tb"),
      sha256: "de4a0c43975cb71a8e9484580408101fa7f57deed72e65ebf76d29bd7158a944",
      bytes: 10210,
      header: true,
      columns: 14,
    },
    license: MIT_MEDICALDATA,
    citation: "Higgins P. medicaldata: Data Package for Medical Datasets. R package, dataset strep_tb.",
    reference: "Medical Research Council Streptomycin in Tuberculosis Trials Committee. Streptomycin treatment of pulmonary tuberculosis. BMJ 1948;2:769–782.",
    columns: [
      cat("patient_id", "id", "Patient ID", undefined, { role: "id" }),
      cat("arm", "treatment", "Treatment", { Control: "bed rest", Streptomycin: "streptomycin" }, { role: "group" }),
      cat("gender", "sex", "Sex", { F: "female", M: "male" }),
      cat("baseline_condition", "baseline_condition", "Condition at baseline", { "1_Good": "good", "2_Fair": "fair", "3_Poor": "poor" }),
      cat("baseline_temp", "baseline_temperature", "Temperature at baseline", {
        "1_98-98.9F": "98–98.9 °F",
        "2_99-99.9F": "99–99.9 °F",
        "3_100-100.9F": "100–100.9 °F",
        "4_100F+": "highest band (100 °F+)",
      }),
      cat("baseline_esr", "baseline_esr", "ESR at baseline", { "1_0-10": "0–10 mm/h", "2_11-20": "11–20 mm/h", "3_21-50": "21–50 mm/h", "4_51+": "51+ mm/h" }),
      flag("baseline_cavitation", "cavitation", "Cavitation on chest X-ray", { no: false, yes: true }),
      cat("strep_resistance", "strep_resistance", "Streptomycin resistance at 6 months", { "1_sens_0-8": "sensitive", "2_mod_8-99": "moderate", "3_resist_100+": "resistant" }),
      num("rad_num", "radiologic_score", "Radiological response at 6 months", { description: "1 = death … 6 = considerable improvement." }),
      event("improved", "improved", "Improved at 6 months", { TRUE: 1, FALSE: 0 }, "outcome", "1 = moderate or considerable radiological improvement."),
    ],
  },
  {
    key: "nhefs",
    name: "NHEFS: smoking cessation and weight gain",
    summary: "1,629 smokers from the NHANES I follow-up: quitting smoking 1971–82, weight change and death by 1992.",
    description:
      "Cigarette smokers aged 25–74 examined in NHANES I (1971–75) and re-interviewed in 1982 (NCHS/NIA). The running example of Hernán and Robins' Causal Inference: What If. Codes for 'missing' in the source are imported as missing.",
    domain: "Epidemiology",
    design: "Prospective cohort",
    topics: ["Linear regression", "Logistic regression", "Table 1"],
    rows: 1629,
    source: {
      publisher: RDATASETS,
      ...rdatasets("causaldata/nhefs"),
      sha256: "c28e1a9c337de4ac0a1dd31468e445b19ff4e73efc99bc030ff574cc3afcd739",
      bytes: 425376,
      header: true,
      columns: 68,
    },
    license: MIT_CAUSALDATA,
    citation: "Huntington-Klein N, Barrett M. causaldata: Example Data Sets for Causal Inference Textbooks. R package, dataset nhefs. Underlying data: NCHS NHANES I Epidemiologic Follow-up Study.",
    reference: "Hernán MA, Robins JM. Causal Inference: What If. Chapman & Hall/CRC, 2020.",
    columns: [
      cat("seqn", "id", "Person ID", undefined, { role: "id" }),
      cat("qsmk", "quit_smoking", "Quit smoking 1971–82", { "0": "no", "1": "yes" }, { role: "exposure" }),
      num("wt82_71", "weight_change", "Weight change 1971–82", { unit: "kg", role: "outcome" }),
      event("death", "death_by_1992", "Died by 1992", { "0": 0, "1": 1 }, "none", "1 = died by 1992."),
      cat("sex", "sex", "Sex", { "0": "male", "1": "female" }),
      num("age", "age", "Age in 1971", { unit: "years" }),
      cat("race", "race", "Race", { "0": "white", "1": "black or other" }),
      cat("education", "education", "Education", {
        "1": "8th grade or less",
        "2": "high-school dropout",
        "3": "high school",
        "4": "college dropout",
        "5": "college or more",
      }),
      num("ht", "height", "Height", { unit: "cm" }),
      num("wt71", "weight_1971", "Weight in 1971", { unit: "kg" }),
      num("wt82", "weight_1982", "Weight in 1982", { unit: "kg" }),
      num("smokeintensity", "cigarettes_per_day", "Cigarettes per day in 1971"),
      num("smokeyrs", "smoking_years", "Years of smoking", { unit: "years" }),
      cat("exercise", "exercise", "Recreational exercise in 1971", { "0": "much", "1": "moderate", "2": "little or none" }),
      cat("active", "activity", "Usual daily activity in 1971", { "0": "very active", "1": "moderately active", "2": "inactive" }),
      cat("alcoholfreq", "alcohol_frequency", "Alcohol frequency in 1971", {
        "0": "almost every day",
        "1": "2–3 times/week",
        "2": "1–4 times/month",
        "3": "< 12 times/year",
        "4": "none last year",
        "5": null,
      }),
      num("sbp", "systolic_bp_1982", "Systolic blood pressure in 1982", { unit: "mmHg" }),
      num("dbp", "diastolic_bp_1982", "Diastolic blood pressure in 1982", { unit: "mmHg" }),
      num("cholesterol", "cholesterol", "Serum cholesterol in 1971", { unit: "mg/dL" }),
      flag("hbp", "high_bp", "Diagnosed high blood pressure (1971)", { "0": false, "1": true, "2": null }),
      flag("diabetes", "diabetes", "Diagnosed diabetes (1971)", { "0": false, "1": true, "2": null }),
      flag("asthma", "asthma", "Diagnosed asthma (1971)"),
      flag("bronch", "bronchitis", "Chronic bronchitis/emphysema (1971)"),
    ],
  },
];

export function findPublicDataset(key: string): PublicDataset | undefined {
  return PUBLIC_DATASETS.find((dataset) => dataset.key === key);
}

export const PUBLIC_DOMAINS: readonly PublicDomain[] = [...new Set(PUBLIC_DATASETS.map((dataset) => dataset.domain))].sort();
