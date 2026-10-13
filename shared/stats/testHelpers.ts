/** Shared assertions for the stats test suites (not part of the public API). */
import { expect } from "vitest";

/** Asserts |actual - expected| <= tol * max(|expected|, tiny) (relative tolerance). */
export function expectRel(actual: number | null | undefined, expected: number, tol = 1e-9): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  const a = actual as number;
  expect(Number.isFinite(a) || a === expected).toBe(true);
  if (expected === 0) {
    expect(Math.abs(a)).toBeLessThanOrEqual(tol);
    return;
  }
  const err = Math.abs(a - expected) / Math.abs(expected);
  if (!(err <= tol)) {
    throw new Error(`expected ${expected}, got ${a} (relative error ${err.toExponential(2)} > ${tol})`);
  }
}

/** Asserts |actual - expected| <= tol (absolute tolerance). */
export function expectAbs(actual: number | null | undefined, expected: number, tol = 1e-12): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  const a = actual as number;
  const err = Math.abs(a - expected);
  if (!(err <= tol)) {
    throw new Error(`expected ${expected}, got ${a} (absolute error ${err.toExponential(2)} > ${tol})`);
  }
}

/** Asserts that `fn` throws a StatsError with the given code. */
export function expectStatsError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected StatsError ${code}`).toBeDefined();
  expect((caught as { name?: string }).name).toBe("StatsError");
  expect((caught as { code?: string }).code).toBe(code);
}
