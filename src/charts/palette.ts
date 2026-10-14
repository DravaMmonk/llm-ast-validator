/*
 * Color helpers. Every value is a CSS variable reference (defined in
 * chartTokens.css) so light/dark switch with the `.dark` class on <html>.
 */

export const CHART_COLOR_COUNT = 8;

/**
 * Categorical slot i (0-based) → `var(--chart-N)`. Cycles past 8 as a safety
 * net only: assign slots in a fixed order per entity, and fold a 9th+ series
 * into "Other" rather than relying on the wrap-around.
 */
export function chartColor(i: number): string {
  const n = ((Math.floor(i) % CHART_COLOR_COUNT) + CHART_COLOR_COUNT) % CHART_COLOR_COUNT;
  return `var(--chart-${n + 1})`;
}

/** Sequential step 1..7 (light → dark in light mode; flipped in dark). */
export function seqColor(step: number): string {
  return `var(--chart-seq-${Math.min(7, Math.max(1, Math.round(step)))})`;
}

/** |t| above which a diverging fill is dark enough for the strong (light) ink. */
export const DIVERGING_INK_THRESHOLD = 0.75;

/** t ∈ [-1, 1] → OKLab mix between the neutral midpoint and a pole. */
export function divergingColor(t: number): string {
  const c = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  const pct = Math.round(Math.abs(c) * 100);
  if (pct === 0) return "var(--chart-div-mid)";
  const pole = c < 0 ? "var(--chart-div-neg)" : "var(--chart-div-pos)";
  return `color-mix(in oklab, ${pole} ${pct}%, var(--chart-div-mid))`;
}

/** Text color that clears contrast over `divergingColor(t)`. */
export function divergingInk(t: number): string {
  return Math.abs(t) >= DIVERGING_INK_THRESHOLD ? "var(--chart-div-ink-strong)" : "var(--chart-div-ink-weak)";
}

/** A translucent wash of a color (area fills, box bodies). */
export function wash(color: string, pct = 12): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
