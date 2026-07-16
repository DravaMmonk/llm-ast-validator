/**
 * CohortEvaluationPanel — the third and last visible component the plan
 * authorizes (Section 6.3, 11.4, 11.5).
 *
 * It compares one saved candidate version against observed outcomes and lets a
 * human accept or reject it. It renders inside the existing right inspector's
 * `Cohort results` tab; it is not a fourth workspace pane.
 *
 * Language rule: this surface says "observed outcome", never
 * "ground-truth diagnosis", and never calls the score a probability. Review
 * metrics are exploratory, not held-out performance.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  EvaluationRow,
  EvaluationRunDetail,
  ReviewMetrics,
  RowFilterClass,
} from "../../shared/contracts";
import { ApiError, api } from "../api/client";
import {
  Chip,
  EmptyState,
  KV,
  LoadingState,
  PaneBody,
  PaneFooter,
  SegTabs,
  StatusPill,
  capSm,
  dangerBtn,
  ghostBtn,
  inputCls,
  primaryBtn,
  softBtn,
  tdCls,
  thCls,
  trHoverCls,
} from "../shared-console/src";

const POLL_INTERVAL_MS = 1_000;

/**
 * Tooltips expand each cell to what it actually means. A true negative means the
 * formula said negative and no diabetes was observed during the available
 * follow-up — never permanent freedom from diabetes.
 */
const CLASS_META: Record<RowFilterClass, { label: string; tooltip: string; color: string }> = {
  disagreement: {
    label: "Disagreements",
    tooltip: "Rows where the formula and the observed outcome disagree.",
    color: "var(--warn)",
  },
  true_positive: {
    label: "TP",
    tooltip: "Formula positive; diabetes was observed during the available follow-up.",
    color: "var(--risk-low)",
  },
  true_negative: {
    label: "TN",
    tooltip:
      "Formula negative; no diabetes was observed during the available follow-up. This does not mean permanent freedom from diabetes.",
    color: "var(--risk-low)",
  },
  false_positive: {
    label: "FP",
    tooltip: "Formula positive; no diabetes was observed during the available follow-up.",
    color: "var(--bad)",
  },
  false_negative: {
    label: "FN",
    tooltip: "Formula negative; diabetes was observed during the available follow-up.",
    color: "var(--bad)",
  },
};

function ratio(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

export function CohortEvaluationPanel({
  sessionId,
  versionId,
  isDirty,
}: {
  sessionId: string;
  versionId: string | null;
  /** An unsaved draft cannot be evaluated (Section 11.4). */
  isDirty: boolean;
}) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);

  const dataset = useQuery({ queryKey: ["dataset-current"], queryFn: () => api.getCurrentDataset(), retry: false });

  const latestRun = useQuery({
    queryKey: ["latest-evaluation-run", versionId],
    queryFn: () => api.getLatestEvaluationRun(versionId!),
    enabled: Boolean(versionId),
    retry: false,
  });
  const effectiveRunId = runId ?? latestRun.data?.run?.id ?? null;

  const run = useQuery({
    queryKey: ["evaluation-run", effectiveRunId],
    queryFn: () => api.getEvaluationRun(effectiveRunId!),
    enabled: Boolean(effectiveRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? POLL_INTERVAL_MS : false;
    },
  });

  const evaluate = useMutation({
    mutationFn: () => api.createEvaluationRuns(sessionId, [versionId!]),
    onSuccess: (created) => setRunId(created.run_ids[0]),
  });

  if (!versionId) {
    return (
      <PaneBody>
        <EmptyState title="No candidate selected" hint="Select an admitted candidate to evaluate it." />
      </PaneBody>
    );
  }

  const datasetMissing = dataset.error instanceof ApiError && dataset.error.code === "DATASET_NOT_PREPARED";

  return (
    <>
      <PaneBody>
        {datasetMissing ? (
          <EmptyState
            title="No cohort prepared"
            hint="Run `npm run prepare:cohort` to import the local cohort before evaluating."
          />
        ) : (
          <>
            <div className="flex flex-none items-center gap-2 border-b border-border-2 px-[11px] py-2">
              <button
                type="button"
                className={primaryBtn}
                disabled={isDirty || evaluate.isPending || dataset.isLoading || run.data?.status === "running"}
                onClick={() => evaluate.mutate()}
              >
                {evaluate.isPending ? "Starting…" : "Run cohort evaluation"}
              </button>
              {isDirty && (
                <span className="text-cap text-warn">Save the version first — a draft cannot be evaluated.</span>
              )}
            </div>

            {evaluate.error && (
              <p className="m-0 px-[11px] py-2 text-body text-bad">
                {evaluate.error instanceof Error ? evaluate.error.message : "The evaluation could not be started."}
              </p>
            )}

            {latestRun.isLoading && !runId ? (
              <LoadingState label="Restoring evaluation…" />
            ) : !effectiveRunId ? (
              <EmptyState
                title="Not evaluated yet"
                hint="Run a cohort evaluation to compare this exact version against observed outcomes."
              />
            ) : run.isLoading ? (
              <LoadingState label="Loading evaluation…" />
            ) : run.data ? (
              <RunView run={run.data} versionId={versionId} onRetry={() => evaluate.mutate()} />
            ) : null}
          </>
        )}
      </PaneBody>

      {run.data?.status === "completed" && (
        <DecisionBar
          versionId={versionId}
          run={run.data}
          onDecided={async () => {
            await queryClient.invalidateQueries({ queryKey: ["decisions", versionId] });
          }}
        />
      )}
    </>
  );
}

function RunView({
  run,
  versionId,
  onRetry,
}: {
  run: EvaluationRunDetail;
  versionId: string;
  onRetry: () => void;
}) {
  if (run.status === "failed") {
    return (
      <EmptyState
        title="Evaluation failed"
        hint={`${run.error?.code ?? "UNKNOWN"} — ${run.error?.message ?? "The run did not complete."}`}
        action={
          <button type="button" className={ghostBtn} onClick={onRetry}>
            Retry
          </button>
        }
      />
    );
  }
  if (run.status !== "completed" || !run.review_metrics) {
    return <LoadingState label="Evaluating against the cohort…" />;
  }

  return (
    <div>
      <Provenance run={run} versionId={versionId} />
      <Aggregate metrics={run.review_metrics} />
      <RowTable runId={run.id} run={run} />
    </div>
  );
}

/** Dataset and candidate version stay prominent (Section 11.4). */
function Provenance({ run, versionId }: { run: EvaluationRunDetail; versionId: string }) {
  const comparator = run.score_direction === "higher" ? ">=" : "<=";
  return (
    <section className="border-b border-border-2 px-[11px] py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className={capSm}>Provenance</span>
        {run.stale_dataset && (
          <Chip
            label="stale dataset"
            color="var(--warn)"
            title="This ran against a superseded dataset. Re-evaluate against the current dataset before accepting."
          />
        )}
        <Chip
          label="exploratory"
          color="var(--info)"
          title="Review metrics are exploratory, not held-out performance: a human may inspect them and then edit the formula."
        />
      </div>
      <KV flat k="Candidate version" v={versionId.slice(0, 8)} />
      <KV flat k="AST" v={run.ast_hash.slice(0, 12)} />
      <KV flat k="Dataset version" v={run.dataset_version_id.slice(0, 8)} />
      <KV flat k="Score rule" v={`${comparator} ${run.threshold?.toFixed(4) ?? "—"} (${run.score_direction})`} />
      <KV flat k="Threshold from" v={`${run.calibration_row_count ?? 0} calibration rows · ${run.threshold_policy_version}`} />
      <KV flat k="Evaluator" v={`${run.evaluator_version} · ${run.metric_policy_version}`} />
    </section>
  );
}

/** One aggregate metric as a scannable tile. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border-2 bg-card-2 px-2 py-1.5">
      <div className={`${capSm} truncate`}>{label}</div>
      <div className="ui-mono mt-0.5 text-md font-semibold text-fg">{value}</div>
    </div>
  );
}

/** Formula/observed corner note for one confusion-matrix cell. */
const CONFUSION_SUB: Record<string, string> = {
  true_positive: "formula + · observed +",
  false_positive: "formula + · observed −",
  false_negative: "formula − · observed +",
  true_negative: "formula − · observed −",
};

function Aggregate({ metrics }: { metrics: ReviewMetrics }) {
  return (
    <section className="border-b border-border-2 px-[11px] py-2">
      <div className="mb-0.5 flex items-center gap-2">
        <span className={capSm}>Review split</span>
      </div>
      {/* The denominator sits beside the metrics that depend on it. */}
      <div className="ui-mono mb-1.5 text-fine text-muted-fg">
        N={metrics.review_row_count} · observed positive={metrics.observed_positive_count} · prevalence=
        {metrics.prevalence.toFixed(3)}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="AUROC" value={ratio(metrics.auroc)} />
        <Stat label="Average precision" value={ratio(metrics.average_precision)} />
        <Stat label="Sensitivity" value={ratio(metrics.sensitivity)} />
        <Stat label="Specificity" value={ratio(metrics.specificity)} />
        <Stat label="PPV" value={ratio(metrics.positive_predictive_value)} />
        <Stat label="NPV" value={ratio(metrics.negative_predictive_value)} />
      </div>

      <div className="mt-1.5">
        <KV flat k="Median score · observed positive" v={ratio(metrics.median_score_positive)} />
        <KV flat k="Median score · observed negative" v={ratio(metrics.median_score_negative)} />
      </div>

      {/* 2×2 confusion matrix: rows by formula verdict, columns by observed outcome. */}
      <div className={`${capSm} mb-1 mt-2`}>Confusion — formula vs observed</div>
      <div className="grid grid-cols-2 gap-1.5">
        {(["true_positive", "false_positive", "false_negative", "true_negative"] as const).map((key) => (
          <div
            key={key}
            className="min-w-0 rounded-md border border-border-2 bg-card-2 px-2 py-1.5"
            title={CLASS_META[key].tooltip}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className={capSm}>{CLASS_META[key].label}</span>
              <span className="ui-mono truncate text-nano text-muted-fg">{CONFUSION_SUB[key]}</span>
            </div>
            <div className="ui-mono mt-0.5 text-md font-semibold" style={{ color: CLASS_META[key].color }}>
              {metrics.confusion[key]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RowTable({ runId, run }: { runId: string; run: EvaluationRunDetail }) {
  // Section 11.4: the table defaults to disagreements.
  const [filter, setFilter] = useState<RowFilterClass>("disagreement");
  const [selected, setSelected] = useState<EvaluationRow | null>(null);

  const rows = useQuery({
    queryKey: ["evaluation-rows", runId, filter],
    queryFn: () => api.getEvaluationRows(runId, { error_class: filter, limit: 50 }),
  });

  const comparator = run.score_direction === "higher" ? ">=" : "<=";

  return (
    <section className="px-[11px] py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={capSm}>Rows</span>
      </div>
      <div className="mb-2">
        <SegTabs
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setSelected(null);
          }}
          options={(Object.keys(CLASS_META) as RowFilterClass[]).map((key) => ({
            v: key,
            label: CLASS_META[key].label,
          }))}
        />
      </div>

      {rows.isLoading ? (
        <LoadingState label="Loading rows…" />
      ) : rows.error ? (
        <EmptyState
          title="Could not load rows"
          hint={rows.error instanceof Error ? rows.error.message : undefined}
          action={
            <button type="button" className={ghostBtn} onClick={() => void rows.refetch()}>
              Retry
            </button>
          }
        />
      ) : rows.data && rows.data.rows.length === 0 ? (
        <EmptyState
          title={filter === "disagreement" ? "No disagreements" : "No rows in this class"}
          hint="The formula and the observed outcome agree on every row in this class."
        />
      ) : (
        <>
          <div className="max-h-[300px] overflow-y-auto ui-scroll">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thCls}>Row</th>
                  <th className={thCls}>Score</th>
                  <th className={thCls}>Pct</th>
                  <th className={thCls}>Formula</th>
                  <th className={thCls}>Observed</th>
                </tr>
              </thead>
              <tbody>
                {rows.data?.rows.map((row) => (
                  <tr
                    key={row.row_key}
                    className={`${trHoverCls} cursor-pointer`}
                    onClick={() => setSelected(row)}
                    style={selected?.row_key === row.row_key ? { background: "var(--muted)" } : undefined}
                  >
                    <td className={`${tdCls} ui-mono`}>{row.row_key.slice(0, 8)}</td>
                    <td className={`${tdCls} ui-mono`}>{row.score.toFixed(3)}</td>
                    <td className={`${tdCls} ui-mono`}>{(row.percentile * 100).toFixed(0)}</td>
                    <td className={tdCls} title={CLASS_META[row.error_class].tooltip}>
                      <span style={{ color: row.predicted_label === 1 ? "var(--warn)" : "var(--muted-fg)" }}>
                        {row.predicted_label === 1 ? "positive" : "negative"}
                      </span>
                    </td>
                    <td className={tdCls} title={CLASS_META[row.error_class].tooltip}>
                      {/* "observed outcome", never "ground-truth diagnosis"; the
                          detail card below spells out the full phrase. */}
                      {row.observed_label === 1 ? "yes" : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.data?.next_cursor !== null && (
            <p className="m-0 mt-1.5 text-cap text-muted-fg">
              Showing the first {rows.data?.rows.length} rows. Narrow the class to see more.
            </p>
          )}
        </>
      )}

      {selected && (
        <div className="mt-2 rounded-md border border-border-2 bg-card-2 px-2 py-1.5">
          <div className={`${capSm} mb-1`}>Row {selected.row_key.slice(0, 8)}</div>
          <KV k="Formula score" v={selected.score.toFixed(4)} />
          <KV k="Percentile in review" v={`${(selected.percentile * 100).toFixed(1)}%`} />
          <KV k="Rule" v={`${comparator} ${run.threshold?.toFixed(4) ?? "—"}`} />
          <KV k="Formula says" v={selected.predicted_label === 1 ? "positive" : "negative"} />
          <KV k="Observed outcome" v={selected.observed_label === 1 ? "diabetes observed" : "not observed"} />
          <div className={`${capSm} mt-1.5`}>Formula inputs</div>
          {Object.entries(selected.explanation_inputs).map(([key, value]) => (
            <KV key={key} k={key} v={String(value)} />
          ))}
        </div>
      )}
    </section>
  );
}

function DecisionBar({
  versionId,
  run,
  onDecided,
}: {
  versionId: string;
  run: EvaluationRunDetail;
  onDecided: () => Promise<void>;
}) {
  const [note, setNote] = useState("");

  const decisions = useQuery({
    queryKey: ["decisions", versionId],
    queryFn: () => api.getDecisions(versionId),
  });

  const decide = useMutation({
    mutationFn: (decision: "accepted" | "rejected") =>
      api.createDecision(versionId, {
        decision,
        // Acceptance must bind the completed evaluation of this exact version.
        evaluation_run_id: decision === "accepted" ? run.id : undefined,
        note: note.trim() === "" ? undefined : note.trim(),
      }),
    onSuccess: async () => {
      setNote("");
      await onDecided();
    },
  });

  const latest = decisions.data?.decisions.at(-1);

  return (
    <>
      {latest && (
        <div className="flex flex-none items-center gap-2 border-t border-border-2 px-[11px] py-1.5">
          <span className={capSm}>Decision</span>
          <StatusPill status={latest.decision === "accepted" ? "approved" : "retired"} />
          <span className="text-cap text-muted-fg">
            #{latest.decision_no}
            {latest.note ? ` · ${latest.note}` : ""}
          </span>
          {latest.stale_dataset && <Chip label="stale dataset" color="var(--warn)" />}
        </div>
      )}

      <div className="flex flex-none items-center gap-2 border-t border-border-2 px-[11px] py-2">
        <input
          className={`${inputCls} min-w-0 flex-1`}
          aria-label="Decision note"
          placeholder="Optional note"
          value={note}
          disabled={decide.isPending}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          type="button"
          className={dangerBtn}
          disabled={decide.isPending}
          onClick={() => decide.mutate("rejected")}
        >
          Reject
        </button>
        <button
          type="button"
          className={softBtn}
          disabled={decide.isPending || run.stale_dataset}
          title={run.stale_dataset ? "Re-evaluate against the current dataset before accepting." : undefined}
          onClick={() => decide.mutate("accepted")}
        >
          Accept
        </button>
      </div>

      {decide.error && (
        <PaneFooter>
          <span className="text-bad">
            {decide.error instanceof ApiError
              ? `${decide.error.code} — ${decide.error.message}`
              : "The decision could not be recorded."}
          </span>
        </PaneFooter>
      )}
    </>
  );
}
