import { describe, expect, it } from "vitest";
import { linearRegression, logisticRegression } from "./regression";
import { expectAbs, expectRel, expectStatsError } from "./testHelpers";

// mtcars columns (R datasets)
const MPG = [
  21, 21, 22.8, 21.4, 18.7, 18.1, 14.3, 24.4, 22.8, 19.2, 17.8, 16.4, 17.3, 15.2, 10.4, 10.4, 14.7, 32.4, 30.4, 33.9,
  21.5, 15.5, 15.2, 13.3, 19.2, 27.3, 26, 30.4, 15.8, 19.7, 15, 21.4,
];
const WT = [
  2.62, 2.875, 2.32, 3.215, 3.44, 3.46, 3.57, 3.19, 3.15, 3.44, 3.44, 4.07, 3.73, 3.78, 5.25, 5.424, 5.345, 2.2, 1.615,
  1.835, 2.465, 3.52, 3.435, 3.84, 3.845, 1.935, 2.14, 1.513, 3.17, 2.77, 3.57, 2.78,
];
const HP = [
  110, 110, 93, 110, 175, 105, 245, 62, 95, 123, 123, 180, 180, 180, 205, 215, 230, 66, 52, 65, 97, 150, 150, 245, 175, 66,
  91, 113, 264, 175, 335, 109,
];
const AM = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
const VS = [0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1];

const X_WT_HP = WT.map((w, i) => [w, HP[i]]);

describe("linearRegression", () => {
  it("matches R summary(lm(mpg ~ wt + hp, mtcars)) and confint", () => {
    const r = linearRegression(X_WT_HP, MPG, ["wt", "hp"]);
    const ref = [
      ["(Intercept)", 37.227270116447201, 1.5987875379993937, 23.284688697930868, 2.5654585119837213e-20, 33.957382452258472, 40.497157780635931],
      ["wt", -3.8778307424046821, 0.63273349437739523, -6.1286952198104148, 1.1196471362000361e-6, -5.1719160406755371, -2.583745444133827],
      ["hp", -0.031772946982160995, 0.009029709675855719, -3.5187119102087814, 0.0014512285315694212, -0.050240776871073603, -0.01330511709324839],
    ] as const;
    ref.forEach(([name, est, se, t, p, lo, hi], j) => {
      const c = r.coefficients[j];
      expect(c.name).toBe(name);
      expectRel(c.estimate, est, 1e-10);
      expectRel(c.se, se, 1e-10);
      expectRel(c.t, t, 1e-10);
      expectRel(c.p, p, 1e-8);
      expectRel(c.ciLower, lo, 1e-10);
      expectRel(c.ciUpper, hi, 1e-10);
    });
    expectRel(r.rSquared, 0.82678545188279118, 1e-12);
    expectRel(r.adjRSquared, 0.8148396209781561, 1e-12);
    expectRel(r.fStatistic, 69.21121339177769, 1e-10);
    expect([r.fDf1, r.fDf2, r.df, r.n]).toEqual([2, 29, 29, 32]);
    expectRel(r.fPValue, 9.1090543852220241e-12, 1e-8);
    expectRel(r.residualSe, 2.5934117772265664, 1e-12);
  });
  it("supports other confidence levels (confint(level = 0.9))", () => {
    const r = linearRegression(X_WT_HP, MPG, ["wt", "hp"], 0.9);
    const ref = [34.510727000947483, 39.943813231946919, -4.9529253232942949, -2.8027361615150692, -0.04711557073415848, -0.016430323230163517];
    r.coefficients.forEach((c, j) => {
      expectRel(c.ciLower, ref[2 * j], 1e-10);
      expectRel(c.ciUpper, ref[2 * j + 1], 1e-10);
    });
  });
  it("fits an intercept-only model (no F test)", () => {
    // summary(lm(mpg ~ 1, mtcars))
    const r = linearRegression(MPG.map(() => []), MPG, []);
    expectRel(r.coefficients[0].estimate, 20.090624999999996, 1e-13);
    expectRel(r.coefficients[0].se, 1.0654239593728145, 1e-12);
    expectRel(r.coefficients[0].ciLower, 17.917678508746238, 1e-12);
    expect(r.fStatistic).toBeNull();
    expect(r.fPValue).toBeNull();
    expect(r.rSquared).toBe(0);
  });
  it("matches R on a small simple regression", () => {
    // x1 <- 1:6; y1 <- c(2.1, 3.9, 6.2, 7.8, 10.1, 12.2); summary(lm(y1 ~ x1))
    const r = linearRegression([[1], [2], [3], [4], [5], [6]], [2.1, 3.9, 6.2, 7.8, 10.1, 12.2], ["x1"]);
    expectAbs(r.coefficients[0].estimate, -0.020000000000000503, 1e-12);
    expectRel(r.coefficients[0].se, 0.16653327995729061, 1e-10);
    expectRel(r.coefficients[0].p, 0.91019754203271896, 1e-8);
    expectRel(r.coefficients[1].estimate, 2.02, 1e-12);
    expectRel(r.coefficients[1].p, 1.2013602560215721e-6, 1e-8);
    expectRel(r.rSquared, 0.99821066610749987, 1e-12);
    expectRel(r.fStatistic, 2231.4687500000018, 1e-10);
    expectRel(r.residualSe, 0.17888543819998309, 1e-12);
  });
  it("throws on singular designs and degenerate data", () => {
    const dup = WT.map((w, i) => [w, HP[i], w]);
    expectStatsError(() => linearRegression(dup, MPG, ["wt", "hp", "wt2"]), "SINGULAR_MATRIX");
    const constant = WT.map(() => [5]);
    expectStatsError(() => linearRegression(constant, MPG, ["c"]), "SINGULAR_MATRIX");
    expectStatsError(() => linearRegression([[1], [2]], [1, 2], ["x"]), "INSUFFICIENT_DATA");
    expectStatsError(() => linearRegression([[1], [2], [3]], [4, 4, 4], ["x"]), "ZERO_VARIANCE");
    expectStatsError(() => linearRegression([[1], [2], [3], [4]], [3, 5, 7, 9], ["x"]), "PERFECT_FIT");
    expectStatsError(() => linearRegression([[1], [2]], [1, 2, 3], ["x"]), "LENGTH_MISMATCH");
    expectStatsError(() => linearRegression([[1, 2], [2, 3], [3, 1]], [1, 2, 3], ["x"]), "LENGTH_MISMATCH");
    expectStatsError(() => linearRegression([[1], [Number.NaN], [3]], [1, 2, 3], ["x"]), "NON_FINITE");
  });
});

describe("logisticRegression", () => {
  // R: glm(am ~ wt + hp, mtcars, family = binomial, control = glm.control(epsilon = 1e-14)); exp(confint.default(g))
  it("matches R glm(am ~ wt + hp, binomial)", () => {
    const r = logisticRegression(X_WT_HP, AM, ["wt", "hp"]);
    const ref = [
      ["(Intercept)", 18.866298717204121, 7.4435580602052864, 2.5345807159168992, 0.011258198716613719, 156145483.50632393, 72.037945596981373, 338452350596257.19],
      ["wt", -8.0834751824446318, 3.0686751130547023, -2.6341906147236172, 0.00843381259970713, 0.00030859673984047443, 7.5392881418835071e-7, 0.12631424353066054],
      ["hp", 0.036255596082216505, 0.017734153650769361, 2.0443939302760934, 0.040914646459030327, 1.0369208455288088, 1.0014984151341872, 1.0735961471772446],
    ] as const;
    ref.forEach(([name, est, se, z, p, or, lo, hi], j) => {
      const c = r.coefficients[j];
      expect(c.name).toBe(name);
      expectRel(c.estimate, est, 1e-6);
      expectRel(c.se, se, 1e-6);
      expectRel(c.z, z, 1e-6);
      expectRel(c.p, p, 1e-5);
      expectRel(c.oddsRatio, or, 1e-5);
      expectRel(c.orLower, lo, 1e-5);
      expectRel(c.orUpper, hi, 1e-5);
    });
    expectRel(r.logLik, -5.029555236133497, 1e-8);
    expectRel(r.deviance, 10.059110472266989, 1e-8);
    expectRel(r.nullDeviance, 43.229733276857807, 1e-12);
    expectRel(r.aic, 16.059110472266994, 1e-8);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(12);
    expect(r.events).toBe(13);
    expect(r.n).toBe(32);
    expect(r.separationWarning).toBe(false);
  });
  it("matches R glm(vs ~ mpg, binomial)", () => {
    const r = logisticRegression(
      MPG.map((m) => [m]),
      VS,
      ["mpg"],
    );
    const ref = [
      [-8.8330725767920608, 3.1622740911938938, -2.7932659605281711, 0.0052178771610810097, 2.9656011071408703e-7, 0.071709700416306879],
      [0.43041352026265872, 0.15842196958701846, 2.7168802495302899, 0.0065900446676920941, 1.1273978228200581, 2.0978539109383534],
    ];
    ref.forEach(([est, se, z, p, lo, hi], j) => {
      const c = r.coefficients[j];
      expectRel(c.estimate, est, 1e-6);
      expectRel(c.se, se, 1e-6);
      expectRel(c.z, z, 1e-6);
      expectRel(c.p, p, 1e-5);
      expectRel(c.orLower, lo, 1e-5);
      expectRel(c.orUpper, hi, 1e-5);
    });
    expectRel(r.logLik, -12.766667576546514, 1e-8);
    expectRel(r.nullDeviance, 43.860109265693332, 1e-12);
    expectRel(r.aic, 29.533335153093027, 1e-8);
  });
  it("flags complete separation without throwing", () => {
    const r = logisticRegression([[1], [2], [3], [4], [5], [6]], [0, 0, 0, 1, 1, 1], ["x"]);
    expect(r.separationWarning).toBe(true);
    expect(r.deviance).toBeLessThan(1e-6);
    for (const c of r.coefficients) {
      expect(Number.isNaN(c.estimate)).toBe(false);
      expect(Number.isNaN(c.se)).toBe(false);
    }
  });
  it("flags quasi-complete separation", () => {
    const r = logisticRegression([[1], [2], [3], [3], [4], [5], [6]], [0, 0, 0, 1, 1, 1, 1], ["x"]);
    expect(r.separationWarning).toBe(true);
  });
  it("flags separation by a binary predictor (a zero cell)", () => {
    // Every exposed subject had the event.
    const x = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
    const y = [1, 1, 1, 1, 1, 0, 0, 1, 0, 0];
    const r = logisticRegression(
      x.map((v) => [v]),
      y,
      ["exposed"],
    );
    expect(r.separationWarning).toBe(true);
    expect(r.coefficients[1].estimate).toBeGreaterThan(10);
  });
  it("throws on singular designs and degenerate outcomes", () => {
    const dup = WT.map((w, i) => [w, HP[i], w * 2]);
    expectStatsError(() => logisticRegression(dup, AM, ["wt", "hp", "wt2"]), "SINGULAR_MATRIX");
    expectStatsError(() => logisticRegression([[1], [2], [3]], [1, 1, 1], ["x"]), "ZERO_VARIANCE");
    expectStatsError(() => logisticRegression([[1], [2], [3]], [0, 2, 1], ["x"]), "INVALID_ARGUMENT");
    expectStatsError(() => logisticRegression([[1], [2]], [0, 1], ["x"]), "INSUFFICIENT_DATA");
  });
});
