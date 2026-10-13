import { describe, expect, it } from "vitest";
import { aucDeLong, confusionAt, diagnostic2x2, postTestProbability, rocCurve, youdenOptimal } from "./diagnostic";
import { expectRel, expectStatsError } from "./testHelpers";

// Hand-made scores with ties across classes.
const S = [0.1, 0.4, 0.35, 0.8, 0.65, 0.5, 0.5, 0.9, 0.2, 0.7, 0.5, 0.3, 0.6, 0.85, 0.45, 0.55, 0.5, 0.25];
const Y: (0 | 1)[] = [0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0];

describe("rocCurve", () => {
  it("has one point per distinct threshold, matching R mean(s[y==k] >= t)", () => {
    const roc = rocCurve(S, Y);
    expect(roc.points[0]).toEqual({ threshold: Infinity, fpr: 0, tpr: 0 });
    const th = [0.9, 0.85, 0.8, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.1];
    const tpr = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 0.9, 0.9, 1, 1, 1, 1, 1];
    const fpr = [0, 0, 0, 0, 0, 0, 0, 0.25, 0.375, 0.5, 0.5, 0.625, 0.75, 0.875, 1];
    expect(roc.points.slice(1).map((p) => p.threshold)).toEqual(th);
    roc.points.slice(1).forEach((p, i) => {
      expectRel(p.tpr, tpr[i], 1e-15);
      if (fpr[i] === 0) expect(p.fpr).toBe(0);
      else expectRel(p.fpr, fpr[i], 1e-15);
    });
    expect(roc.points.at(-1)).toMatchObject({ fpr: 1, tpr: 1 });
    // wilcox.test(...)$statistic / (n1 * n0)
    expectRel(roc.auc, 0.925, 1e-14);
  });
  it("handles all-tied scores (diagonal, AUC 0.5) and rejects single-class input", () => {
    const roc = rocCurve([1, 1, 1, 1], [0, 1, 0, 1]);
    expect(roc.points).toEqual([
      { threshold: Infinity, fpr: 0, tpr: 0 },
      { threshold: 1, fpr: 1, tpr: 1 },
    ]);
    expect(roc.auc).toBe(0.5);
    expectStatsError(() => rocCurve([1, 2], [1, 1]), "INSUFFICIENT_DATA");
    expectStatsError(() => rocCurve([1, 2], [1]), "LENGTH_MISMATCH");
  });
});

describe("aucDeLong", () => {
  // Hand-coded DeLong in R: psi <- outer(X, Y, function(a, b) (a > b) + 0.5 * (a == b));
  // se <- sqrt(var(rowMeans(psi)) / n1 + var(colMeans(psi)) / n0)
  it("matches a hand-coded R DeLong", () => {
    const r = aucDeLong(S, Y);
    expectRel(r.auc, 0.925, 1e-14);
    expectRel(r.se, 0.05900968443520823, 1e-12);
    expectRel(r.lower, 0.80934314376791816, 1e-12);
    expect(r.upper).toBe(1); // clipped
    expectRel(aucDeLong(S, Y, 0.9).lower, 0.82793770653148602, 1e-12);
    expect([r.nPositive, r.nNegative]).toEqual([10, 8]);
  });
  it("handles perfect separation and too-small classes", () => {
    const r = aucDeLong([1, 2, 3, 4], [0, 0, 1, 1]);
    expect([r.auc, r.se, r.lower, r.upper]).toEqual([1, 0, 1, 1]);
    expectStatsError(() => aucDeLong([1, 2, 3], [0, 0, 1]), "INSUFFICIENT_DATA");
  });
});

describe("confusionAt / youdenOptimal", () => {
  it("counts with both directions", () => {
    expect(confusionAt(S, Y, 0.5)).toEqual({ tp: 9, fp: 2, fn: 1, tn: 6 });
    expect(confusionAt(S, Y, 0.5, "lower")).toEqual({ tp: 3, fp: 8, fn: 7, tn: 0 });
    expectStatsError(() => confusionAt(S, Y, Number.NaN), "INVALID_ARGUMENT");
  });
  it("finds the Youden-optimal threshold (R: th[which.max(J)])", () => {
    const r = youdenOptimal(S, Y);
    expect(r.threshold).toBe(0.55);
    expectRel(r.j, 0.7, 1e-14);
    expectRel(r.sensitivity, 0.7, 1e-14);
    expect(r.specificity).toBe(1);
  });
});

describe("diagnostic2x2", () => {
  // Wilson: prop.test(x, n, correct = FALSE)$conf.int; LR: log method (Simel 1991); DOR: Woolf.
  it("matches R formulas for tp=90, fp=15, fn=10, tn=85", () => {
    const r = diagnostic2x2(90, 15, 10, 85);
    const ref: [keyof typeof r, number, number, number][] = [
      ["sensitivity", 0.9, 0.82563433849508661, 0.94477086293932488],
      ["specificity", 0.85, 0.7671644040916763, 0.90694014716343363],
      ["ppv", 0.8571428571428571, 0.77760046772999603, 0.91147519160635404],
      ["npv", 0.89473684210526316, 0.81697942935200141, 0.94181147574841462],
      ["accuracy", 0.875, 0.82198574997417651, 0.91388025524287353],
      ["prevalence", 0.5, 0.43136085960389192, 0.56863914039610808],
      ["lrPositive", 5.9999999999999991, 3.7458282707567299, 9.6106915207640551],
      ["lrNegative", 0.11764705882352938, 0.06497244807877009, 0.21302614968496936],
      ["diagnosticOddsRatio", 51, 21.726361997126961, 119.71631515409484],
    ];
    for (const [key, est, lo, hi] of ref) {
      const v = r[key] as { estimate: number; lower: number; upper: number };
      expectRel(v.estimate, est, 1e-13);
      expectRel(v.lower, lo, 1e-12);
      expectRel(v.upper, hi, 1e-12);
    }
    const r90 = diagnostic2x2(90, 15, 10, 85, 0.9);
    expectRel(r90.lrPositive.lower, 4.0405703714272097, 1e-12);
    expectRel(r90.sensitivity.lower, 0.83964449038890787, 1e-12);
  });
  it("returns nulls where denominators are zero", () => {
    const noFp = diagnostic2x2(10, 0, 2, 20);
    expect(noFp.lrPositive).toEqual({ estimate: null, lower: null, upper: null });
    expect(noFp.diagnosticOddsRatio.estimate).toBeNull();
    expect(noFp.specificity.estimate).toBe(1);
    const noDisease = diagnostic2x2(0, 3, 0, 7);
    expect(noDisease.sensitivity).toEqual({ estimate: null, lower: null, upper: null });
    expect(noDisease.npv.estimate).toBe(1);
    const noTp = diagnostic2x2(0, 4, 6, 10);
    expect(noTp.lrPositive.estimate).toBe(0);
    expect(noTp.lrPositive.lower).toBeNull();
    expect(noTp.diagnosticOddsRatio.estimate).toBe(0);
    expect(noTp.diagnosticOddsRatio.lower).toBeNull();
    expectStatsError(() => diagnostic2x2(0, 0, 0, 0), "EMPTY_INPUT");
    expectStatsError(() => diagnostic2x2(1.5, 0, 0, 0), "INVALID_ARGUMENT");
  });
});

describe("postTestProbability", () => {
  it("applies Bayes via odds", () => {
    expectRel(postTestProbability(0.2, 6), 0.6, 1e-14);
    expectRel(postTestProbability(0.3, 0.1), 0.041095890410958909, 1e-14);
    expect(postTestProbability(0, 5)).toBe(0);
    expect(postTestProbability(1, 0.5)).toBe(1);
    expect(postTestProbability(0.4, 1)).toBeCloseTo(0.4, 15);
    expectStatsError(() => postTestProbability(1.2, 2), "INVALID_ARGUMENT");
    expectStatsError(() => postTestProbability(0.5, -1), "INVALID_ARGUMENT");
    expectStatsError(() => postTestProbability(1, 0), "INVALID_ARGUMENT");
  });
});
