import { describe, expect, it } from "vitest";
import {
  chiSquareTest,
  fisherExact2x2,
  kruskalWallis,
  mannWhitneyU,
  oddsRatio2x2,
  oneSampleTTest,
  oneWayAnova,
  pairedTTest,
  pearson,
  riskDifference2x2,
  riskRatio2x2,
  spearman,
  studentTTest,
  welchTTest,
  wilsonInterval,
} from "./tests";
import { expectAbs, expectRel, expectStatsError } from "./testHelpers";

// ToothGrowth$len split by supp (R datasets)
const OJ = [
  15.2, 21.5, 17.6, 9.7, 14.5, 10, 8.2, 9.4, 16.5, 9.7, 19.7, 23.3, 23.6, 26.4, 20, 25.2, 25.8, 21.2, 14.5, 27.3, 25.5,
  26.4, 22.4, 24.5, 24.8, 30.9, 26.4, 27.3, 29.4, 23,
];
const VC = [
  4.2, 11.5, 7.3, 5.8, 6.4, 10, 11.2, 11.2, 5.2, 7, 16.5, 16.5, 15.2, 17.3, 22.5, 17.3, 13.6, 14.5, 18.8, 15.5, 23.6,
  18.5, 33.9, 25.5, 26.4, 32.5, 26.7, 21.5, 23.3, 29.5,
];
// PlantGrowth$weight by group
const CTRL = [4.17, 5.58, 5.18, 6.11, 4.5, 4.61, 5.17, 4.53, 5.33, 5.14];
const TRT1 = [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69];
const TRT2 = [6.31, 5.12, 5.54, 5.5, 5.37, 5.29, 4.92, 6.15, 5.8, 5.26];
// mtcars$wt and mtcars$mpg
const WT = [
  2.62, 2.875, 2.32, 3.215, 3.44, 3.46, 3.57, 3.19, 3.15, 3.44, 3.44, 4.07, 3.73, 3.78, 5.25, 5.424, 5.345, 2.2, 1.615,
  1.835, 2.465, 3.52, 3.435, 3.84, 3.845, 1.935, 2.14, 1.513, 3.17, 2.77, 3.57, 2.78,
];
const MPG = [
  21, 21, 22.8, 21.4, 18.7, 18.1, 14.3, 24.4, 22.8, 19.2, 17.8, 16.4, 17.3, 15.2, 10.4, 10.4, 14.7, 32.4, 30.4, 33.9,
  21.5, 15.5, 15.2, 13.3, 19.2, 27.3, 26, 30.4, 15.8, 19.7, 15, 21.4,
];

describe("t-tests", () => {
  it("welchTTest matches R t.test(oj, vc)", () => {
    const r = welchTTest(OJ, VC);
    expectRel(r.statistic, 1.9152682686952678, 1e-12);
    expectRel(r.df, 55.309432682640583, 1e-12);
    expectRel(r.pValue, 0.060634507880934121, 1e-10);
    expectRel(r.ci.lower, -0.17101561836716414, 1e-10);
    expectRel(r.ci.upper, 7.571015618367162, 1e-11);
    expectRel(r.se, 1.9318442541318448, 1e-12);
    expectRel(r.meanDiff, 3.7, 1e-12);
    // (mean(oj) - mean(vc)) / pooled sd
    expectRel(r.cohensD, 0.4945201405450857, 1e-12);
    expect(r.method).toBe("Welch two-sample t-test");
    // t.test(oj, vc, conf.level = 0.9)$conf.int
    const r90 = welchTTest(OJ, VC, 0.9);
    expectRel(r90.ci.lower, 0.46826868985538356, 1e-10);
    expectRel(r90.ci.upper, 6.931731310144615, 1e-11);
  });
  it("welchTTest matches R on small unequal groups", () => {
    // t.test(c(5.1, 4.8, 6.0, 5.7, 6.3), c(4.2, 5.5, 3.9))
    const r = welchTTest([5.1, 4.8, 6.0, 5.7, 6.3], [4.2, 5.5, 3.9]);
    expectRel(r.statistic, 1.8545822539417702, 1e-12);
    expectRel(r.df, 3.3191367368787095, 1e-12);
    expectRel(r.pValue, 0.15177961157400996, 1e-10);
    expectRel(r.ci.lower, -0.6555522270484121, 1e-10);
    expectRel(r.ci.upper, 2.7488855603817459, 1e-10);
  });
  it("studentTTest matches R t.test(var.equal = TRUE)", () => {
    const r = studentTTest(OJ, VC);
    expectRel(r.statistic, 1.915268268695268, 1e-12);
    expect(r.df).toBe(58);
    expectRel(r.pValue, 0.060393371224128724, 1e-10);
    expectRel(r.ci.lower, -0.16700642014122588, 1e-10);
    expectRel(r.ci.upper, 7.5670064201412242, 1e-11);
    // t.test(3, c(4, 6), var.equal = TRUE): a single observation in one group is allowed
    const s = studentTTest([3], [4, 6]);
    expectRel(s.statistic, -1.1547005383792517, 1e-12);
    expect(s.df).toBe(1);
    expectRel(s.pValue, 0.45437105165700981, 1e-10);
    expectRel(s.ci.lower, -24.007792174426868, 1e-10);
  });
  it("pairedTTest matches R t.test(paired = TRUE)", () => {
    const r = pairedTTest(OJ, VC);
    expectRel(r.statistic, 3.3025850322158838, 1e-12);
    expect(r.df).toBe(29);
    expectRel(r.pValue, 0.0025498424133060613, 1e-10);
    expectRel(r.ci.lower, 1.4086586410119899, 1e-11);
    expectRel(r.ci.upper, 5.9913413589880093, 1e-11);
    expectRel(r.cohensD, 0.60296677340785521, 1e-12);
  });
  it("oneSampleTTest matches R t.test(oj, mu = 18)", () => {
    const r = oneSampleTTest(OJ, 18);
    expectRel(r.statistic, 2.2083934034390702, 1e-12);
    expectRel(r.pValue, 0.035276484912485688, 1e-10);
    expectRel(r.ci.lower, 18.196776300636728, 1e-12);
    expectRel(r.ci.upper, 23.12989036602994, 1e-12);
  });
  it("throws on degenerate input", () => {
    expectStatsError(() => welchTTest([1], [2, 3]), "INSUFFICIENT_DATA");
    expectStatsError(() => welchTTest([2, 2, 2], [5, 5]), "ZERO_VARIANCE");
    expectStatsError(() => studentTTest([1], [2]), "INSUFFICIENT_DATA");
    expectStatsError(() => pairedTTest([1, 2, 3], [1, 2]), "LENGTH_MISMATCH");
    expectStatsError(() => pairedTTest([1, 2, 3], [0, 1, 2]), "ZERO_VARIANCE");
    expectStatsError(() => oneSampleTTest([4], 0), "INSUFFICIENT_DATA");
    expectStatsError(() => welchTTest([1, 2, Number.NaN], [1, 2]), "NON_FINITE");
    expectStatsError(() => welchTTest([1, 2, 3], [1, 2], 1.2), "INVALID_ARGUMENT");
  });
});

describe("mannWhitneyU", () => {
  it("matches R wilcox.test(exact = FALSE, correct = TRUE) with ties", () => {
    const r = mannWhitneyU(OJ, VC);
    expect(r.statistic).toBe(575.5);
    expectRel(r.pValue, 0.064490672133835691, 1e-10);
    expectRel(r.rankBiserial, (2 * 575.5) / 900 - 1, 1e-14);
    // x1 <- c(1.1, 2.2, 2.2, 3.5, 4, 4, 4); y1 <- c(2.2, 3, 4, 5.5, 6.1)
    const r2 = mannWhitneyU([1.1, 2.2, 2.2, 3.5, 4.0, 4.0, 4.0], [2.2, 3.0, 4.0, 5.5, 6.1]);
    expect(r2.statistic).toBe(10.5);
    expectRel(r2.pValue, 0.27906479661807765, 1e-10);
    expect(r2.rankBiserial).toBeLessThan(0);
  });
  it("handles tiny samples and all-tied data", () => {
    // wilcox.test(c(1, 2), 3, exact = FALSE)
    const r = mannWhitneyU([1, 2], [3]);
    expect(r.statistic).toBe(0);
    expectRel(r.pValue, 0.54029137460742005, 1e-10);
    expect(r.rankBiserial).toBe(-1);
    expectStatsError(() => mannWhitneyU([2, 2], [2, 2, 2]), "ZERO_VARIANCE");
    expectStatsError(() => mannWhitneyU([], [1]), "INSUFFICIENT_DATA");
  });
});

describe("oneWayAnova", () => {
  it("matches R summary(aov(weight ~ group, PlantGrowth))", () => {
    const r = oneWayAnova([CTRL, TRT1, TRT2]);
    expectRel(r.statistic, 4.8460878623801351, 1e-12);
    expect([r.df1, r.df2]).toEqual([2, 27]);
    expectRel(r.pValue, 0.015909958325622937, 1e-10);
    expectRel(r.ssBetween, 3.7663399999999991, 1e-12);
    expectRel(r.ssWithin, 10.492089999999999, 1e-12);
    expectRel(r.etaSquared, 3.76634 / (3.76634 + 10.49209), 1e-11);
  });
  it("throws on degenerate input", () => {
    expectStatsError(() => oneWayAnova([[1, 2, 3]]), "INSUFFICIENT_DATA");
    expectStatsError(() => oneWayAnova([[1], [2]]), "INSUFFICIENT_DATA");
    expectStatsError(() => oneWayAnova([[1, 2], []]), "INSUFFICIENT_DATA");
    expectStatsError(() => oneWayAnova([[1, 1], [2, 2]]), "ZERO_VARIANCE");
  });
});

describe("kruskalWallis", () => {
  it("matches R kruskal.test(weight ~ group, PlantGrowth)", () => {
    const r = kruskalWallis([CTRL, TRT1, TRT2]);
    expectRel(r.statistic, 7.9882287494437154, 1e-12);
    expect(r.df).toBe(2);
    expectRel(r.pValue, 0.01842375573147197, 1e-10);
  });
  it("applies the tie correction like R", () => {
    // kruskal.test(list(c(1,1,2,3), c(2,2,4), c(3,5,5,5,6)))
    const r = kruskalWallis([
      [1, 1, 2, 3],
      [2, 2, 4],
      [3, 5, 5, 5, 6],
    ]);
    expectRel(r.statistic, 7.5203200483091779, 1e-12);
    expectRel(r.pValue, 0.023280014712133808, 1e-10);
  });
  it("throws on degenerate input", () => {
    expectStatsError(() => kruskalWallis([[1, 2]]), "INSUFFICIENT_DATA");
    expectStatsError(() => kruskalWallis([[3, 3], [3]]), "ZERO_VARIANCE");
  });
});

describe("chiSquareTest", () => {
  it("matches R chisq.test on a 2x3 table (no Yates for non-2x2)", () => {
    // chisq.test(matrix(c(12,5,9,7,3,14), nrow = 2, byrow = TRUE))
    const r = chiSquareTest([
      [12, 5, 9],
      [7, 3, 14],
    ]);
    expectRel(r.statistic, 2.8272696268262631, 1e-12);
    expect(r.df).toBe(2);
    expectRel(r.pValue, 0.24325747871529235, 1e-10);
    expect(r.yatesApplied).toBe(false);
    expect(r.lowExpectedWarning).toBe(true); // expected 3.84 and 4.16
    const exp = [9.88, 4.16, 11.96, 9.12, 3.84, 11.04];
    r.expected.flat().forEach((e, i) => expectRel(e, exp[i], 1e-12));
    expectRel(r.cramersV, 0.23779275122788177, 1e-12);
  });
  it("applies Yates only to 2x2 tables, matching correct = TRUE / FALSE", () => {
    const table = [
      [15, 5],
      [8, 12],
    ];
    const y = chiSquareTest(table);
    expect(y.yatesApplied).toBe(true);
    expectRel(y.statistic, 3.6828644501278776, 1e-12);
    expectRel(y.pValue, 0.054974328721694471, 1e-10);
    const n = chiSquareTest(table, { yates: false });
    expectRel(n.statistic, 5.0127877237851663, 1e-12);
    expectRel(n.pValue, 0.025160759200408805, 1e-10);
    expect(n.lowExpectedWarning).toBe(false);
  });
  it("uses R's min(0.5, |O - E|) Yates rule", () => {
    // chisq.test(matrix(c(10, 10, 10, 10.2), 2, byrow = TRUE)): statistic ~ 6.3e-31
    const r = chiSquareTest([
      [10, 10],
      [10, 10.2],
    ]);
    expectAbs(r.statistic, 0, 1e-20);
    expectRel(r.pValue, 1, 1e-12);
  });
  it("rejects invalid tables", () => {
    expectStatsError(() => chiSquareTest([[1, 2]]), "INSUFFICIENT_DATA");
    expectStatsError(() => chiSquareTest([[1, 2], [3]]), "LENGTH_MISMATCH");
    expectStatsError(() => chiSquareTest([[0, 0], [3, 4]]), "INVALID_ARGUMENT");
    expectStatsError(() => chiSquareTest([[-1, 2], [3, 4]]), "INVALID_ARGUMENT");
  });
});

describe("fisherExact2x2", () => {
  // p-values: R fisher.test(); conditional MLE / CI: R fisher.test internals re-run with uniroot(tol = 1e-15)
  // (R's default uniroot tolerance only gives ~4 significant digits).
  it("matches R on a balanced small table", () => {
    const r = fisherExact2x2(3, 1, 1, 3);
    expectRel(r.pValue, 0.4857142857142856, 1e-10);
    expectRel(r.oddsRatio, 6.4083196581996642, 1e-8);
    expectRel(r.ci.lower, 0.21173559544657861, 1e-8);
    expectRel(r.ci.upper, 626.24353058881309, 1e-8);
    expect(r.sampleOddsRatio).toBe(9);
  });
  it("matches R on an asymmetric table", () => {
    const r = fisherExact2x2(10, 2, 3, 15);
    expectRel(r.pValue, 0.00053672411914343593, 1e-9);
    expectRel(r.oddsRatio, 21.305317556750339, 1e-8);
    expectRel(r.ci.lower, 2.7533827882493229, 1e-8);
    expectRel(r.ci.upper, 301.46233797151723, 1e-8);
    const r5 = fisherExact2x2(25, 30, 40, 20);
    expectRel(r5.pValue, 0.025138593431581969, 1e-9);
    expectRel(r5.oddsRatio, 0.41995674007474509, 1e-8);
    expectRel(r5.ci.lower, 0.1825949513573909, 1e-8);
    expectRel(r5.ci.upper, 0.94612213704814729, 1e-8);
  });
  it("handles zero cells (boundary MLE)", () => {
    const r = fisherExact2x2(0, 5, 6, 4);
    expectRel(r.pValue, 0.043956043956043932, 1e-10);
    expect(r.oddsRatio).toBe(0);
    expect(r.ci.lower).toBe(0);
    expectRel(r.ci.upper, 1.2787375244879904, 1e-8);
    expect(r.sampleOddsRatio).toBe(0);
    const r4 = fisherExact2x2(7, 12, 0, 9);
    expectRel(r4.pValue, 0.062131346913955561, 1e-10);
    expect(r4.oddsRatio).toBe(Infinity);
    expectRel(r4.ci.lower, 0.80002809636555139, 1e-8);
    expect(r4.ci.upper).toBe(Infinity);
    expect(r4.sampleOddsRatio).toBe(Infinity);
    expect(fisherExact2x2(0, 3, 0, 4).sampleOddsRatio).toBeNull();
    // fisher.test(matrix(c(0,0,3,4), 2, byrow = TRUE)): p = 1 (R reports estimate 0, CI [0, Inf])
    const empty = fisherExact2x2(0, 0, 3, 4);
    expect(empty.pValue).toBe(1);
    expect(empty.oddsRatio).toBeNull();
    expect([empty.ci.lower, empty.ci.upper]).toEqual([0, Infinity]);
  });
  it("rejects non-integer counts", () => {
    expectStatsError(() => fisherExact2x2(1.5, 2, 3, 4), "INVALID_ARGUMENT");
    expectStatsError(() => fisherExact2x2(-1, 2, 3, 4), "INVALID_ARGUMENT");
  });
});

describe("correlation", () => {
  it("pearson matches R cor.test(wt, mpg)", () => {
    const r = pearson(WT, MPG);
    expectRel(r.r, -0.86765937651722791, 1e-13);
    expectRel(r.t, -9.5590441469721181, 1e-12);
    expect(r.df).toBe(30);
    expectRel(r.pValue, 1.293958701350493e-10, 1e-9);
    expectRel(r.ci?.lower, -0.93382641328499416, 1e-12);
    expectRel(r.ci?.upper, -0.7440871964601129, 1e-12);
    const r90 = pearson(WT, MPG, 0.9);
    expectRel(r90.ci?.lower, -0.92591514988401946, 1e-12);
    expectRel(r90.ci?.upper, -0.76908720785974949, 1e-12);
  });
  it("pearson small n: CI only from n = 4", () => {
    const r4 = pearson([1, 2, 3, 4], [1.5, 1.9, 3.7, 3.6]);
    expectRel(r4.r, 0.91861772294046307, 1e-13);
    expectRel(r4.pValue, 0.081382277059536948, 1e-10);
    expectRel(r4.ci?.lower, -0.36258814710610193, 1e-11);
    expectRel(r4.ci?.upper, 0.99831808935761868, 1e-12);
    const r3 = pearson([1, 2, 3], [1, 3, 2]);
    expectRel(r3.pValue, 0.66666666666666674, 1e-10);
    expect(r3.ci).toBeNull();
  });
  it("pearson handles perfect and degenerate correlation", () => {
    const perfect = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
    expect(perfect.r).toBe(1);
    expect(perfect.pValue).toBe(0);
    expect(perfect.ci?.upper).toBe(1);
    expectStatsError(() => pearson([1, 2, 3], [5, 5, 5]), "ZERO_VARIANCE");
    expectStatsError(() => pearson([1, 2], [1, 2]), "INSUFFICIENT_DATA");
    expectStatsError(() => pearson([1, 2, 3], [1, 2]), "LENGTH_MISMATCH");
  });
  it("spearman matches R cor.test(method = 'spearman', exact = FALSE)", () => {
    const r = spearman(WT, MPG); // ties present
    expectRel(r.rho, -0.88642203327029778, 1e-13);
    expectRel(r.statistic, 10292.318613522744, 1e-12);
    expectRel(r.pValue, 1.4875948581275344e-11, 1e-9);
    const r2 = spearman([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5]);
    expectRel(r2.rho, 0.82857142857142851, 1e-13);
    expectRel(r2.pValue, 0.041562682215743448, 1e-10);
    expectStatsError(() => spearman([1, 2, 3], [4, 4, 4]), "ZERO_VARIANCE");
  });
});

describe("2x2 effect measures", () => {
  it("oddsRatio2x2 uses Woolf CI", () => {
    const r = oddsRatio2x2(20, 80, 10, 90);
    expectRel(r.oddsRatio, 2.25, 1e-14);
    expectRel(r.se, 0.41666666666666669, 1e-14);
    expectRel(r.ci.lower, 0.99429489228150669, 1e-12);
    expectRel(r.ci.upper, 5.0915478288172631, 1e-12);
    expectRel(r.pValue, 0.051626815347268103, 1e-10);
    expect(r.corrected).toBe(false);
    const r90 = oddsRatio2x2(20, 80, 10, 90, 0.9);
    expectRel(r90.ci.lower, 1.1337996773339629, 1e-12);
    expectRel(r90.ci.upper, 4.465074475858076, 1e-12);
  });
  it("oddsRatio2x2 applies Haldane–Anscombe only with a zero cell", () => {
    const r = oddsRatio2x2(0, 15, 6, 9);
    expect(r.corrected).toBe(true);
    expectRel(r.oddsRatio, 0.04714640198511167, 1e-12);
    expectRel(r.se, 1.5243442658314257, 1e-12);
    expectRel(r.ci.lower, 0.0023764263725606894, 1e-11);
    expectRel(r.ci.upper, 0.93534697552889412, 1e-11);
    expectStatsError(() => oddsRatio2x2(0, 0, 3, 4), "INVALID_ARGUMENT");
    expectStatsError(() => oddsRatio2x2(0, 5, 0, 4), "INVALID_ARGUMENT");
  });
  it("riskRatio2x2 and riskDifference2x2", () => {
    const rr = riskRatio2x2(20, 80, 10, 90);
    expectRel(rr.riskRatio, 2, 1e-14);
    expectRel(rr.se, 0.36055512754639896, 1e-13);
    expectRel(rr.ci.lower, 0.98656320673178233, 1e-12);
    expectRel(rr.ci.upper, 4.0544791988046267, 1e-12);
    const rr0 = riskRatio2x2(0, 15, 6, 9);
    expect(rr0.corrected).toBe(true);
    expectRel(rr0.riskRatio, 0.076923076923076927, 1e-12);
    expectRel(rr0.ci.lower, 0.0047165652618169568, 1e-11);
    expectRel(rr0.ci.upper, 1.2545484764551205, 1e-11);
    expect(riskRatio2x2(5, 0, 3, 7).corrected).toBe(false);
    const rd = riskDifference2x2(20, 80, 10, 90);
    expectRel(rd.riskDifference, 0.1, 1e-14);
    expectRel(rd.se, 0.05, 1e-14);
    expectRel(rd.ci.lower, 0.0020018007729973308, 1e-10);
    expectRel(rd.ci.upper, 0.19799819922700268, 1e-12);
    const degenerate = riskDifference2x2(0, 10, 0, 10);
    expect(degenerate.ci.lower).toBe(0);
    expect(degenerate.ci.upper).toBe(0);
    expectStatsError(() => riskRatio2x2(0, 0, 1, 2), "INVALID_ARGUMENT");
  });
  it("wilsonInterval matches prop.test(correct = FALSE)", () => {
    const ref: [number, number, number, number, number][] = [
      [7, 20, 0.95, 0.18119182410108212, 0.56714572331476365],
      [0, 10, 0.95, 0, 0.27753279986288903],
      [10, 10, 0.95, 0.72246720013711085, 1],
      [1, 1000, 0.99, 0.00011741635361832181, 0.0084605662199816918],
      [55, 100, 0.95, 0.45244602997442135, 0.64385462020488016],
    ];
    for (const [x, n, conf, lo, hi] of ref) {
      const w = wilsonInterval(x, n, conf);
      expectRel(w.estimate, x / n, 1e-15);
      if (lo === 0) expect(w.lower).toBe(0);
      else expectRel(w.lower, lo, 1e-12);
      expectRel(w.upper, hi, 1e-12);
    }
    expectStatsError(() => wilsonInterval(3, 2), "INVALID_ARGUMENT");
    expectStatsError(() => wilsonInterval(0, 0), "INVALID_ARGUMENT");
  });
});
