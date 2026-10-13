/**
 * The module registry: one entry per workstation module. The nav rail, the
 * command palette, the mobile tab bar, the home launchpad, and the page title
 * all read this list, so a module is declared exactly once.
 */

import type { LucideIcon } from "lucide-react";
import {
  Calculator,
  Compass,
  Crosshair,
  Database,
  FileText,
  LayoutGrid,
  ListFilter,
  Puzzle,
  Sigma,
  Sparkles,
} from "lucide-react";

export type ModuleGroup = "Workspace" | "Data" | "Model" | "Analyse" | "Plan & report";

export interface ModuleEntry {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: ModuleGroup;
  /** One line for the launchpad and the command palette. */
  summary: string;
  /** Extra words the command palette matches on. */
  keywords: string;
  /** Shown in the mobile tab bar's first four slots. */
  primaryOnMobile?: boolean;
}

export const MODULES: readonly ModuleEntry[] = [
  {
    id: "home",
    label: "Overview",
    path: "/",
    icon: LayoutGrid,
    group: "Workspace",
    summary: "Start here: datasets, recent work, and guided first steps.",
    keywords: "home launchpad dashboard start",
    primaryOnMobile: true,
  },
  {
    id: "data",
    label: "Data Studio",
    path: "/data",
    icon: Database,
    group: "Data",
    summary: "Import CSV data, profile every column, fix types, and derive variables with formulas.",
    keywords: "import csv upload profile columns variables missing derive",
    primaryOnMobile: true,
  },
  {
    id: "cohorts",
    label: "Cohort Builder",
    path: "/cohorts",
    icon: ListFilter,
    group: "Data",
    summary: "Snap inclusion and exclusion criteria together like puzzle pieces and watch the CONSORT flow update live.",
    keywords: "inclusion exclusion criteria filter consort flow attrition population",
  },
  {
    id: "forge",
    label: "Score Forge",
    path: "/forge",
    icon: Puzzle,
    group: "Model",
    summary: "Assemble a risk score from blocks and see its distribution, discrimination, and calibration instantly.",
    keywords: "formula blocks blockly risk score roc auc build puzzle",
  },
  {
    id: "calculators",
    label: "Clinical Calculators",
    path: "/calculators",
    icon: Calculator,
    group: "Model",
    summary: "Validated bedside formulas — compute for one patient, open as blocks, or apply to a whole dataset.",
    keywords: "egfr bmi qtc cha2ds2-vasc meld curb-65 calculator score bedside",
  },
  {
    id: "formula-lab",
    label: "AI Formula Lab",
    path: "/sessions",
    icon: Sparkles,
    group: "Model",
    summary: "Turn a plain-language requirement into validated formula candidates and evaluate them on the diabetes cohort.",
    keywords: "llm ai generate candidates session diabetes ast",
  },
  {
    id: "stats",
    label: "Statistics",
    path: "/stats",
    icon: Sigma,
    group: "Analyse",
    summary: "Table 1, group comparisons, correlation, regression, and survival — with a test finder that picks the method.",
    keywords: "t-test chi-square regression logistic cox kaplan meier survival correlation table 1 anova",
    primaryOnMobile: true,
  },
  {
    id: "diagnostic",
    label: "Diagnostic Lab",
    path: "/diagnostic",
    icon: Crosshair,
    group: "Analyse",
    summary: "2×2 accuracy, ROC explorer with a live threshold, Fagan nomogram, and natural-frequency pictographs.",
    keywords: "sensitivity specificity ppv npv likelihood ratio roc fagan nomogram bayes",
  },
  {
    id: "design",
    label: "Study Design",
    path: "/design",
    icon: Compass,
    group: "Plan & report",
    summary: "PICO question builder with PubMed search strings, sample size and power, and reporting checklists.",
    keywords: "pico pubmed search sample size power consort strobe stard tripod checklist protocol",
  },
  {
    id: "report",
    label: "Evidence Report",
    path: "/report",
    icon: FileText,
    group: "Plan & report",
    summary: "Every pinned result with its provenance, ordered into a report you can export as Markdown or HTML.",
    keywords: "report export markdown pinned results notebook evidence",
    primaryOnMobile: true,
  },
];

export const MODULE_GROUPS: readonly ModuleGroup[] = ["Workspace", "Data", "Model", "Analyse", "Plan & report"];

/** The module owning a pathname (longest matching prefix). */
export function moduleForPath(pathname: string): ModuleEntry {
  if (pathname === "/") return MODULES[0];
  let best: ModuleEntry = MODULES[0];
  for (const entry of MODULES) {
    if (entry.path !== "/" && (pathname === entry.path || pathname.startsWith(`${entry.path}/`))) {
      if (entry.path.length > best.path.length || best.path === "/") best = entry;
    }
  }
  return best;
}
