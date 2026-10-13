/**
 * Special functions and probability distributions.
 *
 * Accuracy targets (verified against R 4.5 in distributions.test.ts):
 * - logGamma: Lanczos (g = 7) below 10, Stirling series with the R
 *   `lgammacor` correction above, ~1e-15 relative.
 * - normalCdf: W. J. Cody's rational Chebyshev approximation (the algorithm
 *   behind R's `pnorm`), accurate to full double precision in both tails.
 * - normalQuantile: Wichura's AS 241 (PPND16, the algorithm behind R's
 *   `qnorm`), ~1e-16 relative.
 * - Incomplete gamma: series / Lentz continued fraction (Numerical Recipes).
 * - Incomplete beta: Lentz continued fraction; the smaller tail is always
 *   computed directly, so tiny p-values keep their relative accuracy.
 * - Student t quantile: safeguarded Newton iteration on the exact CDF.
 *
 * Domain violations throw `StatsError("INVALID_ARGUMENT")`; nothing returns NaN.
 */

import { StatsError } from "./errors";

const EPS = 1e-16;
const FPMIN = 1e-300;
const MAX_ITER = 100_000;
const LN_SQRT_2PI = 0.918938533204672741780329736406; // log(sqrt(2*pi))
const INV_SQRT_2PI = 0.398942280401432677939946059934; // 1/sqrt(2*pi)
const SQRT_32 = 5.656854249492380195206754896838;
const LN_SQRT_PI = 0.572364942924700087071713675677; // log(sqrt(pi))

function requireNumber(x: number, label: string): void {
  if (typeof x !== "number" || Number.isNaN(x)) {
    throw new StatsError("INVALID_ARGUMENT", `${label} must be a number (got NaN)`);
  }
}

function requirePositive(x: number, label: string): void {
  if (typeof x !== "number" || !(x > 0)) {
    throw new StatsError("INVALID_ARGUMENT", `${label} must be > 0`);
  }
}

function requireProbability(p: number, label = "p"): void {
  if (typeof p !== "number" || !(p >= 0 && p <= 1)) {
    throw new StatsError("INVALID_ARGUMENT", `${label} must be in [0, 1]`);
  }
}

// ---------------------------------------------------------------------------
// Gamma / beta functions
// ---------------------------------------------------------------------------

/** Stirling-series remainder: logGamma(x) - [(x-0.5)log x - x + log sqrt(2pi)], x >= 10. */
function lgammacor(x: number): number {
  const x2 = 1 / (x * x);
  // Bernoulli-number series; truncation error < 1e-17 for x >= 10.
  return (
    (1 / x) *
    (1 / 12 +
      x2 *
        (-1 / 360 +
          x2 * (1 / 1260 + x2 * (-1 / 1680 + x2 * (1 / 1188 + x2 * (-691 / 360360 + x2 * (1 / 156)))))))
  );
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/**
 * log|Γ(x)|. Defined for x > 0 and for negative non-integers (via reflection).
 * Throws INVALID_ARGUMENT at the poles x = 0, -1, -2, ...
 */
export function logGamma(x: number): number {
  requireNumber(x, "x");
  if (x === Infinity) return Infinity;
  if (x <= 0 && Number.isInteger(x)) {
    throw new StatsError("INVALID_ARGUMENT", "logGamma is undefined at non-positive integers");
  }
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  if (x >= 10) {
    return (x - 0.5) * Math.log(x) - x + LN_SQRT_2PI + lgammacor(x);
  }
  const z = x - 1;
  let s = LANCZOS[0];
  for (let i = 1; i < 9; i++) s += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return LN_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(s);
}

/** log B(a, b) computed without catastrophic cancellation for large arguments (after R's lbeta). */
export function logBeta(a: number, b: number): number {
  requirePositive(a, "a");
  requirePositive(b, "b");
  const p = Math.min(a, b);
  const q = Math.max(a, b);
  if (p >= 10) {
    const corr = lgammacor(p) + lgammacor(q) - lgammacor(p + q);
    return -0.5 * Math.log(q) + LN_SQRT_2PI + corr + (p - 0.5) * Math.log(p / (p + q)) + q * Math.log1p(-p / (p + q));
  }
  if (q >= 10) {
    const corr = lgammacor(q) - lgammacor(p + q);
    return logGamma(p) + corr + p - p * Math.log(p + q) + (q - 0.5) * Math.log1p(-p / (p + q));
  }
  return logGamma(p) + logGamma(q) - logGamma(p + q);
}

/** Series representation of P(a, x); converges quickly for x < a + 1. */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < MAX_ITER; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Lentz continued fraction for Q(a, x); converges quickly for x >= a + 1. */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularized lower incomplete gamma P(a, x) = γ(a, x) / Γ(a); a > 0, x >= 0. */
export function regularizedGammaP(a: number, x: number): number {
  requirePositive(a, "a");
  requireNumber(x, "x");
  if (x < 0) throw new StatsError("INVALID_ARGUMENT", "x must be >= 0");
  if (x === 0) return 0;
  if (x === Infinity) return 1;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaContinuedFraction(a, x);
}

/** Regularized upper incomplete gamma Q(a, x) = 1 - P(a, x), computed directly in the upper tail. */
export function regularizedGammaQ(a: number, x: number): number {
  requirePositive(a, "a");
  requireNumber(x, "x");
  if (x < 0) throw new StatsError("INVALID_ARGUMENT", "x must be >= 0");
  if (x === 0) return 1;
  if (x === Infinity) return 0;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaContinuedFraction(a, x);
}

/** Lentz continued fraction for I_x(a, b) (Numerical Recipes `betacf`), with y = 1 - x supplied exactly. */
function betaContinuedFraction(x: number, logX: number, logY: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  const front = Math.exp(a * logX + b * logY - logBeta(a, b));
  return (front * h) / a;
}

/**
 * Regularized incomplete beta, choosing the tail. `y` must equal 1 - x but is
 * passed separately (optionally with precomputed logs) so callers can supply
 * it without cancellation; this matters when a or b is large.
 */
function betaTail(
  x: number,
  y: number,
  a: number,
  b: number,
  upper: boolean,
  logX: number = Math.log(x),
  logY: number = Math.log(y),
): number {
  if (x <= 0) return upper ? 1 : 0;
  if (y <= 0) return upper ? 0 : 1;
  if (x < (a + 1) / (a + b + 2)) {
    const lower = betaContinuedFraction(x, logX, logY, a, b);
    return upper ? 1 - lower : lower;
  }
  const up = betaContinuedFraction(y, logY, logX, b, a);
  return upper ? up : 1 - up;
}

/**
 * Incomplete beta at x = r/(1+r), y = 1/(1+r) for a ratio r >= 0, with the
 * logarithms computed from r via log1p (no rounding of x near 1).
 */
function betaTailRatio(r: number, a: number, b: number, upper: boolean): number {
  if (r <= 0) return upper ? 1 : 0;
  if (r === Infinity) return upper ? 0 : 1;
  // x = 1/(1 + 1/r) and y = 1/(1 + r): both logs are accurate via log1p for any r.
  return betaTail(r / (1 + r), 1 / (1 + r), a, b, upper, -Math.log1p(1 / r), -Math.log1p(r));
}

/** Regularized incomplete beta I_x(a, b) for x in [0, 1], a, b > 0 (continued fraction, Lentz). */
export function regularizedBeta(x: number, a: number, b: number): number {
  requirePositive(a, "a");
  requirePositive(b, "b");
  requireProbability(x, "x");
  return betaTail(x, 1 - x, a, b, false);
}

// ---------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------

/** Standard normal density. */
export function normalPdf(z: number): number {
  requireNumber(z, "z");
  if (!Number.isFinite(z)) return 0;
  return INV_SQRT_2PI * Math.exp(-0.5 * z * z);
}

const CODY_A = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582, 18154.981253343561249, 0.065682337918207449113];
const CODY_B = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205, 45507.789335026729956];
const CODY_C = [
  0.39894151208813466764, 8.8831497943883759412, 93.506656132177855979, 597.27027639480026226,
  2494.5375852903726711, 6848.1904505362823326, 11602.651437647350124, 9842.7148383839780218,
  1.0765576773720192317e-8,
];
const CODY_D = [
  22.266688044328115691, 235.38790178262499861, 1519.377599407554805, 6485.558298266760755,
  18615.571640885098091, 34900.952721145977266, 38912.003286093271411, 19685.429676859990727,
];
const CODY_P = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807, 0.001421619193227893466, 2.9112874951168792e-5, 0.02307344176494017303];
const CODY_Q = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515, 0.00378239633202758244, 7.29751555083966205e-5];

/** Returns [lower, upper] tail probabilities of N(0, 1) at x (Cody 1969, as in R's pnorm_both). */
function normalBoth(x: number): [number, number] {
  const y = Math.abs(x);
  let cum: number;
  let ccum: number;
  if (y <= 0.67448975) {
    let xnum = 0;
    let xden = 0;
    if (y > 1.11e-16) {
      const xsq = x * x;
      xnum = CODY_A[4] * xsq;
      xden = xsq;
      for (let i = 0; i < 3; i++) {
        xnum = (xnum + CODY_A[i]) * xsq;
        xden = (xden + CODY_B[i]) * xsq;
      }
    }
    const temp = (x * (xnum + CODY_A[3])) / (xden + CODY_B[3]);
    return [0.5 + temp, 0.5 - temp];
  }
  if (y <= SQRT_32) {
    let xnum = CODY_C[8] * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + CODY_C[i]) * y;
      xden = (xden + CODY_D[i]) * y;
    }
    const temp = (xnum + CODY_C[7]) / (xden + CODY_D[7]);
    const xsq = Math.trunc(y * 16) / 16;
    const del = (y - xsq) * (y + xsq);
    cum = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
    ccum = 1 - cum;
  } else {
    if (y > 38.5) {
      cum = 0;
      ccum = 1;
    } else {
      const xsq0 = 1 / (x * x);
      let xnum = CODY_P[5] * xsq0;
      let xden = xsq0;
      for (let i = 0; i < 4; i++) {
        xnum = (xnum + CODY_P[i]) * xsq0;
        xden = (xden + CODY_Q[i]) * xsq0;
      }
      let temp = (xsq0 * (xnum + CODY_P[4])) / (xden + CODY_Q[4]);
      temp = (INV_SQRT_2PI - temp) / y;
      const xsq = Math.trunc(x * 16) / 16;
      const del = (x - xsq) * (x + xsq);
      cum = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
      ccum = 1 - cum;
    }
  }
  return x > 0 ? [ccum, cum] : [cum, ccum];
}

/** Standard normal CDF Φ(z), accurate to full relative precision in both tails. */
export function normalCdf(z: number): number {
  requireNumber(z, "z");
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  return normalBoth(z)[0];
}

/** Standard normal survival function 1 - Φ(z), computed without cancellation. */
export function normalSf(z: number): number {
  requireNumber(z, "z");
  if (z === Infinity) return 0;
  if (z === -Infinity) return 1;
  return normalBoth(z)[1];
}

/**
 * Standard normal quantile Φ⁻¹(p), Wichura (1988) AS 241 PPND16.
 * Returns -Infinity / Infinity for p = 0 / 1.
 */
export function normalQuantile(p: number): number {
  requireProbability(p);
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1)
    );
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let val: number;
  if (r <= 5) {
    r -= 1.6;
    val =
      (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
        1.27045825245236838258) *
        r +
        3.64784832476320460504) *
        r +
        5.7694972214606914055) *
        r +
        4.6303378461565452959) *
        r +
        1.42343711074968357734) /
      (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
        0.14810397642748007459) *
        r +
        0.68976733498510000455) *
        r +
        1.6763848301838038494) *
        r +
        2.05319162663775882187) *
        r +
        1);
  } else {
    r -= 5;
    val =
      (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
        0.026532189526576123093) *
        r +
        0.29656057182850489123) *
        r +
        1.7848265399172913358) *
        r +
        5.4637849111641143699) *
        r +
        6.6579046435011037772) /
      (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
        7.868691311456132591e-4) *
        r +
        0.0148753612908506148525) *
        r +
        0.13692988092273580531) *
        r +
        0.59983220655588793769) *
        r +
        1);
  }
  return q < 0 ? -val : val;
}

// ---------------------------------------------------------------------------
// Student t
// ---------------------------------------------------------------------------

/** Student t density with `df` > 0 degrees of freedom (df = Infinity gives the normal). */
export function studentTPdf(t: number, df: number): number {
  requireNumber(t, "t");
  requirePositive(df, "df");
  if (df === Infinity) return normalPdf(t);
  if (!Number.isFinite(t)) return 0;
  return Math.exp(-logBeta(0.5, df / 2) - 0.5 * Math.log(df) - ((df + 1) / 2) * Math.log1p((t * t) / df));
}

/** P(T > |t|) for T ~ t(df), computed directly (no cancellation). */
function tUpperTailAbs(t: number, df: number): number {
  const at = Math.abs(t);
  if (at === Infinity) return 0;
  if (df === Infinity) return normalSf(at);
  // P(|T| > t) = I_{df/(df+t²)}(df/2, 1/2); with r = df/t², x = r/(1+r).
  return 0.5 * betaTailRatio(df / (at * at), df / 2, 0.5, false);
}

/** Student t CDF P(T <= t), df > 0 (non-integer df allowed, e.g. Welch). */
export function studentTCdf(t: number, df: number): number {
  requireNumber(t, "t");
  requirePositive(df, "df");
  const tail = tUpperTailAbs(t, df);
  return t > 0 ? 1 - tail : tail;
}

/** Two-sided p-value P(|T| >= |t|), computed directly in the tail. */
export function tTwoSidedP(t: number, df: number): number {
  requireNumber(t, "t");
  requirePositive(df, "df");
  return Math.min(1, 2 * tUpperTailAbs(t, df));
}

/**
 * Student t quantile: the t with P(T <= t) = p. Closed forms for df = 1, 2;
 * otherwise safeguarded Newton iteration (bracketed, in log-tail space) on the
 * exact CDF, converged to ~1e-15 relative.
 */
export function studentTQuantile(p: number, df: number): number {
  requireProbability(p);
  requirePositive(df, "df");
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  if (df === Infinity) return normalQuantile(p);
  const sign = p < 0.5 ? -1 : 1;
  const tail = p < 0.5 ? p : 1 - p; // target upper-tail probability for |t|
  if (df === 1) return sign * Math.tan(Math.PI * (0.5 - tail));
  if (df === 2) return (sign * (1 - 2 * tail)) / Math.sqrt(2 * tail * (1 - tail));

  // Bracket [lo, hi] with tail(lo) > target > tail(hi).
  let lo = 0;
  let hi = Math.max(1, -normalQuantile(tail));
  while (tUpperTailAbs(hi, df) > tail) {
    lo = hi;
    hi *= 2;
    if (hi > 1e300) return sign * Infinity;
  }
  let t = Math.max(-normalQuantile(tail), (lo + hi) / 2);
  if (!(t > lo && t < hi)) t = (lo + hi) / 2;
  const logTarget = Math.log(tail);
  for (let i = 0; i < 200; i++) {
    const s = tUpperTailAbs(t, df);
    const f = Math.log(s) - logTarget; // decreasing in t
    if (f > 0) lo = t;
    else hi = t;
    const deriv = -studentTPdf(t, df) / s;
    let next = t - f / deriv;
    if (!(next > lo && next < hi) || !Number.isFinite(next)) next = (lo + hi) / 2;
    if (Math.abs(next - t) <= 1e-15 * Math.max(1, Math.abs(t)) || hi - lo <= 1e-15 * hi) {
      t = next;
      break;
    }
    t = next;
  }
  return sign * t;
}

// ---------------------------------------------------------------------------
// Chi-square and F
// ---------------------------------------------------------------------------

/** Chi-square CDF P(X <= x), df > 0. */
export function chiSquareCdf(x: number, df: number): number {
  requireNumber(x, "x");
  requirePositive(df, "df");
  if (x <= 0) return 0;
  return regularizedGammaP(df / 2, x / 2);
}

/** Chi-square survival function P(X > x), computed directly in the upper tail. */
export function chiSquareSf(x: number, df: number): number {
  requireNumber(x, "x");
  requirePositive(df, "df");
  if (x <= 0) return 1;
  return regularizedGammaQ(df / 2, x / 2);
}

/** F distribution CDF P(F <= x) with (d1, d2) degrees of freedom. */
export function fCdf(x: number, d1: number, d2: number): number {
  requireNumber(x, "x");
  requirePositive(d1, "d1");
  requirePositive(d2, "d2");
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  return betaTailRatio((d1 * x) / d2, d1 / 2, d2 / 2, false);
}

/** F distribution survival function P(F > x), computed directly in the upper tail. */
export function fSf(x: number, d1: number, d2: number): number {
  requireNumber(x, "x");
  requirePositive(d1, "d1");
  requirePositive(d2, "d2");
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  return betaTailRatio((d1 * x) / d2, d1 / 2, d2 / 2, true);
}

// ---------------------------------------------------------------------------
// Noncentral t (used for power of t-tests)
// ---------------------------------------------------------------------------

/**
 * Noncentral t CDF P(T <= t) with `df` degrees of freedom and noncentrality
 * `ncp` — Lenth (1989) AS 243, as implemented in R's `pnt`. Absolute accuracy
 * ~1e-12, adequate for power calculations (not for extreme tails).
 */
export function noncentralTCdf(t: number, df: number, ncp: number): number {
  requireNumber(t, "t");
  requireNumber(ncp, "ncp");
  requirePositive(df, "df");
  if (ncp === 0) return studentTCdf(t, df);
  if (t === Infinity) return 1;
  if (t === -Infinity) return 0;

  let negdel: boolean;
  let tt: number;
  let del: number;
  if (t >= 0) {
    negdel = false;
    tt = t;
    del = ncp;
  } else {
    // P(T <= t; ncp) = 1 - P(T <= -t; -ncp), handled at the end.
    if (ncp > 40) return 0;
    negdel = true;
    tt = -t;
    del = -ncp;
  }

  if (df > 4e5 || del * del > 2 * Math.LN2 * 1021) {
    // Abramowitz & Stegun 26.7.10 normal approximation for huge df / ncp.
    const s = 1 / (4 * df);
    const z = (tt * (1 - s) - del) / Math.sqrt(1 + tt * tt * 2 * s);
    const lowerVal = normalCdf(z);
    return negdel ? 1 - lowerVal : lowerVal;
  }

  const x = (t * t) / (t * t + df);
  let tnc: number;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda);
    let q = Math.sqrt(2 / Math.PI) * p * del;
    let s = 0.5 - p;
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda);
    let a = 0.5;
    const b = 0.5 * df;
    const rxb = Math.pow(df / (t * t + df), b);
    const albeta = LN_SQRT_PI + logGamma(b) - logGamma(0.5 + b);
    let xodd = betaTail(x, df / (t * t + df), a, b, false);
    let godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta);
    const bx = b * x;
    let xeven = bx < 2.220446e-16 ? bx : 1 - rxb;
    let geven = bx * rxb;
    tnc = p * xodd + q * xeven;
    for (let it = 1; it <= 1000; it++) {
      a += 1;
      xodd -= godd;
      xeven -= geven;
      godd *= (x * (a + b - 1)) / a;
      geven *= (x * (a + b - 0.5)) / (a + 0.5);
      p *= lambda / (2 * it);
      q *= lambda / (2 * it + 1);
      tnc += p * xodd + q * xeven;
      s -= p;
      if (s < -1e-10) break;
      if (s <= 0 && it > 1) break;
      const errbd = 2 * s * (xodd - godd);
      if (Math.abs(errbd) < 1e-12 && it > 1) break;
    }
  } else {
    tnc = 0;
  }
  tnc += normalCdf(-del);
  tnc = Math.min(Math.max(tnc, 0), 1);
  return negdel ? 1 - tnc : tnc;
}
