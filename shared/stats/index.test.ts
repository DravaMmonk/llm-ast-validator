import { describe, expect, it } from "vitest";
import * as stats from "./index";

describe("index re-exports", () => {
  it("exposes every module's public API", () => {
    const required = [
      "StatsError",
      "logGamma", "regularizedGammaP", "regularizedGammaQ", "regularizedBeta", "normalPdf", "normalCdf", "normalQuantile",
      "studentTCdf", "studentTQuantile", "tTwoSidedP", "chiSquareCdf", "chiSquareSf", "fCdf", "fSf",
      "mean", "variance", "sd", "quantile", "median", "summarize", "histogram", "frequencies", "rank",
      "welchTTest", "studentTTest", "pairedTTest", "oneSampleTTest", "mannWhitneyU", "oneWayAnova", "kruskalWallis",
      "chiSquareTest", "fisherExact2x2", "pearson", "spearman", "oddsRatio2x2", "riskRatio2x2", "riskDifference2x2",
      "wilsonInterval",
      "transpose", "matMul", "solveSymmetricPositiveDefinite", "invert",
      "linearRegression", "logisticRegression",
      "kaplanMeier", "logRankTest", "coxRegression",
      "rocCurve", "aucDeLong", "confusionAt", "youdenOptimal", "diagnostic2x2", "postTestProbability",
      "sampleSizeTwoMeans", "powerTwoMeans", "sampleSizeTwoProportions", "powerTwoProportions",
      "sampleSizeOneProportion", "sampleSizeCorrelation", "powerCurve",
    ];
    for (const name of required) expect(typeof (stats as Record<string, unknown>)[name], name).toBe("function");
  });
  it("StatsError carries a code and is an Error", () => {
    const e = new stats.StatsError("SINGULAR_MATRIX", "boom");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(stats.StatsError);
    expect(e.code).toBe("SINGULAR_MATRIX");
    expect(e.name).toBe("StatsError");
  });
});
