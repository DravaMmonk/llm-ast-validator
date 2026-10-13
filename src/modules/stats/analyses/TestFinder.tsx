/**
 * Test Finder — answer a few plain questions, get the method, the reason, its
 * assumptions, and a one-click jump to run it on your data. The decision tree
 * follows standard teaching references for choosing a statistical test.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, RotateCcw } from "lucide-react";

import { PaneBody, ghostBtn, primaryBtn } from "../../../shared-console/src";
import { Callout } from "../../../workstation/ui";

interface Option {
  id: string;
  label: string;
  hint: string;
}

interface Question {
  id: string;
  prompt: string;
  options: Option[];
}

interface Recommendation {
  method: string;
  why: string;
  assumptions: string[];
  route: string;
  routeLabel: string;
  alternative?: string;
}

const QUESTIONS: Record<string, Question> = {
  goal: {
    id: "goal",
    prompt: "What do you want to find out?",
    options: [
      { id: "compare", label: "Compare groups", hint: "Is the outcome different between treatment arms, sexes, exposure groups…?" },
      { id: "relate", label: "Relate two measurements", hint: "Do two numeric variables move together?" },
      { id: "predict", label: "Predict or adjust", hint: "Several variables explaining one outcome, adjusting for confounders." },
      { id: "survival", label: "Time until an event", hint: "Follow-up with censoring — death, relapse, diagnosis." },
      { id: "diagnostic", label: "Accuracy of a test", hint: "How well does a marker or score detect a condition?" },
      { id: "describe", label: "Describe a sample", hint: "Baseline characteristics, Table 1." },
    ],
  },
  outcome: {
    id: "outcome",
    prompt: "What kind of outcome?",
    options: [
      { id: "numeric", label: "Numeric", hint: "Blood pressure, glucose, a score." },
      { id: "categorical", label: "Yes/no or categories", hint: "Event happened, disease stage, smoking status." },
    ],
  },
  groups: {
    id: "groups",
    prompt: "How many groups?",
    options: [
      { id: "two", label: "Two", hint: "Treatment vs placebo, women vs men." },
      { id: "many", label: "Three or more", hint: "Several sites, dose levels, categories." },
    ],
  },
  paired: {
    id: "paired",
    prompt: "Are the measurements independent or paired?",
    options: [
      { id: "independent", label: "Independent", hint: "Different people in each group." },
      { id: "paired", label: "Paired / repeated", hint: "The same people measured twice, or matched pairs." },
    ],
  },
  shape: {
    id: "shape",
    prompt: "How is the numeric outcome distributed within groups?",
    options: [
      { id: "normal", label: "Roughly symmetric", hint: "Bell-shaped, no extreme tail, or large groups (n ≥ 30 each)." },
      { id: "skewed", label: "Skewed or small groups", hint: "Long tail, outliers, ordinal scores, or small n." },
    ],
  },
  expected: {
    id: "expected",
    prompt: "Are all expected cell counts at least 5?",
    options: [
      { id: "large", label: "Yes — reasonably large table", hint: "Most cells hold more than a handful of rows." },
      { id: "small", label: "No — sparse 2×2 table", hint: "Rare outcomes or small groups." },
    ],
  },
  predictTarget: {
    id: "predictTarget",
    prompt: "What is the outcome being predicted?",
    options: [
      { id: "numeric", label: "Numeric", hint: "A measurement." },
      { id: "binary", label: "Yes/no", hint: "Event or no event." },
      { id: "time", label: "Time to event", hint: "With censoring." },
    ],
  },
};

function next(answers: Record<string, string>): string | null {
  const goal = answers.goal;
  if (!goal) return "goal";
  if (goal === "compare") {
    if (!answers.outcome) return "outcome";
    if (answers.outcome === "numeric") {
      if (!answers.groups) return "groups";
      if (!answers.paired) return "paired";
      if (!answers.shape) return "shape";
      return null;
    }
    if (!answers.paired) return "paired";
    if (answers.paired === "independent" && !answers.expected) return "expected";
    return null;
  }
  if (goal === "relate") return answers.shape ? null : "shape";
  if (goal === "predict") return answers.predictTarget ? null : "predictTarget";
  return null;
}

export function recommend(answers: Record<string, string>): Recommendation {
  const { goal, outcome, groups, paired, shape, expected, predictTarget } = answers;
  const compare: Recommendation = { method: "", why: "", assumptions: [], route: "/stats/compare", routeLabel: "Open Compare groups" };
  if (goal === "describe") {
    return { method: "Table 1 (descriptive statistics)", why: "Summarise each variable overall and by group before any modelling.", assumptions: ["Choose mean ± SD for symmetric and median [IQR] for skewed variables — the workbench decides per variable."], route: "/stats/table1", routeLabel: "Open Table 1" };
  }
  if (goal === "survival") {
    return { method: "Kaplan–Meier curves + log-rank test", why: "Censoring means simple proportions underestimate risk; Kaplan–Meier uses every participant's follow-up.", assumptions: ["Censoring is non-informative.", "For adjusted comparisons use Cox regression."], route: "/stats/survival", routeLabel: "Open Survival" , alternative: "Cox proportional hazards to adjust for covariates." };
  }
  if (goal === "diagnostic") {
    return { method: "ROC analysis with DeLong CI; sensitivity, specificity, likelihood ratios", why: "Accuracy is about separating people with and without the condition at a threshold.", assumptions: ["A reference standard classifies every participant.", "Choose thresholds on one sample and confirm on another."], route: "/diagnostic/roc", routeLabel: "Open the ROC explorer" };
  }
  if (goal === "predict") {
    if (predictTarget === "numeric") return { method: "Multiple linear regression", why: "Models a numeric outcome as a weighted sum of predictors, giving adjusted effects.", assumptions: ["Linearity and constant residual variance (check the residual plot).", "Independent observations."], route: "/stats/regression?model=linear", routeLabel: "Open Regression" };
    if (predictTarget === "time") return { method: "Cox proportional-hazards regression", why: "Adjusted hazard ratios for time-to-event data with censoring.", assumptions: ["Proportional hazards over follow-up.", "Non-informative censoring."], route: "/stats/regression?model=cox", routeLabel: "Open Regression" };
    return { method: "Multiple logistic regression", why: "Models the log-odds of a yes/no outcome, giving adjusted odds ratios.", assumptions: ["At least ~10 events per predictor.", "Linearity of numeric predictors on the log-odds scale."], route: "/stats/regression?model=logistic", routeLabel: "Open Regression" };
  }
  if (goal === "relate") {
    return shape === "normal"
      ? { method: "Pearson correlation", why: "Measures linear association between two roughly normal measurements.", assumptions: ["Linear relation", "No influential outliers"], route: "/stats/correlation", routeLabel: "Open Correlation", alternative: "Spearman if the relation is monotonic but not linear." }
      : { method: "Spearman rank correlation", why: "Uses ranks, so it is robust to skew, outliers, and ordinal scales.", assumptions: ["Monotonic relation"], route: "/stats/correlation", routeLabel: "Open Correlation" };
  }
  if (outcome === "numeric") {
    if (paired === "paired") {
      return groups === "two"
        ? shape === "normal"
          ? { method: "Paired t-test", why: "Tests whether the mean within-person change differs from zero.", assumptions: ["Differences roughly normal"], route: "/stats/paired", routeLabel: "Open Paired comparison" }
          : { method: "Wilcoxon signed-rank test", why: "The rank-based alternative for skewed paired differences.", assumptions: ["Differences symmetric about the median"], route: "/stats/paired", routeLabel: "Open Paired comparison", alternative: "Not yet built in: the paired t-test on the change is shown; with n ≥ 30 pairs it is robust." }
        : { method: "Repeated-measures ANOVA or Friedman test", why: "Three or more measurements on the same people.", assumptions: ["Sphericity (RM-ANOVA)"], route: "/stats/paired", routeLabel: "Open Paired comparison", alternative: "Not yet built in: compare two time points at a time with the paired test, adjusting for multiplicity." };
    }
    if (groups === "two") {
      return shape === "normal"
        ? { ...compare, method: "Welch two-sample t-test", why: "Compares means without assuming equal variances — the safer default to Student's t.", assumptions: ["Roughly normal within groups or n ≥ 30 per group", "Independent observations"], alternative: "The Mann–Whitney U test is shown alongside as a robustness check." }
        : { ...compare, method: "Mann–Whitney U (Wilcoxon rank-sum) test", why: "Compares distributions via ranks; robust to skew and outliers.", assumptions: ["Independent observations", "Similar shapes if you interpret it as a median difference"] };
    }
    return shape === "normal"
      ? { ...compare, method: "One-way ANOVA", why: "Tests whether any group mean differs among three or more groups.", assumptions: ["Roughly normal within groups", "Similar variances"], alternative: "Kruskal–Wallis is shown alongside." }
      : { ...compare, method: "Kruskal–Wallis test", why: "The rank-based extension of Mann–Whitney to several groups.", assumptions: ["Independent observations"] };
  }
  if (paired === "paired") {
    return { method: "McNemar's test", why: "Paired yes/no outcomes (before/after, matched case–control).", assumptions: ["Discordant pairs drive the test"], route: "/stats/compare", routeLabel: "Open Compare groups", alternative: "Not yet built in: tabulate the paired outcomes and compare discordant counts." };
  }
  return expected === "small"
    ? { ...compare, method: "Fisher's exact test", why: "Exact p-value for a sparse 2×2 table where the χ² approximation fails.", assumptions: ["Fixed margins"], alternative: "The workbench switches to Fisher automatically when expected counts are small." }
    : { ...compare, method: "χ² test of independence (with OR, RR and risk difference for 2×2)", why: "Compares proportions across groups.", assumptions: ["Expected counts ≥ 5 in most cells", "Independent observations"] };
}

export function TestFinder() {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const pending = next(answers);
  const path = Object.entries(answers);

  return (
    <PaneBody>
      <div className="mx-auto w-full max-w-[760px] px-4 py-4">
        <div className="flex items-center gap-2">
          <h2 className="m-0 flex-1 text-[17px] font-semibold text-fg-strong">Which test should I use?</h2>
          {path.length > 0 && (
            <button type="button" className={`${ghostBtn} gap-1`} onClick={() => setAnswers({})}>
              <RotateCcw size={11} aria-hidden /> <span className="text-label">Start over</span>
            </button>
          )}
        </div>
        <p className="m-0 mt-1 text-ui text-muted-fg">Answer a few questions — each answer is a piece; the path ends in a method you can run on your data.</p>

        {path.length > 0 && (
          <ol className="m-0 mt-3 flex list-none flex-wrap items-center gap-1.5 p-0" aria-label="Your answers">
            {path.map(([question, answer], index) => {
              const option = QUESTIONS[question].options.find((entry) => entry.id === answer)!;
              return (
                <li key={question} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    title="Change this answer"
                    onClick={() => setAnswers(Object.fromEntries(path.slice(0, index)))}
                    className="cursor-pointer rounded-full border border-border bg-primary-soft px-2.5 py-1 text-label font-medium text-primary hover:opacity-85"
                  >
                    {option.label}
                  </button>
                  {index < path.length - 1 && <ArrowRight size={12} className="text-muted-fg" aria-hidden />}
                </li>
              );
            })}
          </ol>
        )}

        {pending ? (
          <fieldset className="m-0 mt-4 border-0 p-0">
            <legend className="mb-2 text-md font-semibold text-fg">{QUESTIONS[pending].prompt}</legend>
            <div className="grid grid-cols-2 gap-2 mobile:grid-cols-1">
              {QUESTIONS[pending].options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAnswers({ ...answers, [pending]: option.id })}
                  className="cursor-pointer rounded-[10px] border border-border bg-card p-3 text-left hover:border-primary"
                >
                  <div className="text-ui font-semibold text-fg-strong">{option.label}</div>
                  <div className="mt-0.5 text-body leading-snug text-muted-fg">{option.hint}</div>
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          (() => {
            const rec = recommend(answers);
            return (
              <section className="mt-4 rounded-[12px] border border-primary bg-card p-4" aria-live="polite">
                <div className="text-cap font-semibold uppercase tracking-[0.06em] text-primary">Recommended</div>
                <h3 className="m-0 mt-1 text-[17px] font-semibold text-fg-strong">{rec.method}</h3>
                <p className="m-0 mt-1.5 text-ui leading-relaxed text-fg">{rec.why}</p>
                <div className="mt-3 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Check first</div>
                <ul className="m-0 mt-1 pl-4 text-body leading-relaxed text-fg">
                  {rec.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
                {rec.alternative && (
                  <Callout tone="info" className="mt-3">
                    {rec.alternative}
                  </Callout>
                )}
                <button type="button" className={`${primaryBtn} mt-3 flex items-center gap-1`} onClick={() => navigate(rec.route)}>
                  {rec.routeLabel} <ArrowRight size={13} aria-hidden />
                </button>
              </section>
            );
          })()
        )}
        <p className="m-0 mt-6 text-cap leading-relaxed text-muted-fg">
          A guide, not a substitute for a statistician: study design, clustering, multiplicity, and missing-data mechanisms can change the right choice.
        </p>
      </div>
    </PaneBody>
  );
}
