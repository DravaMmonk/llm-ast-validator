/**
 * Statistics library for the medical research workstation.
 *
 * Pure TypeScript, dependency-free and deterministic; usable from both the
 * browser and Node. Every public function is validated against R 4.5 (see the
 * `*.test.ts` files for the exact R calls used as references).
 *
 * Input convention: numeric inputs must be clean `number[]` — filter missing
 * values (NaN / null / undefined) before calling. Degenerate input throws a
 * `StatsError` with a stable `code`; no function silently returns NaN.
 */

export { StatsError, type StatsErrorCode } from "./errors";
export * from "./types";
export * from "./distributions";
export * from "./descriptive";
export * from "./tests";
export * from "./matrix";
export * from "./regression";
export * from "./survival";
export * from "./diagnostic";
export * from "./sampleSize";
