/** Shared result shapes for the statistics library. */

/** A two-sided confidence interval. `level` is the confidence level, e.g. 0.95. */
export interface ConfidenceInterval {
  lower: number;
  upper: number;
  level: number;
}

/** A point estimate with an optional confidence interval (null where undefined). */
export interface EstimateWithCi {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
}
