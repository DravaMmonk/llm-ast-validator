/**
 * Threshold policy and aggregate metrics (plan Sections 8.3, 8.5).
 *
 * Pure functions over scored rows, so the policy is testable without a database.
 * The threshold is chosen on the calibration split only and frozen before any
 * review metric exists — the review split never chooses its own threshold.
 *
 * There is no ML framework here and no dynamic code: this is arithmetic over an
 * already computed score column.
 */

export const THRESHOLD_POLICY_VERSION = "youden-v1";
export const METRIC_POLICY_VERSION = "exploratory-v1";
export const EVALUATOR_VERSION = "v1";

export type ScoreDirection = "higher" | "lower";

export interface ScoredRow {
  score: number;
  label: 0 | 1;
}

export interface ThresholdChoice {
  direction: ScoreDirection;
  threshold: number;
  sensitivity: number;
  specificity: number;
  youden_j: number;
}

/** `higher` predicts positive at score >= t; `lower` predicts positive at score <= t. */
export function predictsPositive(direction: ScoreDirection, score: number, threshold: number): boolean {
  return direction === "higher" ? score >= threshold : score <= threshold;
}

function rates(rows: readonly ScoredRow[], direction: ScoreDirection, threshold: number) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const row of rows) {
    const positive = predictsPositive(direction, row.score, threshold);
    if (row.label === 1) positive ? (tp += 1) : (fn += 1);
    else positive ? (fp += 1) : (tn += 1);
  }
  const sensitivity = tp + fn === 0 ? 0 : tp / (tp + fn);
  const specificity = tn + fp === 0 ? 0 : tn / (tn + fp);
  return { tp, fp, tn, fn, sensitivity, specificity };
}

/**
 * Enumerates every distinct prediction partition for a direction, including the
 * all-positive and all-negative sentinels, and picks maximum Youden's J.
 *
 * Candidate thresholds are the distinct scores themselves plus one sentinel
 * beyond each end, which covers tied-score groups: a tie can only be split as a
 * whole group, and using the score value as the threshold does exactly that.
 *
 * Ties in J break by lower false-positive rate, then higher sensitivity, then
 * ascending threshold, then the `higher` direction.
 */
export function chooseThreshold(rows: readonly ScoredRow[]): ThresholdChoice {
  const scores = [...new Set(rows.map((row) => row.score))].sort((a, b) => a - b);
  const lowest = scores[0];
  const highest = scores[scores.length - 1];
  const span = Math.max(1, Math.abs(highest - lowest));
  // Sentinels force the all-positive and all-negative partitions to be reachable
  // for both directions.
  const candidates = [...scores, lowest - span, highest + span].sort((a, b) => a - b);

  let best: ThresholdChoice | null = null;

  for (const direction of ["higher", "lower"] as const) {
    for (const threshold of candidates) {
      const { fp, tn, sensitivity, specificity } = rates(rows, direction, threshold);
      const falsePositiveRate = fp + tn === 0 ? 0 : fp / (fp + tn);
      const choice: ThresholdChoice = {
        direction,
        threshold,
        sensitivity,
        specificity,
        youden_j: sensitivity + specificity - 1,
      };

      if (!best) {
        best = choice;
        continue;
      }
      const bestRates = rates(rows, best.direction, best.threshold);
      const bestFpr = bestRates.fp + bestRates.tn === 0 ? 0 : bestRates.fp / (bestRates.fp + bestRates.tn);

      const better =
        choice.youden_j > best.youden_j ||
        (choice.youden_j === best.youden_j &&
          (falsePositiveRate < bestFpr ||
            (falsePositiveRate === bestFpr &&
              (choice.sensitivity > best.sensitivity ||
                (choice.sensitivity === best.sensitivity &&
                  (choice.threshold < best.threshold ||
                    (choice.threshold === best.threshold && direction === "higher" && best.direction === "lower")))))));
      if (better) best = choice;
    }
  }

  return best!;
}

/**
 * Direction-normalized score: `lower` is negated so a larger normalized value
 * always means "more positive". AUROC and average precision use this.
 */
export function normalizeScore(direction: ScoreDirection, score: number): number {
  return direction === "higher" ? score : -score;
}

/**
 * AUROC by the rank-sum identity, with tied scores sharing their mid-rank so
 * ties contribute 0.5 rather than an arbitrary order.
 */
export function auroc(rows: readonly ScoredRow[]): number | null {
  const positives = rows.filter((row) => row.label === 1).length;
  const negatives = rows.length - positives;
  if (positives === 0 || negatives === 0) return null;

  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const ranks = new Array<number>(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    const midRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[k] = midRank;
    i = j + 1;
  }

  const positiveRankSum = sorted.reduce((sum, row, index) => (row.label === 1 ? sum + ranks[index] : sum), 0);
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/**
 * Average precision as the step-wise sum over recall gains. Tied scores are
 * consumed as one group so the value cannot depend on within-tie ordering.
 */
export function averagePrecision(rows: readonly ScoredRow[]): number | null {
  const positives = rows.filter((row) => row.label === 1).length;
  if (positives === 0) return null;

  const sorted = [...rows].sort((a, b) => b.score - a.score);
  let tp = 0;
  let seen = 0;
  let previousRecall = 0;
  let sum = 0;

  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    for (let k = i; k <= j; k += 1) {
      seen += 1;
      if (sorted[k].label === 1) tp += 1;
    }
    const recall = tp / positives;
    const precision = tp / seen;
    sum += (recall - previousRecall) * precision;
    previousRecall = recall;
    i = j + 1;
  }
  return sum;
}

export interface ConfusionCounts {
  true_positive: number;
  true_negative: number;
  false_positive: number;
  false_negative: number;
}

export type ErrorClass = keyof ConfusionCounts;

export function classify(predicted: 0 | 1, observed: 0 | 1): ErrorClass {
  if (observed === 1) return predicted === 1 ? "true_positive" : "false_negative";
  return predicted === 1 ? "false_positive" : "true_negative";
}

export interface ReviewMetrics {
  auroc: number | null;
  average_precision: number | null;
  sensitivity: number;
  specificity: number;
  positive_predictive_value: number | null;
  negative_predictive_value: number | null;
  confusion: ConfusionCounts;
  median_score_positive: number | null;
  median_score_negative: number | null;
  review_row_count: number;
  observed_positive_count: number;
  prevalence: number;
  /** This is not a held-out estimate; a human may inspect and then edit. */
  interpretation: "exploratory";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Review metrics under an already frozen direction and threshold.
 *
 * AUROC and average precision use direction-normalized raw scores; sensitivity,
 * specificity, predictive values, and the confusion counts use the frozen
 * calibration threshold.
 */
export function reviewMetrics(
  rows: readonly ScoredRow[],
  direction: ScoreDirection,
  threshold: number,
): ReviewMetrics {
  const normalized = rows.map((row) => ({ score: normalizeScore(direction, row.score), label: row.label }));
  const { tp, fp, tn, fn, sensitivity, specificity } = rates(rows, direction, threshold);
  const positives = rows.filter((row) => row.label === 1);

  return {
    auroc: auroc(normalized),
    average_precision: averagePrecision(normalized),
    sensitivity,
    specificity,
    positive_predictive_value: tp + fp === 0 ? null : tp / (tp + fp),
    negative_predictive_value: tn + fn === 0 ? null : tn / (tn + fn),
    confusion: { true_positive: tp, true_negative: tn, false_positive: fp, false_negative: fn },
    median_score_positive: median(positives.map((row) => row.score)),
    median_score_negative: median(rows.filter((row) => row.label === 0).map((row) => row.score)),
    review_row_count: rows.length,
    observed_positive_count: positives.length,
    prevalence: rows.length === 0 ? 0 : positives.length / rows.length,
    interpretation: "exploratory",
  };
}

/** Percentile of each score within the review split, direction-normalized. */
export function percentileOf(normalizedScores: readonly number[]): (score: number) => number {
  const sorted = [...normalizedScores].sort((a, b) => a - b);
  return (score: number) => {
    if (sorted.length === 0) return 0;
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid] < score) low = mid + 1;
      else high = mid;
    }
    return low / sorted.length;
  };
}
