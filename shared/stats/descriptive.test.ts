import { describe, expect, it } from "vitest";
import { frequencies, histogram, mean, median, quantile, rank, sd, summarize, variance } from "./descriptive";
import { expectRel, expectStatsError } from "./testHelpers";

// mtcars$mpg (R datasets)
const MPG = [
  21, 21, 22.8, 21.4, 18.7, 18.1, 14.3, 24.4, 22.8, 19.2, 17.8, 16.4, 17.3, 15.2, 10.4, 10.4, 14.7, 32.4, 30.4, 33.9,
  21.5, 15.5, 15.2, 13.3, 19.2, 27.3, 26, 30.4, 15.8, 19.7, 15, 21.4,
];

describe("mean / variance / sd", () => {
  it("match R on mtcars$mpg", () => {
    // mean(x); var(x); sd(x)
    expectRel(mean(MPG), 20.090624999999999, 1e-15);
    expectRel(variance(MPG), 36.324102822580649, 1e-14);
    expectRel(sd(MPG), 6.0269480520891046, 1e-14);
  });
  it("are stable for large offsets", () => {
    // y <- c(1e9+1, 1e9+2, 1e9+3, 1e9+4.5); mean(y); var(y)
    const y = [1e9 + 1, 1e9 + 2, 1e9 + 3, 1e9 + 4.5];
    expectRel(mean(y), 1000000002.625, 1e-15);
    expectRel(variance(y), 2.2291666666666665, 1e-9);
  });
  it("handle edge cases", () => {
    expectStatsError(() => mean([]), "EMPTY_INPUT");
    expectStatsError(() => variance([3]), "INSUFFICIENT_DATA");
    expectStatsError(() => mean([1, Number.NaN]), "NON_FINITE");
    expect(variance([4, 4, 4])).toBe(0);
  });
});

describe("quantile (type 7) and median", () => {
  it("matches R quantile(type = 7)", () => {
    const sorted = [...MPG].sort((a, b) => a - b);
    const ps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    const ref = [10.4, 14.340000000000002, 15.425000000000001, 19.199999999999999, 22.800000000000001, 30.090000000000003, 33.899999999999999];
    ps.forEach((p, i) => expectRel(quantile(sorted, p), ref[i], 1e-14));
  });
  it("validates inputs", () => {
    expectStatsError(() => quantile([3, 1, 2], 0.5), "INVALID_ARGUMENT");
    expectStatsError(() => quantile([1, 2], 1.5), "INVALID_ARGUMENT");
    expectStatsError(() => quantile([], 0.5), "EMPTY_INPUT");
    expect(quantile([7], 0.3)).toBe(7);
  });
  it("median handles odd/even n", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expectRel(median(MPG), 19.2, 1e-15);
  });
});

describe("summarize", () => {
  it("matches R on mtcars$mpg (skewness/kurtosis: e1071 type 2 formula)", () => {
    const s = summarize(MPG);
    expect(s.n).toBe(32);
    expectRel(s.mean, 20.090624999999999, 1e-15);
    expectRel(s.sd, 6.0269480520891046, 1e-14);
    expectRel(s.se, 1.0654239593728148, 1e-14);
    expect(s.min).toBe(10.4);
    expect(s.max).toBe(33.9);
    expectRel(s.q1, 15.425, 1e-14);
    expectRel(s.q3, 22.8, 1e-14);
    expectRel(s.iqr, 7.375, 1e-13);
    expectRel(s.skewness, 0.67237713762908247, 1e-12);
    expectRel(s.kurtosis, -0.022006291424083425, 1e-10);
  });
  it("matches R on a small sample with ties", () => {
    // z <- c(2, 7, 7, 1, 9)
    const s = summarize([2, 7, 7, 1, 9]);
    expectRel(s.sd, 3.4928498393145961, 1e-14);
    expect([s.q1, s.median, s.q3]).toEqual([2, 7, 7]);
    expectRel(s.skewness, -0.39424803346200782, 1e-12);
    expectRel(s.kurtosis, -2.578607901101853, 1e-12);
  });
  it("returns nulls where undefined", () => {
    const one = summarize([3]);
    expect(one).toMatchObject({ n: 1, mean: 3, sd: null, se: null, skewness: null, kurtosis: null, iqr: 0 });
    const three = summarize([1, 2, 4]);
    expect(three.skewness).not.toBeNull();
    expect(three.kurtosis).toBeNull();
    const constant = summarize([5, 5, 5, 5, 5]);
    expect(constant.sd).toBe(0);
    expect(constant.skewness).toBeNull();
    expect(constant.kurtosis).toBeNull();
    expectStatsError(() => summarize([]), "EMPTY_INPUT");
  });
});

describe("histogram", () => {
  it("uses Freedman–Diaconis with nice edges; counts match R hist(right = FALSE)", () => {
    // FD: 2*IQR*n^(-1/3) = 4.65 -> 6 bins -> nice width 5 -> edges 10..35.
    // R: hist(x, breaks = seq(10, 35, 5), right = FALSE)$counts == 5 13 8 2 4
    const h = histogram(MPG);
    expect(h.binWidth).toBe(5);
    expect(h.bins.map((b) => [b.x0, b.x1])).toEqual([
      [10, 15],
      [15, 20],
      [20, 25],
      [25, 30],
      [30, 35],
    ]);
    expect(h.bins.map((b) => b.count)).toEqual([5, 13, 8, 2, 4]);
  });
  it("counts the maximum in the last bin and produces clean decimal edges", () => {
    const h = histogram([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], { bins: 3 });
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(7);
    for (const b of h.bins) {
      expect(String(b.x0).length).toBeLessThan(6);
      expect(String(b.x1).length).toBeLessThan(6);
    }
    const last = h.bins[h.bins.length - 1];
    expect(last.x1).toBeGreaterThanOrEqual(0.7);
  });
  it("max exactly on an edge lands in the last bin", () => {
    const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 5 });
    expect(h.bins.at(-1)?.x1).toBe(10);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(11);
    expect(h.bins.at(-1)?.count).toBe(3); // 8, 9, 10
  });
  it("falls back to Sturges when IQR = 0", () => {
    const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 50];
    const h = histogram(values);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(10);
    expect(h.bins.length).toBeLessThanOrEqual(5); // Sturges: ceil(log2 10) + 1 = 5 target bins
  });
  it("handles constant data and explicit domains", () => {
    expect(histogram([3, 3, 3]).bins).toEqual([{ x0: 2.5, x1: 3.5, count: 3 }]);
    const h = histogram([-1, 0, 0.5, 1, 2, 3], { bins: 2, domain: [0, 2] });
    expect(h.bins).toEqual([
      { x0: 0, x1: 1, count: 2 },
      { x0: 1, x1: 2, count: 2 },
    ]);
    expect(h.outOfRange).toBe(2);
    expectStatsError(() => histogram([]), "EMPTY_INPUT");
    expectStatsError(() => histogram([1, 2], { domain: [2, 1] }), "INVALID_ARGUMENT");
    expectStatsError(() => histogram([1, 2], { bins: 0 }), "INVALID_ARGUMENT");
  });
  it("clamps the FD bin count to at most 60", () => {
    const values = Array.from({ length: 2000 }, (_, i) => (i % 2 === 0 ? i / 1000 : 1e4 + i));
    const h = histogram(values);
    expect(h.bins.length).toBeLessThanOrEqual(60);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(2000);
  });
});

describe("frequencies", () => {
  it("sorts by count desc then value", () => {
    expect(frequencies(["b", "a", "c", "a", "b", "d"])).toEqual([
      { value: "a", count: 2, proportion: 2 / 6 },
      { value: "b", count: 2, proportion: 2 / 6 },
      { value: "c", count: 1, proportion: 1 / 6 },
      { value: "d", count: 1, proportion: 1 / 6 },
    ]);
    expect(frequencies([])).toEqual([]);
  });
});

describe("rank", () => {
  it("matches R rank() with average ties", () => {
    const ref = [
      19.5, 19.5, 24.5, 21.5, 15, 14, 4, 26, 24.5, 16.5, 13, 11, 12, 7.5, 1.5, 1.5, 5, 31, 29.5, 32, 23, 9, 7.5, 3, 16.5,
      28, 27, 29.5, 10, 18, 6, 21.5,
    ];
    expect(rank(MPG)).toEqual(ref);
    expect(rank([])).toEqual([]);
  });
});
