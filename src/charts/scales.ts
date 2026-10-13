/*
 * Hand-rolled scale + tick utilities (no d3). Pure functions, unit-tested in
 * scales.test.ts.
 */

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert: (px: number) => number;
}

const isNum = (v: number) => typeof v === "number" && Number.isFinite(v);

/** Round away floating-point noise (0.30000000000000004 → 0.3) at a step's precision. */
function roundToStep(v: number, step: number): number {
  const decimals = Math.max(0, Math.min(15, -Math.floor(Math.log10(step)) + 1));
  const r = Number(v.toFixed(decimals));
  return Object.is(r, -0) ? 0 : r;
}

/** The 1-2-5 step that yields roughly `count` intervals over `span`. */
export function tickStep(span: number, count = 5): number {
  if (!(span > 0) || !isNum(span)) return 1;
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return mult * pow;
}

/** Widen a degenerate (min == max) or inverted domain to something tickable. */
function widen(min: number, max: number): [number, number] {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  return [lo, hi];
}

/**
 * Nice round tick values inside [min, max] (inclusive), ~`count` of them.
 * min == max yields ticks around the value; non-finite input yields [].
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isNum(min) || !isNum(max)) return [];
  const [lo, hi] = widen(min, max);
  const step = tickStep(hi - lo, count);
  const start = Math.ceil(lo / step - 1e-9);
  const stop = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let i = start; i <= stop && out.length < 1000; i++) out.push(roundToStep(i * step, step));
  return out;
}

/** Expand [min, max] outward to the enclosing nice step boundaries. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (!isNum(min) || !isNum(max)) return [0, 1];
  const [lo, hi] = widen(min, max);
  const step = tickStep(hi - lo, count);
  return [roundToStep(Math.floor(lo / step + 1e-9) * step, step), roundToStep(Math.ceil(hi / step - 1e-9) * step, step)];
}

/** Linear map domain → range. A zero-width domain maps everything to the range midpoint. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dd = d1 - d0;
  const rr = r1 - r0;
  const f = ((v: number) => (dd === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / dd) * rr)) as Scale;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  f.invert = (px: number) => (rr === 0 ? d0 : d0 + ((px - r0) / rr) * dd);
  return f;
}

/** Log10 map; non-positive inputs are clamped to a tiny positive value. */
export function logScale(domain: [number, number], range: [number, number]): Scale {
  const safe = (v: number) => Math.log10(Math.max(v, 1e-300));
  const lin = linearScale([safe(domain[0]), safe(domain[1])], range);
  const f = ((v: number) => lin(safe(v))) as Scale;
  f.domain = [domain[0], domain[1]];
  f.range = [range[0], range[1]];
  f.invert = (px: number) => 10 ** lin.invert(px);
  return f;
}

/** Nice 1-2-5 log ticks within [min, max] (both > 0). Denser mantissas on short spans. */
export function logTicks(min: number, max: number): number[] {
  if (!isNum(min) || !isNum(max) || min <= 0 || max <= 0) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const decades = Math.log10(hi / lo);
  const mantissas = decades <= 1 ? [1, 1.5, 2, 3, 5, 7] : decades <= 2.5 ? [1, 2, 5] : [1];
  const every = decades > 6 ? Math.ceil(decades / 6) : 1;
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    if (mantissas.length === 1 && e % every !== 0) continue;
    for (const m of mantissas) {
      const v = Number((m * 10 ** e).toPrecision(6));
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
    }
  }
  if (out.length === 0) out.push(Number(lo.toPrecision(2)), Number(hi.toPrecision(2)));
  return out;
}

/** Expand a positive domain outward to the enclosing 1-2-5 values. */
export function niceLogDomain(min: number, max: number): [number, number] {
  if (!isNum(min) || !isNum(max) || min <= 0 || max <= 0) return [0.1, 10];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    lo /= 2;
    hi *= 2;
  }
  const down = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v));
    const m = [5, 2, 1].find((k) => k * p <= v * (1 + 1e-9)) ?? 1;
    return Number((m * p).toPrecision(6));
  };
  const up = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v));
    const m = [1, 2, 5, 10].find((k) => k * p >= v * (1 - 1e-9)) ?? 10;
    return Number((m * p).toPrecision(6));
  };
  return [down(lo), up(hi)];
}

function trim(v: number, sig = 3): string {
  return String(Number(v.toPrecision(sig)));
}

/** Compact axis label: 0.5, 10, 1.2k, 3.4M, 1e-4. */
export function formatTick(v: number): string {
  if (!isNum(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9 || a < 1e-3) {
    const [m, e] = a.toExponential().split("e");
    return `${sign}${trim(Number(m))}e${Number(e)}`;
  }
  if (a >= 1e6) return `${sign}${trim(a / 1e6)}M`;
  if (a >= 1e4 || (a >= 1e3 && Number.isInteger(a))) return `${sign}${trim(a / 1e3)}k`;
  return `${sign}${trim(a)}`;
}

/** Tooltip-precision number (more digits than a tick, thousands-separated). */
export function formatValue(v: number | null | undefined, sig = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e9)) return formatTick(v);
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return Number(v.toPrecision(sig)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** p-value: "<0.001", else 3 decimals (2 significant above 0.1 is overkill — keep 3dp). */
export function formatP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

export function formatPercent(p: number, digits = 1): string {
  if (!isNum(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Finite extent of a list, or null when nothing finite. */
export function extent(values: Iterable<number>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!isNum(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Greedy label thinning: keep ticks whose pixel positions sit at least
 * `minGap` apart, preferring higher-priority ticks (lower `priority` value).
 */
export function thinTicks(
  ticks: number[],
  pos: (v: number) => number,
  minGap: number,
  priority: (v: number) => number = () => 0,
): number[] {
  const order = ticks.map((v, i) => ({ v, i, p: priority(v) })).sort((a, b) => a.p - b.p || a.i - b.i);
  const kept: { v: number; px: number }[] = [];
  for (const t of order) {
    const px = pos(t.v);
    if (kept.every((k) => Math.abs(k.px - px) >= minGap)) kept.push({ v: t.v, px });
  }
  return kept.map((k) => k.v).sort((a, b) => a - b);
}

/** Probability helpers for the Fagan nomogram. */
export const logit = (p: number) => Math.log(p / (1 - p));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** Bayes in odds form: post-odds = pre-odds × LR. */
export function postTestProbability(pre: number, lr: number): number {
  if (!(pre > 0) || !(lr > 0)) return pre <= 0 ? 0 : lr === 0 ? 0 : NaN;
  if (pre >= 1) return 1;
  const odds = (pre / (1 - pre)) * lr;
  return odds / (1 + odds);
}
