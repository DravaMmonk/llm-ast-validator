/**
 * Score Forge — assemble a risk score from puzzle pieces and judge it at once.
 *
 * Every snap re-evaluates the score on the selected rows and, given a binary
 * outcome, recomputes discrimination (ROC, AUC with a DeLong interval), the
 * operating point at a chosen threshold, and the event-rate gradient across
 * score tenths. The judgement is exploratory: the same rows inform the edit and
 * the evaluation, so it says nothing about performance on new patients.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";

import { canonicalHash } from "../../../shared/ast/canonical";
import { type Frame, binaryValue, frameSchema, isBinaryColumn } from "../../../shared/workbench/dataset";
import type { CohortPayload, ScorePayload, WorkbenchDocument } from "../../../shared/workbench/documents";
import { type ExprNode, compileExpr, evaluateExpr, exprColumns, hashExpr } from "../../../shared/workbench/expr";
import { exprToLatex } from "../../../shared/workbench/exprLatex";
import { printExpr } from "../../../shared/workbench/exprText";
import { aucDeLong, confusionAt, diagnostic2x2, histogram, rocCurve, youdenOptimal } from "../../../shared/stats";
import { BarChart, ChartActions, Histogram, LineChart } from "../../charts";
import { ExprEditor, type ExprStatus } from "../../blocks/ExprEditor";
import {
  CONDITION_PIECES,
  MATH_PIECES,
  PieceLibrary,
  VALUE_PIECES,
  columnGroups,
  type PieceEntry,
} from "../../blocks/PieceLibrary";
import type { WbCanvasApi } from "../../blocks/useWbCanvas";
import { exprToBlock } from "../../blocks/wbAdapter";
import { HUE } from "../../blocks/wbBlocks";
import { FormulaPreview } from "../../formula/FormulaPreview";
import {
  EmptyState,
  KV,
  LoadingState,
  Page,
  Pane,
  PaneBody,
  PaneHeader,
  SegTabs,
  TabBar,
  ghostBtn,
  inputSmCls,
  pillBtn,
  primaryBtn,
  selectSmCls,
  textareaCls,
  toast,
} from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import {
  invalidateDocuments,
  provenanceOf,
  useActiveDataset,
  useDocuments,
  useFrame,
  usePinToReport,
  useRowSelection,
} from "../../workstation/data";
import { markClean, useGuard, useUnsavedChanges } from "../../workstation/guard";
import { Callout, ColumnSelect, plural, Field, PinButton, ResultTable, Section, StatTile, fixed, fmt, needsDatasetHint, pct } from "../../workstation/ui";
import { DerivedDialog } from "../data/DerivedDialog";
import { CALCULATORS } from "../../../shared/workbench/calculators";

interface Draft {
  title: string;
  expr: ExprNode | null;
  outcome: string | null;
  direction: "higher" | "lower";
  cohortId: string | null;
  calculatorKey: string | null;
  notes: string;
}

const draftHash = (draft: Draft) => canonicalHash(draft as unknown as Record<string, unknown>);

export default function ScoreForge() {
  const { scoreId } = useParams<{ scoreId: string }>();
  const navigate = useNavigate();
  const { datasetId, setDatasetId, isLoading: listLoading } = useActiveDataset();
  const opened = useQuery({
    queryKey: ["wb-doc", scoreId],
    queryFn: () => wbApi.getDocument<ScorePayload>(scoreId!),
    enabled: Boolean(scoreId),
  });
  // Opening a score by link switches to its dataset once, never overriding a later switch.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    const doc = opened.data;
    if (!doc || synced.current === doc.id) return;
    synced.current = doc.id;
    if (doc.dataset_id && doc.dataset_id !== datasetId) setDatasetId(doc.dataset_id);
  }, [opened.data, datasetId, setDatasetId]);
  const { frame, isLoading } = useFrame(datasetId);
  const scores = useDocuments<ScorePayload>("score", datasetId, Boolean(datasetId));

  if (listLoading || isLoading || (scoreId && opened.isLoading)) {
    return (
      <Page>
        <Pane>
          <PaneBody>
            <LoadingState label="Loading Score Forge…" />
          </PaneBody>
        </Pane>
      </Page>
    );
  }
  if (!datasetId || !frame) {
    return (
      <Page>
        <Pane>
          <PaneBody>
            <EmptyState
              title="No dataset to forge a score on"
              hint={needsDatasetHint()}
              action={
                <button type="button" className={primaryBtn} onClick={() => navigate("/")}>
                  Go to Overview
                </button>
              }
            />
          </PaneBody>
        </Pane>
      </Page>
    );
  }
  if (scoreId && opened.error) {
    return (
      <Page>
        <Pane>
          <PaneBody>
            <EmptyState
              title="Score not found"
              hint={errorMessage(opened.error)}
              action={
                <button type="button" className={pillBtn} onClick={() => navigate("/forge")}>
                  Start a new score
                </button>
              }
            />
          </PaneBody>
        </Pane>
      </Page>
    );
  }
  const saved = opened.data && opened.data.dataset_id === datasetId ? opened.data : null;
  return <ForgeWorkspace key={`${datasetId}:${saved?.id ?? "new"}`} frame={frame} saved={saved} scores={scores.data?.documents ?? []} />;
}

function defaultOutcome(frame: Frame): string | null {
  const binary = frame.columns.filter((column) => column.error === null && isBinaryColumn(column));
  return (binary.find((column) => column.role === "outcome") ?? binary.find((column) => column.role === "event") ?? binary[0])?.name ?? null;
}

function ForgeWorkspace({
  frame,
  saved,
  scores,
}: {
  frame: Frame;
  saved: WorkbenchDocument<ScorePayload> | null;
  scores: WorkbenchDocument<ScorePayload>[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const incoming = (location.state as { expr?: ExprNode; title?: string; calculatorKey?: string } | null) ?? null;
  const initial: Draft = saved
    ? {
        title: saved.title,
        expr: saved.payload.expr,
        outcome: saved.payload.outcome,
        direction: saved.payload.direction,
        cohortId: saved.payload.cohort_id,
        calculatorKey: saved.payload.calculator_key,
        notes: saved.payload.notes,
      }
    : {
        title: incoming?.title ?? "Untitled score",
        expr: incoming?.expr ?? null,
        outcome: defaultOutcome(frame),
        direction: "higher",
        cohortId: null,
        calculatorKey: incoming?.calculatorKey ?? null,
        notes: "",
      };
  const [draft, setDraft] = useState<Draft>(initial);
  const [baseline, setBaseline] = useState(() => (incoming && !saved ? "" : draftHash(initial)));
  const [status, setStatus] = useState<ExprStatus>({ expr: initial.expr, type: null, problem: null });
  const [loadKey, setLoadKey] = useState(0);
  const [tab, setTab] = useState<"performance" | "distribution" | "whatif" | "details">("performance");
  const [derivedOpen, setDerivedOpen] = useState(false);
  const canvas = useRef<WbCanvasApi | null>(null);
  const dirty = draftHash(draft) !== baseline;
  const pin = usePinToReport();
  useUnsavedChanges(dirty, `The score “${draft.title || "Untitled score"}”`);
  const guard = useGuard();
  const unfinished = status.problem !== null;

  const cohortDocs = useDocuments<CohortPayload>("cohort", frame.datasetId);
  const selection = useRowSelection(frame, draft.cohortId);
  const schema = useMemo(() => frameSchema(frame), [frame]);
  const describe = (name: string) => {
    const column = frame.columns.find((entry) => entry.name === name);
    return column ? `${column.label}${column.unit ? ` (${column.unit})` : ""}` : name;
  };

  const save = useMutation({
    mutationFn: () => {
      const payload: ScorePayload = {
        expr: draft.expr,
        outcome: draft.outcome,
        direction: draft.direction,
        cohort_id: draft.cohortId,
        calculator_key: draft.calculatorKey,
        notes: draft.notes,
      };
      const title = draft.title.trim() || "Untitled score";
      return saved
        ? wbApi.patchDocument<ScorePayload>(saved.id, { title, payload })
        : wbApi.createDocument<ScorePayload>({ kind: "score", title, dataset_id: frame.datasetId, payload });
    },
    onSuccess: async (doc) => {
      const next = { ...draft, title: doc.title };
      setDraft(next);
      setBaseline(draftHash(next));
      // The open-by-id cache must hold what was just saved, or reopening shows the old version.
      queryClient.setQueryData(["wb-doc", doc.id], doc);
      await invalidateDocuments(queryClient, "score");
      toast(`Saved score · ${doc.title}`);
      if (!saved) {
        // The work is saved; the URL change must not trip the unsaved-changes blocker.
        markClean();
        navigate(`/forge/${doc.id}`, { replace: true });
      }
    },
    onError: (error) => toast(`Not saved: ${errorMessage(error)}`),
  });

  // Evaluate the draft's formula (stable identity across cosmetic canvas events), not the status copy.
  const valid = draft.expr && status.expr && !status.problem && status.type === "number" ? draft.expr : null;
  const evaluation = useScoreEvaluation(frame, valid, draft.outcome, draft.direction, selection.rows);

  const templates: PieceEntry[] = useMemo(
    () =>
      CALCULATORS.map((calc): PieceEntry | null => {
        let state;
        try {
          state = exprToBlock(calc.outputs[0].expr, schema);
        } catch {
          return null;
        }
        return {
          id: `calc:${calc.key}`,
          label: calc.name,
          tag: calc.short,
          detail: `${calc.summary} Its inputs arrive as grey column pieces named after the calculator's variables — swap them for this dataset's columns.`,
          hue: HUE.condition,
          state,
        };
      }).filter((entry): entry is PieceEntry => entry !== null),
    [schema],
  );

  const groups = useMemo(
    () => [
      ...columnGroups(frame),
      { key: "math", label: "Math", entries: MATH_PIECES },
      { key: "conditions", label: "Conditions", entries: CONDITION_PIECES },
      { key: "values", label: "Values", entries: VALUE_PIECES },
      { key: "templates", label: "Calculator templates", entries: templates },
    ],
    [frame, templates],
  );

  const outcomeColumns = frame.columns.filter((column) => column.error === null && isBinaryColumn(column));

  return (
    <Page>
      <PieceLibrary groups={groups} onInsert={(entry) => canvas.current?.insert(entry.state)} />

      <Pane>
        <PaneHeader label="Score">
          <select
            aria-label="Open a saved score"
            className={`${selectSmCls} max-w-[200px]`}
            value={saved?.id ?? ""}
            onChange={(event) => {
              const target = event.target.value ? `/forge/${event.target.value}` : "/forge";
              guard(() => navigate(target));
            }}
          >
            <option value="">{saved ? "＋ New score" : "New (unsaved)"}</option>
            {scores.map((score) => (
              <option key={score.id} value={score.id}>
                {score.title}
              </option>
            ))}
          </select>
          {dirty && <span className="ui-mono text-fine" style={{ color: "var(--warn)" }}>unsaved</span>}
          <button
            type="button"
            className={`${primaryBtn} flex items-center gap-1`}
            disabled={save.isPending || (!dirty && Boolean(saved)) || unfinished}
            title={unfinished ? `Fix the formula before saving: ${status.problem}` : undefined}
            onClick={() => save.mutate()}
          >
            <Save size={13} aria-hidden /> {save.isPending ? "Saving…" : "Save"}
          </button>
        </PaneHeader>
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border-2 px-[11px] py-1.5">
          <input
            aria-label="Score title"
            className={`${inputSmCls} h-7 w-[300px] font-sans text-ui`}
            value={draft.title}
            maxLength={160}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
          {draft.calculatorKey && (
            <span className="text-cap text-muted-fg">
              from calculator <span className="ui-mono">{draft.calculatorKey}</span>
            </span>
          )}
          {incoming?.expr && !saved && (
            <span className="text-cap" style={{ color: "var(--info)" }}>
              Loaded from the calculator library — map its variables to your columns if any piece is red.
            </span>
          )}
        </div>
        <ExprEditor
          value={draft.expr}
          loadKey={loadKey}
          schema={schema}
          describe={describe}
          expected="number"
          onChange={(next) => {
            setStatus(next);
            // An unfinished canvas has no formula; never keep a stale one that is no longer on screen.
            setDraft((current) =>
              (current.expr && next.expr && hashExpr(current.expr) === hashExpr(next.expr)) || (!current.expr && !next.expr)
                ? current
                : { ...current, expr: next.expr },
            );
          }}
          onCanvasApi={(api) => {
            canvas.current = api;
          }}
          emptyHint="Build a score: drag numeric columns and arithmetic pieces, use if-pieces for points, or start from a calculator template."
        />
      </Pane>

      <Pane w={420} side="l">
        <div className="flex flex-none flex-col gap-2 border-b border-border-2 px-[11px] py-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Outcome (0/1)" htmlFor="forge-outcome">
              <ColumnSelect
                id="forge-outcome"
                frame={frame}
                value={draft.outcome}
                onChange={(outcome) => setDraft((current) => ({ ...current, outcome }))}
                filter={(column) => isBinaryColumn(column)}
                allowNone
                noneLabel="— no outcome —"
                ariaLabel="Outcome column"
              />
            </Field>
            <Field label="Rows" htmlFor="forge-cohort">
              <select
                id="forge-cohort"
                className={`${selectSmCls} h-7 text-body`}
                value={draft.cohortId ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, cohortId: event.target.value || null }))}
              >
                <option value="">All rows ({frame.rowCount.toLocaleString("en-US")})</option>
                {(cohortDocs.data?.documents ?? []).map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    Cohort: {cohort.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Higher score means</span>
            <SegTabs
              value={draft.direction}
              onChange={(direction) => setDraft((current) => ({ ...current, direction }))}
              options={[
                { v: "higher", label: "more risk" },
                { v: "lower", label: "less risk" },
              ]}
            />
          </div>
          {outcomeColumns.length === 0 && (
            <Callout tone="info">This dataset has no 0/1 column; discrimination needs a binary outcome. Distribution still works.</Callout>
          )}
        </div>
        <TabBar
          value={tab}
          onChange={setTab}
          options={[
            { v: "performance", label: "Performance" },
            { v: "distribution", label: "Distribution" },
            { v: "whatif", label: "What-if" },
            { v: "details", label: "Details" },
          ]}
        />
        <PaneBody>
          {!valid ? (
            <EmptyState
              title={status.problem ? "The score is not valid yet" : "No score yet"}
              hint={status.problem ?? "Assemble a numeric formula on the canvas to see its performance."}
            />
          ) : tab === "performance" ? (
            <PerformanceTab
              evaluation={evaluation}
              outcome={draft.outcome}
              direction={draft.direction}
              onFlip={() => setDraft((current) => ({ ...current, direction: current.direction === "higher" ? "lower" : "higher" }))}
            />
          ) : tab === "distribution" ? (
            <DistributionTab evaluation={evaluation} />
          ) : tab === "whatif" ? (
            <WhatIfTab key={printExpr(valid)} frame={frame} expr={valid} evaluation={evaluation} rows={selection.rows} />
          ) : (
            <DetailsTab
              expr={valid}
              frame={frame}
              notes={draft.notes}
              onNotes={(notes) => setDraft((current) => ({ ...current, notes }))}
              onDerive={() => setDerivedOpen(true)}
            />
          )}
          {valid && evaluation && (
            <div className="flex flex-wrap gap-2 border-t border-border-2 px-[11px] py-2.5">
              <PinButton
                busy={pin.isPending}
                onClick={() =>
                  pin.mutate({
                    title: `Score · ${draft.title}`,
                    datasetId: frame.datasetId,
                    payload: {
                      module: "forge",
                      summary: scoreSummary(draft, evaluation),
                      table: {
                        columns: ["Measure", "Value"],
                        rows: [
                          ["Formula", printExpr(valid)],
                          ["Rows scored", evaluation.scored],
                          ["Missing score", evaluation.missing],
                          ...(evaluation.discrimination
                            ? ([
                                ["AUC (95% CI)", `${fixed(evaluation.discrimination.auc.auc, 3)} (${fixed(evaluation.discrimination.auc.lower, 3)}–${fixed(evaluation.discrimination.auc.upper, 3)})`],
                                ["Youden threshold", fmt(evaluation.discrimination.youden.threshold)],
                                ["Sensitivity at threshold", pct(evaluation.discrimination.youden.sensitivity)],
                                ["Specificity at threshold", pct(evaluation.discrimination.youden.specificity)],
                              ] as [string, string][])
                            : []),
                        ],
                      },
                      chart: evaluation.discrimination
                        ? { type: "roc", data: { points: evaluation.discrimination.roc.points.map((p) => ({ x: p.fpr, y: p.tpr })), auc: evaluation.discrimination.auc.auc } }
                        : null,
                      provenance: { ...provenanceOf(frame, selection), formula: printExpr(valid), outcome: draft.outcome },
                      notes: draft.notes,
                    },
                  })
                }
              />
            </div>
          )}
        </PaneBody>
      </Pane>

      {derivedOpen && valid && (
        <DerivedDialogFromForge frame={frame} expr={valid} title={draft.title} onClose={() => setDerivedOpen(false)} />
      )}
    </Page>
  );
}

function DerivedDialogFromForge({ frame, expr, title, onClose }: { frame: Frame; expr: ExprNode; title: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: ["wb-dataset", frame.datasetId], queryFn: () => wbApi.getDataset(frame.datasetId) });
  if (!detail.data) return null;
  const suggested = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "score";
  return <DerivedDialog frame={frame} derived={detail.data.derived} editing={null} initialExpr={expr} initialName={suggested} onClose={onClose} />;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

interface ScoreEvaluation {
  scores: number[];
  labels: (0 | 1)[] | null;
  scored: number;
  missing: number;
  bins: { x0: number; x1: number; count: number }[];
  discrimination: {
    roc: ReturnType<typeof rocCurve>;
    auc: ReturnType<typeof aucDeLong>;
    youden: ReturnType<typeof youdenOptimal>;
    events: number;
    deciles: { label: string; rate: number; n: number }[];
  } | null;
  discriminationError: string | null;
}

function useScoreEvaluation(
  frame: Frame,
  expr: ExprNode | null,
  outcome: string | null,
  direction: "higher" | "lower",
  rows: number[],
): ScoreEvaluation | null {
  return useMemo(() => {
    if (!expr) return null;
    const columns = new Map(frame.columns.map((column) => [column.name, column.values]));
    const run = compileExpr(expr, (name) => columns.get(name));
    const outcomeValues = outcome ? columns.get(outcome) : undefined;
    const scores: number[] = [];
    const labels: (0 | 1)[] = [];
    let missing = 0;
    for (const row of rows) {
      const value = run(row);
      if (typeof value !== "number") {
        missing += 1;
        continue;
      }
      if (outcomeValues) {
        const label = binaryValue(outcomeValues[row]);
        if (label === null) continue;
        labels.push(label);
      }
      scores.push(value);
    }
    // Orient so that a larger oriented score always means more risk.
    const oriented = direction === "higher" ? scores : scores.map((value) => -value);
    let discrimination: ScoreEvaluation["discrimination"] = null;
    let discriminationError: string | null = null;
    if (outcomeValues) {
      const events = labels.reduce<number>((sum, label) => sum + label, 0);
      if (events === 0 || events === labels.length) {
        discriminationError = "The outcome has only one class in these rows, so discrimination is undefined.";
      } else {
        try {
          const order = oriented.map((value, index) => index).sort((a, b) => oriented[a] - oriented[b]);
          const deciles: { label: string; rate: number; n: number }[] = [];
          for (let d = 0; d < 10; d += 1) {
            const slice = order.slice(Math.floor((d * order.length) / 10), Math.floor(((d + 1) * order.length) / 10));
            if (slice.length === 0) continue;
            const positives = slice.reduce((sum, index) => sum + labels[index], 0);
            deciles.push({ label: `D${d + 1}`, rate: positives / slice.length, n: slice.length });
          }
          const youden = youdenOptimal(oriented, labels);
          discrimination = {
            roc: rocCurve(oriented, labels),
            auc: aucDeLong(oriented, labels),
            youden: { ...youden, threshold: direction === "higher" ? youden.threshold : -youden.threshold },
            events,
            deciles,
          };
        } catch (error) {
          discriminationError = error instanceof Error ? error.message : "Discrimination could not be computed.";
        }
      }
    }
    return {
      scores,
      labels: outcomeValues ? labels : null,
      scored: scores.length,
      missing,
      bins: scores.length ? histogram(scores).bins : [],
      discrimination,
      discriminationError,
    };
  }, [frame, expr, outcome, direction, rows]);
}

function scoreSummary(draft: Draft, evaluation: ScoreEvaluation): string {
  const auc = evaluation.discrimination?.auc;
  return auc
    ? `The score ${draft.title} discriminated ${draft.outcome} with an AUC of ${fixed(auc.auc, 3)} (95% CI ${fixed(auc.lower, 3)}–${fixed(auc.upper, 3)}) across ${evaluation.labels?.length ?? 0} rows (${evaluation.discrimination!.events} events). Exploratory: evaluated on the rows used to build it.`
    : `The score ${draft.title} was computed for ${evaluation.scored} rows (${evaluation.missing} missing).`;
}

function PerformanceTab({
  evaluation,
  outcome,
  direction,
  onFlip,
}: {
  evaluation: ScoreEvaluation | null;
  outcome: string | null;
  direction: "higher" | "lower";
  onFlip: () => void;
}) {
  const rocRef = useRef<SVGSVGElement>(null);
  const decRef = useRef<SVGSVGElement>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const discrimination = evaluation?.discrimination ?? null;
  // A new formula or outcome resets the cut to the Youden optimum.
  useEffect(() => setThreshold(null), [discrimination]);
  if (!evaluation) return null;
  if (!outcome) return <EmptyState title="Choose an outcome" hint="Pick a 0/1 outcome above to see the ROC curve and AUC." />;
  if (!discrimination) return <EmptyState title="No discrimination" hint={evaluation.discriminationError ?? "Not enough data."} />;
  return (
    <ThresholdPanel
      scores={evaluation.scores}
      labels={evaluation.labels!}
      direction={direction}
      threshold={threshold ?? discrimination.youden.threshold}
      setThreshold={setThreshold}
      youdenThreshold={discrimination.youden.threshold}
      roc={discrimination.roc}
      auc={discrimination.auc}
      deciles={discrimination.deciles}
      rocRef={rocRef}
      decRef={decRef}
      onFlip={onFlip}
    />
  );
}

function ThresholdPanel({
  scores,
  labels,
  direction,
  threshold,
  setThreshold,
  youdenThreshold,
  roc,
  auc,
  deciles,
  rocRef,
  decRef,
  onFlip,
}: {
  scores: number[];
  labels: (0 | 1)[];
  direction: "higher" | "lower";
  threshold: number;
  setThreshold: (value: number) => void;
  youdenThreshold: number;
  roc: ReturnType<typeof rocCurve>;
  auc: ReturnType<typeof aucDeLong>;
  deciles: { label: string; rate: number; n: number }[];
  rocRef: React.RefObject<SVGSVGElement>;
  decRef: React.RefObject<SVGSVGElement>;
  onFlip: () => void;
}) {
  const sorted = useMemo(() => [...scores].sort((a, b) => a - b), [scores]);
  // Arrow keys step between distinct cut-offs, never between tied rows.
  const cuts = useMemo(() => sorted.filter((value, index) => index === 0 || value !== sorted[index - 1]), [sorted]);
  const found = cuts.findIndex((value) => value >= threshold);
  const cutIndex = found === -1 ? Math.max(0, cuts.length - 1) : found;
  const cut = confusionAt(scores, labels, threshold, direction);
  const metrics = diagnostic2x2(cut.tp, cut.fp, cut.fn, cut.tn);
  const below = sorted.findIndex((value) => value >= threshold);
  const percentile = sorted.length ? (below === -1 ? 1 : below / sorted.length) : 0;
  const operating = {
    x: cut.fp + cut.tn ? cut.fp / (cut.fp + cut.tn) : 0,
    y: cut.tp + cut.fn ? cut.tp / (cut.tp + cut.fn) : 0,
  };
  const positive = direction === "higher" ? "≥" : "≤";
  const negative = direction === "higher" ? "<" : ">";
  return (
    <>
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label="AUC" value={fixed(auc.auc, 3)} sub={`95% CI ${fixed(auc.lower, 3)}–${fixed(auc.upper, 3)}`} tone="var(--primary)" />
        <StatTile label="Sensitivity" value={pct(metrics.sensitivity.estimate)} sub={`score ${positive} ${fmt(threshold)}`} />
        <StatTile label="Specificity" value={pct(metrics.specificity.estimate)} sub={`PPV ${pct(metrics.ppv.estimate)}`} />
      </div>
      <Section title="ROC curve">
        <LineChart
          ref={rocRef}
          title="ROC curve"
          height={240}
          series={[{ label: "Score", points: roc.points.map((point) => ({ x: point.fpr, y: point.tpr })) }]}
          xLabel="1 − specificity"
          yLabel="Sensitivity"
          xDomain={[0, 1]}
          yDomain={[0, 1]}
          diagonal
          highlight={{ ...operating, label: "cut" }}
          legend={false}
          actions={<ChartActions svgRef={rocRef} filename="roc-curve" />}
        />
      </Section>
      <Section
        title="Threshold"
        actions={
          <button type="button" className={ghostBtn} onClick={() => setThreshold(youdenThreshold)}>
            Youden optimum
          </button>
        }
      >
        <input
          type="range"
          aria-label="Score threshold"
          aria-valuetext={`cut ${fmt(threshold)} · sensitivity ${pct(metrics.sensitivity.estimate)} · specificity ${pct(metrics.specificity.estimate)}`}
          className="w-full accent-[var(--primary)]"
          min={0}
          max={Math.max(0, cuts.length - 1)}
          step={1}
          value={cutIndex}
          onChange={(event) => setThreshold(cuts[Number(event.target.value)] ?? threshold)}
        />
        <div className="ui-mono mt-1 flex justify-between text-fine text-muted-fg">
          <span>{fmt(sorted[0])}</span>
          <span>
            cut {fmt(threshold)} · {pct(percentile, 0)} of rows below
          </span>
          <span>{fmt(sorted[sorted.length - 1])}</span>
        </div>
        <div className="mt-2">
          <ResultTable
            dense
            columns={["", "Outcome = 1", "Outcome = 0"]}
            rows={[
              [`Score ${positive} cut`, `TP ${cut.tp}`, `FP ${cut.fp}`],
              [`Score ${negative} cut`, `FN ${cut.fn}`, `TN ${cut.tn}`],
            ]}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <KV k="NPV" v={pct(metrics.npv.estimate)} flat />
          <KV k="LR+" v={fixed(metrics.lrPositive.estimate, 2)} flat />
          <KV k="Accuracy" v={pct(metrics.accuracy.estimate)} flat />
          <KV k="LR−" v={fixed(metrics.lrNegative.estimate, 2)} flat />
        </div>
      </Section>
      <Section title="Event rate by score tenth">
        <BarChart
          ref={decRef}
          title="Observed event rate by score decile"
          orientation="vertical"
          height={180}
          data={deciles.map((decile) => ({ label: decile.label, value: decile.rate, detail: `${decile.n} rows` }))}
          valueFormat={(value) => `${(value * 100).toFixed(1)}%`}
          tickFormat={(value) => `${Math.round(value * 1000) / 10}%`}
          yLabel="Event rate"
        />
        <p className="m-0 mt-1 text-cap leading-relaxed text-muted-fg">
          D1 holds the lowest-risk tenth. A useful score climbs steadily from left to right.
        </p>
      </Section>
      {auc.auc < 0.5 && (
        <div className="px-[11px] pt-2">
          <Callout tone="info">
            The AUC is below 0.5: in these rows {direction === "higher" ? "lower" : "higher"} scores go with the outcome.
            <button type="button" className={`${ghostBtn} ml-2 inline-flex`} onClick={onFlip}>
              Flip direction
            </button>
          </Callout>
        </div>
      )}
      <div className="px-[11px] py-2">
        <Callout tone="warn">Exploratory: the same rows shaped the formula and judged it. Validate on independent data before any use.</Callout>
      </div>
    </>
  );
}

function DistributionTab({ evaluation }: { evaluation: ScoreEvaluation | null }) {
  const ref = useRef<SVGSVGElement>(null);
  if (!evaluation) return null;
  const mean = evaluation.scores.reduce((sum, value) => sum + value, 0) / Math.max(1, evaluation.scores.length);
  return (
    <>
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label="Scored" value={evaluation.scored.toLocaleString("en-US")} />
        <StatTile label="Missing" value={evaluation.missing.toLocaleString("en-US")} tone={evaluation.missing ? "var(--warn)" : undefined} />
        <StatTile label="Mean" value={fmt(mean)} />
      </div>
      <Section title="Distribution">
        <Histogram
          ref={ref}
          title="Score distribution"
          height={220}
          bins={evaluation.bins}
          xLabel="Score"
          markers={[{ x: mean, label: "mean" }]}
          actions={<ChartActions svgRef={ref} filename="score-distribution" />}
        />
      </Section>
      {evaluation.missing > 0 && (
        <div className="px-[11px] py-2">
          <Callout tone="info">
            {plural(evaluation.missing, "row")} {evaluation.missing === 1 ? "has" : "have"} no score because an input is missing or a step is undefined (for example division by zero).
          </Callout>
        </div>
      )}
    </>
  );
}

function DetailsTab({
  expr,
  frame,
  notes,
  onNotes,
  onDerive,
}: {
  expr: ExprNode;
  frame: Frame;
  notes: string;
  onNotes: (notes: string) => void;
  onDerive: () => void;
}) {
  const columns = exprColumns(expr);
  return (
    <>
      <Section title="Formula">
        <FormulaPreview latex={exprToLatex(expr)} variant="card" />
        <p className="ui-mono m-0 mt-1.5 break-all text-label text-fg">{printExpr(expr)}</p>
      </Section>
      <Section title="Inputs">
        {columns.map((name) => {
          const column = frame.columns.find((entry) => entry.name === name);
          return <KV key={name} k={name} v={column ? `${column.label}${column.unit ? ` · ${column.unit}` : ""}` : "not in dataset"} flat />;
        })}
      </Section>
      <Section title="Use it">
        <button type="button" className={pillBtn} onClick={onDerive}>
          Save as a derived variable…
        </button>
        <p className="m-0 mt-1.5 text-cap leading-relaxed text-muted-fg">
          A derived variable makes the score available to Statistics, the Diagnostic Lab, and cohort criteria.
        </p>
      </Section>
      <Section title="Notes">
        <textarea aria-label="Score notes" className={`${textareaCls} h-[90px]`} value={notes} onChange={(event) => onNotes(event.target.value)} />
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* What-if patient                                                     */
/* ------------------------------------------------------------------ */

/**
 * A single synthetic patient whose inputs you move with sliders: the score
 * updates live and is placed in the cohort's score distribution, which turns
 * an abstract formula into something a clinician can reason about.
 */
function WhatIfTab({ frame, expr, evaluation, rows }: { frame: Frame; expr: ExprNode; evaluation: ScoreEvaluation | null; rows: number[] }) {
  const inputs = useMemo(
    () =>
      exprColumns(expr)
        .map((name) => frame.columns.find((column) => column.name === name))
        .filter((column): column is NonNullable<typeof column> => Boolean(column))
        .map((column) => {
          if (column.kind === "numeric") {
            const values = rows.map((row) => column.values[row]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
            const at = (p: number) => (values.length ? values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))] : 0);
            return { column, kind: "numeric" as const, min: at(0.01), max: at(0.99), start: at(0.5), levels: [] as string[] };
          }
          const levels = [...new Set(rows.map((row) => column.values[row]).filter((v) => v !== null).map((v) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v))))].sort();
          return { column, kind: column.kind, min: 0, max: 0, start: 0, levels };
        }),
    [expr, frame, rows],
  );
  const [values, setValues] = useState<Record<string, number | string>>(() =>
    Object.fromEntries(inputs.map((input) => [input.column.name, input.kind === "numeric" ? input.start : input.levels[0] ?? ""])),
  );
  const row: Record<string, number | string | boolean | null> = {};
  for (const input of inputs) {
    const value = values[input.column.name];
    if (input.kind === "boolean") row[input.column.name] = value === "yes" ? true : value === "no" ? false : null;
    else row[input.column.name] = value === "" || value === undefined ? null : value;
  }
  const score = evaluateExpr(expr, row);
  const sorted = useMemo(() => [...(evaluation?.scores ?? [])].sort((a, b) => a - b), [evaluation]);
  const lower = typeof score === "number" ? sorted.filter((value) => value < score).length : 0;
  const same = typeof score === "number" ? sorted.filter((value) => value === score).length : 0;
  // Mid-rank percentile, so a tie at the minimum is not called the 50th percentile.
  const percentile = typeof score === "number" && sorted.length ? (lower + same / 2) / sorted.length : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label="This patient's score" value={typeof score === "number" ? fmt(score, 4) : "missing"} tone="var(--primary)" />
        <StatTile
          label="Cohort position"
          value={percentile === null ? "—" : `${Math.round(percentile * 100)}th pct`}
          sub={percentile === null ? undefined : `${pct(lower / sorted.length, 0)} score lower · ${pct(same / sorted.length, 0)} the same`}
        />
      </div>
      {percentile !== null && (
        <div className="border-b border-border-2 px-[11px] py-2.5">
          <div className="relative h-2.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--risk-low), var(--risk-mod), var(--risk-high))" }}>
            <div
              className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full bg-fg-strong shadow"
              style={{ left: `${percentile * 100}%` }}
              aria-hidden
            />
          </div>
          <div className="ui-mono mt-1 flex justify-between text-nano text-muted-fg">
            <span>lowest</span>
            <span>median</span>
            <span>highest</span>
          </div>
        </div>
      )}
      <Section title="Move the inputs">
        <div className="flex flex-col gap-3">
          {inputs.map((input) => (
            <label key={input.column.name} className="flex flex-col gap-1">
              <span className="flex justify-between text-label text-fg">
                <span className="ui-mono">{input.column.name}</span>
                <span className="ui-mono text-muted-fg">
                  {String(values[input.column.name] ?? "")}
                  {input.column.unit ? ` ${input.column.unit}` : ""}
                </span>
              </span>
              {input.kind === "numeric" ? (
                <input
                  type="range"
                  className="accent-[var(--primary)]"
                  min={input.min}
                  max={input.max}
                  step={input.max - input.min > 20 ? 1 : (input.max - input.min) / 100 || 0.01}
                  value={Number(values[input.column.name])}
                  onChange={(event) => setValues((current) => ({ ...current, [input.column.name]: Number(event.target.value) }))}
                  aria-label={`${input.column.label} value`}
                />
              ) : (
                <select
                  className={`${selectSmCls} h-7`}
                  value={String(values[input.column.name] ?? "")}
                  onChange={(event) => setValues((current) => ({ ...current, [input.column.name]: event.target.value }))}
                  aria-label={`${input.column.label} value`}
                >
                  {input.levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
          {inputs.length === 0 && <p className="m-0 text-body text-muted-fg">This score reads no columns.</p>}
        </div>
        <p className="m-0 mt-3 text-cap leading-relaxed text-muted-fg">Sliders span the 1st–99th percentile of the selected rows and start at the median.</p>
      </Section>
    </>
  );
}
