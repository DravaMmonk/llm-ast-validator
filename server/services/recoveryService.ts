/**
 * Startup recovery (plan Section 5).
 *
 * Nothing resumes in-flight work across a restart. A run left `pending` or
 * `running` can never progress, so it becomes a visible `APP_RESTARTED` failure
 * the user can retry. Completed and failed runs are never touched.
 */

import type { AppDatabase } from "../db/connection";
import { failStaleTurns } from "../db/stores/candidates";
import { failStaleRuns } from "../db/stores/evaluations";

export interface RecoveryResult {
  failed_turns: number;
  failed_evaluations: number;
}

export function recoverInterruptedRuns(
  database: AppDatabase,
  now = new Date().toISOString(),
): RecoveryResult {
  return {
    failed_turns: failStaleTurns(database, now),
    failed_evaluations: failStaleRuns(database, now),
  };
}
