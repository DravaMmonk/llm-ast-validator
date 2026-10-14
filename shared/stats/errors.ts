/**
 * Typed error for the statistics library.
 *
 * Every function in `shared/stats` either returns finite numbers (or `null`
 * where a quantity is undefined) or throws a `StatsError` with a stable
 * machine-readable `code`. No function silently returns NaN.
 *
 * Input convention: functions accept *clean* numeric arrays. Callers are
 * responsible for filtering missing values (NaN / null / undefined) before
 * calling; non-finite inputs are rejected with code `NON_FINITE`.
 */

export type StatsErrorCode =
  | "EMPTY_INPUT"
  | "INSUFFICIENT_DATA"
  | "INVALID_ARGUMENT"
  | "LENGTH_MISMATCH"
  | "NON_FINITE"
  | "ZERO_VARIANCE"
  | "SINGULAR_MATRIX"
  | "PERFECT_FIT"
  | "NO_CONVERGENCE";

export class StatsError extends Error {
  readonly code: StatsErrorCode;

  constructor(code: StatsErrorCode, message: string) {
    super(message);
    this.name = "StatsError";
    this.code = code;
  }
}

/** Throws NON_FINITE if any element is NaN or ±Infinity. */
export function assertFiniteArray(values: readonly number[], label = "values"): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new StatsError(
        "NON_FINITE",
        `${label}[${i}] is not a finite number; filter missing values before calling`,
      );
    }
  }
}

/** Throws NON_FINITE unless `value` is a finite number. */
export function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StatsError("NON_FINITE", `${label} must be a finite number`);
  }
}

/** Throws INVALID_ARGUMENT unless 0 < level < 1 (confidence level / alpha / power). */
export function assertProbabilityOpen(value: number, label: string): void {
  if (typeof value !== "number" || !(value > 0 && value < 1)) {
    throw new StatsError("INVALID_ARGUMENT", `${label} must be strictly between 0 and 1`);
  }
}

/** Throws LENGTH_MISMATCH unless both arrays have the same length. */
export function assertSameLength(a: readonly unknown[], b: readonly unknown[], labels: string): void {
  if (a.length !== b.length) {
    throw new StatsError("LENGTH_MISMATCH", `${labels} must have the same length (${a.length} vs ${b.length})`);
  }
}

/** Throws INVALID_ARGUMENT unless every element is 0 or 1. */
export function assertBinary(values: readonly number[], label: string): void {
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== 0 && values[i] !== 1) {
      throw new StatsError("INVALID_ARGUMENT", `${label}[${i}] must be 0 or 1`);
    }
  }
}

/** Throws INVALID_ARGUMENT unless the value is a non-negative finite number. */
export function assertNonNegativeCount(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new StatsError("INVALID_ARGUMENT", `${label} must be a non-negative finite number`);
  }
}
