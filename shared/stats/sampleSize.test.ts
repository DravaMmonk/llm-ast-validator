import { describe, expect, it } from "vitest";
import {
  powerCurve,
  powerTwoMeans,
  powerTwoProportions,
  sampleSizeCorrelation,
  sampleSizeOneProportion,
  sampleSizeTwoMeans,
  sampleSizeTwoProportions,
} from "./sampleSize";
import { expectRel, expectStatsError } from "./testHelpers";

describe("sampleSizeTwoMeans", () => {
  it("matches ceiling(power.t.test(...)$n) for equal allocation", () => {
    // power.t.test(delta=5, sd=10, power=.8)$n = 63.77; (1, 1, .9, .01) = 31.46; (.3, 1, .8) = 175.39;
    // (2, 1, .8) = 5.09; one-sided (5, 10, .8) = 50.15
    const cases: [Parameters<typeof sampleSizeTwoMeans>[0], number][] = [
      [{ delta: 5, sd: 10 }, 64],
      [{ delta: 1, sd: 1, power: 0.9, alpha: 0.01 }, 32],
      [{ delta: 0.3, sd: 1 }, 176],
      [{ delta: 2, sd: 1 }, 6],
      [{ delta: -5, sd: 10 }, 64],
      [{ delta: 5, sd: 10, twoSided: false }, 51],
    ];
    for (const [opts, n] of cases) {
      const r = sampleSizeTwoMeans(opts);
      expect(r.n1).toBe(n);
      expect(r.n2).toBe(n);
      expect(r.total).toBe(2 * n);
      expect(r.achievedPower).toBeGreaterThanOrEqual(opts.power ?? 0.8);
    }
    const r = sampleSizeTwoMeans({ delta: 5, sd: 10 });
    expect(r.inputs).toEqual({ delta: 5, sd: 10, alpha: 0.05, power: 0.8, ratio: 1, twoSided: true });
    // power.t.test(n = 64, delta = 5, sd = 10)$power
    expectRel(r.achievedPower, 0.80145862336795148, 1e-9);
  });
  it("handles unequal allocation (R brute force over noncentral t, n2 = ceiling(k n1))", () => {
    const r2 = sampleSizeTwoMeans({ delta: 5, sd: 10, ratio: 2 });
    expect([r2.n1, r2.n2, r2.total]).toEqual([48, 96, 144]);
    expectRel(r2.achievedPower, 0.80213862606668074, 1e-9);
    const rHalf = sampleSizeTwoMeans({ delta: 5, sd: 10, ratio: 0.5 });
    expect([rHalf.n1, rHalf.n2]).toEqual([95, 48]);
    expectRel(rHalf.achievedPower, 0.8007305265506045, 1e-9);
  });
  it("validates inputs", () => {
    expectStatsError(() => sampleSizeTwoMeans({ delta: 0, sd: 1 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeTwoMeans({ delta: 1, sd: 0 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeTwoMeans({ delta: 1, sd: 1, power: 1 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeTwoMeans({ delta: 1, sd: 1, alpha: 0 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeTwoMeans({ delta: 1, sd: 1, ratio: -1 }), "INVALID_ARGUMENT");
  });
});

describe("powerTwoMeans", () => {
  it("matches power.t.test(n = ...)$power", () => {
    expectRel(powerTwoMeans({ n1: 64, delta: 5, sd: 10 }).power, 0.80145862336795148, 1e-9);
    expectRel(powerTwoMeans({ n1: 20, delta: 0.8, sd: 1.2, alpha: 0.01 }).power, 0.28808523676249687, 1e-9);
    expectRel(powerTwoMeans({ n1: 10.5, delta: 1, sd: 1 }).power, 0.58498047703411138, 1e-9);
    expectRel(powerTwoMeans({ n1: 30, delta: 0.5, sd: 1, twoSided: false }).power, 0.60602532788680707, 1e-9);
    // Unequal: pt(qt(.975, 118), 118, ncp = 5 / (10 * sqrt(1/40 + 1/80)), lower = FALSE)
    const r = powerTwoMeans({ n1: 40, delta: 5, sd: 10, ratio: 2 });
    expectRel(r.power, 0.72606684527818999, 1e-9);
    expect(r.n2).toBe(80);
    expectStatsError(() => powerTwoMeans({ n1: 1, delta: 1, sd: 1 }), "INSUFFICIENT_DATA");
  });
});

describe("sampleSizeTwoProportions", () => {
  it("matches ceiling(power.prop.test(...)$n) without continuity correction", () => {
    // power.prop.test(p1=.5, p2=.75, power=.9)$n = 76.71; (.1, .2, .8) = 198.96; (.3, .25, .8, .01) = 1861.36
    const a = sampleSizeTwoProportions({ p1: 0.5, p2: 0.75, power: 0.9 });
    expect([a.n1, a.n2, a.total]).toEqual([77, 77, 154]);
    expectRel(a.n1Exact, 76.706930114107664, 1e-6);
    const b = sampleSizeTwoProportions({ p1: 0.1, p2: 0.2 });
    expect(b.n1).toBe(199);
    expectRel(b.n1Exact, 198.96341328382053, 1e-6);
    expect(b.achievedPower).toBeGreaterThanOrEqual(0.8);
    const c = sampleSizeTwoProportions({ p1: 0.3, p2: 0.25, alpha: 0.01 });
    expect(c.n1).toBe(1862);
    expectRel(c.n1Exact, 1861.3564734199736, 1e-6);
  });
  it("applies Fleiss continuity correction and unequal allocation (R formula)", () => {
    const cc = sampleSizeTwoProportions({ p1: 0.1, p2: 0.2, continuityCorrection: true });
    expectRel(cc.n1Exact, 218.50575944374316, 1e-12);
    expect([cc.n1, cc.n2]).toEqual([219, 219]);
    expect(cc.achievedPower).toBeNull();
    const k2 = sampleSizeTwoProportions({ p1: 0.1, p2: 0.2, ratio: 2 });
    expectRel(k2.n1Exact, 154.15864429281947, 1e-12);
    expect([k2.n1, k2.n2, k2.total]).toEqual([155, 309, 464]);
    const k2cc = sampleSizeTwoProportions({ p1: 0.1, p2: 0.2, ratio: 2, continuityCorrection: true });
    expectRel(k2cc.n1Exact, 168.82545994955274, 1e-12);
    expect([k2cc.n1, k2cc.n2]).toEqual([169, 338]);
  });
  it("validates inputs", () => {
    expectStatsError(() => sampleSizeTwoProportions({ p1: 0.2, p2: 0.2 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeTwoProportions({ p1: 0, p2: 0.2 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeTwoProportions({ p1: 0.1, p2: 1.2 }), "INVALID_ARGUMENT");
  });
});

describe("powerTwoProportions", () => {
  it("matches power.prop.test(n = ...)$power", () => {
    expectRel(powerTwoProportions({ n1: 50, p1: 0.5, p2: 0.75 }).power, 0.74016590133138793, 1e-12);
    expectRel(powerTwoProportions({ n1: 200, p1: 0.1, p2: 0.2 }).power, 0.8020483724715961, 1e-12);
  });
});

describe("precision and correlation sample sizes", () => {
  it("sampleSizeOneProportion = ceiling(z^2 p(1-p) / E^2)", () => {
    const a = sampleSizeOneProportion({ p: 0.3, margin: 0.05 });
    expectRel(a.nExact, 322.6825409383062, 1e-12);
    expect(a.n1).toBe(323);
    expect(a.total).toBe(323);
    const b = sampleSizeOneProportion({ p: 0.5, margin: 0.03, alpha: 0.01 });
    expectRel(b.nExact, 1843.0268336170031, 1e-12);
    expect(b.n1).toBe(1844);
    expect(sampleSizeOneProportion({ p: 0, margin: 0.1 }).n1).toBe(1);
    expectStatsError(() => sampleSizeOneProportion({ p: 0.5, margin: 0 }), "INVALID_ARGUMENT");
  });
  it("sampleSizeCorrelation = ceiling(((z_a + z_b) / atanh(r))^2 + 3)", () => {
    const a = sampleSizeCorrelation({ r: 0.3 });
    expectRel(a.nExact, 84.927811115775199, 1e-12);
    expect(a.n1).toBe(85);
    const b = sampleSizeCorrelation({ r: -0.5, power: 0.9 });
    expectRel(b.nExact, 37.823089965184479, 1e-12);
    expect(b.n1).toBe(38);
    expectStatsError(() => sampleSizeCorrelation({ r: 0 }), "INVALID_ARGUMENT");
    expectStatsError(() => sampleSizeCorrelation({ r: 1 }), "INVALID_ARGUMENT");
  });
});

describe("powerCurve", () => {
  it("evaluates a grid and skips invalid points", () => {
    const pts = powerCurve((n) => powerTwoMeans({ n1: n, delta: 5, sd: 10 }).power, { from: 1, to: 101, steps: 11 });
    expect(pts.length).toBe(10); // n = 1 throws INSUFFICIENT_DATA and is skipped
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThan(pts[i - 1].y);
    expectStatsError(() => powerCurve((x) => x, { from: 0, to: 1, steps: 1 }), "INVALID_ARGUMENT");
  });
});
