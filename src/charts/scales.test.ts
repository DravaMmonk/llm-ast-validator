import { describe, expect, it } from "vitest";
import {
  extent,
  formatP,
  formatTick,
  formatValue,
  linearScale,
  logScale,
  logTicks,
  niceDomain,
  niceLogDomain,
  niceTicks,
  postTestProbability,
  thinTicks,
  tickStep,
} from "./scales";
import { chartColor, divergingColor, divergingInk } from "./palette";
import { estimateTextWidth, truncateText, wrapText } from "./text";

describe("tickStep / niceTicks", () => {
  it("uses 1-2-5 steps", () => {
    expect(tickStep(10, 5)).toBe(2);
    expect(tickStep(1, 5)).toBe(0.2);
    expect(tickStep(100, 4)).toBe(20);
    expect(tickStep(7, 7)).toBe(1);
  });

  it("returns round ticks within the domain", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6]);
    expect(niceTicks(0.13, 0.87, 4)).toEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it("has no floating-point noise", () => {
    for (const t of niceTicks(0, 0.3, 3)) expect(String(t).length).toBeLessThan(5);
    expect(niceTicks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("handles min == max, inverted and non-finite input", () => {
    const t = niceTicks(5, 5, 5);
    expect(t.length).toBeGreaterThan(1);
    expect(Math.min(...t)).toBeLessThanOrEqual(5);
    expect(Math.max(...t)).toBeGreaterThanOrEqual(5);
    expect(niceTicks(0, 0, 5)).toContain(0);
    expect(niceTicks(10, 0, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(NaN, 1)).toEqual([]);
    expect(niceTicks(0, Infinity)).toEqual([]);
  });

  it("niceDomain expands to step boundaries", () => {
    expect(niceDomain(0.13, 0.87, 4)).toEqual([0, 1]);
    expect(niceDomain(3, 97, 5)).toEqual([0, 100]);
    expect(niceDomain(-0.5, 0.5, 5)).toEqual([-0.6, 0.6]);
    const [a, b] = niceDomain(4, 4);
    expect(a).toBeLessThan(4);
    expect(b).toBeGreaterThan(4);
  });
});

describe("linearScale", () => {
  it("maps and inverts", () => {
    const s = linearScale([0, 10], [100, 200]);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(150);
    expect(s(10)).toBe(200);
    expect(s.invert(175)).toBe(7.5);
  });
  it("supports inverted ranges (y axes)", () => {
    const s = linearScale([0, 1], [300, 0]);
    expect(s(0.25)).toBe(225);
    expect(s.invert(0)).toBe(1);
  });
  it("maps a zero-width domain to the range midpoint (no NaN)", () => {
    const s = linearScale([3, 3], [0, 100]);
    expect(s(3)).toBe(50);
    expect(Number.isNaN(s(99))).toBe(false);
  });
});

describe("logScale / logTicks", () => {
  it("maps decades evenly", () => {
    const s = logScale([0.1, 10], [0, 200]);
    expect(s(0.1)).toBeCloseTo(0);
    expect(s(1)).toBeCloseTo(100);
    expect(s(10)).toBeCloseTo(200);
    expect(s.invert(100)).toBeCloseTo(1);
  });
  it("clamps non-positive input instead of producing NaN", () => {
    const s = logScale([0.1, 10], [0, 200]);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(Number.isFinite(s(-1))).toBe(true);
  });
  it("produces 1-2-5 ticks", () => {
    expect(logTicks(0.1, 10)).toEqual([0.1, 0.2, 0.5, 1, 2, 5, 10]);
    expect(logTicks(0.001, 1000)).toEqual([0.001, 0.01, 0.1, 1, 10, 100, 1000]);
    expect(logTicks(0.5, 3)).toEqual([0.5, 0.7, 1, 1.5, 2, 3]);
    expect(logTicks(0, 10)).toEqual([]);
  });
  it("niceLogDomain snaps outward", () => {
    expect(niceLogDomain(0.37, 2.75)).toEqual([0.2, 5]);
    expect(niceLogDomain(1, 1)).toEqual([0.5, 2]);
  });
});

describe("formatting", () => {
  it("formatTick is compact", () => {
    expect(formatTick(0)).toBe("0");
    expect(formatTick(0.5)).toBe("0.5");
    expect(formatTick(10)).toBe("10");
    expect(formatTick(1200)).toBe("1.2k");
    expect(formatTick(15000)).toBe("15k");
    expect(formatTick(2_500_000)).toBe("2.5M");
    expect(formatTick(0.0001)).toBe("1e-4");
    expect(formatTick(0.00025)).toBe("2.5e-4");
    expect(formatTick(-0.2)).toBe("-0.2");
    expect(formatTick(0.30000000000000004)).toBe("0.3");
    expect(formatTick(0.001)).toBe("0.001");
    expect(formatTick(NaN)).toBe("");
  });
  it("formatValue and formatP", () => {
    expect(formatValue(1234567)).toBe("1,234,567");
    expect(formatValue(0.123456)).toBe("0.1235");
    expect(formatValue(null)).toBe("—");
    expect(formatP(0.0004)).toBe("<0.001");
    expect(formatP(0.0312)).toBe("0.031");
    expect(formatP(null)).toBe("—");
  });
});

describe("misc helpers", () => {
  it("extent skips non-finite values", () => {
    expect(extent([3, NaN, -1, Infinity, 7])).toEqual([-1, 7]);
    expect(extent([])).toBeNull();
  });
  it("thinTicks keeps priority ticks and enforces a gap", () => {
    const kept = thinTicks([1, 2, 3, 10], (v) => v * 10, 15, (v) => (v === 10 ? 0 : 1));
    expect(kept).toContain(10);
    expect(kept).toEqual([1, 3, 10]);
  });
  it("post-test probability follows Bayes in odds form", () => {
    expect(postTestProbability(0.25, 4)).toBeCloseTo(0.5714, 4);
    expect(postTestProbability(0.5, 1)).toBeCloseTo(0.5);
    expect(postTestProbability(0.25, 0.2)).toBeCloseTo(0.0625, 4);
  });
});

describe("palette + text", () => {
  it("chartColor returns css vars and cycles", () => {
    expect(chartColor(0)).toBe("var(--chart-1)");
    expect(chartColor(7)).toBe("var(--chart-8)");
    expect(chartColor(8)).toBe("var(--chart-1)");
    expect(chartColor(-1)).toBe("var(--chart-8)");
  });
  it("divergingColor is neutral at 0 and mixes toward the poles", () => {
    expect(divergingColor(0)).toBe("var(--chart-div-mid)");
    expect(divergingColor(-1)).toContain("--chart-div-neg) 100%");
    expect(divergingColor(0.5)).toContain("--chart-div-pos) 50%");
    expect(divergingInk(0.9)).toBe("var(--chart-div-ink-strong)");
    expect(divergingInk(0.1)).toBe("var(--chart-div-ink-weak)");
  });
  it("truncates and wraps with ellipsis", () => {
    const long = "Hypertension with documented end-organ damage requiring treatment";
    const t = truncateText(long, 80, 11);
    expect(t.endsWith("…")).toBe(true);
    expect(estimateTextWidth(t, 11)).toBeLessThanOrEqual(80);
    const lines = wrapText(long, 120, 11, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(wrapText("short", 120, 11, 2)).toEqual(["short"]);
  });
});
