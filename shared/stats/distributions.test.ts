import { describe, expect, it } from "vitest";
import {
  chiSquareCdf,
  chiSquareSf,
  fCdf,
  fSf,
  logGamma,
  noncentralTCdf,
  normalCdf,
  normalPdf,
  normalQuantile,
  normalSf,
  regularizedBeta,
  regularizedGammaP,
  regularizedGammaQ,
  studentTCdf,
  studentTQuantile,
  tTwoSidedP,
} from "./distributions";
import { expectAbs, expectRel, expectStatsError } from "./testHelpers";

// Reference values: R 4.5.1, printed with sprintf("%.17g").

describe("logGamma", () => {
  // lgamma(c(0.1, 0.5, 1, 1.5, 2, 3.7, 9.99, 10, 25.3, 171.5, 1e5, -0.5, -2.5))
  const xs = [0.1, 0.5, 1, 1.5, 2, 3.7, 9.99, 10, 25.3, 171.5, 1e5, -0.5, -2.5];
  const ref = [
    2.252712651734206, 0.57236494292470008, 0, -0.12078223763524518, 0, 1.4280723266653881,
    12.779315214350193, 12.801827480081469, 55.746181183584589, 709.14316303092835, 1051287.7089736569,
    1.2655121234846454, -0.056243716497674033,
  ];
  it("matches R lgamma", () => {
    xs.forEach((x, i) => {
      if (ref[i] === 0) expectAbs(logGamma(x), 0, 1e-14);
      else expectRel(logGamma(x), ref[i], 1e-13);
    });
  });
  it("throws at poles", () => {
    expectStatsError(() => logGamma(0), "INVALID_ARGUMENT");
    expectStatsError(() => logGamma(-3), "INVALID_ARGUMENT");
    expectStatsError(() => logGamma(Number.NaN), "INVALID_ARGUMENT");
  });
});

describe("incomplete gamma", () => {
  it("matches R pgamma", () => {
    // pgamma(0.5,0.5), pgamma(3,2.5), pgamma(10,3), pgamma(50,100), pgamma(150,100), pgamma(1e-3,2)
    expectRel(regularizedGammaP(0.5, 0.5), 0.68268949213708596, 1e-13);
    expectRel(regularizedGammaP(2.5, 3), 0.69378108158672158, 1e-13);
    expectRel(regularizedGammaP(3, 10), 0.9972306042844884, 1e-13);
    expectRel(regularizedGammaP(100, 50), 3.2000653245851258e-10, 1e-11);
    expectRel(regularizedGammaP(100, 150), 0.99999407545966457, 1e-13);
    expectRel(regularizedGammaP(2, 1e-3), 4.9966679163334028e-7, 1e-12);
  });
  it("upper tail keeps relative accuracy", () => {
    // pgamma(30,3,lower=FALSE), pgamma(300,100,lower=FALSE)
    expectRel(regularizedGammaQ(3, 30), 4.5010166480121245e-11, 1e-12);
    expectRel(regularizedGammaQ(100, 300), 1.4110215102111522e-41, 1e-10);
    expectRel(regularizedGammaQ(2.5, 3) + regularizedGammaP(2.5, 3), 1, 1e-15);
  });
  it("handles boundaries and domain errors", () => {
    expect(regularizedGammaP(2, 0)).toBe(0);
    expect(regularizedGammaQ(2, 0)).toBe(1);
    expectStatsError(() => regularizedGammaP(0, 1), "INVALID_ARGUMENT");
    expectStatsError(() => regularizedGammaP(1, -1), "INVALID_ARGUMENT");
  });
});

describe("regularizedBeta", () => {
  it("matches R pbeta", () => {
    // pbeta(0.3,2,5), pbeta(0.9,.5,.5), pbeta(0.999,30,2), pbeta(1e-4,.7,12), pbeta(.5,200,300), pbeta(.2,1,1)
    expectRel(regularizedBeta(0.3, 2, 5), 0.57982500000000015, 1e-13);
    expectRel(regularizedBeta(0.9, 0.5, 0.5), 0.79516723530086664, 1e-13);
    expectRel(regularizedBeta(0.999, 30, 2), 0.99954389628097839, 1e-13);
    expectRel(regularizedBeta(1e-4, 0.7, 12), 0.0098414902576267928, 1e-12);
    expectRel(regularizedBeta(0.5, 200, 300), 0.99999645651973568, 1e-13);
    expectRel(regularizedBeta(0.2, 1, 1), 0.2, 1e-14);
  });
  it("handles boundaries and domain errors", () => {
    expect(regularizedBeta(0, 2, 3)).toBe(0);
    expect(regularizedBeta(1, 2, 3)).toBe(1);
    expectStatsError(() => regularizedBeta(1.2, 2, 3), "INVALID_ARGUMENT");
    expectStatsError(() => regularizedBeta(0.5, 0, 3), "INVALID_ARGUMENT");
  });
});

describe("normal distribution", () => {
  it("pdf matches dnorm", () => {
    expectRel(normalPdf(0), 0.3989422804014327, 1e-15);
    expectRel(normalPdf(1.5), 0.12951759566589174, 1e-14);
    expectRel(normalPdf(-3), 0.0044318484119380075, 1e-14);
    expectRel(normalPdf(10), 7.6945986267064199e-23, 1e-13);
  });
  it("cdf matches pnorm including far tails", () => {
    const zs = [-38, -20, -8.5, -5.7, -3, -1.96, -0.5, 0, 0.3, 0.67448975, 0.7, 2.5, 6];
    const ref = [
      2.8854283510039645e-316, 2.7536241186062337e-89, 9.4795348222033192e-18, 5.9903714010635279e-9,
      0.0013498980316300946, 0.024997895148220428, 0.30853753872598694, 0.5, 0.61791142218895267,
      0.74999999993768973, 0.75803634777692697, 0.99379033467422384, 0.9999999990134123,
    ];
    zs.forEach((z, i) => expectRel(normalCdf(z), ref[i], i === 0 ? 1e-9 : 1e-14));
    expect(normalCdf(-40)).toBe(0);
    expect(normalCdf(9)).toBe(1);
  });
  it("survival function keeps upper-tail precision", () => {
    // pnorm(c(5, 8, 12, 30), lower=FALSE)
    expectRel(normalSf(5), 2.8665157187919391e-7, 1e-14);
    expectRel(normalSf(8), 6.2209605742717849e-16, 1e-14);
    expectRel(normalSf(12), 1.776482112077679e-33, 1e-13);
    expectRel(normalSf(30), 4.9067139271481872e-198, 1e-12);
  });
  it("quantile matches qnorm", () => {
    const ps = [1e-300, 1e-20, 1e-10, 1e-5, 0.001, 0.025, 0.1, 0.3, 0.5, 0.6, 0.8, 0.975, 0.999, 1 - 1e-10];
    const ref = [
      -37.047096299361201, -9.262340089798407, -6.3613409024040566, -4.2648907939228247, -3.0902323061678132,
      -1.9599639845400538, -1.2815515655446006, -0.52440051270804078, 0, 0.25334710313579978,
      0.84162123357291441, 1.9599639845400534, 3.0902323061678132, 6.3613408896974226,
    ];
    ps.forEach((p, i) => expectRel(normalQuantile(p), ref[i], 1e-14));
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expectStatsError(() => normalQuantile(1.5), "INVALID_ARGUMENT");
  });
  it("quantile inverts cdf", () => {
    for (const p of [1e-12, 0.0123, 0.4, 0.77, 0.9999]) expectRel(normalCdf(normalQuantile(p)), p, 1e-13);
  });
});

describe("Student t", () => {
  it("cdf matches pt", () => {
    expectRel(studentTCdf(2.1, 5), 0.95512337505770062, 1e-13);
    expectRel(studentTCdf(-2.1, 5), 0.04487662494229934, 1e-13);
    expectRel(studentTCdf(0.3, 1), 0.59277357907774231, 1e-13);
    expectRel(studentTCdf(-3, 2), 0.047732983133354563, 1e-13);
    expectRel(studentTCdf(1.7, 12.34), 0.94291161634107945, 1e-13);
    expectRel(studentTCdf(-12, 30), 2.7900927075996303e-13, 1e-11);
    expectRel(studentTCdf(4, 1000), 0.99996599504039563, 1e-13);
    expectRel(studentTCdf(-50, 3), 8.808576020635991e-6, 1e-12);
    expect(studentTCdf(0, 7)).toBe(0.5);
  });
  it("two-sided p-values match 2*pt(-|t|, df)", () => {
    expectRel(tTwoSidedP(2.1, 5), 0.089753249884598679, 1e-13);
    expectRel(tTwoSidedP(-8, 40), 7.9050841101045172e-10, 1e-11);
    expectRel(tTwoSidedP(0.01, 7), 0.99230031764362181, 1e-13);
  });
  it("quantile matches qt", () => {
    // qt(0.975, c(1,2,3,10)), qt(.995,7.5), qt(.025,25), qt(1e-8,4), qt(.6,100), qt(.975,1e6), qt(.9,.5)
    expectRel(studentTQuantile(0.975, 1), 12.706204736174692, 1e-13);
    expectRel(studentTQuantile(0.975, 2), 4.3026527297494619, 1e-13);
    expectRel(studentTQuantile(0.975, 3), 3.1824463052837078, 1e-13);
    expectRel(studentTQuantile(0.975, 10), 2.2281388519862735, 1e-13);
    expectRel(studentTQuantile(0.995, 7.5), 3.4214226881240433, 1e-13);
    expectRel(studentTQuantile(0.025, 25), -2.0595385527532977, 1e-13);
    expectRel(studentTQuantile(1e-8, 4), -131.59473694062353, 1e-12);
    expectRel(studentTQuantile(0.6, 100), 0.25402218245822766, 1e-12);
    expectRel(studentTQuantile(0.975, 1e6), 1.9599663568141061, 1e-12);
    expectRel(studentTQuantile(0.9, 0.5), 10.270324410234281, 1e-12);
    expect(studentTQuantile(0.5, 3)).toBe(0);
  });
  it("rejects invalid df", () => {
    expectStatsError(() => studentTCdf(1, 0), "INVALID_ARGUMENT");
    expectStatsError(() => studentTQuantile(0.5, -1), "INVALID_ARGUMENT");
  });
});

describe("chi-square and F", () => {
  it("chi-square cdf / sf match pchisq", () => {
    expectRel(chiSquareCdf(3.84, 1), 0.94995647875129496, 1e-13);
    expectRel(chiSquareCdf(0.1, 3), 0.0081625762681235229, 1e-13);
    expectRel(chiSquareCdf(20, 7), 0.99443031692705441, 1e-13);
    expectRel(chiSquareCdf(1000, 900), 0.98900539105786411, 1e-11);
    expectRel(chiSquareSf(3.84, 1), 0.050043521248705002, 1e-13);
    expectRel(chiSquareSf(80, 4), 1.7418252446695517e-16, 1e-12);
    expectRel(chiSquareSf(0.5, 10), 0.99999338828943896, 1e-13);
    expect(chiSquareCdf(-1, 2)).toBe(0);
    expect(chiSquareSf(0, 2)).toBe(1);
  });
  it("F cdf / sf match pf", () => {
    expectRel(fCdf(3.5, 2, 27), 0.95549124605359981, 1e-13);
    expectRel(fCdf(0.4, 5, 3), 0.17392765793650988, 1e-13);
    expectRel(fCdf(10, 1, 100), 0.99792712741913336, 1e-13);
    expectRel(fSf(3.5, 2, 27), 0.044508753946400269, 1e-12);
    expectRel(fSf(60, 3, 50), 1.3739866935584238e-16, 1e-11);
    expect(fSf(0, 3, 4)).toBe(1);
  });
});

describe("noncentralTCdf", () => {
  it("matches pt(..., ncp)", () => {
    expectRel(noncentralTCdf(1.96, 10, 2), 0.46671726989250395, 1e-10);
    expectRel(noncentralTCdf(2.0, 38, 2.5), 0.30840885345418306, 1e-10);
    expectRel(noncentralTCdf(-1, 5, 0.5), 0.082444091056970814, 1e-9);
    expectRel(noncentralTCdf(3, 20, -1), 0.99984691520547608, 1e-10);
  });
});
