/**
 * Linear and logistic regression.
 *
 * `X` is rows × predictors WITHOUT an intercept column; an intercept is
 * always added as the first coefficient, named "(Intercept)". Inputs must be
 * clean (no missing values). Collinear / duplicated predictors throw
 * `StatsError("SINGULAR_MATRIX")` (R would instead drop the aliased column
 * and report NA).
 */

import { normalQuantile, normalSf, fSf, studentTQuantile, tTwoSidedP } from "./distributions";
import { StatsError, assertBinary, assertFiniteArray, assertProbabilityOpen } from "./errors";
import { qrLeastSquares, type Matrix } from "./matrix";

function buildDesign(X: readonly (readonly number[])[], y: readonly number[], names: readonly string[]): Matrix {
  if (!Array.isArray(X) || !Array.isArray(y)) throw new StatsError("INVALID_ARGUMENT", "X and y must be arrays");
  if (X.length !== y.length) {
    throw new StatsError("LENGTH_MISMATCH", `X has ${X.length} rows but y has ${y.length} values`);
  }
  const p = names.length;
  X.forEach((row, i) => {
    if (row.length !== p) {
      throw new StatsError("LENGTH_MISMATCH", `X row ${i} has ${row.length} predictors but ${p} names were given`);
    }
    assertFiniteArray(row, `X[${i}]`);
  });
  assertFiniteArray(y, "y");
  return X.map((row) => [1, ...row]);
}

export interface LinearCoefficient {
  name: string;
  estimate: number;
  se: number;
  t: number;
  p: number;
  ciLower: number;
  ciUpper: number;
}

export interface LinearRegressionResult {
  coefficients: LinearCoefficient[];
  rSquared: number;
  adjRSquared: number;
  /** Overall F test against the intercept-only model; null when there are no predictors. */
  fStatistic: number | null;
  fDf1: number | null;
  fDf2: number | null;
  fPValue: number | null;
  /** Residual standard error sqrt(RSS / df). */
  residualSe: number;
  n: number;
  /** Residual degrees of freedom n - p - 1. */
  df: number;
  confLevel: number;
}

/**
 * Ordinary least squares via Householder QR, matching R `lm` /
 * `summary.lm` / `confint`. Requires n ≥ p + 2 (at least one residual df).
 * Throws ZERO_VARIANCE for a constant outcome and PERFECT_FIT when the
 * residual variance is negligible (R's "essentially perfect fit" condition),
 * since standard errors are then meaningless.
 */
export function linearRegression(
  X: readonly (readonly number[])[],
  y: readonly number[],
  names: readonly string[],
  conf = 0.95,
): LinearRegressionResult {
  assertProbabilityOpen(conf, "conf");
  const design = buildDesign(X, y, names);
  const n = y.length;
  const k = names.length + 1;
  if (n < k + 1) {
    throw new StatsError("INSUFFICIENT_DATA", `need at least ${k + 1} observations for ${k} coefficients (got ${n})`);
  }
  const fit = qrLeastSquares(design, y);
  const beta = fit.coefficients;
  const fitted = design.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (y[i] - fitted[i]) ** 2;
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let tss = 0;
  for (const v of y) tss += (v - yMean) ** 2;
  if (tss === 0) throw new StatsError("ZERO_VARIANCE", "outcome y is constant");
  const df = n - k;
  const resvar = rss / df;
  const fMean = fitted.reduce((s, v) => s + v, 0) / n;
  const fVar = fitted.reduce((s, v) => s + (v - fMean) ** 2, 0) / (n - 1);
  if (resvar < (fMean * fMean + fVar) * 1e-30) {
    throw new StatsError("PERFECT_FIT", "essentially perfect fit: residual variance is zero, standard errors are undefined");
  }
  const tCrit = studentTQuantile((1 + conf) / 2, df);
  const allNames = ["(Intercept)", ...names];
  const coefficients = beta.map((est, j) => {
    const se = Math.sqrt(resvar * fit.xtxInverse[j][j]);
    const t = est / se;
    return { name: allNames[j], estimate: est, se, t, p: tTwoSidedP(t, df), ciLower: est - tCrit * se, ciUpper: est + tCrit * se };
  });
  // As R summary.lm: model sum of squares from the fitted values, R² = MSS / (MSS + RSS).
  const p = k - 1;
  const mss = p > 0 ? fVar * (n - 1) : 0;
  const rSquared = mss / (mss + rss);
  let fStatistic: number | null = null;
  let fPValue: number | null = null;
  if (p > 0) {
    fStatistic = mss / p / resvar;
    fPValue = fSf(fStatistic, p, df);
  }
  return {
    coefficients,
    rSquared,
    adjRSquared: 1 - ((1 - rSquared) * (n - 1)) / df,
    fStatistic,
    fDf1: p > 0 ? p : null,
    fDf2: p > 0 ? df : null,
    fPValue,
    residualSe: Math.sqrt(resvar),
    n,
    df,
    confLevel: conf,
  };
}

export interface LogisticCoefficient {
  name: string;
  estimate: number;
  se: number;
  z: number;
  p: number;
  oddsRatio: number;
  orLower: number;
  orUpper: number;
}

export interface LogisticRegressionResult {
  coefficients: LogisticCoefficient[];
  logLik: number;
  deviance: number;
  nullDeviance: number;
  aic: number;
  n: number;
  events: number;
  converged: boolean;
  iterations: number;
  /**
   * Heuristic flag for (quasi-)complete separation: the fit did not converge,
   * or some fitted probability is within 1e-8 of 0 or 1, or a coefficient's
   * standard error is enormous relative to its predictor's spread. Estimates
   * and Wald CIs are then unreliable (consider Firth / exact methods).
   */
  separationWarning: boolean;
  confLevel: number;
}

const THRESH = 30;
const DBL_EPS = 2.220446049250313e-16;

/** Inverse logit with R's clamping at |eta| > 30. */
function linkinv(eta: number): number {
  if (eta < -THRESH) return DBL_EPS;
  if (eta > THRESH) return 1 - DBL_EPS;
  return 1 / (1 + Math.exp(-eta));
}

/** dmu/deta with R's floor at DBL_EPSILON. */
function muEta(eta: number): number {
  if (eta > THRESH || eta < -THRESH) return DBL_EPS;
  const e = Math.exp(-Math.abs(eta));
  return e / ((1 + e) * (1 + e));
}

function binomialDeviance(y: readonly number[], mu: readonly number[]): number {
  let dev = 0;
  for (let i = 0; i < y.length; i++) dev -= 2 * (y[i] === 1 ? Math.log(mu[i]) : Math.log1p(-mu[i]));
  return dev;
}

/**
 * Logistic regression (binomial, logit link) by IRLS / Fisher scoring, as R
 * `glm(y ~ ., family = binomial)`: starts from mu = (y + 0.5)/2, at most 50
 * iterations, converges when |Δdeviance| / (|deviance| + 0.1) < 1e-10, halving
 * the step if the deviance increases or becomes non-finite. Standard errors
 * come from the Fisher information at the final estimate; CIs are Wald
 * (R `confint.default`), exponentiated for odds ratios.
 */
export function logisticRegression(
  X: readonly (readonly number[])[],
  y: readonly number[],
  names: readonly string[],
  conf = 0.95,
): LogisticRegressionResult {
  assertProbabilityOpen(conf, "conf");
  const design = buildDesign(X, y, names);
  assertBinary(y, "y");
  const n = y.length;
  const k = names.length + 1;
  if (n < k + 1) {
    throw new StatsError("INSUFFICIENT_DATA", `need at least ${k + 1} observations for ${k} coefficients (got ${n})`);
  }
  const events = y.reduce((s, v) => s + v, 0);
  if (events === 0 || events === n) {
    throw new StatsError("ZERO_VARIANCE", "outcome has no variation (all 0 or all 1); logistic regression is undefined");
  }
  // Detect a rank-deficient design up front (independent of the IRLS weights).
  qrLeastSquares(design, y);

  const etaOf = (beta: readonly number[]) => design.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));

  let eta = y.map((v) => Math.log((v + 0.5) / (1.5 - v)));
  let mu = eta.map(linkinv);
  let devOld = binomialDeviance(y, mu);
  let beta: number[] | null = null;
  let converged = false;
  let iterations = 0;
  let stalled = false;

  for (let iter = 1; iter <= 50; iter++) {
    iterations = iter;
    const zw: number[] = [];
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) {
      const me = muEta(eta[i]);
      const w = (me * me) / (mu[i] * (1 - mu[i]));
      const z = eta[i] + (y[i] - mu[i]) / me;
      const s = Math.sqrt(w);
      zw.push(z * s);
      rows.push(design[i].map((v) => v * s));
    }
    let next: number[];
    try {
      next = qrLeastSquares(rows, zw).coefficients;
    } catch (error) {
      if (error instanceof StatsError && error.code === "SINGULAR_MATRIX" && beta !== null) {
        stalled = true; // weights collapsed (separation): keep the last finite estimate
        break;
      }
      throw error;
    }
    let newEta = etaOf(next);
    let newMu = newEta.map(linkinv);
    let dev = binomialDeviance(y, newMu);
    if (beta !== null) {
      let halvings = 0;
      while ((!Number.isFinite(dev) || dev > devOld * (1 + 1e-12) + 1e-12) && halvings < 30) {
        const prev: number[] = beta;
        next = next.map((b, j) => (b + prev[j]) / 2);
        newEta = etaOf(next);
        newMu = newEta.map(linkinv);
        dev = binomialDeviance(y, newMu);
        halvings++;
      }
    }
    if (!Number.isFinite(dev)) throw new StatsError("NO_CONVERGENCE", "deviance became non-finite during IRLS");
    beta = next;
    eta = newEta;
    mu = newMu;
    if (Math.abs(dev - devOld) / (Math.abs(dev) + 0.1) < 1e-10) {
      converged = true;
      devOld = dev;
      break;
    }
    devOld = dev;
  }
  if (beta === null) throw new StatsError("NO_CONVERGENCE", "IRLS failed on the first iteration");
  const finalBeta: number[] = beta;

  // Fisher information at the final estimate.
  const rows = design.map((row, i) => {
    const me = muEta(eta[i]);
    const s = Math.sqrt((me * me) / (mu[i] * (1 - mu[i])));
    return row.map((v) => v * s);
  });
  let xtwxInv: Matrix;
  try {
    xtwxInv = qrLeastSquares(rows, new Array<number>(n).fill(0)).xtxInverse;
  } catch (error) {
    if (error instanceof StatsError && error.code === "SINGULAR_MATRIX") {
      throw new StatsError(
        "SINGULAR_MATRIX",
        "information matrix is singular at the estimate (complete separation); Wald statistics are undefined",
      );
    }
    throw error;
  }

  const zCrit = normalQuantile((1 + conf) / 2);
  const allNames = ["(Intercept)", ...names];
  const coefficients = finalBeta.map((est, j) => {
    const se = Math.sqrt(xtwxInv[j][j]);
    const z = est / se;
    return {
      name: allNames[j],
      estimate: est,
      se,
      z,
      p: Math.min(1, 2 * normalSf(Math.abs(z))),
      oddsRatio: Math.exp(est),
      orLower: Math.exp(est - zCrit * se),
      orUpper: Math.exp(est + zCrit * se),
    };
  });

  // Separation heuristics.
  const fittedAtBoundary = mu.some((m) => m < 1e-8 || m > 1 - 1e-8);
  const hugeSe = coefficients.some((c, j) => {
    if (j === 0) return c.se > 1e3;
    const col = design.map((row) => row[j]);
    const m = col.reduce((s, v) => s + v, 0) / n;
    const sdx = Math.sqrt(col.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
    return sdx > 0 && c.se * sdx > 1e3;
  });
  const separationWarning = !converged || stalled || fittedAtBoundary || hugeSe;

  const pBar = events / n;
  const nullDeviance = -2 * (events * Math.log(pBar) + (n - events) * Math.log1p(-pBar));
  const deviance = devOld;
  return {
    coefficients,
    logLik: -deviance / 2,
    deviance,
    nullDeviance,
    aic: deviance + 2 * k,
    n,
    events,
    converged: converged && !stalled,
    iterations,
    separationWarning,
    confLevel: conf,
  };
}
