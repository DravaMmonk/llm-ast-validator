/**
 * Sample size and power for common two-group designs.
 *
 * Conventions: tests are two-sided by default; `ratio` = n2 / n1 (allocation
 * ratio); sample sizes are rounded UP to integers per group (n2 = ceil(ratio ·
 * n1) for designs solved in closed form). Results echo their inputs.
 */

import { noncentralTCdf, normalCdf, normalQuantile, studentTQuantile } from "./distributions";
import { StatsError, assertFiniteNumber, assertProbabilityOpen } from "./errors";

/** Ceiling that ignores floating-point noise just above an integer (e.g. 50.0000000001 -> 50). */
function ceilTolerant(x: number): number {
  return Math.ceil(x - 1e-9 * Math.max(1, Math.abs(x)));
}

function requirePositive(x: number, label: string): void {
  assertFiniteNumber(x, label);
  if (!(x > 0)) throw new StatsError("INVALID_ARGUMENT", `${label} must be > 0`);
}

function zAlpha(alpha: number, twoSided: boolean): number {
  assertProbabilityOpen(alpha, "alpha");
  return normalQuantile(1 - (twoSided ? alpha / 2 : alpha));
}

export interface SampleSizeResult<I> {
  /** Size of group 1 (or the single sample). */
  n1: number;
  /** Size of group 2 (0 for single-sample designs). */
  n2: number;
  total: number;
  /** Power actually achieved by the rounded sizes (where computable). */
  achievedPower: number | null;
  inputs: I;
}

// ---------------------------------------------------------------------------
// Two means (t-test)
// ---------------------------------------------------------------------------

export interface TwoMeansInputs {
  delta: number;
  sd: number;
  alpha: number;
  power: number;
  ratio: number;
  twoSided: boolean;
}

/**
 * Power of the two-sample (pooled-variance) t-test using the noncentral t
 * distribution: df = n1 + n2 - 2, ncp = |δ| / (sd·sqrt(1/n1 + 1/n2)),
 * power = P(T' > t_{1-α/2, df}). Like R `power.t.test` (strict = FALSE), the
 * negligible probability of rejecting in the wrong tail is ignored.
 */
function tTestPower(n1: number, n2: number, delta: number, sd: number, alpha: number, twoSided: boolean): number {
  const df = n1 + n2 - 2;
  const ncp = Math.abs(delta) / (sd * Math.sqrt(1 / n1 + 1 / n2));
  const crit = studentTQuantile(1 - (twoSided ? alpha / 2 : alpha), df);
  return 1 - noncentralTCdf(crit, df, ncp);
}

/**
 * Per-group sample size for comparing two means with a t-test: the smallest
 * n1 (with n2 = ceil(ratio·n1)) whose noncentral-t power reaches the target.
 * For ratio = 1 this equals ceiling(n) from R
 * `power.t.test(delta, sd, sig.level = alpha, power)`.
 */
export function sampleSizeTwoMeans(opts: {
  delta: number;
  sd: number;
  alpha?: number;
  power?: number;
  ratio?: number;
  twoSided?: boolean;
}): SampleSizeResult<TwoMeansInputs> {
  const { delta, sd, alpha = 0.05, power = 0.8, ratio = 1, twoSided = true } = opts;
  assertFiniteNumber(delta, "delta");
  if (delta === 0) throw new StatsError("INVALID_ARGUMENT", "delta must be non-zero");
  requirePositive(sd, "sd");
  requirePositive(ratio, "ratio");
  assertProbabilityOpen(power, "power");
  const za = zAlpha(alpha, twoSided);
  if (power <= (twoSided ? alpha / 2 : alpha)) throw new StatsError("INVALID_ARGUMENT", "power must exceed the significance level");
  const zb = normalQuantile(power);
  const n2Of = (n1: number) => Math.max(2, Math.ceil(ratio * n1 - 1e-9));
  const pw = (n1: number) => tTestPower(n1, n2Of(n1), delta, sd, alpha, twoSided);
  // Normal-approximation starting point, then exact integer search.
  const guess = (((za + zb) * sd) / delta) ** 2 * (1 + 1 / ratio);
  let n1 = Math.max(2, Math.floor(guess) - 1);
  while (pw(n1) < power) {
    n1++;
    if (n1 > 1e9) throw new StatsError("NO_CONVERGENCE", "required sample size exceeds 1e9");
  }
  while (n1 > 2 && pw(n1 - 1) >= power) n1--;
  const n2 = n2Of(n1);
  return { n1, n2, total: n1 + n2, achievedPower: pw(n1), inputs: { delta, sd, alpha, power, ratio, twoSided } };
}

export interface PowerResult<I> {
  power: number;
  n1: number;
  n2: number;
  inputs: I;
}

/**
 * Power of the two-sample t-test for given n1 and n2 = ratio·n1 (not rounded),
 * as R `power.t.test(n = n1, delta, sd, sig.level)` when ratio = 1.
 */
export function powerTwoMeans(opts: {
  n1: number;
  delta: number;
  sd: number;
  alpha?: number;
  ratio?: number;
  twoSided?: boolean;
}): PowerResult<{ delta: number; sd: number; alpha: number; ratio: number; twoSided: boolean }> {
  const { n1, delta, sd, alpha = 0.05, ratio = 1, twoSided = true } = opts;
  assertFiniteNumber(n1, "n1");
  assertFiniteNumber(delta, "delta");
  requirePositive(sd, "sd");
  requirePositive(ratio, "ratio");
  assertProbabilityOpen(alpha, "alpha");
  const n2 = n1 * ratio;
  if (!(n1 >= 2 && n2 >= 1 && n1 + n2 > 2)) throw new StatsError("INSUFFICIENT_DATA", "need n1 >= 2 and n1 + n2 > 2");
  const power = delta === 0 ? (twoSided ? alpha / 2 : alpha) : tTestPower(n1, n2, delta, sd, alpha, twoSided);
  return { power, n1, n2, inputs: { delta, sd, alpha, ratio, twoSided } };
}

// ---------------------------------------------------------------------------
// Two proportions (normal approximation)
// ---------------------------------------------------------------------------

export interface TwoProportionsInputs {
  p1: number;
  p2: number;
  alpha: number;
  power: number;
  ratio: number;
  continuityCorrection: boolean;
  twoSided: boolean;
}

function requireOpenProportion(p: number, label: string): void {
  assertFiniteNumber(p, label);
  if (!(p > 0 && p < 1)) throw new StatsError("INVALID_ARGUMENT", `${label} must be strictly between 0 and 1`);
}

/**
 * Per-group sample size for comparing two proportions (Fleiss, normal
 * approximation), with k = ratio = n2/n1 and p̄ = (p1 + k·p2)/(1 + k):
 *
 *   n1 = [z_{1-α/2}·sqrt(p̄q̄(1 + 1/k)) + z_{1-β}·sqrt(p1q1 + p2q2/k)]² / (p1 - p2)²
 *
 * With continuityCorrection (Fleiss, Tytun & Ury 1980):
 * n1' = n1/4 · (1 + sqrt(1 + 2(k + 1)/(k·n1·|p1 - p2|)))².
 * n1 = ceil(n1'), n2 = ceil(k·n1'). For k = 1 without correction this equals
 * ceiling(n) from R `power.prop.test(p1 = p1, p2 = p2, power = power)`.
 */
export function sampleSizeTwoProportions(opts: {
  p1: number;
  p2: number;
  alpha?: number;
  power?: number;
  ratio?: number;
  continuityCorrection?: boolean;
  twoSided?: boolean;
}): SampleSizeResult<TwoProportionsInputs> & { n1Exact: number } {
  const { p1, p2, alpha = 0.05, power = 0.8, ratio = 1, continuityCorrection = false, twoSided = true } = opts;
  requireOpenProportion(p1, "p1");
  requireOpenProportion(p2, "p2");
  if (p1 === p2) throw new StatsError("INVALID_ARGUMENT", "p1 and p2 must differ");
  requirePositive(ratio, "ratio");
  assertProbabilityOpen(power, "power");
  const za = zAlpha(alpha, twoSided);
  const zb = normalQuantile(power);
  const k = ratio;
  const pBar = (p1 + k * p2) / (1 + k);
  const delta = Math.abs(p1 - p2);
  let n1Exact =
    (za * Math.sqrt(pBar * (1 - pBar) * (1 + 1 / k)) + zb * Math.sqrt(p1 * (1 - p1) + (p2 * (1 - p2)) / k)) ** 2 / delta ** 2;
  if (continuityCorrection) {
    n1Exact = (n1Exact / 4) * (1 + Math.sqrt(1 + (2 * (k + 1)) / (k * n1Exact * delta))) ** 2;
  }
  const n1 = ceilTolerant(n1Exact);
  const n2 = ceilTolerant(k * n1Exact);
  const achievedPower = continuityCorrection
    ? null
    : powerTwoProportions({ n1, p1, p2, alpha, ratio: n2 / n1, twoSided }).power;
  return {
    n1,
    n2,
    total: n1 + n2,
    n1Exact,
    achievedPower,
    inputs: { p1, p2, alpha, power, ratio, continuityCorrection, twoSided },
  };
}

/**
 * Power for comparing two proportions (normal approximation, no continuity
 * correction) with n2 = ratio·n1:
 * Φ((|p1 - p2|·sqrt(n1) - z_{1-α/2}·sqrt(p̄q̄(1 + 1/k))) / sqrt(p1q1 + p2q2/k)).
 * Equals R `power.prop.test(n = n1, p1, p2)$power` for ratio = 1.
 */
export function powerTwoProportions(opts: {
  n1: number;
  p1: number;
  p2: number;
  alpha?: number;
  ratio?: number;
  twoSided?: boolean;
}): PowerResult<{ p1: number; p2: number; alpha: number; ratio: number; twoSided: boolean }> {
  const { n1, p1, p2, alpha = 0.05, ratio = 1, twoSided = true } = opts;
  requirePositive(n1, "n1");
  requireOpenProportion(p1, "p1");
  requireOpenProportion(p2, "p2");
  requirePositive(ratio, "ratio");
  const za = zAlpha(alpha, twoSided);
  const k = ratio;
  const pBar = (p1 + k * p2) / (1 + k);
  const num = Math.abs(p1 - p2) * Math.sqrt(n1) - za * Math.sqrt(pBar * (1 - pBar) * (1 + 1 / k));
  const power = normalCdf(num / Math.sqrt(p1 * (1 - p1) + (p2 * (1 - p2)) / k));
  return { power, n1, n2: n1 * k, inputs: { p1, p2, alpha, ratio, twoSided } };
}

// ---------------------------------------------------------------------------
// Precision and correlation
// ---------------------------------------------------------------------------

/**
 * Sample size to estimate a single proportion to within ±margin (normal
 * approximation): n = z²_{1-α/2}·p(1 - p) / margin², rounded up.
 */
export function sampleSizeOneProportion(opts: {
  p: number;
  margin: number;
  alpha?: number;
}): SampleSizeResult<{ p: number; margin: number; alpha: number }> & { nExact: number } {
  const { p, margin, alpha = 0.05 } = opts;
  assertFiniteNumber(p, "p");
  if (!(p >= 0 && p <= 1)) throw new StatsError("INVALID_ARGUMENT", "p must be in [0, 1]");
  requirePositive(margin, "margin");
  if (margin >= 1) throw new StatsError("INVALID_ARGUMENT", "margin must be < 1");
  const z = zAlpha(alpha, true);
  const nExact = (z * z * p * (1 - p)) / (margin * margin);
  const n = Math.max(1, ceilTolerant(nExact));
  return { n1: n, n2: 0, total: n, nExact, achievedPower: null, inputs: { p, margin, alpha } };
}

/**
 * Sample size to detect a correlation r ≠ 0 (Fisher z approximation):
 * n = ((z_{1-α/2} + z_{1-β}) / atanh(r))² + 3, rounded up.
 */
export function sampleSizeCorrelation(opts: {
  r: number;
  alpha?: number;
  power?: number;
  twoSided?: boolean;
}): SampleSizeResult<{ r: number; alpha: number; power: number; twoSided: boolean }> & { nExact: number } {
  const { r, alpha = 0.05, power = 0.8, twoSided = true } = opts;
  assertFiniteNumber(r, "r");
  if (!(Math.abs(r) > 0 && Math.abs(r) < 1)) throw new StatsError("INVALID_ARGUMENT", "r must satisfy 0 < |r| < 1");
  assertProbabilityOpen(power, "power");
  const za = zAlpha(alpha, twoSided);
  const zb = normalQuantile(power);
  const nExact = ((za + zb) / Math.atanh(Math.abs(r))) ** 2 + 3;
  const n = ceilTolerant(nExact);
  return { n1: n, n2: 0, total: n, nExact, achievedPower: null, inputs: { r, alpha, power, twoSided } };
}

/**
 * Evaluates `fn` on an evenly spaced grid (inclusive) — e.g. power as a
 * function of n or effect size, for plotting. Points where `fn` throws a
 * StatsError are omitted.
 */
export function powerCurve(
  fn: (x: number) => number,
  range: { from: number; to: number; steps: number },
): { x: number; y: number }[] {
  const { from, to, steps } = range;
  assertFiniteNumber(from, "from");
  assertFiniteNumber(to, "to");
  if (!Number.isInteger(steps) || steps < 2 || steps > 10_000) {
    throw new StatsError("INVALID_ARGUMENT", "steps must be an integer between 2 and 10000");
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const x = from + ((to - from) * i) / (steps - 1);
    try {
      const y = fn(x);
      if (Number.isFinite(y)) out.push({ x, y });
    } catch (error) {
      if (!(error instanceof StatsError)) throw error;
    }
  }
  return out;
}
