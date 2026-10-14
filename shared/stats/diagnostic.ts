/**
 * Diagnostic-accuracy statistics: ROC curves, AUC with DeLong CI, confusion
 * matrices, Youden's J, 2×2 accuracy measures and Bayes post-test
 * probabilities.
 *
 * Labels are 1 = diseased / positive class, 0 = non-diseased. Unless stated
 * otherwise, higher scores indicate disease: a subject is test-positive when
 * score >= threshold.
 */

import { normalQuantile } from "./distributions";
import { rankWithTies } from "./descriptive";
import { StatsError, assertBinary, assertFiniteArray, assertFiniteNumber, assertProbabilityOpen, assertSameLength } from "./errors";
import { wilsonInterval } from "./tests";
import type { EstimateWithCi } from "./types";

function validateScores(scores: readonly number[], labels: readonly number[]): { nPos: number; nNeg: number } {
  assertSameLength(scores, labels, "scores and labels");
  assertFiniteArray(scores, "scores");
  assertBinary(labels, "labels");
  const nPos = labels.reduce((s, v) => s + v, 0);
  const nNeg = labels.length - nPos;
  if (nPos === 0 || nNeg === 0) {
    throw new StatsError("INSUFFICIENT_DATA", "need at least one positive (label 1) and one negative (label 0)");
  }
  return { nPos, nNeg };
}

export interface RocPoint {
  /** Test positive when score >= threshold. The first point uses +Infinity (nobody positive). */
  threshold: number;
  fpr: number;
  tpr: number;
}

export interface RocCurve {
  points: RocPoint[];
  /** Trapezoidal area = Mann–Whitney probability P(score_pos > score_neg) + ½ P(tie). */
  auc: number;
}

/**
 * Empirical ROC curve: one point per distinct score (thresholds descending),
 * starting at (0, 0) with threshold +Infinity and ending at (1, 1). Tied
 * scores move diagonally, so the trapezoidal AUC counts ties as ½.
 */
export function rocCurve(scores: readonly number[], labels: readonly (0 | 1)[]): RocCurve {
  const { nPos, nNeg } = validateScores(scores, labels);
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const points: RocPoint[] = [{ threshold: Infinity, fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  let auc = 0;
  let i = 0;
  while (i < order.length) {
    const t = scores[order[i]];
    let dTp = 0;
    let dFp = 0;
    while (i < order.length && scores[order[i]] === t) {
      if (labels[order[i]] === 1) dTp++;
      else dFp++;
      i++;
    }
    // Trapezoid in count units: dFp * (tp + tp + dTp) / 2.
    auc += dFp * (tp + dTp / 2);
    tp += dTp;
    fp += dFp;
    points.push({ threshold: t, fpr: fp / nNeg, tpr: tp / nPos });
  }
  return { points, auc: auc / (nPos * nNeg) };
}

export interface AucDeLongResult {
  auc: number;
  /** DeLong (1988) standard error. */
  se: number;
  /** Wald CI auc ± z·se, clipped to [0, 1]. */
  lower: number;
  upper: number;
  level: number;
  nPositive: number;
  nNegative: number;
}

/**
 * AUC with DeLong et al. (1988) variance from structural components:
 * V10_i = P(Y < X_i) + ½P(Y = X_i) for each positive X_i, V01_j likewise for
 * each negative; Var(AUC) = S10/n1 + S01/n0 with sample variances (n - 1).
 * Requires ≥ 2 subjects per class.
 */
export function aucDeLong(scores: readonly number[], labels: readonly (0 | 1)[], conf = 0.95): AucDeLongResult {
  const { nPos, nNeg } = validateScores(scores, labels);
  assertProbabilityOpen(conf, "conf");
  if (nPos < 2 || nNeg < 2) throw new StatsError("INSUFFICIENT_DATA", "DeLong variance needs at least 2 positives and 2 negatives");
  const pos: number[] = [];
  const neg: number[] = [];
  scores.forEach((s, i) => (labels[i] === 1 ? pos : neg).push(s));
  const all = rankWithTies([...pos, ...neg]).ranks;
  const rPos = rankWithTies(pos).ranks;
  const rNeg = rankWithTies(neg).ranks;
  // Midrank identity: #neg below X_i + ½#ties = rank_all(X_i) - rank_pos(X_i).
  const v10 = pos.map((_, i) => (all[i] - rPos[i]) / nNeg);
  const v01 = neg.map((_, j) => 1 - (all[nPos + j] - rNeg[j]) / nPos);
  const auc = v10.reduce((s, v) => s + v, 0) / nPos;
  const sampleVar = (v: number[], m: number) => v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
  const s10 = sampleVar(v10, auc);
  const s01 = sampleVar(v01, auc);
  const se = Math.sqrt(s10 / nPos + s01 / nNeg);
  const z = normalQuantile((1 + conf) / 2);
  return {
    auc,
    se,
    lower: Math.max(0, auc - z * se),
    upper: Math.min(1, auc + z * se),
    level: conf,
    nPositive: nPos,
    nNegative: nNeg,
  };
}

export interface ConfusionCounts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

/**
 * Confusion matrix at a threshold. direction "higher": positive when
 * score >= threshold; "lower": positive when score <= threshold.
 */
export function confusionAt(
  scores: readonly number[],
  labels: readonly (0 | 1)[],
  threshold: number,
  direction: "higher" | "lower" = "higher",
): ConfusionCounts {
  assertSameLength(scores, labels, "scores and labels");
  assertFiniteArray(scores, "scores");
  assertBinary(labels, "labels");
  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    throw new StatsError("INVALID_ARGUMENT", "threshold must be a number");
  }
  if (direction !== "higher" && direction !== "lower") throw new StatsError("INVALID_ARGUMENT", "direction must be 'higher' or 'lower'");
  const out = { tp: 0, fp: 0, fn: 0, tn: 0 };
  scores.forEach((s, i) => {
    const positive = direction === "higher" ? s >= threshold : s <= threshold;
    if (labels[i] === 1) positive ? out.tp++ : out.fn++;
    else positive ? out.fp++ : out.tn++;
  });
  return out;
}

export interface YoudenResult {
  /** Optimal cut-off: test positive when score >= threshold. */
  threshold: number;
  sensitivity: number;
  specificity: number;
  /** Youden's J = sensitivity + specificity - 1. */
  j: number;
}

/**
 * Threshold maximising Youden's J over the observed scores (higher = disease).
 * Ties in J are broken in favour of the highest threshold (most specific).
 */
export function youdenOptimal(scores: readonly number[], labels: readonly (0 | 1)[]): YoudenResult {
  const { points } = rocCurve(scores, labels);
  let best: YoudenResult | null = null;
  for (const p of points.slice(1)) {
    const j = p.tpr - p.fpr;
    if (best === null || j > best.j + 1e-12) best = { threshold: p.threshold, sensitivity: p.tpr, specificity: 1 - p.fpr, j };
  }
  return best as YoudenResult;
}

export interface Diagnostic2x2Result {
  sensitivity: EstimateWithCi;
  specificity: EstimateWithCi;
  ppv: EstimateWithCi;
  npv: EstimateWithCi;
  accuracy: EstimateWithCi;
  prevalence: EstimateWithCi;
  lrPositive: EstimateWithCi;
  lrNegative: EstimateWithCi;
  diagnosticOddsRatio: EstimateWithCi;
  level: number;
}

const NULL_ESTIMATE: EstimateWithCi = { estimate: null, lower: null, upper: null };

function wilson(x: number, n: number, conf: number): EstimateWithCi {
  if (n === 0) return NULL_ESTIMATE;
  const w = wilsonInterval(x, n, conf);
  return { estimate: w.estimate, lower: w.lower, upper: w.upper };
}

/** Ratio (a/n1)/(b/n2) with log-scale CI, SE = sqrt(1/a - 1/n1 + 1/b - 1/n2) (Simel et al. 1991). */
function likelihoodRatio(a: number, n1: number, b: number, n2: number, z: number): EstimateWithCi {
  if (n1 === 0 || n2 === 0 || b === 0) return NULL_ESTIMATE;
  const estimate = a / n1 / (b / n2);
  if (a === 0) return { estimate, lower: null, upper: null };
  const se = Math.sqrt(Math.max(0, 1 / a - 1 / n1 + 1 / b - 1 / n2));
  const log = Math.log(estimate);
  return { estimate, lower: Math.exp(log - z * se), upper: Math.exp(log + z * se) };
}

/**
 * Accuracy measures for a 2×2 table of test result vs reference standard.
 * Proportions use Wilson intervals; likelihood ratios use log-method CIs
 * (Simel 1991); the diagnostic odds ratio uses a Woolf log CI. Estimates are
 * null when their denominator is 0; CIs are null when a log-scale interval
 * is undefined (a zero cell in the ratio's numerator / any zero cell for DOR).
 */
export function diagnostic2x2(tp: number, fp: number, fn: number, tn: number, conf = 0.95): Diagnostic2x2Result {
  [tp, fp, fn, tn].forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0) throw new StatsError("INVALID_ARGUMENT", `${["tp", "fp", "fn", "tn"][i]} must be a non-negative integer`);
  });
  assertProbabilityOpen(conf, "conf");
  const n = tp + fp + fn + tn;
  if (n === 0) throw new StatsError("EMPTY_INPUT", "all cells are zero");
  const z = normalQuantile((1 + conf) / 2);
  let dor: EstimateWithCi = NULL_ESTIMATE;
  if (fp > 0 && fn > 0) {
    const estimate = (tp * tn) / (fp * fn);
    if (tp > 0 && tn > 0) {
      const se = Math.sqrt(1 / tp + 1 / fp + 1 / fn + 1 / tn);
      dor = { estimate, lower: Math.exp(Math.log(estimate) - z * se), upper: Math.exp(Math.log(estimate) + z * se) };
    } else {
      dor = { estimate, lower: null, upper: null };
    }
  }
  return {
    sensitivity: wilson(tp, tp + fn, conf),
    specificity: wilson(tn, tn + fp, conf),
    ppv: wilson(tp, tp + fp, conf),
    npv: wilson(tn, tn + fn, conf),
    accuracy: wilson(tp + tn, n, conf),
    prevalence: wilson(tp + fn, n, conf),
    lrPositive: likelihoodRatio(tp, tp + fn, fp, fp + tn, z),
    lrNegative: likelihoodRatio(fn, tp + fn, tn, fp + tn, z),
    diagnosticOddsRatio: dor,
    level: conf,
  };
}

/**
 * Post-test probability from a pre-test probability and a likelihood ratio
 * via odds: post odds = pre odds × LR. pre-test 1 stays 1 (LR > 0).
 */
export function postTestProbability(preTest: number, likelihoodRatio: number): number {
  assertFiniteNumber(preTest, "preTest");
  assertFiniteNumber(likelihoodRatio, "likelihoodRatio");
  if (preTest < 0 || preTest > 1) throw new StatsError("INVALID_ARGUMENT", "preTest must be in [0, 1]");
  if (likelihoodRatio < 0) throw new StatsError("INVALID_ARGUMENT", "likelihoodRatio must be >= 0");
  if (preTest === 1) {
    if (likelihoodRatio === 0) throw new StatsError("INVALID_ARGUMENT", "preTest = 1 with likelihoodRatio = 0 is undefined");
    return 1;
  }
  const postOdds = (preTest / (1 - preTest)) * likelihoodRatio;
  return postOdds / (1 + postOdds);
}
