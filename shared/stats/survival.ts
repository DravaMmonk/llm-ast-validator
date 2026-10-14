/**
 * Survival analysis: Kaplan–Meier, log-rank test, Cox proportional hazards.
 *
 * Conventions: `time` is a non-negative follow-up time; `event` is 1 for an
 * observed event and 0 for right-censoring. At tied times, events are taken
 * to occur before censorings (standard convention, as in R `survival`).
 */

import { chiSquareSf, normalQuantile, normalSf } from "./distributions";
import { StatsError, assertBinary, assertFiniteArray, assertProbabilityOpen, assertSameLength } from "./errors";
import { invert, invertSymmetricPositiveDefinite, type Matrix } from "./matrix";

function validateSurvival(time: readonly number[], event: readonly number[]): void {
  assertSameLength(time, event, "time and event");
  if (time.length === 0) throw new StatsError("EMPTY_INPUT", "no observations");
  assertFiniteArray(time, "time");
  assertBinary(event, "event");
  for (let i = 0; i < time.length; i++) {
    if (time[i] < 0) throw new StatsError("INVALID_ARGUMENT", `time[${i}] is negative`);
  }
}

// ---------------------------------------------------------------------------
// Kaplan–Meier
// ---------------------------------------------------------------------------

export interface KaplanMeierStep {
  time: number;
  nRisk: number;
  nEvent: number;
  nCensor: number;
  survival: number;
  /** Greenwood standard error of S(t) (on the survival scale); null when S(t) = 0. */
  se: number | null;
  /** Pointwise CI, conf.type = "log" (R's default); null when S(t) = 0. */
  lower: number | null;
  upper: number | null;
}

export interface KaplanMeierResult {
  steps: KaplanMeierStep[];
  /** Median survival time; null if the curve never reaches 0.5. */
  median: number | null;
  /** CI for the median from the lower / upper pointwise curves; null if not reached. */
  medianLower: number | null;
  medianUpper: number | null;
  n: number;
  events: number;
  confLevel: number;
}

/**
 * Kaplan–Meier estimator with Greenwood variance and R's default
 * `conf.type = "log"` pointwise intervals: exp(log S ± z·sqrt(Σ d/(n(n-d)))),
 * upper bound truncated at 1. One step per distinct observed time (events
 * or censorings), like `summary(survfit(...), censored = TRUE)`.
 *
 * Median (and its CI) follow R's `print.survfit`: the first time at which the
 * curve is ≤ 0.5; if the curve is exactly 0.5 there (within sqrt(ε)) and
 * later drops below, the midpoint between that time and the time of the next
 * drop. The CI applies the same rule to the lower and upper curves.
 */
export function kaplanMeier(time: readonly number[], event: readonly (0 | 1)[], conf = 0.95): KaplanMeierResult {
  validateSurvival(time, event);
  assertProbabilityOpen(conf, "conf");
  const z = normalQuantile((1 + conf) / 2);
  const n = time.length;
  const order = time.map((_, i) => i).sort((a, b) => time[a] - time[b]);
  const steps: KaplanMeierStep[] = [];
  let atRisk = n;
  let surv = 1;
  let greenwood = 0;
  let i = 0;
  let events = 0;
  while (i < n) {
    const t = time[order[i]];
    let d = 0;
    let c = 0;
    while (i < n && time[order[i]] === t) {
      if (event[order[i]] === 1) d++;
      else c++;
      i++;
    }
    events += d;
    if (d > 0) {
      surv *= 1 - d / atRisk;
      greenwood = d < atRisk ? greenwood + d / (atRisk * (atRisk - d)) : Infinity;
    }
    let se: number | null = null;
    let lower: number | null = null;
    let upper: number | null = null;
    if (surv > 0) {
      const sdLog = Math.sqrt(greenwood);
      se = surv * sdLog;
      lower = Math.exp(Math.log(surv) - z * sdLog);
      upper = Math.min(1, Math.exp(Math.log(surv) + z * sdLog));
    }
    steps.push({ time: t, nRisk: atRisk, nEvent: d, nCensor: c, survival: surv, se, lower, upper });
    atRisk -= d + c;
  }
  const times = steps.map((s) => s.time);
  return {
    steps,
    median: survivalMedian(times, steps.map((s) => s.survival)),
    medianLower: survivalMedian(times, steps.map((s) => s.lower)),
    medianUpper: survivalMedian(times, steps.map((s) => s.upper)),
    n,
    events,
    confLevel: conf,
  };
}

/** R survival's `minmin` rule (print.survfit / survmean) for the 0.5 crossing. */
function survivalMedian(times: readonly number[], curve: readonly (number | null)[]): number | null {
  const tol = Math.sqrt(2.220446049250313e-16);
  const keptT: number[] = [];
  const keptY: number[] = [];
  curve.forEach((y, i) => {
    if (y !== null && y < 0.5 + tol) {
      keptT.push(times[i]);
      keptY.push(y);
    }
  });
  if (keptT.length === 0) return null;
  if (Math.abs(keptY[0] - 0.5) < tol) {
    const drop = keptY.findIndex((y) => y < keptY[0]);
    if (drop >= 0) return (keptT[0] + keptT[drop]) / 2;
  }
  return keptT[0];
}

// ---------------------------------------------------------------------------
// Log-rank test
// ---------------------------------------------------------------------------

export interface LogRankGroup {
  group: string;
  n: number;
  observed: number;
  expected: number;
}

export interface LogRankResult {
  method: string;
  statistic: number;
  df: number;
  pValue: number;
  /** Groups in ascending (code-unit) order of their labels, like R factor levels. */
  groups: LogRankGroup[];
}

/**
 * Log-rank (Mantel–Cox) test comparing k ≥ 2 groups, as R
 * `survival::survdiff(Surv(time, event) ~ group)` (rho = 0), with the
 * hypergeometric variance matrix. Groups with zero expected events are
 * dropped from the quadratic form (df = remaining groups - 1), as in R.
 */
export function logRankTest(time: readonly number[], event: readonly (0 | 1)[], group: readonly string[]): LogRankResult {
  validateSurvival(time, event);
  assertSameLength(time, group, "time and group");
  const labels = [...new Set(group)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const k = labels.length;
  if (k < 2) throw new StatsError("INSUFFICIENT_DATA", "log-rank test needs at least 2 groups");
  const gIndex = new Map(labels.map((l, i) => [l, i]));
  const g = group.map((l) => gIndex.get(l) as number);
  const n = time.length;
  if (!event.some((e) => e === 1)) throw new StatsError("INSUFFICIENT_DATA", "no events observed");

  const order = time.map((_, i) => i).sort((a, b) => time[a] - time[b]);
  const atRisk = new Array<number>(k).fill(0);
  g.forEach((gi) => atRisk[gi]++);
  const sizes = [...atRisk];
  const observed = new Array<number>(k).fill(0);
  const expected = new Array<number>(k).fill(0);
  const V: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  let i = 0;
  while (i < n) {
    const t = time[order[i]];
    const dg = new Array<number>(k).fill(0);
    const leaving = new Array<number>(k).fill(0);
    while (i < n && time[order[i]] === t) {
      const idx = order[i];
      if (event[idx] === 1) dg[g[idx]]++;
      leaving[g[idx]]++;
      i++;
    }
    const d = dg.reduce((s, v) => s + v, 0);
    const nt = atRisk.reduce((s, v) => s + v, 0);
    if (d > 0) {
      for (let a = 0; a < k; a++) {
        observed[a] += dg[a];
        expected[a] += (atRisk[a] * d) / nt;
      }
      if (nt > 1) {
        const factor = (d * (nt - d)) / (nt - 1);
        for (let a = 0; a < k; a++) {
          const pa = atRisk[a] / nt;
          for (let b = 0; b < k; b++) {
            const pb = atRisk[b] / nt;
            V[a][b] += factor * pa * ((a === b ? 1 : 0) - pb);
          }
        }
      }
    }
    for (let a = 0; a < k; a++) atRisk[a] -= leaving[a];
  }

  const keep = expected.map((e, idx) => (e > 0 ? idx : -1)).filter((idx) => idx >= 0);
  if (keep.length < 2) throw new StatsError("INSUFFICIENT_DATA", "fewer than 2 groups have subjects at risk at event times");
  const sub = keep.slice(1);
  const diff = sub.map((a) => observed[a] - expected[a]);
  const vv = sub.map((a) => sub.map((b) => V[a][b]));
  const vInv = invert(vv);
  let chi = 0;
  for (let a = 0; a < sub.length; a++) for (let b = 0; b < sub.length; b++) chi += diff[a] * vInv[a][b] * diff[b];
  chi = Math.max(0, chi);
  const df = keep.length - 1;
  return {
    method: "Log-rank test",
    statistic: chi,
    df,
    pValue: chiSquareSf(chi, df),
    groups: labels.map((label, idx) => ({ group: label, n: sizes[idx], observed: observed[idx], expected: expected[idx] })),
  };
}

// ---------------------------------------------------------------------------
// Cox proportional hazards
// ---------------------------------------------------------------------------

export interface CoxCoefficient {
  name: string;
  estimate: number;
  se: number;
  z: number;
  p: number;
  hazardRatio: number;
  hrLower: number;
  hrUpper: number;
}

export interface CoxRegressionResult {
  coefficients: CoxCoefficient[];
  /** Partial log-likelihood at the estimate. */
  logLik: number;
  /** Partial log-likelihood at β = 0. */
  logLikNull: number;
  /** Likelihood-ratio statistic 2(logLik - logLikNull). */
  likelihoodRatio: number;
  lrDf: number;
  lrPValue: number;
  n: number;
  events: number;
  converged: boolean;
  iterations: number;
  /**
   * Monotone likelihood (a coefficient drifting to ±∞, e.g. no events in one
   * level of a binary covariate): the remaining Newton step is not negligible
   * relative to the coefficient (R's "coefficient may be infinite" rule).
   */
  separationWarning: boolean;
  confLevel: number;
}

interface CoxEval {
  loglik: number;
  score: number[];
  info: Matrix;
}

/**
 * Cox proportional-hazards regression with the Breslow approximation for
 * ties — R `coxph(Surv(time, event) ~ ., ties = "breslow")`. Newton–Raphson
 * from β = 0 with step halving when the partial likelihood decreases; at
 * most 50 iterations, converged when the relative change in log-likelihood
 * is < 1e-12. Covariates are centred internally for stability. SEs come
 * from the inverse observed information; CIs are Wald, exponentiated.
 */
export function coxRegression(
  time: readonly number[],
  event: readonly (0 | 1)[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  conf = 0.95,
): CoxRegressionResult {
  validateSurvival(time, event);
  assertProbabilityOpen(conf, "conf");
  assertSameLength(time, X, "time and X");
  const p = names.length;
  if (p === 0) throw new StatsError("INVALID_ARGUMENT", "at least one covariate is required");
  X.forEach((row, i) => {
    if (row.length !== p) throw new StatsError("LENGTH_MISMATCH", `X row ${i} has ${row.length} covariates but ${p} names were given`);
    assertFiniteArray(row, `X[${i}]`);
  });
  const n = time.length;
  const events = event.reduce<number>((s, e) => s + e, 0);
  if (events === 0) throw new StatsError("INSUFFICIENT_DATA", "no events observed");

  const means = Array.from({ length: p }, (_, j) => X.reduce((s, row) => s + row[j], 0) / n);
  const Z = X.map((row) => row.map((v, j) => v - means[j]));
  // Process subjects from the latest time to the earliest so risk sets accumulate.
  const order = time.map((_, i) => i).sort((a, b) => time[b] - time[a]);

  const evaluate = (beta: readonly number[]): CoxEval => {
    const eta = Z.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
    const shift = eta.reduce((m, v) => Math.max(m, v), -Infinity);
    let s0 = 0;
    const s1 = new Array<number>(p).fill(0);
    const s2: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    let loglik = 0;
    const score = new Array<number>(p).fill(0);
    const info: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    let i = 0;
    while (i < n) {
      const t = time[order[i]];
      let d = 0;
      const xEvents = new Array<number>(p).fill(0);
      let etaEvents = 0;
      while (i < n && time[order[i]] === t) {
        const idx = order[i];
        const w = Math.exp(eta[idx] - shift);
        const z = Z[idx];
        s0 += w;
        for (let a = 0; a < p; a++) {
          s1[a] += w * z[a];
          for (let b = 0; b <= a; b++) s2[a][b] += w * z[a] * z[b];
        }
        if (event[idx] === 1) {
          d++;
          etaEvents += eta[idx] - shift;
          for (let a = 0; a < p; a++) xEvents[a] += z[a];
        }
        i++;
      }
      if (d === 0) continue;
      loglik += etaEvents - d * Math.log(s0);
      for (let a = 0; a < p; a++) {
        const ma = s1[a] / s0;
        score[a] += xEvents[a] - d * ma;
        for (let b = 0; b <= a; b++) {
          const v = d * (s2[a][b] / s0 - ma * (s1[b] / s0));
          info[a][b] += v;
          if (a !== b) info[b][a] += v;
        }
      }
    }
    return { loglik, score, info };
  };

  const zero = new Array<number>(p).fill(0);
  const initial = evaluate(zero);
  let current = initial;
  let beta = zero;
  let converged = false;
  let iterations = 0;
  // Throws SINGULAR_MATRIX for collinear covariates (information singular at β = 0).
  let infoInv = invertSymmetricPositiveDefinite(current.info);
  for (let iter = 1; iter <= 50; iter++) {
    iterations = iter;
    const step = infoInv.map((row) => row.reduce((s, v, j) => s + v * current.score[j], 0));
    let candidate = beta.map((b, j) => b + step[j]);
    let next = evaluate(candidate);
    let halvings = 0;
    while ((!Number.isFinite(next.loglik) || next.loglik < current.loglik - 1e-12 * Math.abs(current.loglik)) && halvings < 30) {
      candidate = candidate.map((c, j) => (c + beta[j]) / 2);
      next = evaluate(candidate);
      halvings++;
    }
    const change = Math.abs(next.loglik - current.loglik);
    beta = candidate;
    current = next;
    try {
      infoInv = invertSymmetricPositiveDefinite(current.info);
    } catch (error) {
      if (error instanceof StatsError && error.code === "SINGULAR_MATRIX") {
        throw new StatsError("SINGULAR_MATRIX", "information matrix became singular (monotone likelihood / infinite coefficient)");
      }
      throw error;
    }
    if (change <= 1e-12 * Math.abs(current.loglik) || change < 1e-14) {
      converged = true;
      break;
    }
  }

  const finalStep = infoInv.map((row) => row.reduce((s, v, j) => s + v * current.score[j], 0));
  const separationWarning =
    !converged || finalStep.some((s, j) => Math.abs(s) > 1e-9 && Math.abs(s) > Math.sqrt(1e-9) * Math.abs(beta[j]));

  const zCrit = normalQuantile((1 + conf) / 2);
  const coefficients = beta.map((est, j) => {
    const se = Math.sqrt(infoInv[j][j]);
    const z = est / se;
    return {
      name: names[j],
      estimate: est,
      se,
      z,
      p: Math.min(1, 2 * normalSf(Math.abs(z))),
      hazardRatio: Math.exp(est),
      hrLower: Math.exp(est - zCrit * se),
      hrUpper: Math.exp(est + zCrit * se),
    };
  });
  const lr = Math.max(0, 2 * (current.loglik - initial.loglik));
  return {
    coefficients,
    logLik: current.loglik,
    logLikNull: initial.loglik,
    likelihoodRatio: lr,
    lrDf: p,
    lrPValue: chiSquareSf(lr, p),
    n,
    events,
    converged,
    iterations,
    separationWarning,
    confLevel: conf,
  };
}
