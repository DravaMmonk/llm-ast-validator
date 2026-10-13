/**
 * Cohort evaluation: applies an ordered list of inclusion / exclusion criteria
 * to a frame and accounts for every row that leaves, CONSORT-style.
 *
 * Each step sees only the rows that survived the steps before it. A row
 * leaves an *include* step when its criterion is false, and an *exclude* step
 * when its criterion is true. A row whose criterion is missing (unknown)
 * follows the step's explicit missing-data policy and is counted separately,
 * so the attrition diagram can always say *why* a row was dropped.
 */

import { type Frame, frameSchema } from "./dataset";
import { checkExpr, compileExpr } from "./expr";
import type { CohortStep } from "./documents";

export interface StepOutcome {
  id: string;
  label: string;
  kind: CohortStep["kind"];
  enabled: boolean;
  /** Rows entering this step. */
  before: number;
  /** Rows removed because the criterion decided against them. */
  removedByCriterion: number;
  /** Rows removed because the criterion was missing and the policy is drop. */
  removedMissing: number;
  /** Rows whose criterion was missing but were kept by policy. */
  keptMissing: number;
  /** Rows leaving this step. */
  remaining: number;
  /** A step that cannot be evaluated passes every row through and says why. */
  error: string | null;
}

export interface CohortResult {
  start: number;
  steps: StepOutcome[];
  final: number;
  /** 1 for rows in the final cohort. */
  mask: Uint8Array;
  /** False when any enabled step could not be evaluated. */
  valid: boolean;
}

export function evaluateCohort(frame: Frame, steps: readonly CohortStep[]): CohortResult {
  const mask = new Uint8Array(frame.rowCount).fill(1);
  const schema = frameSchema(frame);
  const columns = new Map(frame.columns.map((column) => [column.name, column.values]));
  let remaining = frame.rowCount;
  let valid = true;
  const outcomes: StepOutcome[] = [];

  for (const step of steps) {
    const outcome: StepOutcome = {
      id: step.id,
      label: step.label,
      kind: step.kind,
      enabled: step.enabled,
      before: remaining,
      removedByCriterion: 0,
      removedMissing: 0,
      keptMissing: 0,
      remaining,
      error: null,
    };
    outcomes.push(outcome);
    if (!step.enabled) continue;

    const checked = checkExpr(step.expr, schema);
    if (checked.diagnostics.length > 0) {
      outcome.error = checked.diagnostics[0].message;
      valid = false;
      continue;
    }
    if (checked.type !== "boolean") {
      outcome.error = "A criterion must be a yes/no condition (for example age >= 18).";
      valid = false;
      continue;
    }

    const run = compileExpr(step.expr, (name) => columns.get(name));
    for (let row = 0; row < frame.rowCount; row += 1) {
      if (mask[row] === 0) continue;
      const value = run(row);
      if (value === null) {
        if (step.on_missing === "drop") {
          mask[row] = 0;
          outcome.removedMissing += 1;
        } else {
          outcome.keptMissing += 1;
        }
        continue;
      }
      const leaves = step.kind === "include" ? value === false : value === true;
      if (leaves) {
        mask[row] = 0;
        outcome.removedByCriterion += 1;
      }
    }
    remaining -= outcome.removedByCriterion + outcome.removedMissing;
    outcome.remaining = remaining;
  }

  return { start: frame.rowCount, steps: outcomes, final: remaining, mask, valid };
}

/** Row indices selected by a mask, or every row when the mask is null. */
export function maskedRows(rowCount: number, mask: Uint8Array | null): number[] {
  const rows: number[] = [];
  for (let row = 0; row < rowCount; row += 1) if (!mask || mask[row] === 1) rows.push(row);
  return rows;
}
