import { describe, expect, it } from "vitest";

import {
  type ScoredRow,
  auroc,
  averagePrecision,
  chooseThreshold,
  classify,
  normalizeScore,
  percentileOf,
  predictsPositive,
  reviewMetrics,
} from "./metrics";

const rows = (spec: [number, 0 | 1][]): ScoredRow[] => spec.map(([score, label]) => ({ score, label }));

describe("predictsPositive", () => {
  it("uses >= for higher and <= for lower", () => {
    expect(predictsPositive("higher", 5, 5)).toBe(true);
    expect(predictsPositive("higher", 4.9, 5)).toBe(false);
    expect(predictsPositive("lower", 5, 5)).toBe(true);
    expect(predictsPositive("lower", 5.1, 5)).toBe(false);
  });
});

describe("chooseThreshold", () => {
  it("finds the perfect split when the score separates the classes", () => {
    const choice = chooseThreshold(rows([[1, 0], [2, 0], [8, 1], [9, 1]]));

    expect(choice.direction).toBe("higher");
    expect(choice.youden_j).toBe(1);
    expect(choice.sensitivity).toBe(1);
    expect(choice.specificity).toBe(1);
    expect(predictsPositive("higher", 8, choice.threshold)).toBe(true);
    expect(predictsPositive("higher", 2, choice.threshold)).toBe(false);
  });

  it("detects an inverted score and picks the lower direction", () => {
    const choice = chooseThreshold(rows([[9, 0], [8, 0], [2, 1], [1, 1]]));

    expect(choice.direction).toBe("lower");
    expect(choice.youden_j).toBe(1);
  });

  it("evaluates both directions rather than assuming higher is positive", () => {
    // A perfectly inverted score must not be reported as useless.
    expect(chooseThreshold(rows([[1, 1], [2, 1], [3, 0], [4, 0]])).direction).toBe("lower");
  });

  it("handles a constant score without crashing", () => {
    const choice = chooseThreshold(rows([[5, 1], [5, 0], [5, 1], [5, 0]]));

    expect(Number.isFinite(choice.threshold)).toBe(true);
    // Nothing separates the classes, so J cannot exceed 0.
    expect(choice.youden_j).toBe(0);
  });

  it("splits tied scores as a whole group", () => {
    // The tie at 5 cannot be partially split; a threshold must take all or none.
    const choice = chooseThreshold(rows([[1, 0], [5, 0], [5, 1], [9, 1]]));
    const positives = [1, 5, 5, 9].filter((score) => predictsPositive(choice.direction, score, choice.threshold));
    expect(positives).not.toEqual([5, 9]);
  });

  it("can reach the all-positive and all-negative sentinels", () => {
    // Every row positive: the best rule is to call everything positive.
    const choice = chooseThreshold(rows([[1, 1], [2, 1], [3, 1]]));
    expect(choice.sensitivity).toBe(1);
  });

  it("is deterministic for the same input", () => {
    const input = rows([[1, 0], [3, 1], [2, 0], [4, 1], [2, 1]]);
    expect(chooseThreshold(input)).toEqual(chooseThreshold(input));
  });

  it("prefers the lower false-positive rate when J ties", () => {
    const choice = chooseThreshold(rows([[1, 0], [2, 0], [3, 1], [4, 1]]));
    // Both thresholds at 3 and just under 3 give J = 1; the tie-break must be stable.
    expect(choice.youden_j).toBe(1);
    expect(choice.specificity).toBe(1);
  });
});

describe("auroc", () => {
  it("is 1 for a perfect ranking", () => {
    expect(auroc(rows([[1, 0], [2, 0], [3, 1], [4, 1]]))).toBe(1);
  });

  it("is 0 for a perfectly inverted ranking", () => {
    expect(auroc(rows([[4, 0], [3, 0], [2, 1], [1, 1]]))).toBe(0);
  });

  it("is 0.5 when every score ties", () => {
    expect(auroc(rows([[5, 1], [5, 0], [5, 1], [5, 0]]))).toBe(0.5);
  });

  it("gives tied pairs half credit", () => {
    // Positives {2,3} vs negatives {1,2}: 2>1, 2 ties 2, 3>1, 3>2
    // → (1 + 0.5 + 1 + 1) / 4 = 0.875. Without half credit this would be 0.75.
    expect(auroc(rows([[1, 0], [2, 0], [2, 1], [3, 1]]))).toBeCloseTo(0.875, 10);
  });

  it("is null when a class is absent", () => {
    expect(auroc(rows([[1, 1], [2, 1]]))).toBeNull();
    expect(auroc(rows([[1, 0], [2, 0]]))).toBeNull();
  });

  it("matches a brute-force pairwise count", () => {
    const sample = rows([[1, 0], [2, 1], [2, 0], [3, 1], [4, 0], [5, 1], [5, 1]]);
    const positives = sample.filter((row) => row.label === 1);
    const negatives = sample.filter((row) => row.label === 0);
    let wins = 0;
    for (const p of positives) {
      for (const n of negatives) {
        if (p.score > n.score) wins += 1;
        else if (p.score === n.score) wins += 0.5;
      }
    }
    expect(auroc(sample)).toBeCloseTo(wins / (positives.length * negatives.length), 10);
  });
});

describe("averagePrecision", () => {
  it("is 1 when every positive outranks every negative", () => {
    expect(averagePrecision(rows([[4, 1], [3, 1], [2, 0], [1, 0]]))).toBeCloseTo(1, 10);
  });

  it("equals prevalence when the score is uninformative", () => {
    // All tied: precision is prevalence at every recall step.
    expect(averagePrecision(rows([[5, 1], [5, 0], [5, 1], [5, 0]]))).toBeCloseTo(0.5, 10);
  });

  it("is null with no positives", () => {
    expect(averagePrecision(rows([[1, 0], [2, 0]]))).toBeNull();
  });

  it("does not depend on ordering within a tie", () => {
    const a = averagePrecision(rows([[5, 1], [5, 0], [1, 0]]));
    const b = averagePrecision(rows([[5, 0], [5, 1], [1, 0]]));
    expect(a).toBe(b);
  });
});

describe("normalizeScore", () => {
  it("negates for the lower direction so larger always means more positive", () => {
    expect(normalizeScore("higher", 3)).toBe(3);
    expect(normalizeScore("lower", 3)).toBe(-3);
  });

  it("makes an inverted score rank correctly under AUROC", () => {
    const raw = rows([[1, 1], [2, 1], [3, 0], [4, 0]]);
    const normalized = raw.map((row) => ({ score: normalizeScore("lower", row.score), label: row.label }));
    expect(auroc(normalized)).toBe(1);
  });
});

describe("classify", () => {
  it("names all four cells", () => {
    expect(classify(1, 1)).toBe("true_positive");
    expect(classify(0, 0)).toBe("true_negative");
    expect(classify(1, 0)).toBe("false_positive");
    expect(classify(0, 1)).toBe("false_negative");
  });
});

describe("reviewMetrics", () => {
  const sample = rows([[1, 0], [2, 0], [3, 1], [4, 1]]);

  it("reports the confusion matrix under the frozen threshold", () => {
    const metrics = reviewMetrics(sample, "higher", 3);
    expect(metrics.confusion).toEqual({
      true_positive: 2,
      true_negative: 2,
      false_positive: 0,
      false_negative: 0,
    });
  });

  it("reports predictive values and their denominator", () => {
    const metrics = reviewMetrics(sample, "higher", 3);
    expect(metrics.positive_predictive_value).toBe(1);
    expect(metrics.negative_predictive_value).toBe(1);
    expect(metrics.review_row_count).toBe(4);
    expect(metrics.observed_positive_count).toBe(2);
    expect(metrics.prevalence).toBe(0.5);
  });

  it("uses a threshold it was given rather than fitting its own", () => {
    // A deliberately poor threshold must produce poor numbers, not be corrected.
    const metrics = reviewMetrics(sample, "higher", 1);
    expect(metrics.confusion.false_positive).toBe(2);
    expect(metrics.specificity).toBe(0);
  });

  it("reports medians per observed class", () => {
    const metrics = reviewMetrics(sample, "higher", 3);
    expect(metrics.median_score_positive).toBe(3.5);
    expect(metrics.median_score_negative).toBe(1.5);
  });

  it("labels itself exploratory", () => {
    expect(reviewMetrics(sample, "higher", 3).interpretation).toBe("exploratory");
  });

  it("ranks with direction-normalized scores", () => {
    const inverted = rows([[1, 1], [2, 1], [3, 0], [4, 0]]);
    expect(reviewMetrics(inverted, "lower", 2).auroc).toBe(1);
  });

  it("returns null predictive values when a denominator is empty", () => {
    const metrics = reviewMetrics(rows([[1, 0], [2, 0]]), "higher", 99);
    expect(metrics.positive_predictive_value).toBeNull();
    expect(metrics.auroc).toBeNull();
  });
});

describe("percentileOf", () => {
  it("ranks a score within the split", () => {
    const percentile = percentileOf([1, 2, 3, 4]);
    expect(percentile(1)).toBe(0);
    expect(percentile(3)).toBe(0.5);
    expect(percentile(4)).toBe(0.75);
  });

  it("gives tied scores the same percentile", () => {
    const percentile = percentileOf([1, 5, 5, 9]);
    expect(percentile(5)).toBe(percentile(5));
    expect(percentile(5)).toBe(0.25);
  });

  it("handles an empty split", () => {
    expect(percentileOf([])(1)).toBe(0);
  });
});

describe("the calibration split alone chooses the threshold", () => {
  it("ignores review rows entirely when choosing", () => {
    const calibration = rows([[1, 0], [2, 0], [8, 1], [9, 1]]);
    const choice = chooseThreshold(calibration);

    // A review split with the opposite relationship must not move the threshold.
    const review = rows([[1, 1], [2, 1], [8, 0], [9, 0]]);
    const metrics = reviewMetrics(review, choice.direction, choice.threshold);

    expect(choice.direction).toBe("higher");
    expect(metrics.confusion.true_positive).toBe(0);
    expect(metrics.sensitivity).toBe(0);
    // The frozen rule is simply wrong on review, and that is what gets reported.
    expect(chooseThreshold(calibration)).toEqual(choice);
  });
});
