/**
 * Descriptive statistics.
 *
 * Inputs are clean `number[]` (callers filter NaN / null first; non-finite
 * values throw NON_FINITE). Empty input throws EMPTY_INPUT; quantities that
 * need more observations than provided throw INSUFFICIENT_DATA, except in
 * `summarize`, which reports them as `null`.
 */

import { StatsError, assertFiniteArray, assertFiniteNumber } from "./errors";

function requireNonEmpty(values: readonly number[], label = "values"): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new StatsError("EMPTY_INPUT", `${label} must contain at least one value`);
  }
}

/** Neumaier-compensated sum (robust to cancellation and large magnitude ranges). */
export function sum(values: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (const v of values) {
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += s - t + v;
    else c += v - t + s;
    s = t;
  }
  return s + c;
}

/** Arithmetic mean, computed as a compensated sum plus a second-pass correction (as R does). */
export function mean(values: readonly number[]): number {
  requireNonEmpty(values);
  assertFiniteArray(values);
  return meanUnchecked(values);
}

function meanUnchecked(values: readonly number[]): number {
  const n = values.length;
  const m = sum(values) / n;
  let corr = 0;
  for (const v of values) corr += v - m;
  return m + corr / n;
}

/** Sum of squared deviations from the mean (two-pass with correction term). */
function sumSquaredDeviations(values: readonly number[], m: number): number {
  let ss = 0;
  let comp = 0;
  for (const v of values) {
    const d = v - m;
    ss += d * d;
    comp += d;
  }
  return ss - (comp * comp) / values.length;
}

/** Sample variance with denominator n - 1. Throws INSUFFICIENT_DATA for n < 2. */
export function variance(values: readonly number[]): number {
  requireNonEmpty(values);
  assertFiniteArray(values);
  if (values.length < 2) throw new StatsError("INSUFFICIENT_DATA", "variance requires at least 2 values");
  const m = meanUnchecked(values);
  return Math.max(0, sumSquaredDeviations(values, m)) / (values.length - 1);
}

/** Sample standard deviation (denominator n - 1). Throws INSUFFICIENT_DATA for n < 2. */
export function sd(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Quantile of an ascending-sorted sample using R's default definition
 * (type 7): h = (n - 1)p, Q = x[floor(h)] + (h - floor(h)) (x[floor(h)+1] - x[floor(h)]).
 * Throws INVALID_ARGUMENT if the input is not sorted ascending or p ∉ [0, 1].
 */
export function quantile(sortedAscending: readonly number[], p: number): number {
  requireNonEmpty(sortedAscending, "sortedAscending");
  assertFiniteArray(sortedAscending, "sortedAscending");
  assertFiniteNumber(p, "p");
  if (p < 0 || p > 1) throw new StatsError("INVALID_ARGUMENT", "p must be in [0, 1]");
  for (let i = 1; i < sortedAscending.length; i++) {
    if (sortedAscending[i] < sortedAscending[i - 1]) {
      throw new StatsError("INVALID_ARGUMENT", "quantile() requires values sorted ascending");
    }
  }
  return quantileSorted(sortedAscending, p);
}

function quantileSorted(x: readonly number[], p: number): number {
  const n = x.length;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  const frac = h - lo;
  return frac === 0 ? x[lo] : x[lo] + frac * (x[hi] - x[lo]);
}

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Median of an unsorted sample. */
export function median(values: readonly number[]): number {
  requireNonEmpty(values);
  assertFiniteArray(values);
  return quantileSorted(sortedCopy(values), 0.5);
}

export interface Summary {
  n: number;
  mean: number;
  /** Sample SD (n - 1); null for n < 2. */
  sd: number | null;
  /** Standard error of the mean, sd / sqrt(n); null for n < 2. */
  se: number | null;
  min: number;
  /** First quartile, R type 7. */
  q1: number;
  median: number;
  /** Third quartile, R type 7. */
  q3: number;
  max: number;
  iqr: number;
  /**
   * Adjusted Fisher–Pearson skewness G1 = g1·sqrt(n(n-1))/(n-2) (SAS / SPSS /
   * e1071 type 2); null for n < 3 or zero variance.
   */
  skewness: number | null;
  /**
   * Adjusted excess kurtosis G2 = ((n+1)g2 + 6)(n-1)/((n-2)(n-3)) (SAS / SPSS /
   * e1071 type 2); null for n < 4 or zero variance.
   */
  kurtosis: number | null;
}

/** Five-number summary plus moments. Throws EMPTY_INPUT for an empty sample. */
export function summarize(values: readonly number[]): Summary {
  requireNonEmpty(values);
  assertFiniteArray(values);
  const n = values.length;
  const sorted = sortedCopy(values);
  const m = meanUnchecked(values);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = v - m;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const sdValue = n >= 2 ? Math.sqrt(Math.max(0, sumSquaredDeviations(values, m)) / (n - 1)) : null;
  // Treat variance below round-off of the data scale as zero (constant data).
  const scale = Math.max(Math.abs(sorted[0]), Math.abs(sorted[n - 1]), Number.MIN_VALUE);
  const zeroVariance = m2 <= (scale * 1e-14) ** 2;
  let skewness: number | null = null;
  let kurtosis: number | null = null;
  if (!zeroVariance && n >= 3) {
    const g1 = m3 / Math.pow(m2, 1.5);
    skewness = (g1 * Math.sqrt(n * (n - 1))) / (n - 2);
  }
  if (!zeroVariance && n >= 4) {
    const g2 = m4 / (m2 * m2) - 3;
    kurtosis = (((n + 1) * g2 + 6) * (n - 1)) / ((n - 2) * (n - 3));
  }
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  return {
    n,
    mean: m,
    sd: sdValue,
    se: sdValue === null ? null : sdValue / Math.sqrt(n),
    min: sorted[0],
    q1,
    median: quantileSorted(sorted, 0.5),
    q3,
    max: sorted[n - 1],
    iqr: q3 - q1,
    skewness,
    kurtosis,
  };
}

export interface HistogramBin {
  /** Inclusive lower edge. */
  x0: number;
  /** Exclusive upper edge (inclusive for the last bin). */
  x1: number;
  count: number;
}

export interface Histogram {
  bins: HistogramBin[];
  binWidth: number;
  /** Values outside an explicit `domain` (not counted); always 0 without `domain`. */
  outOfRange: number;
}

export interface HistogramOptions {
  /** Target number of bins. Default: Freedman–Diaconis, clamped to [5, 60]. */
  bins?: number;
  /** Explicit [lo, hi] range; bins split it exactly into equal widths. */
  domain?: [number, number];
}

/** Smallest "nice" number (1, 2, 2.5, 5 × 10^k) that is >= x. */
function niceCeil(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 2.5, 5, 10]) {
    const candidate = m * base;
    if (candidate >= x * (1 - 1e-12)) return candidate;
  }
  return 10 * base;
}

/** Rounds an edge to the precision implied by the bin width, removing float noise (e.g. 0.30000000000000004). */
function cleanEdge(value: number, width: number): number {
  const decimals = Math.max(0, Math.min(15, -Math.floor(Math.log10(width)) + 3));
  const cleaned = Number(value.toFixed(decimals));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

/**
 * Histogram with left-closed bins [x0, x1) (the last bin is closed, so the
 * maximum is always counted).
 *
 * Default bin count: Freedman–Diaconis (width 2·IQR·n^(-1/3)) clamped to
 * [5, 60]; when IQR = 0, Sturges (ceil(log2 n) + 1), clamped to [1, 60].
 * Without `domain`, the width is rounded up to a "nice" value (1, 2, 2.5, 5 ×
 * 10^k) and edges are aligned to multiples of it, so the realised bin count
 * may be slightly lower than the target. With `domain`, the range is split
 * exactly into `bins` equal bins and values outside are reported in
 * `outOfRange`. All-equal data produce a single bin of width 1 centred on the value.
 */
export function histogram(values: readonly number[], opts: HistogramOptions = {}): Histogram {
  requireNonEmpty(values);
  assertFiniteArray(values);
  const n = values.length;
  const sorted = sortedCopy(values);
  if (opts.bins !== undefined && !(Number.isInteger(opts.bins) && opts.bins >= 1 && opts.bins <= 10_000)) {
    throw new StatsError("INVALID_ARGUMENT", "bins must be an integer between 1 and 10000");
  }

  const defaultBinCount = (lo: number, hi: number): number => {
    const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
    if (iqr > 0) {
      const width = 2 * iqr * Math.pow(n, -1 / 3);
      return Math.min(60, Math.max(5, Math.ceil((hi - lo) / width)));
    }
    return Math.min(60, Math.max(1, Math.ceil(Math.log2(n)) + 1));
  };

  if (opts.domain) {
    const [lo, hi] = opts.domain;
    assertFiniteNumber(lo, "domain[0]");
    assertFiniteNumber(hi, "domain[1]");
    if (!(hi > lo)) throw new StatsError("INVALID_ARGUMENT", "domain must satisfy lo < hi");
    const k = opts.bins ?? defaultBinCount(lo, hi);
    const width = (hi - lo) / k;
    const bins: HistogramBin[] = [];
    for (let i = 0; i < k; i++) {
      bins.push({ x0: i === 0 ? lo : lo + i * width, x1: i === k - 1 ? hi : lo + (i + 1) * width, count: 0 });
    }
    let outOfRange = 0;
    for (const v of sorted) {
      if (v < lo || v > hi) {
        outOfRange++;
        continue;
      }
      bins[locateBin(bins, v)].count++;
    }
    return { bins, binWidth: width, outOfRange };
  }

  const min = sorted[0];
  const max = sorted[n - 1];
  if (min === max) {
    return { bins: [{ x0: min - 0.5, x1: min + 0.5, count: n }], binWidth: 1, outOfRange: 0 };
  }
  const k = opts.bins ?? defaultBinCount(min, max);
  const width = niceCeil((max - min) / k);
  const start = Math.floor(min / width);
  let count = Math.max(1, Math.ceil(max / width - start));
  // Guard against floating error placing max beyond the last edge.
  while ((start + count) * width < max) count++;
  const bins: HistogramBin[] = [];
  for (let i = 0; i < count; i++) {
    bins.push({ x0: cleanEdge((start + i) * width, width), x1: cleanEdge((start + i + 1) * width, width), count: 0 });
  }
  bins[0].x0 = Math.min(bins[0].x0, min);
  bins[count - 1].x1 = Math.max(bins[count - 1].x1, max);
  for (const v of sorted) bins[locateBin(bins, v)].count++;
  return { bins, binWidth: width, outOfRange: 0 };
}

/** Index of the bin containing v (binary search; last bin closed on the right). */
function locateBin(bins: readonly HistogramBin[], v: number): number {
  let lo = 0;
  let hi = bins.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (v >= bins[mid].x0) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface FrequencyRow {
  value: string;
  count: number;
  proportion: number;
}

/**
 * Frequency table of categorical values, sorted by count (descending) then by
 * value (ascending, by UTF-16 code units so the order is locale-independent).
 * Empty input returns [].
 */
export function frequencies(values: readonly string[]): FrequencyRow[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, proportion: count / total }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/** 1-based ranks with ties given their average rank (R `rank(ties.method = "average")`). */
export function rank(values: readonly number[]): number[] {
  assertFiniteArray(values);
  return rankWithTies(values).ranks;
}

/**
 * Average ranks plus the tie-group sizes (each tie group of size t > 1 is
 * listed once), used for tie corrections in rank tests.
 */
export function rankWithTies(values: readonly number[]): { ranks: number[]; tieSizes: number[] } {
  const n = values.length;
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(n);
  const tieSizes: number[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[order[k]] = avg;
    if (j > i) tieSizes.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieSizes };
}
