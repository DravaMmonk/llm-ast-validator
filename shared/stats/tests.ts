/**
 * Classical hypothesis tests, effect sizes and 2×2-table measures.
 *
 * All tests are two-sided. Results mirror R (`t.test`, `wilcox.test`,
 * `kruskal.test`, `chisq.test`, `fisher.test`, `cor.test`, `prop.test`) as
 * documented per function. Inputs are clean numeric arrays (filter missing
 * values first). Degenerate inputs (too few observations, constant data,
 * empty margins) throw a `StatsError` instead of returning NaN.
 */

import { mean as meanOf, rankWithTies, variance as varianceOf } from "./descriptive";
import {
  chiSquareSf,
  fSf,
  logGamma,
  normalCdf,
  normalQuantile,
  normalSf,
  studentTQuantile,
  tTwoSidedP,
} from "./distributions";
import {
  StatsError,
  assertFiniteArray,
  assertNonNegativeCount,
  assertProbabilityOpen,
  assertSameLength,
} from "./errors";
import type { ConfidenceInterval } from "./types";

const DBL_EPSILON = 2.220446049250313e-16;

function requireAtLeast(values: readonly number[], n: number, label: string): void {
  if (!Array.isArray(values) || values.length < n) {
    throw new StatsError("INSUFFICIENT_DATA", `${label} needs at least ${n} observation(s) (got ${values?.length ?? 0})`);
  }
}

function zCritical(conf: number): number {
  assertProbabilityOpen(conf, "conf");
  return normalQuantile((1 + conf) / 2);
}

// ---------------------------------------------------------------------------
// t-tests
// ---------------------------------------------------------------------------

export interface TwoSampleTTestResult {
  method: string;
  statistic: number;
  df: number;
  pValue: number;
  meanA: number;
  meanB: number;
  /** meanA - meanB. */
  meanDiff: number;
  /** Standard error of the mean difference. */
  se: number;
  /** CI for meanA - meanB. */
  ci: ConfidenceInterval;
  /** Cohen's d using the pooled SD: (meanA - meanB) / s_pooled. */
  cohensD: number;
  nA: number;
  nB: number;
}

function pooledSd(a: readonly number[], b: readonly number[], va: number, vb: number): number {
  return Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
}

/** R's "data are essentially constant" guard. */
function checkNotConstant(se: number, scale: number): void {
  if (!(se > 10 * DBL_EPSILON * scale) || se === 0) {
    throw new StatsError("ZERO_VARIANCE", "data are essentially constant; the t statistic is undefined");
  }
}

/**
 * Welch two-sample t-test (unequal variances, Welch–Satterthwaite df), as R
 * `t.test(a, b)`. Requires ≥ 2 observations per group.
 */
export function welchTTest(a: readonly number[], b: readonly number[], conf = 0.95): TwoSampleTTestResult {
  requireAtLeast(a, 2, "a");
  requireAtLeast(b, 2, "b");
  assertFiniteArray(a, "a");
  assertFiniteArray(b, "b");
  const q = studentTQuantileForConf(conf);
  const ma = meanOf(a);
  const mb = meanOf(b);
  const va = varianceOf(a);
  const vb = varianceOf(b);
  const sa = va / a.length;
  const sb = vb / b.length;
  const se = Math.sqrt(sa + sb);
  checkNotConstant(se, Math.max(Math.abs(ma), Math.abs(mb)));
  const df = (sa + sb) ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1));
  const diff = ma - mb;
  const t = diff / se;
  const crit = q(df);
  const sp = pooledSd(a, b, va, vb);
  return {
    method: "Welch two-sample t-test",
    statistic: t,
    df,
    pValue: tTwoSidedP(t, df),
    meanA: ma,
    meanB: mb,
    meanDiff: diff,
    se,
    ci: { lower: diff - crit * se, upper: diff + crit * se, level: conf },
    cohensD: diff / sp,
    nA: a.length,
    nB: b.length,
  };
}

function studentTQuantileForConf(conf: number): (df: number) => number {
  assertProbabilityOpen(conf, "conf");
  return (df: number) => studentTQuantile((1 + conf) / 2, df);
}

/**
 * Student two-sample t-test assuming equal variances (pooled SD, df = nA + nB - 2),
 * as R `t.test(a, b, var.equal = TRUE)`. Requires nA, nB ≥ 1 and nA + nB ≥ 3.
 */
export function studentTTest(a: readonly number[], b: readonly number[], conf = 0.95): TwoSampleTTestResult {
  requireAtLeast(a, 1, "a");
  requireAtLeast(b, 1, "b");
  assertFiniteArray(a, "a");
  assertFiniteArray(b, "b");
  if (a.length + b.length < 3) throw new StatsError("INSUFFICIENT_DATA", "need nA + nB >= 3");
  const q = studentTQuantileForConf(conf);
  const ma = meanOf(a);
  const mb = meanOf(b);
  const va = a.length > 1 ? varianceOf(a) : 0;
  const vb = b.length > 1 ? varianceOf(b) : 0;
  const df = a.length + b.length - 2;
  const sp = pooledSd(a, b, va, vb);
  const se = sp * Math.sqrt(1 / a.length + 1 / b.length);
  checkNotConstant(se, Math.max(Math.abs(ma), Math.abs(mb)));
  const diff = ma - mb;
  const t = diff / se;
  const crit = q(df);
  return {
    method: "Two-sample t-test (equal variances)",
    statistic: t,
    df,
    pValue: tTwoSidedP(t, df),
    meanA: ma,
    meanB: mb,
    meanDiff: diff,
    se,
    ci: { lower: diff - crit * se, upper: diff + crit * se, level: conf },
    cohensD: diff / sp,
    nA: a.length,
    nB: b.length,
  };
}

export interface OneSampleTTestResult {
  method: string;
  statistic: number;
  df: number;
  pValue: number;
  /** Sample mean (of the differences, for the paired test). */
  mean: number;
  /** Null-hypothesis mean. */
  mu: number;
  se: number;
  /** CI for the mean (of the differences, for the paired test). */
  ci: ConfidenceInterval;
  /** Cohen's d = (mean - mu) / sd (d_z for paired data). */
  cohensD: number;
  n: number;
}

/** One-sample t-test of H0: mean = mu, as R `t.test(x, mu = mu)`. Requires n ≥ 2. */
export function oneSampleTTest(x: readonly number[], mu = 0, conf = 0.95): OneSampleTTestResult {
  return oneSampleCore(x, mu, conf, "One-sample t-test");
}

function oneSampleCore(x: readonly number[], mu: number, conf: number, method: string): OneSampleTTestResult {
  requireAtLeast(x, 2, "x");
  assertFiniteArray(x, "x");
  if (!Number.isFinite(mu)) throw new StatsError("NON_FINITE", "mu must be finite");
  const q = studentTQuantileForConf(conf);
  const n = x.length;
  const m = meanOf(x);
  const s = Math.sqrt(varianceOf(x));
  const se = s / Math.sqrt(n);
  checkNotConstant(se, Math.abs(m));
  const df = n - 1;
  const t = (m - mu) / se;
  const crit = q(df);
  return {
    method,
    statistic: t,
    df,
    pValue: tTwoSidedP(t, df),
    mean: m,
    mu,
    se,
    ci: { lower: m - crit * se, upper: m + crit * se, level: conf },
    cohensD: (m - mu) / s,
    n,
  };
}

/** Paired t-test on differences a[i] - b[i], as R `t.test(a, b, paired = TRUE)`. */
export function pairedTTest(a: readonly number[], b: readonly number[], conf = 0.95): OneSampleTTestResult {
  assertSameLength(a, b, "a and b");
  assertFiniteArray(a, "a");
  assertFiniteArray(b, "b");
  const d = a.map((v, i) => v - b[i]);
  return oneSampleCore(d, 0, conf, "Paired t-test");
}

// ---------------------------------------------------------------------------
// Rank tests
// ---------------------------------------------------------------------------

export interface MannWhitneyResult {
  method: string;
  /** W = (sum of ranks of a) - nA(nA+1)/2, as reported by R `wilcox.test`. */
  statistic: number;
  /** Continuity-corrected normal deviate. */
  z: number;
  pValue: number;
  /**
   * Rank-biserial correlation 2W/(nA·nB) - 1 ∈ [-1, 1]; positive when values
   * in `a` tend to be larger than in `b`.
   */
  rankBiserial: number;
  nA: number;
  nB: number;
}

/**
 * Wilcoxon rank-sum / Mann–Whitney U test using the normal approximation with
 * tie correction and continuity correction — R
 * `wilcox.test(a, b, exact = FALSE, correct = TRUE)`.
 */
export function mannWhitneyU(a: readonly number[], b: readonly number[]): MannWhitneyResult {
  requireAtLeast(a, 1, "a");
  requireAtLeast(b, 1, "b");
  assertFiniteArray(a, "a");
  assertFiniteArray(b, "b");
  const na = a.length;
  const nb = b.length;
  const n = na + nb;
  const { ranks, tieSizes } = rankWithTies([...a, ...b]);
  let rankSumA = 0;
  for (let i = 0; i < na; i++) rankSumA += ranks[i];
  const w = rankSumA - (na * (na + 1)) / 2;
  const tieTerm = tieSizes.reduce((s, t) => s + t * t * t - t, 0);
  const sigma = Math.sqrt(((na * nb) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (!(sigma > 0)) throw new StatsError("ZERO_VARIANCE", "all observations are tied; the test is undefined");
  const centered = w - (na * nb) / 2;
  const z = (centered - Math.sign(centered) * 0.5) / sigma;
  const pValue = Math.min(1, 2 * Math.min(normalCdf(z), normalSf(z)));
  return {
    method: "Wilcoxon rank-sum test with continuity correction (normal approximation)",
    statistic: w,
    z,
    pValue,
    rankBiserial: (2 * w) / (na * nb) - 1,
    nA: na,
    nB: nb,
  };
}

export interface KruskalWallisResult {
  method: string;
  /** Tie-corrected H statistic. */
  statistic: number;
  df: number;
  pValue: number;
  /** Epsilon-squared effect size H / (N - 1). */
  epsilonSquared: number;
  n: number;
}

/** Kruskal–Wallis rank-sum test with tie correction, as R `kruskal.test`. */
export function kruskalWallis(groups: readonly (readonly number[])[]): KruskalWallisResult {
  if (!Array.isArray(groups) || groups.length < 2) {
    throw new StatsError("INSUFFICIENT_DATA", "need at least 2 groups");
  }
  groups.forEach((g, i) => {
    requireAtLeast(g, 1, `groups[${i}]`);
    assertFiniteArray(g, `groups[${i}]`);
  });
  const all = groups.flat();
  const n = all.length;
  const { ranks, tieSizes } = rankWithTies(all);
  let offset = 0;
  let sumTerm = 0;
  for (const g of groups) {
    let r = 0;
    for (let i = 0; i < g.length; i++) r += ranks[offset + i];
    sumTerm += (r * r) / g.length;
    offset += g.length;
  }
  const tieTerm = tieSizes.reduce((s, t) => s + t * t * t - t, 0);
  const denom = 1 - tieTerm / (n * n * n - n);
  if (!(denom > 1e-12)) throw new StatsError("ZERO_VARIANCE", "all observations are tied; the test is undefined");
  const h = ((12 / (n * (n + 1))) * sumTerm - 3 * (n + 1)) / denom;
  const df = groups.length - 1;
  const stat = Math.max(0, h);
  return {
    method: "Kruskal-Wallis rank sum test",
    statistic: stat,
    df,
    pValue: chiSquareSf(stat, df),
    epsilonSquared: stat / (n - 1),
    n,
  };
}

// ---------------------------------------------------------------------------
// ANOVA
// ---------------------------------------------------------------------------

export interface AnovaResult {
  method: string;
  statistic: number;
  df1: number;
  df2: number;
  pValue: number;
  ssBetween: number;
  ssWithin: number;
  msBetween: number;
  msWithin: number;
  /** η² = SS_between / SS_total. */
  etaSquared: number;
  groupMeans: number[];
}

/** One-way ANOVA (equal variances), as R `summary(aov(y ~ g))` / `oneway.test(var.equal = TRUE)`. */
export function oneWayAnova(groups: readonly (readonly number[])[]): AnovaResult {
  if (!Array.isArray(groups) || groups.length < 2) {
    throw new StatsError("INSUFFICIENT_DATA", "need at least 2 groups");
  }
  groups.forEach((g, i) => {
    requireAtLeast(g, 1, `groups[${i}]`);
    assertFiniteArray(g, `groups[${i}]`);
  });
  const k = groups.length;
  const all = groups.flat();
  const n = all.length;
  if (n - k < 1) throw new StatsError("INSUFFICIENT_DATA", "need more observations than groups");
  const grand = meanOf(all);
  const groupMeans = groups.map((g) => meanOf(g));
  let ssb = 0;
  let ssw = 0;
  groups.forEach((g, i) => {
    const m = groupMeans[i];
    ssb += g.length * (m - grand) ** 2;
    for (const v of g) ssw += (v - m) ** 2;
  });
  const sst = ssb + ssw;
  const scale = all.reduce((mx, v) => Math.max(mx, Math.abs(v)), Number.MIN_VALUE);
  if (ssw <= (scale * 1e-14) ** 2 * n) {
    throw new StatsError("ZERO_VARIANCE", "within-group variance is zero; the F statistic is undefined");
  }
  const df1 = k - 1;
  const df2 = n - k;
  const msb = ssb / df1;
  const msw = ssw / df2;
  const f = msb / msw;
  return {
    method: "One-way ANOVA",
    statistic: f,
    df1,
    df2,
    pValue: fSf(f, df1, df2),
    ssBetween: ssb,
    ssWithin: ssw,
    msBetween: msb,
    msWithin: msw,
    etaSquared: ssb / sst,
    groupMeans,
  };
}

// ---------------------------------------------------------------------------
// Contingency tables
// ---------------------------------------------------------------------------

export interface ChiSquareResult {
  method: string;
  statistic: number;
  df: number;
  pValue: number;
  expected: number[][];
  /** Cramér's V from the uncorrected Pearson statistic: sqrt(X² / (N·(min(r,c) - 1))). */
  cramersV: number;
  /** True when any expected count is below 5 (approximation may be poor; consider Fisher's exact test). */
  lowExpectedWarning: boolean;
  /** Whether Yates' continuity correction was applied (only for 2×2 tables). */
  yatesApplied: boolean;
}

/**
 * Pearson chi-square test of independence on an r×c table of counts, as R
 * `chisq.test(table, correct = yates)`. Yates' correction (default true, as
 * in R) applies only to 2×2 tables, using R's form
 * Σ (|O - E| - min(0.5, min|O - E|))² / E.
 */
export function chiSquareTest(table: readonly (readonly number[])[], opts: { yates?: boolean } = {}): ChiSquareResult {
  const yates = opts.yates ?? true;
  if (!Array.isArray(table) || table.length < 2) {
    throw new StatsError("INSUFFICIENT_DATA", "table needs at least 2 rows");
  }
  const c = table[0].length;
  if (c < 2) throw new StatsError("INSUFFICIENT_DATA", "table needs at least 2 columns");
  table.forEach((row, i) => {
    if (row.length !== c) throw new StatsError("LENGTH_MISMATCH", "all table rows must have the same length");
    row.forEach((v: number, j: number) => assertNonNegativeCount(v, `table[${i}][${j}]`));
  });
  const r = table.length;
  const rowSums = table.map((row) => row.reduce((s: number, v: number) => s + v, 0));
  const colSums = Array.from({ length: c }, (_, j) => table.reduce((s, row) => s + row[j], 0));
  const total = rowSums.reduce((s, v) => s + v, 0);
  if (rowSums.some((s) => s === 0) || colSums.some((s) => s === 0)) {
    throw new StatsError("INVALID_ARGUMENT", "every row and column must have a non-zero total");
  }
  const expected = table.map((_, i) => colSums.map((cs) => (rowSums[i] * cs) / total));
  const applyYates = yates && r === 2 && c === 2;
  let correction = 0;
  if (applyYates) {
    let minAbs = Infinity;
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) minAbs = Math.min(minAbs, Math.abs(table[i][j] - expected[i][j]));
    correction = Math.min(0.5, minAbs);
  }
  let stat = 0;
  let pearson = 0;
  let low = false;
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      const e = expected[i][j];
      const dev = Math.abs(table[i][j] - e);
      stat += (dev - correction) ** 2 / e;
      pearson += (dev * dev) / e;
      if (e < 5) low = true;
    }
  }
  const df = (r - 1) * (c - 1);
  return {
    method: applyYates
      ? "Pearson's chi-squared test with Yates' continuity correction"
      : "Pearson's chi-squared test",
    statistic: stat,
    df,
    pValue: chiSquareSf(stat, df),
    expected,
    cramersV: Math.sqrt(pearson / (total * (Math.min(r, c) - 1))),
    lowExpectedWarning: low,
    yatesApplied: applyYates,
  };
}

function requireCountCells(cells: readonly number[], names: string): void {
  cells.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0) {
      throw new StatsError("INVALID_ARGUMENT", `${names[i]} must be a non-negative integer count`);
    }
  });
}

export interface FisherExactResult {
  method: string;
  pValue: number;
  /** Sample (cross-product) odds ratio ad/bc; Infinity if bc = 0 < ad; null if ad = bc = 0. */
  sampleOddsRatio: number | null;
  /**
   * Conditional maximum-likelihood odds ratio (as R `fisher.test`); 0 or
   * Infinity at the support boundary. null when a margin is zero (the
   * conditional distribution is degenerate; R reports 0 there).
   */
  oddsRatio: number | null;
  /** Conditional exact CI for the odds ratio (as R `fisher.test`); upper may be Infinity. */
  ci: ConfidenceInterval;
}

/** Bisection on a monotone function of log(θ) over θ ∈ (0, ∞); returns θ. */
function solveLogScale(fn: (theta: number) => number, target: number, increasing: boolean): number {
  const g = (logTheta: number) => (fn(Math.exp(logTheta)) - target) * (increasing ? 1 : -1);
  let lo = -1;
  let hi = 1;
  while (g(lo) > 0 && lo > -700) lo *= 2;
  while (g(hi) < 0 && hi < 700) hi *= 2;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) < 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13) break;
  }
  return Math.exp((lo + hi) / 2);
}

/**
 * Fisher's exact test for the 2×2 table [[a, b], [c, d]], as R `fisher.test`.
 * Two-sided p: sum of hypergeometric probabilities ≤ P(observed)·(1 + 1e-7).
 * Also reports the conditional MLE odds ratio and its exact conditional CI
 * (solved to ~1e-13 in log scale; R's uniroot default tolerance is looser).
 */
export function fisherExact2x2(a: number, b: number, c: number, d: number, conf = 0.95): FisherExactResult {
  requireCountCells([a, b, c, d], "abcd");
  assertProbabilityOpen(conf, "conf");
  const m = a + c;
  const n = b + d;
  const k = a + b;
  const x = a;
  const lo = Math.max(0, k - n);
  const hi = Math.min(k, m);
  const support: number[] = [];
  for (let s = lo; s <= hi; s++) support.push(s);
  const lf = (v: number) => logGamma(v + 1);
  const logdc = support.map((s) => lf(m) - lf(s) - lf(m - s) + lf(n) - lf(k - s) - lf(n - k + s));

  const dnhyper = (ncp: number): number[] => {
    const logNcp = Math.log(ncp);
    const ld = logdc.map((l, i) => l + logNcp * support[i]);
    const mx = ld.reduce((m, v) => Math.max(m, v), -Infinity);
    const e = ld.map((v) => Math.exp(v - mx));
    const tot = e.reduce((s, v) => s + v, 0);
    return e.map((v) => v / tot);
  };
  const mnhyper = (ncp: number): number => {
    if (ncp === 0) return lo;
    if (ncp === Infinity) return hi;
    return dnhyper(ncp).reduce((s, p, i) => s + p * support[i], 0);
  };
  const pnhyper = (q: number, ncp: number, upper: boolean): number => {
    const dn = dnhyper(ncp);
    let sum = 0;
    for (let i = 0; i < support.length; i++) if (upper ? support[i] >= q : support[i] <= q) sum += dn[i];
    return sum;
  };

  // Two-sided p-value at OR = 1.
  const d1 = dnhyper(1);
  const observed = d1[x - lo];
  let pValue = 0;
  for (const p of d1) if (p <= observed * (1 + 1e-7)) pValue += p;
  pValue = Math.min(1, pValue);

  let oddsRatio: number | null;
  if (lo === hi) oddsRatio = null;
  else if (x === lo) oddsRatio = 0;
  else if (x === hi) oddsRatio = Infinity;
  else oddsRatio = solveLogScale(mnhyper, x, true);

  const alpha = (1 - conf) / 2;
  let lower: number;
  let upper: number;
  if (lo === hi) {
    lower = 0;
    upper = Infinity;
  } else {
    lower = x === lo ? 0 : solveLogScale((t) => pnhyper(x, t, true), alpha, true);
    upper = x === hi ? Infinity : solveLogScale((t) => pnhyper(x, t, false), alpha, false);
  }

  const ad = a * d;
  const bc = b * c;
  return {
    method: "Fisher's exact test",
    pValue,
    sampleOddsRatio: bc === 0 ? (ad === 0 ? null : Infinity) : ad / bc,
    oddsRatio,
    ci: { lower, upper, level: conf },
  };
}

export interface OddsRatioResult {
  oddsRatio: number;
  logOddsRatio: number;
  /** Standard error of log(OR) (Woolf). */
  se: number;
  ci: ConfidenceInterval;
  /** Wald z for H0: OR = 1 and its two-sided p-value. */
  z: number;
  pValue: number;
  /** True when 0.5 was added to every cell because some cell was zero (Haldane–Anscombe). */
  corrected: boolean;
}

/**
 * Odds ratio for [[a, b], [c, d]] (rows: exposed / unexposed; columns: outcome
 * yes / no) with Woolf's log-scale Wald CI. If any cell is zero, 0.5 is added
 * to all four cells (Haldane–Anscombe) and `corrected` is true.
 */
export function oddsRatio2x2(a: number, b: number, c: number, d: number, conf = 0.95): OddsRatioResult {
  [a, b, c, d].forEach((v, i) => assertNonNegativeCount(v, "abcd"[i]));
  if (a + b === 0 || c + d === 0 || a + c === 0 || b + d === 0) {
    throw new StatsError("INVALID_ARGUMENT", "all row and column totals must be > 0 for an odds ratio");
  }
  const z = zCritical(conf);
  const corrected = a === 0 || b === 0 || c === 0 || d === 0;
  const [A, B, C, D] = corrected ? [a + 0.5, b + 0.5, c + 0.5, d + 0.5] : [a, b, c, d];
  const logOr = Math.log(A) + Math.log(D) - Math.log(B) - Math.log(C);
  const se = Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D);
  const zStat = logOr / se;
  return {
    oddsRatio: Math.exp(logOr),
    logOddsRatio: logOr,
    se,
    ci: { lower: Math.exp(logOr - z * se), upper: Math.exp(logOr + z * se), level: conf },
    z: zStat,
    pValue: Math.min(1, 2 * normalSf(Math.abs(zStat))),
    corrected,
  };
}

export interface RiskRatioResult {
  riskRatio: number;
  risk1: number;
  risk2: number;
  /** Standard error of log(RR). */
  se: number;
  ci: ConfidenceInterval;
  /** True when 0.5 was added to every cell because a or c was zero. */
  corrected: boolean;
}

function requireRowTotals(a: number, b: number, c: number, d: number): void {
  [a, b, c, d].forEach((v, i) => assertNonNegativeCount(v, "abcd"[i]));
  if (a + b === 0 || c + d === 0) throw new StatsError("INVALID_ARGUMENT", "both row totals (a+b, c+d) must be > 0");
}

/**
 * Risk ratio (a/(a+b)) / (c/(c+d)) with log-scale Wald CI,
 * SE = sqrt(1/a - 1/(a+b) + 1/c - 1/(c+d)). If a or c is zero, 0.5 is added
 * to all four cells and `corrected` is true.
 */
export function riskRatio2x2(a: number, b: number, c: number, d: number, conf = 0.95): RiskRatioResult {
  requireRowTotals(a, b, c, d);
  const z = zCritical(conf);
  const corrected = a === 0 || c === 0;
  const [A, B, C, D] = corrected ? [a + 0.5, b + 0.5, c + 0.5, d + 0.5] : [a, b, c, d];
  const r1 = A / (A + B);
  const r2 = C / (C + D);
  const logRr = Math.log(r1) - Math.log(r2);
  const se = Math.sqrt(Math.max(0, 1 / A - 1 / (A + B) + 1 / C - 1 / (C + D)));
  return {
    riskRatio: Math.exp(logRr),
    risk1: a / (a + b),
    risk2: c / (c + d),
    se,
    ci: { lower: Math.exp(logRr - z * se), upper: Math.exp(logRr + z * se), level: conf },
    corrected,
  };
}

export interface RiskDifferenceResult {
  riskDifference: number;
  risk1: number;
  risk2: number;
  se: number;
  /** Wald CI (not clipped; may be degenerate when both risks are 0 or 1). */
  ci: ConfidenceInterval;
}

/** Risk difference a/(a+b) - c/(c+d) with the Wald CI. */
export function riskDifference2x2(a: number, b: number, c: number, d: number, conf = 0.95): RiskDifferenceResult {
  requireRowTotals(a, b, c, d);
  const z = zCritical(conf);
  const n1 = a + b;
  const n2 = c + d;
  const r1 = a / n1;
  const r2 = c / n2;
  const rd = r1 - r2;
  const se = Math.sqrt((r1 * (1 - r1)) / n1 + (r2 * (1 - r2)) / n2);
  return { riskDifference: rd, risk1: r1, risk2: r2, se, ci: { lower: rd - z * se, upper: rd + z * se, level: conf } };
}

export interface ProportionInterval {
  estimate: number;
  lower: number;
  upper: number;
  level: number;
}

/**
 * Wilson score interval for x successes in n trials (no continuity
 * correction) — R `prop.test(x, n, correct = FALSE)$conf.int`.
 */
export function wilsonInterval(x: number, n: number, conf = 0.95): ProportionInterval {
  if (!Number.isInteger(n) || n < 1) throw new StatsError("INVALID_ARGUMENT", "n must be a positive integer");
  if (!Number.isInteger(x) || x < 0 || x > n) throw new StatsError("INVALID_ARGUMENT", "x must be an integer in [0, n]");
  const z = zCritical(conf);
  const p = x / n;
  const z2n = (z * z) / (2 * n);
  const center = p + z2n;
  const half = z * Math.sqrt((p * (1 - p)) / n + z2n / (2 * n));
  const denom = 1 + 2 * z2n;
  return {
    estimate: p,
    // As in R: exact 0 / 1 bounds when x = 0 / x = n.
    lower: x === 0 ? 0 : Math.max(0, (center - half) / denom),
    upper: x === n ? 1 : Math.min(1, (center + half) / denom),
    level: conf,
  };
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export interface PearsonResult {
  method: string;
  r: number;
  /** t = r·sqrt(df / (1 - r²)); ±Infinity when |r| = 1. */
  t: number;
  df: number;
  pValue: number;
  /** Fisher-z CI; null when n < 4. */
  ci: ConfidenceInterval | null;
  n: number;
}

function correlationCore(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = meanOf(x);
  const my = meanOf(y);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const maxAbs = (v: readonly number[], center: number) => v.reduce((m, e) => Math.max(m, Math.abs(e - center)), 0);
  const sx = maxAbs(x, mx);
  const sy = maxAbs(y, my);
  const scaleX = Math.max(maxAbs(x, 0), Number.MIN_VALUE);
  const scaleY = Math.max(maxAbs(y, 0), Number.MIN_VALUE);
  if (sx <= 1e-14 * scaleX || sy <= 1e-14 * scaleY || sxx === 0 || syy === 0) {
    throw new StatsError("ZERO_VARIANCE", "correlation is undefined when x or y is constant");
  }
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

function correlationT(r: number, df: number): number {
  if (Math.abs(r) === 1) return r * Infinity;
  return r * Math.sqrt(df / (1 - r * r));
}

/**
 * Pearson product-moment correlation with t-test (df = n - 2) and Fisher-z
 * confidence interval, as R `cor.test(x, y)`. Requires n ≥ 3.
 */
export function pearson(x: readonly number[], y: readonly number[], conf = 0.95): PearsonResult {
  assertSameLength(x, y, "x and y");
  requireAtLeast(x, 3, "x");
  assertFiniteArray(x, "x");
  assertFiniteArray(y, "y");
  const zc = zCritical(conf);
  const n = x.length;
  const r = correlationCore(x, y);
  const df = n - 2;
  const t = correlationT(r, df);
  let ci: ConfidenceInterval | null = null;
  if (n >= 4) {
    const z = Math.atanh(r);
    const s = 1 / Math.sqrt(n - 3);
    ci = { lower: Math.tanh(z - zc * s), upper: Math.tanh(z + zc * s), level: conf };
  }
  return {
    method: "Pearson's product-moment correlation",
    r,
    t,
    df,
    pValue: Number.isFinite(t) ? tTwoSidedP(t, df) : 0,
    ci,
    n,
  };
}

export interface SpearmanResult {
  method: string;
  rho: number;
  /** R's S statistic: (n³ - n)(1 - rho) / 6. */
  statistic: number;
  pValue: number;
  n: number;
}

/**
 * Spearman rank correlation (Pearson on average ranks) with the asymptotic
 * t-approximation p-value — R `cor.test(x, y, method = "spearman", exact = FALSE)`.
 * Requires n ≥ 3.
 */
export function spearman(x: readonly number[], y: readonly number[]): SpearmanResult {
  assertSameLength(x, y, "x and y");
  requireAtLeast(x, 3, "x");
  assertFiniteArray(x, "x");
  assertFiniteArray(y, "y");
  const n = x.length;
  const rho = correlationCore(rankWithTies(x).ranks, rankWithTies(y).ranks);
  const t = correlationT(rho, n - 2);
  return {
    method: "Spearman's rank correlation (t approximation)",
    rho,
    statistic: ((n * n * n - n) * (1 - rho)) / 6,
    pValue: Number.isFinite(t) ? tTwoSidedP(t, n - 2) : 0,
    n,
  };
}
