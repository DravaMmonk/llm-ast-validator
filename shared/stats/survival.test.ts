import { describe, expect, it } from "vitest";
import { coxRegression, kaplanMeier, logRankTest } from "./survival";
import { expectRel, expectStatsError } from "./testHelpers";

// survival::aml
const AML_TIME = [9, 13, 13, 18, 23, 28, 31, 34, 45, 48, 161, 5, 5, 8, 8, 12, 16, 23, 27, 30, 33, 43, 45];
const AML_STATUS: (0 | 1)[] = [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1];
const AML_X = [...Array<string>(11).fill("Maintained"), ...Array<string>(12).fill("Nonmaintained")];

// survival::lung[1:60, ], complete ph.ecog; st = status - 1; eg = ph.ecog collapsed to 0 / 1 / 2+
const LUNG_TIME = [
  306, 455, 1010, 210, 883, 1022, 310, 361, 218, 166, 170, 654, 728, 567, 144, 613, 707, 61, 88, 301, 81, 624, 371, 394, 520,
  574, 118, 390, 12, 473, 26, 533, 107, 53, 122, 814, 965, 93, 731, 460, 153, 433, 145, 583, 95, 303, 519, 643, 765, 735,
  189, 53, 246, 689, 65, 5, 132, 687, 345,
];
const LUNG_ST: (0 | 1)[] = [
  1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];
const LUNG_EG = "1,0,0,1,0,1,2+,2+,1,2+,1,2+,1,1,1,1,2+,2+,1,1,0,1,0,0,1,0,2+,1,2+,1,2+,2+,2+,2+,2+,2+,1,2+,1,1,2+,0,2+,1,2+,0,1,0,1,1,0,0,0,1,0,0,2+,1,1".split(",");
const LUNG_AGE = [
  74, 68, 56, 57, 60, 74, 68, 71, 53, 61, 57, 68, 68, 57, 67, 70, 63, 56, 57, 67, 49, 50, 58, 72, 70, 60, 70, 53, 74, 69, 73,
  48, 60, 61, 62, 65, 66, 74, 64, 70, 73, 59, 60, 68, 76, 74, 63, 74, 50, 72, 63, 68, 58, 59, 62, 65, 57, 58, 64,
];
const LUNG_SEX = [
  1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 2,
  2, 1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 2, 1, 2, 2,
];

// survival::ovarian
const OV_TIME = [59, 115, 156, 421, 431, 448, 464, 475, 477, 563, 638, 744, 769, 770, 803, 855, 1040, 1106, 1129, 1206, 1227, 268, 329, 353, 365, 377];
const OV_STAT: (0 | 1)[] = [1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0];
const OV_AGE = [
  72.3315, 74.4932, 66.4658, 53.3644, 50.3397, 56.4301, 56.937, 59.8548, 64.1753, 55.1781, 56.7562, 50.1096, 59.6301,
  57.0521, 39.2712, 43.1233, 38.8932, 44.6, 53.9068, 44.2055, 59.589, 74.5041, 43.137, 63.2192, 64.4247, 58.3096,
];
const OV_RX = [1, 1, 1, 2, 1, 1, 2, 2, 1, 2, 1, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 1, 1, 2, 2, 2];

describe("kaplanMeier", () => {
  // R: s <- summary(survfit(Surv(time, status) ~ 1, aml), censored = TRUE)
  it("matches R survfit on aml (ties, censoring at the last time)", () => {
    const km = kaplanMeier(AML_TIME, AML_STATUS);
    expect(km.steps.map((s) => s.time)).toEqual([5, 8, 9, 12, 13, 16, 18, 23, 27, 28, 30, 31, 33, 34, 43, 45, 48, 161]);
    expect(km.steps.map((s) => s.nRisk)).toEqual([23, 21, 19, 18, 17, 15, 14, 13, 11, 10, 9, 8, 7, 6, 5, 4, 2, 1]);
    expect(km.steps.map((s) => s.nEvent)).toEqual([2, 2, 1, 1, 1, 0, 1, 2, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(km.steps.map((s) => s.nCensor)).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
    const surv = [
      0.91304347826086951, 0.82608695652173914, 0.78260869565217384, 0.73913043478260865, 0.69565217391304346,
      0.69565217391304346, 0.64596273291925466, 0.54658385093167705, 0.49689440993788819, 0.49689440993788819,
      0.4416839199447895, 0.38647342995169082, 0.33126293995859213, 0.27605244996549344, 0.22084195997239475,
      0.16563146997929606, 0.082815734989648032, 0.082815734989648032,
    ];
    const se = [
      0.058753384755841409, 0.079034196447511806, 0.086006148703798302, 0.091560537151700067, 0.095943875542151391,
      0.095943875542151391, 0.10114267517528461, 0.10725064174012229, 0.10840178078868302, 0.10840178078868302,
      0.10951806997765715, 0.10885880149486436, 0.10639097288755056, 0.10198337609049186, 0.095367438486434419,
      0.086035208408575106, 0.072661800503528301, 0.072661800503528301,
    ];
    const lower = [
      0.80485479778295788, 0.68483946807189866, 0.63095791059958772, 0.57979921796803113, 0.53087834162821212,
      0.53087834162821212, 0.47525772470551453, 0.37207808724921126, 0.32401654568981592, 0.32401654568981592,
      0.27167599539229165, 0.22251529774688583, 0.17652018258070468, 0.13382219562927281, 0.09473324056331256,
      0.059840717810080948, 0.014834608254847221, 0.014834608254847221,
    ];
    const upper = [
      1, 0.99646660502298201, 0.97070875920768129, 0.94224652723151947, 0.91156845010048149, 0.91156845010048149,
      0.87798226231686272, 0.80293335280236944, 0.76201063776504074, 0.76201063776504074, 0.71807847747497544,
      0.67124244297363067, 0.62165772653129392, 0.56944929631151486, 0.51482637978433587, 0.45844677088550695,
      0.46232740656529359, 0.46232740656529359,
    ];
    km.steps.forEach((s, i) => {
      expectRel(s.survival, surv[i], 1e-13);
      expectRel(s.se, se[i], 1e-12);
      expectRel(s.lower, lower[i], 1e-12);
      expectRel(s.upper, upper[i], 1e-12);
    });
    // summary(fit)$table: median 27, 0.95LCL 18, 0.95UCL 45
    expect([km.median, km.medianLower, km.medianUpper]).toEqual([27, 18, 45]);
    expect(km.n).toBe(23);
    expect(km.events).toBe(18);
  });
  it("supports other confidence levels (conf.int = 0.9)", () => {
    const km = kaplanMeier(AML_TIME, AML_STATUS, 0.9);
    const lower90 = [0.82134143900846657, 0.70580006467169731, 0.6531904629044698, 0.60287898292423436];
    lower90.forEach((v, i) => expectRel(km.steps[i].lower, v, 1e-12));
  });
  it("reports an unreached upper median limit as null (aml Maintained: 31, 18, NA)", () => {
    const idx = AML_X.map((x, i) => (x === "Maintained" ? i : -1)).filter((i) => i >= 0);
    const km = kaplanMeier(
      idx.map((i) => AML_TIME[i]),
      idx.map((i) => AML_STATUS[i]),
    );
    expect([km.median, km.medianLower, km.medianUpper]).toEqual([31, 18, null]);
  });
  it("handles S(t) = 0 at the last time like R (se/CI NA -> null)", () => {
    // survfit(Surv(c(1,2,3,4), c(1,1,1,1)) ~ 1): median 2.5 (exactly 0.5 at t = 2), LCL 1, UCL NA
    const km = kaplanMeier([1, 2, 3, 4], [1, 1, 1, 1]);
    const last = km.steps[3];
    expect(last.survival).toBe(0);
    expect([last.se, last.lower, last.upper]).toEqual([null, null, null]);
    expectRel(km.steps[0].lower, 0.42593226849798205, 1e-12);
    expectRel(km.steps[2].lower, 0.045790759666018192, 1e-12);
    expectRel(km.steps[1].se, 0.25, 1e-14);
    expect([km.median, km.medianLower, km.medianUpper]).toEqual([2.5, 1, null]);
  });
  it("follows print.survfit's median rule when the curve is flat at 0.5", () => {
    // survfit(Surv(1:6, c(1,1,1,0,1,1)) ~ 1): flat at 0.5 over [3, 5) -> median 4
    expect(kaplanMeier([1, 2, 3, 4, 5, 6], [1, 1, 1, 0, 1, 1]).median).toBe(4);
    // survfit(Surv(1:4, c(1,1,0,0)) ~ 1): 0.5 from t = 2 to the end, never drops -> median 2
    expect(kaplanMeier([1, 2, 3, 4], [1, 1, 0, 0]).median).toBe(2);
  });
  it("matches R with ties between events and censorings, censored last", () => {
    // survfit(Surv(c(2,3,3,5,8,8), c(1,0,1,0,1,0)) ~ 1)
    const km = kaplanMeier([2, 3, 3, 5, 8, 8], [1, 0, 1, 0, 1, 0]);
    expect(km.steps.map((s) => s.nRisk)).toEqual([6, 5, 3, 2]);
    expect(km.steps.map((s) => s.nCensor)).toEqual([0, 1, 1, 1]);
    const surv = [0.83333333333333337, 0.66666666666666674, 0.66666666666666674, 0.33333333333333337];
    const lower = [0.58265479547713961, 0.37860646088709515, 0.37860646088709515, 0.074604122759626523];
    km.steps.forEach((s, i) => {
      expectRel(s.survival, surv[i], 1e-14);
      expectRel(s.lower, lower[i], 1e-12);
    });
    expect([km.median, km.medianLower, km.medianUpper]).toEqual([8, 3, null]);
  });
  it("handles no events and validates input", () => {
    const km = kaplanMeier([3, 5], [0, 0]);
    expect(km.steps.map((s) => [s.survival, s.se, s.lower, s.upper])).toEqual([
      [1, 0, 1, 1],
      [1, 0, 1, 1],
    ]);
    expect(km.median).toBeNull();
    expectStatsError(() => kaplanMeier([], []), "EMPTY_INPUT");
    expectStatsError(() => kaplanMeier([1, 2], [1]), "LENGTH_MISMATCH");
    expectStatsError(() => kaplanMeier([-1, 2], [1, 1]), "INVALID_ARGUMENT");
    expectStatsError(() => kaplanMeier([1, 2], [1, 2 as 1]), "INVALID_ARGUMENT");
  });
});

describe("logRankTest", () => {
  it("matches R survdiff(Surv(time, status) ~ x, aml)", () => {
    const r = logRankTest(AML_TIME, AML_STATUS, AML_X);
    expectRel(r.statistic, 3.3963886989776011, 1e-12);
    expect(r.df).toBe(1);
    expectRel(r.pValue, 0.065339322040504952, 1e-10);
    expect(r.groups.map((g) => [g.group, g.n, g.observed])).toEqual([
      ["Maintained", 11, 7],
      ["Nonmaintained", 12, 11],
    ]);
    expectRel(r.groups[0].expected, 10.689335992300725, 1e-12);
    expectRel(r.groups[1].expected, 7.3106640076992759, 1e-12);
  });
  it("matches R for three groups (lung subset by ph.ecog)", () => {
    const r = logRankTest(LUNG_TIME, LUNG_ST, LUNG_EG);
    expectRel(r.statistic, 7.8190207463043313, 1e-11);
    expect(r.df).toBe(2);
    expectRel(r.pValue, 0.020050315831639229, 1e-10);
    expect(r.groups.map((g) => g.group)).toEqual(["0", "1", "2+"]);
    expect(r.groups.map((g) => g.observed)).toEqual([14, 23, 19]);
    expect(r.groups.map((g) => g.n)).toEqual([15, 25, 19]);
    [13.541626906898149, 31.256543886484497, 11.20182920661736].forEach((e, i) => expectRel(r.groups[i].expected, e, 1e-12));
  });
  it("validates input", () => {
    expectStatsError(() => logRankTest([1, 2, 3], [1, 1, 0], ["a", "a", "a"]), "INSUFFICIENT_DATA");
    expectStatsError(() => logRankTest([1, 2, 3], [0, 0, 0], ["a", "b", "a"]), "INSUFFICIENT_DATA");
    expectStatsError(() => logRankTest([1, 2, 3], [1, 0, 1], ["a", "b"]), "LENGTH_MISMATCH");
  });
});

describe("coxRegression (Breslow ties)", () => {
  // R: coxph(..., ties = "breslow", control = coxph.control(eps = 1e-14, iter.max = 100))
  it("matches R on lung subset: Surv(time, st) ~ age + sex", () => {
    const X = LUNG_AGE.map((a, i) => [a, LUNG_SEX[i]]);
    const r = coxRegression(LUNG_TIME, LUNG_ST, X, ["age", "sex"]);
    const ref = [
      [0.0040896351244594535, 0.018733933397782659, 0.21830093219737298, 0.82719464818671717, 1.0040980090937865, 0.96789835767170052, 1.0416515369355339],
      [-0.098679932310911198, 0.28238120300552794, -0.34945644844844514, 0.72674666137911981, 0.9060326533976123, 0.52093139773437114, 1.5758220230013888],
    ];
    ref.forEach(([est, se, z, p, hr, lo, hi], j) => {
      const c = r.coefficients[j];
      expectRel(c.estimate, est, 1e-6);
      expectRel(c.se, se, 1e-6);
      expectRel(c.z, z, 1e-6);
      expectRel(c.p, p, 1e-6);
      expectRel(c.hazardRatio, hr, 1e-8);
      expectRel(c.hrLower, lo, 1e-7);
      expectRel(c.hrUpper, hi, 1e-7);
    });
    expectRel(r.logLikNull, -182.76008789772413, 1e-12);
    expectRel(r.logLik, -182.68124566472892, 1e-10);
    expectRel(r.likelihoodRatio, 0.15768446599042818, 1e-6);
    expect(r.lrDf).toBe(2);
    expectRel(r.lrPValue, 0.92418571895674839, 1e-6);
    expect(r.converged).toBe(true);
    expect(r.separationWarning).toBe(false);
    expect(r.events).toBe(56);
  });
  it("matches R on ovarian: Surv(futime, fustat) ~ age + rx", () => {
    const X = OV_AGE.map((a, i) => [a, OV_RX[i]]);
    const r = coxRegression(OV_TIME, OV_STAT, X, ["age", "rx"]);
    const ref = [
      [0.147326595469114, 0.046147047740802638, 3.1925464939082047, 0.0014102423942953959, 1.1587323379702184, 1.0585288257942256, 1.2684214150243058],
      [-0.80397301266511445, 0.63204937187945009, -1.2720098277677825, 0.20336962745236711, 0.44754731605073123, 0.12966941641127905, 1.5446865239904832],
    ];
    ref.forEach(([est, se, z, p, hr, lo, hi], j) => {
      const c = r.coefficients[j];
      expectRel(c.estimate, est, 1e-7);
      expectRel(c.se, se, 1e-7);
      expectRel(c.z, z, 1e-7);
      expectRel(c.p, p, 1e-6);
      expectRel(c.hazardRatio, hr, 1e-7);
      expectRel(c.hrLower, lo, 1e-7);
      expectRel(c.hrUpper, hi, 1e-7);
    });
    expectRel(r.logLikNull, -34.984940371162558, 1e-12);
    expectRel(r.logLik, -27.041898863008388, 1e-10);
    expectRel(r.likelihoodRatio, 15.886083016308341, 1e-9);
    expectRel(r.lrPValue, 0.0003551247193220073, 1e-8);
  });
  it("matches R with tied event times (aml, Breslow)", () => {
    const X = AML_X.map((x) => [x === "Nonmaintained" ? 1 : 0]);
    const r = coxRegression(AML_TIME, AML_STATUS, X, ["nonmaintained"]);
    const c = r.coefficients[0];
    expectRel(c.estimate, 0.90421972368621095, 1e-8);
    expectRel(c.se, 0.51224790730418868, 1e-8);
    expectRel(c.p, 0.077530251208472775, 1e-7);
    expectRel(c.hrLower, 0.90504761284649415, 1e-8);
    expectRel(c.hrUpper, 6.7409925261706913, 1e-8);
    expectRel(r.logLikNull, -42.898123897174031, 1e-12);
    expectRel(r.logLik, -41.25011435006887, 1e-11);
    expectRel(r.likelihoodRatio, 3.2960190942103225, 1e-9);
    expectRel(r.lrPValue, 0.069448000546783753, 1e-8);
  });
  it("flags monotone likelihood (no events in one group)", () => {
    const time = [1, 2, 3, 4, 5, 6, 7, 8];
    const event: (0 | 1)[] = [1, 1, 1, 1, 0, 0, 0, 0];
    const X = [[1], [1], [1], [1], [0], [0], [0], [0]];
    const r = coxRegression(time, event, X, ["g"]);
    expect(r.separationWarning).toBe(true);
    expect(Number.isNaN(r.coefficients[0].estimate)).toBe(false);
  });
  it("throws SINGULAR_MATRIX for duplicated covariates and validates input", () => {
    const X = LUNG_AGE.map((a) => [a, a]);
    expectStatsError(() => coxRegression(LUNG_TIME, LUNG_ST, X, ["age", "age2"]), "SINGULAR_MATRIX");
    expectStatsError(() => coxRegression([1, 2], [0, 0], [[1], [2]], ["x"]), "INSUFFICIENT_DATA");
    expectStatsError(() => coxRegression([1, 2], [1, 0], [[1], [2, 3]], ["x"]), "LENGTH_MISMATCH");
    expectStatsError(() => coxRegression([1, 2], [1, 0], [[1], [2]], []), "INVALID_ARGUMENT");
  });
});
