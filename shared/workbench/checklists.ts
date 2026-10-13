/**
 * Reporting-guideline checklists for the Study Design module.
 *
 * Item labels are short paraphrases written for this application — never the
 * official wording — to be used as tick-box prompts. Each checklist links to
 * the official source and cites its open-access (CC BY 4.0 where available)
 * journal version. Item counts were verified against the official tables.
 */

export interface ChecklistItem {
  id: string;
  label: string;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

export interface Checklist {
  key: string;
  name: string;
  scope: string;
  designs: string[];
  officialUrl: string;
  citation: string;
  doi: string;
  sections: ChecklistSection[];
}

/** Compact authoring form: "id|label" lines grouped by section. */
function sections(spec: Record<string, string[]>): ChecklistSection[] {
  return Object.entries(spec).map(([title, lines]) => ({
    title,
    items: lines.map((line) => {
      const [id, label] = line.split("|");
      return { id, label };
    }),
  }));
}

export const CHECKLISTS: readonly Checklist[] = [
  {
    key: "consort-2025",
    name: "CONSORT 2025",
    scope: "Reports of randomised trials",
    designs: ["Randomised controlled trial"],
    officialUrl: "https://www.consort-spirit.org/",
    citation: "Hopewell S, Chan AW, Collins GS, et al. CONSORT 2025 statement: updated guideline for reporting randomised trials. BMJ 2025;389:e081123.",
    doi: "10.1136/bmj-2024-081123",
    sections: sections({
      "Title and abstract": ["1a|Identified as a randomised trial", "1b|Structured summary: design, methods, results, conclusions"],
      "Open science": [
        "2|Registry name, identifier and registration date",
        "3|Where protocol and analysis plan are accessible",
        "4|Access to de-identified data, code and materials",
        "5a|Funding sources and the funders' role",
        "5b|Authors' financial and other conflicts",
      ],
      Introduction: ["6|Scientific background and rationale", "7|Objectives covering benefits and harms"],
      Methods: [
        "8|Patient and public involvement",
        "9|Trial type, allocation ratio, framework",
        "10|Important post-start changes, with reasons",
        "11|Trial settings and locations",
        "12a|Participant eligibility criteria",
        "12b|Site / intervention-provider eligibility, if applicable",
        "13|Intervention and comparator in replicable detail",
        "14|Prespecified outcomes: variable, metric, aggregation, timing",
        "15|How harms were defined and assessed",
        "16a|Sample size method and assumptions",
        "16b|Interim analyses and stopping guidelines",
        "17a|Who generated the sequence; method used",
        "17b|Randomisation type and any restrictions",
        "18|Allocation concealment mechanism",
        "19|Could enrolling or assigning staff see the sequence?",
        "20a|Who was blinded after assignment",
        "20b|How blinding was achieved; intervention similarity",
        "21a|Group-comparison methods, including harms",
        "21b|Who is analysed, and in which group",
        "21c|Handling of missing data",
        "21d|Additional analyses, prespecified vs post hoc",
      ],
      Results: [
        "22a|Per-group numbers randomised, treated, analysed",
        "22b|Per-group losses after randomisation, with reasons",
        "23a|Recruitment and follow-up dates",
        "23b|Why the trial ended or stopped, if relevant",
        "24a|Interventions as delivered (adherence, fidelity)",
        "24b|Concomitant care in each group",
        "25|Baseline characteristics table per group",
        "26|Per-outcome numbers, group results, effect estimates",
        "27|All harms in each group",
        "28|Other analyses, prespecified vs post hoc",
      ],
      Discussion: ["29|Interpretation balancing benefits, harms and evidence", "30|Limitations: bias, imprecision, generalisability, multiplicity"],
    }),
  },
  {
    key: "strobe",
    name: "STROBE",
    scope: "Cohort, case-control and cross-sectional studies",
    designs: ["Cohort study", "Case-control study", "Cross-sectional study"],
    officialUrl: "https://www.strobe-statement.org/checklists/",
    citation: "von Elm E, Altman DG, Egger M, et al. The STROBE statement: guidelines for reporting observational studies. PLoS Med 2007;4(10):e296.",
    doi: "10.1371/journal.pmed.0040296",
    sections: sections({
      "Title and abstract": ["1a|Design named in title or abstract", "1b|Informative, balanced abstract"],
      Introduction: ["2|Scientific background and rationale", "3|Objectives and prespecified hypotheses"],
      Methods: [
        "4|Key design elements presented early",
        "5|Setting, locations, relevant dates",
        "6a|Eligibility, sources and selection of participants (and follow-up)",
        "6b|Matching criteria and numbers, if matched",
        "7|Outcomes, exposures, confounders and modifiers defined",
        "8|Data sources and measurement methods",
        "9|Efforts to address bias",
        "10|How the study size was reached",
        "11|Handling of quantitative variables",
        "12a|Statistical methods, including confounding control",
        "12b|Subgroup and interaction methods",
        "12c|Handling of missing data",
        "12d|Loss to follow-up / matching / sampling strategy",
        "12e|Sensitivity analyses",
      ],
      Results: [
        "13a|Numbers at each study stage",
        "13b|Reasons for non-participation",
        "13c|Flow diagram considered",
        "14a|Participant characteristics, exposures, confounders",
        "14b|Missing-data count per variable",
        "14c|Follow-up time summarised (cohort)",
        "15|Outcome events or summary measures",
        "16a|Unadjusted and adjusted estimates with precision",
        "16b|Category boundaries for categorised variables",
        "16c|Relative risk translated to absolute risk",
        "17|Other analyses (subgroups, sensitivity)",
      ],
      Discussion: ["18|Key results vs objectives", "19|Limitations; direction and size of bias", "20|Cautious overall interpretation", "21|Generalisability"],
      "Other information": ["22|Funding sources and funders' role"],
    }),
  },
  {
    key: "stard-2015",
    name: "STARD 2015",
    scope: "Diagnostic accuracy studies",
    designs: ["Diagnostic accuracy study"],
    officialUrl: "https://www.equator-network.org/reporting-guidelines/stard/",
    citation: "Bossuyt PM, Reitsma JB, Bruns DE, et al. STARD 2015: an updated list of essential items for reporting diagnostic accuracy studies. BMJ 2015;351:h5527.",
    doi: "10.1136/bmj.h5527",
    sections: sections({
      "Title or abstract": ["1|Identified as a diagnostic accuracy study, with a measure"],
      Abstract: ["2|Structured abstract"],
      Introduction: ["3|Background; intended use and role of the index test", "4|Objectives and hypotheses"],
      Methods: [
        "5|Prospective vs retrospective data collection",
        "6|Eligibility criteria",
        "7|Basis for identifying potential participants",
        "8|Where and when participants were identified",
        "9|Consecutive, random or convenience series",
        "10a|Index test in replicable detail",
        "10b|Reference standard in replicable detail",
        "11|Rationale for the reference standard",
        "12a|Index-test cut-offs, with rationale",
        "12b|Reference-standard cut-offs, with rationale",
        "13a|What index-test readers knew",
        "13b|What reference assessors knew",
        "14|Methods to estimate or compare accuracy",
        "15|Handling of indeterminate results",
        "16|Handling of missing test data",
        "17|Analyses of variability in accuracy",
        "18|Intended sample size and its basis",
      ],
      Results: [
        "19|Participant flow diagram",
        "20|Baseline demographic and clinical characteristics",
        "21a|Disease severity in those with the condition",
        "21b|Alternative diagnoses in those without",
        "22|Interval and interventions between tests",
        "23|Cross-tabulation of index test by reference standard",
        "24|Accuracy estimates with precision",
        "25|Adverse events from either test",
      ],
      Discussion: ["26|Limitations: bias, uncertainty, generalisability", "27|Implications for practice and intended use"],
      "Other information": ["28|Registration number and registry", "29|Where the full protocol is accessible", "30|Funding sources and funders' role"],
    }),
  },
  {
    key: "tripod-ai",
    name: "TRIPOD+AI",
    scope: "Prediction models (regression or machine learning)",
    designs: ["Prediction model development / validation"],
    officialUrl: "https://www.tripod-statement.org/",
    citation: "Collins GS, Moons KGM, Dhiman P, et al. TRIPOD+AI statement: updated guidance for reporting clinical prediction models that use regression or machine learning methods. BMJ 2024;385:e078378.",
    doi: "10.1136/bmj-2023-078378",
    sections: sections({
      Title: ["1|Develops or evaluates a model; population; outcome"],
      Abstract: ["2|Abstract per TRIPOD+AI for Abstracts"],
      Introduction: [
        "3a|Healthcare context, rationale, existing models",
        "3b|Target population, intended purpose and users",
        "3c|Known health inequalities between groups",
        "4|Objectives: development, validation or both",
      ],
      Methods: [
        "5a|Data sources, rationale, representativeness",
        "5b|Dates of data collection",
        "6a|Setting; number and location of centres",
        "6b|Participant eligibility criteria",
        "6c|Treatments received and how handled",
        "7|Data pre-processing and quality checks",
        "8a|Outcome definition, horizon, assessment",
        "8b|Outcome assessors' qualifications, if subjective",
        "8c|Blinding of outcome assessment",
        "9a|Choice and pre-selection of candidate predictors",
        "9b|Predictor definitions, measurement, blinding",
        "9c|Predictor assessors' qualifications, if subjective",
        "10|Sample size justification",
        "11|Missing-data handling",
        "12a|How data were used or partitioned",
        "12b|Predictor handling (form, scaling)",
        "12c|Model type, building, tuning, internal validation",
        "12d|Heterogeneity across clusters",
        "12e|Performance measures and plots, with rationale",
        "12f|Model updating after evaluation",
        "12g|How predictions were calculated",
        "13|Class-imbalance methods, if used",
        "14|Approaches to model fairness",
        "15|Model output and thresholds",
        "16|Development vs evaluation data differences",
        "17|Ethics approval and consent",
      ],
      "Open science": [
        "18a|Funding sources and funders' role",
        "18b|Conflicts of interest",
        "18c|Protocol access, or none prepared",
        "18d|Registration, or not registered",
        "18e|Data availability",
        "18f|Analysis code availability",
      ],
      "Patient and public involvement": ["19|Patient and public involvement, or none"],
      Results: [
        "20a|Participant flow, outcome counts, follow-up",
        "20b|Characteristics overall and per data source",
        "20c|Comparison with development-data distributions",
        "21|Participants and events per analysis",
        "22|Full model details and access",
        "23a|Performance with CIs, including key subgroups",
        "23b|Performance heterogeneity across clusters",
        "24|Model-updating results",
      ],
      Discussion: [
        "25|Overall interpretation, including fairness",
        "26|Limitations and their effects",
        "27a|Handling poor or missing inputs in use",
        "27b|User interaction and expertise needed",
        "27c|Next steps; applicability and generalisability",
      ],
    }),
  },
  {
    key: "prisma-2020",
    name: "PRISMA 2020",
    scope: "Systematic reviews and meta-analyses",
    designs: ["Systematic review"],
    officialUrl: "https://www.prisma-statement.org/prisma-2020-checklist",
    citation: "Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ 2021;372:n71.",
    doi: "10.1136/bmj.n71",
    sections: sections({
      Title: ["1|Identified as a systematic review"],
      Abstract: ["2|Abstract per PRISMA 2020 for Abstracts"],
      Introduction: ["3|Rationale in context of existing knowledge", "4|Explicit objectives or questions"],
      Methods: [
        "5|Eligibility criteria; grouping for syntheses",
        "6|All sources searched; last-search dates",
        "7|Full search strategies",
        "8|Screening process and tools",
        "9|Data-collection process and tools",
        "10a|Outcomes sought and results collected",
        "10b|Other variables sought; assumptions",
        "11|Risk-of-bias methods and tools",
        "12|Effect measures per outcome",
        "13a|Deciding eligibility for each synthesis",
        "13b|Data preparation for synthesis",
        "13c|Tabulation and visual display methods",
        "13d|Synthesis methods and meta-analysis model",
        "13e|Methods exploring heterogeneity",
        "13f|Sensitivity analyses",
        "14|Reporting-bias assessment",
        "15|Certainty-of-evidence assessment",
      ],
      Results: [
        "16a|Search and selection results (flow diagram)",
        "16b|Near-miss exclusions with reasons",
        "17|Included studies with characteristics",
        "18|Risk of bias per study",
        "19|Per-study summary statistics and effects",
        "20a|Characteristics and bias of contributing studies",
        "20b|Synthesis results with precision and heterogeneity",
        "20c|Heterogeneity investigation results",
        "20d|Sensitivity analysis results",
        "21|Reporting-bias assessments",
        "22|Certainty of evidence per outcome",
      ],
      Discussion: [
        "23a|Interpretation in context of other evidence",
        "23b|Limitations of included evidence",
        "23c|Limitations of the review process",
        "23d|Implications for practice, policy and research",
      ],
      "Other information": [
        "24a|Registration, or not registered",
        "24b|Protocol access, or none prepared",
        "24c|Amendments to registration or protocol",
        "25|Support sources and funders' role",
        "26|Competing interests",
        "27|Availability of data, code and materials",
      ],
    }),
  },
  {
    key: "spirit-2025",
    name: "SPIRIT 2025",
    scope: "Protocols of randomised trials",
    designs: ["Trial protocol"],
    officialUrl: "https://www.consort-spirit.org/",
    citation: "Chan AW, Boutron I, Hopewell S, et al. SPIRIT 2025 statement: updated guideline for protocols of randomised trials. BMJ 2025;389:e081477.",
    doi: "10.1136/bmj-2024-081477",
    sections: sections({
      "Administrative information": [
        "1a|Title marks design, population, interventions; protocol",
        "1b|Structured summary with registration items",
        "2|Protocol version date and identifier",
        "3a|Contributors' names, affiliations, roles",
        "3b|Sponsor name and contact",
        "3c|Sponsor and funder roles and authority",
        "3d|Oversight groups and responsibilities",
      ],
      "Open science": [
        "4|Registry name, identifier, date (or intended registry)",
        "5|Where protocol and analysis plan are accessible",
        "6|Access plan for de-identified data, code, materials",
        "7a|Funding and other support",
        "7b|Conflicts of interest",
        "8|Plans to communicate results",
      ],
      Introduction: ["9a|Background and prior evidence on benefits and harms", "9b|Rationale for the comparator", "10|Objectives covering benefits and harms"],
      "Methods: involvement and design": ["11|Patient and public involvement plans", "12|Trial type, allocation ratio, framework"],
      "Methods: participants, interventions, outcomes": [
        "13|Trial settings and locations",
        "14a|Participant eligibility criteria",
        "14b|Site / provider eligibility, if applicable",
        "15a|Intervention and comparator: who, how, when",
        "15b|Criteria to stop or modify the intervention",
        "15c|Adherence strategies and monitoring",
        "15d|Permitted and prohibited concomitant care",
        "16|Outcomes: variable, metric, aggregation, timing",
        "17|How harms will be defined and assessed",
        "18|Participant timeline",
        "19|Sample size method and assumptions",
        "20|Recruitment strategies",
      ],
      "Methods: assignment": [
        "21a|Who generates the sequence; method",
        "21b|Randomisation type; stratification factors",
        "22|Allocation concealment mechanism",
        "23|Can enrolling staff see the sequence?",
        "24a|Who will be blinded",
        "24b|How blinding is achieved",
        "24c|Unblinding circumstances and procedure",
      ],
      "Methods: data and analysis": [
        "25a|Data collection plans, instruments, quality",
        "25b|Retention and follow-up plans",
        "26|Data entry, coding, security, storage",
        "27a|Group-comparison methods, including harms",
        "27b|Who is analysed, and in which group",
        "27c|Handling of missing data",
        "27d|Additional analyses",
      ],
      "Methods: monitoring": ["28a|Data monitoring committee, or why none", "28b|Interim analyses and stopping rules", "29|Trial monitoring frequency and procedures"],
      Ethics: [
        "30|Ethics approval plans",
        "31|Communicating protocol amendments",
        "32a|Who obtains consent, and how",
        "32b|Consent for ancillary data or specimens",
        "33|Protecting confidentiality",
        "34|Ancillary and post-trial care; compensation",
      ],
    }),
  },
];

export function findChecklist(key: string): Checklist | undefined {
  return CHECKLISTS.find((checklist) => checklist.key === key);
}

export function checklistItemCount(checklist: Checklist): number {
  return checklist.sections.reduce((sum, section) => sum + section.items.length, 0);
}
