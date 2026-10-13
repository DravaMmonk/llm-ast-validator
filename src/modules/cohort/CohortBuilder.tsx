/**
 * Cohort Builder — eligibility criteria as puzzle pieces.
 *
 * Each criterion is a statement piece ("include rows where …" / "exclude rows
 * where …") holding a yes/no condition; the pieces stack under a start block
 * and are applied top to bottom. The CONSORT-style flow diagram on the right
 * recomputes on every snap, so the consequence of each criterion — including
 * rows lost to missing data — is visible while you build.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Crosshair, Download, LayoutTemplate, Lightbulb, Redo2, Undo2 } from "lucide-react";

import { evaluateCohort } from "../../../shared/workbench/cohort";
import { type Frame, binaryValue, frameSchema, isBinaryColumn } from "../../../shared/workbench/dataset";
import type { CohortPayload, CohortStep, WorkbenchDocument } from "../../../shared/workbench/documents";
import { E, type ExprNode } from "../../../shared/workbench/expr";
import { describeExpr } from "../../../shared/workbench/exprDescribe";
import { printExpr } from "../../../shared/workbench/exprText";
import { canonicalHash } from "../../../shared/ast/canonical";
import { AttritionFlow, ChartActions } from "../../charts";
import {
  PieceLibrary,
  CONDITION_PIECES,
  MATH_PIECES,
  STEP_PIECES,
  VALUE_PIECES,
  columnGroups,
} from "../../blocks/PieceLibrary";
import { useWbCanvas, type WbCanvasApi } from "../../blocks/useWbCanvas";
import { BLOCK, type BlockState, exprToBlock, stackToSteps, stepsToStack, type StackReadout } from "../../blocks/wbAdapter";
import { setColumnDescriber } from "../../blocks/wbBlocks";
import {
  EmptyState,
  LoadingState,
  Page,
  Pane,
  PaneBody,
  PaneHeader,
  ghostBtn,
  inputSmCls,
  pillBtn,
  primaryBtn,
  selectSmCls,
  textareaCls,
  toast,
} from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import { invalidateDocuments, provenanceOf, useActiveDataset, useDocuments, useFrame, usePinToReport } from "../../workstation/data";
import { downloadText, frameToCsv, safeFilename } from "../../workstation/exportCsv";
import { markClean, useGuard, useUnsavedChanges } from "../../workstation/guard";
import { useTheme } from "../../workstation/preferences";
import { Callout, PinButton, plural, Section, StatTile, needsDatasetHint, pct } from "../../workstation/ui";
import { QuickCriterion } from "./QuickCriterion";

const makeId = () => `s${Math.random().toString(36).slice(2, 9)}`;

interface Draft {
  title: string;
  steps: CohortStep[];
  notes: string;
}

/** Ready-made eligibility criteria for the synthetic samples — a running start. */
const EXAMPLES: Record<string, { title: string; steps: { kind: "include" | "exclude"; label: string; expr: ExprNode }[] }> = {
  cardiometabolic: {
    title: "Diabetes-free adults 30–75",
    steps: [
      { kind: "include", label: "Aged 30–75", expr: E.call("between", E.col("age"), E.num(30), E.num(75)) },
      { kind: "exclude", label: "Prevalent diabetes (FPG ≥ 7.0)", expr: E.call("ge", E.col("fpg_mmol"), E.num(7)) },
      { kind: "exclude", label: "HbA1c not measured", expr: E.call("is_missing", E.col("hba1c_pct")) },
    ],
  },
  rct_hypertension: {
    title: "Per-protocol population",
    steps: [
      { kind: "exclude", label: "Lost to follow-up", expr: E.call("is_missing", E.col("week12_sbp")) },
      { kind: "include", label: "Adherence ≥ 80%", expr: E.call("ge", E.col("adherence_pct"), E.num(80)) },
    ],
  },
  sepsis_biomarker: {
    title: "Adults with lactate measured",
    steps: [
      { kind: "include", label: "Adults", expr: E.call("ge", E.col("age"), E.num(18)) },
      { kind: "exclude", label: "No lactate", expr: E.call("is_missing", E.col("lactate_mmol")) },
    ],
  },
};

export default function CohortBuilder() {
  const { cohortId } = useParams<{ cohortId: string }>();
  const navigate = useNavigate();
  const { datasetId, summary, setDatasetId, isLoading: datasetsLoading } = useActiveDataset();
  const doc = useMemo(() => cohortId ?? null, [cohortId]);
  const opened = useDocumentById(doc);

  // Opening a cohort by link switches to its dataset — once per opened cohort,
  // so a later dataset switch from the header is not overridden.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    const doc = opened.data;
    if (!doc || synced.current === doc.id) return;
    synced.current = doc.id;
    if (doc.dataset_id && doc.dataset_id !== datasetId) setDatasetId(doc.dataset_id);
  }, [opened.data, datasetId, setDatasetId]);

  const { frame, isLoading } = useFrame(datasetId);
  const cohorts = useDocuments<CohortPayload>("cohort", datasetId, Boolean(datasetId));

  if (datasetsLoading || isLoading || (doc && opened.isLoading)) {
    return (
      <Page>
        <Pane>
          <PaneBody>
            <LoadingState label="Loading cohort builder…" />
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
              title="No dataset to build a cohort from"
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
  if (doc && opened.error) {
    return (
      <Page>
        <Pane>
          <PaneBody>
            <EmptyState
              title="Cohort not found"
              hint={errorMessage(opened.error)}
              action={
                <button type="button" className={pillBtn} onClick={() => navigate("/cohorts")}>
                  Start a new cohort
                </button>
              }
            />
          </PaneBody>
        </Pane>
      </Page>
    );
  }
  const saved = opened.data && opened.data.dataset_id === datasetId ? opened.data : null;
  return (
    <CohortWorkspace
      key={`${datasetId}:${saved?.id ?? "new"}`}
      frame={frame}
      saved={saved}
      cohorts={cohorts.data?.documents ?? []}
      sampleKey={summary?.sample_key ?? null}
    />
  );
}

function useDocumentById(id: string | null) {
  const [state, setState] = useState<{ data: WorkbenchDocument<CohortPayload> | null; error: unknown; isLoading: boolean }>({
    data: null,
    error: null,
    isLoading: Boolean(id),
  });
  useEffect(() => {
    if (!id) {
      setState({ data: null, error: null, isLoading: false });
      return;
    }
    let live = true;
    setState((current) => ({ ...current, isLoading: true }));
    wbApi
      .getDocument<CohortPayload>(id)
      .then((data) => live && setState({ data, error: null, isLoading: false }))
      .catch((error: unknown) => live && setState({ data: null, error, isLoading: false }));
    return () => {
      live = false;
    };
  }, [id]);
  return state;
}

const stepsHash = (draft: Draft) => canonicalHash({ title: draft.title, steps: draft.steps, notes: draft.notes });

function CohortWorkspace({
  frame,
  saved,
  cohorts,
  sampleKey,
}: {
  frame: Frame;
  saved: WorkbenchDocument<CohortPayload> | null;
  cohorts: WorkbenchDocument<CohortPayload>[];
  sampleKey: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [theme] = useTheme();
  const location = useLocation();
  const copied = (location.state as { copy?: Draft } | null)?.copy;
  const initial: Draft = saved
    ? { title: saved.title, steps: saved.payload.steps, notes: saved.payload.notes }
    : copied ?? { title: "Untitled cohort", steps: [], notes: "" };
  const [draft, setDraft] = useState<Draft>(initial);
  const [readout, setReadout] = useState<StackReadout>({ steps: initial.steps, problems: [], partial: [] });
  const [loose, setLoose] = useState(0);
  const [loadToken, setLoadToken] = useState(0);
  // A duplicate starts dirty: nothing is saved until the user says so.
  const [baseline, setBaseline] = useState(() => (copied && !saved ? "" : stepsHash(initial)));
  const [activeStep, setActiveStep] = useState<number | undefined>(undefined);
  const canvas = useRef<WbCanvasApi | null>(null);
  const flowRef = useRef<SVGSVGElement>(null);
  const pin = usePinToReport();

  const dirty = stepsHash(draft) !== baseline;
  useUnsavedChanges(dirty, `The cohort “${draft.title || "Untitled cohort"}”`);
  const guard = useGuard();

  const result = useMemo(() => evaluateCohort(frame, draft.steps), [frame, draft.steps]);

  const save = useMutation({
    mutationFn: async () => {
      if (readout.problems.length > 0) throw new Error(`Finish or remove ${plural(readout.problems.length, "incomplete step")} before saving.`);
      const payload: CohortPayload = { steps: draft.steps, notes: draft.notes };
      const title = draft.title.trim() || "Untitled cohort";
      return saved
        ? wbApi.patchDocument<CohortPayload>(saved.id, { title, payload })
        : wbApi.createDocument<CohortPayload>({ kind: "cohort", title, dataset_id: frame.datasetId, payload });
    },
    onSuccess: async (doc) => {
      setBaseline(stepsHash({ title: doc.title, steps: doc.payload.steps, notes: doc.payload.notes }));
      setDraft((current) => ({ ...current, title: doc.title }));
      await invalidateDocuments(queryClient, "cohort");
      toast(`Saved cohort · ${doc.title}`);
      if (!saved) {
        // The work is saved; the URL change must not trip the unsaved-changes blocker.
        markClean();
        navigate(`/cohorts/${doc.id}`, { replace: true });
      }
    },
    onError: (error) => toast(`Not saved: ${errorMessage(error)}`),
  });

  const archive = useMutation({
    mutationFn: () => wbApi.patchDocument(saved!.id, { status: "archived" }),
    onSuccess: async () => {
      await invalidateDocuments(queryClient, "cohort");
      toast("Cohort archived");
      navigate("/cohorts");
    },
  });

  const guardedNavigate = (path: string, state?: unknown) => guard(() => navigate(path, { state }));

  const loadSteps = (steps: CohortStep[], title?: string) => {
    setDraft((current) => ({ ...current, steps, ...(title ? { title } : {}) }));
    setReadout({ steps, problems: [], partial: [] });
    setLoadToken((token) => token + 1);
  };

  const example = sampleKey ? EXAMPLES[sampleKey] : undefined;

  const flowSteps = useMemo(() => {
    const byId = new Map(result.steps.map((outcome) => [outcome.id, outcome]));
    const order = readout.partial.length > 0 ? readout.partial.map((entry) => entry.stepId) : draft.steps.map((step) => step.id);
    let last = result.start;
    return order.map((id) => {
      const outcome = byId.get(id);
      const step = draft.steps.find((entry) => entry.id === id);
      if (!outcome || !step) {
        return { label: "⚠ Incomplete step — not applied", kind: "include" as const, remaining: last, excluded: 0, disabled: true };
      }
      last = outcome.remaining;
      const text = step.label || describeExpr(step.expr);
      return {
        label: outcome.error ? `⚠ ${text} — ${outcome.error}` : text,
        kind: step.kind,
        remaining: outcome.remaining,
        excluded: outcome.removedByCriterion + outcome.removedMissing,
        missing: outcome.removedMissing,
        disabled: !step.enabled || outcome.error !== null,
      };
    });
  }, [result, readout.partial, draft.steps]);

  const outcomeColumn = frame.columns.find((column) => column.role === "outcome" && isBinaryColumn(column)) ?? null;
  const outcomeEvents = useMemo(() => {
    if (!outcomeColumn) return null;
    let events = 0;
    let known = 0;
    for (let row = 0; row < frame.rowCount; row += 1) {
      if (result.mask[row] !== 1) continue;
      const value = binaryValue(outcomeColumn.values[row]);
      if (value === null) continue;
      known += 1;
      events += value;
    }
    return { events, known };
  }, [outcomeColumn, result.mask, frame.rowCount]);

  const groups = useMemo(
    () => [
      { key: "steps", label: "Steps", entries: STEP_PIECES },
      ...columnGroups(frame),
      { key: "conditions", label: "Conditions", entries: CONDITION_PIECES },
      { key: "math", label: "Math", entries: MATH_PIECES },
      { key: "values", label: "Values", entries: VALUE_PIECES },
    ],
    [frame],
  );

  return (
    <Page>
      <PieceLibrary
        groups={groups}
        onInsert={(entry) => {
          if (entry.state.type === BLOCK.step) canvas.current?.appendStatement({ ...entry.state, extraState: { stepId: makeId() } });
          else canvas.current?.insert(entry.state);
        }}
        footer="Steps stack under ▶ start · conditions snap into a step"
      />

      <Pane>
        <PaneHeader label="Cohort">
          <select
            aria-label="Open a saved cohort"
            className={`${selectSmCls} max-w-[200px]`}
            value={saved?.id ?? ""}
            onChange={(event) => guardedNavigate(event.target.value ? `/cohorts/${event.target.value}` : "/cohorts")}
          >
            <option value="">{saved ? "＋ New cohort" : "New (unsaved)"}</option>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.title}
              </option>
            ))}
          </select>
          {dirty && <span className="ui-mono text-fine" style={{ color: "var(--warn)" }}>unsaved</span>}
          {saved && (
            <button type="button" className={ghostBtn} onClick={() => archive.mutate()} disabled={archive.isPending} title="Archive this cohort">
              Archive
            </button>
          )}
          <button type="button" className={primaryBtn} onClick={() => save.mutate()} disabled={save.isPending || (!dirty && Boolean(saved))}>
            {save.isPending ? "Saving…" : saved ? "Save" : "Save cohort"}
          </button>
        </PaneHeader>
        <div className="flex flex-none items-center gap-2 border-b border-border-2 px-[11px] py-1.5">
          <input
            aria-label="Cohort title"
            className={`${inputSmCls} h-7 w-full max-w-[380px] font-sans text-ui`}
            value={draft.title}
            maxLength={160}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
          {example && draft.steps.length === 0 && readout.partial.length === 0 && (
            <button type="button" className={`${pillBtn} flex items-center gap-1`} onClick={() => loadSteps(example.steps.map((step) => ({ ...step, id: makeId(), on_missing: "drop", enabled: true })), example.title)}>
              <Lightbulb size={13} aria-hidden /> Load example criteria
            </button>
          )}
          {saved && (
            <button
              type="button"
              className={`${ghostBtn} ml-auto gap-1`}
              title="Start a new unsaved cohort with these steps"
              onClick={() => {
                const copy: Draft = { title: `${draft.title} (copy)`, steps: draft.steps.map((step) => ({ ...step, id: makeId() })), notes: draft.notes };
                guardedNavigate("/cohorts", { copy });
              }}
            >
              <Copy size={12} aria-hidden /> <span className="text-label">Duplicate</span>
            </button>
          )}
        </div>
        <QuickCriterion
          frame={frame}
          onAdd={(step) =>
            canvas.current?.appendStatement({
              type: BLOCK.step,
              extraState: { stepId: makeId() },
              fields: { KIND: step.kind, LABEL: step.label, MISSING: "drop" },
              inputs: { COND: { block: exprToBlock(step.expr, frameSchema(frame)) } },
            })
          }
        />
        <CohortCanvas
          key={loadToken}
          frame={frame}
          steps={draft.steps}
          dark={theme === "dark"}
          onCanvasApi={(api) => {
            canvas.current = api;
          }}
          onRead={(next, looseCount) => {
            setReadout(next);
            setLoose(looseCount);
            // Keep the same array when nothing changed (e.g. a piece was only moved),
            // so the cohort is not re-evaluated over every row for a cosmetic event.
            setDraft((current) =>
              canonicalHash(current.steps) === canonicalHash(next.steps) ? current : { ...current, steps: next.steps },
            );
          }}
        />
        {(readout.problems.length > 0 || loose > 0) && (
          <div className="flex-none border-t border-border-2 bg-card-2 px-[11px] py-1.5 text-dense" style={{ color: "var(--warn)" }}>
            {readout.problems.length > 0 && <span>⚠ {plural(readout.problems.length, "incomplete step")}: {readout.problems[0].message} </span>}
            {loose > 0 && <span>⚠ {plural(loose, "loose piece")} {loose === 1 ? "is" : "are"} not attached under ▶ start and {loose === 1 ? "is" : "are"} ignored.</span>}
          </div>
        )}
      </Pane>

      <Pane w={400} side="l">
        <PaneHeader label="Participant flow">
          <ChartActions svgRef={flowRef} filename={`${draft.title || "cohort"}-flow`} />
        </PaneHeader>
        <PaneBody>
          <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
            <StatTile label="Start" value={result.start.toLocaleString("en-US")} />
            <StatTile label="Final" value={result.final.toLocaleString("en-US")} tone="var(--primary)" />
            <StatTile label="Retained" value={pct(result.start ? result.final / result.start : 0)} />
          </div>
          {!result.valid && (
            <div className="px-[11px] pt-2">
              <Callout tone="bad">A step cannot be evaluated; it is passed through and marked ⚠ until fixed.</Callout>
            </div>
          )}
          <div className="px-[11px] py-2">
            <AttritionFlow
              ref={flowRef}
              title={`Participant flow for ${draft.title}`}
              start={{ label: `${frame.name}`, n: result.start }}
              steps={flowSteps}
              final={{ label: draft.title || "Final cohort" }}
              activeStep={activeStep}
              onStepClick={(index) => {
                setActiveStep(index);
                const stepId = readout.partial[index]?.stepId ?? draft.steps[index]?.id;
                const ws = canvas.current?.ws();
                const block = ws?.getAllBlocks(false).find((candidate) => (candidate as unknown as { stepId?: string }).stepId === stepId);
                if (ws && block) {
                  ws.centerOnBlock(block.id);
                  (block as unknown as { select: () => void }).select();
                }
              }}
            />
          </div>
          {outcomeColumn && outcomeEvents && (
            <Section title="Outcome in final cohort">
              <div className="text-body text-fg">
                <span className="ui-mono">{outcomeEvents.events.toLocaleString("en-US")}</span> events in{" "}
                <span className="ui-mono">{outcomeEvents.known.toLocaleString("en-US")}</span> with a known{" "}
                <span className="ui-mono">{outcomeColumn.name}</span> ({pct(outcomeEvents.known ? outcomeEvents.events / outcomeEvents.known : null)})
              </div>
            </Section>
          )}
          <Section title="Notes">
            <textarea
              aria-label="Cohort notes"
              className={`${textareaCls} h-[70px]`}
              value={draft.notes}
              placeholder="Rationale for the criteria, protocol references…"
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </Section>
          <div className="flex flex-wrap gap-2 px-[11px] py-2.5">
            <button
              type="button"
              className={pillBtn}
              disabled={!saved || dirty}
              title={!saved || dirty ? "Save the cohort first" : undefined}
              onClick={() => navigate(`/stats?cohort=${saved!.id}`)}
            >
              Analyse this cohort →
            </button>
            <button
              type="button"
              className={`${pillBtn} flex items-center gap-1`}
              disabled={!result.valid || result.final === 0}
              title="Download the rows that remain in this cohort"
              onClick={() => {
                const rows: number[] = [];
                for (let row = 0; row < frame.rowCount; row += 1) if (result.mask[row] === 1) rows.push(row);
                downloadText(`${safeFilename(draft.title)}.csv`, frameToCsv(frame, rows));
              }}
            >
              <Download size={13} aria-hidden /> Cohort CSV
            </button>
            <PinButton
              busy={pin.isPending}
              onClick={() =>
                pin.mutate({
                  title: `Participant flow · ${draft.title}`,
                  datasetId: frame.datasetId,
                  payload: {
                    module: "cohort",
                    summary: `Starting from ${result.start.toLocaleString("en-US")} rows of ${frame.name}, ${draft.steps.filter((s) => s.enabled).length} criteria left ${result.final.toLocaleString("en-US")} (${pct(result.start ? result.final / result.start : 0)}).`,
                    table: {
                      columns: ["Step", "Criterion", "Before", "Removed", "of which missing", "Remaining"],
                      rows: result.steps.map((outcome, index) => {
                        const step = draft.steps.find((entry) => entry.id === outcome.id)!;
                        return [
                          `${index + 1}. ${step.kind}${step.enabled ? "" : " (off)"}`,
                          step.label || describeExpr(step.expr),
                          outcome.before,
                          outcome.removedByCriterion + outcome.removedMissing,
                          outcome.removedMissing,
                          outcome.remaining,
                        ];
                      }),
                    },
                    chart: { type: "attrition", data: { start: result.start, steps: flowSteps, startLabel: frame.name, finalLabel: draft.title } },
                    provenance: {
                      ...provenanceOf(frame, { rows: [], cohort: null, result: null, label: draft.title }),
                      rows: result.final,
                      cohort: draft.title,
                      criteria: draft.steps.map((step) => `${step.kind} ${printExpr(step.expr)}`).join(" | ").slice(0, 480),
                    },
                    notes: draft.notes,
                  },
                })
              }
            />
          </div>
        </PaneBody>
      </Pane>

    </Page>
  );
}

/** The Blockly canvas holding the step stack. */
function CohortCanvas({
  frame,
  steps,
  dark,
  onCanvasApi,
  onRead,
}: {
  frame: Frame;
  steps: CohortStep[];
  dark: boolean;
  onCanvasApi: (api: WbCanvasApi | null) => void;
  onRead: (readout: StackReadout, loose: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const schema = useMemo(() => frameSchema(frame), [frame]);
  const startLabel = `all ${frame.rowCount.toLocaleString("en-US")} rows`;

  setColumnDescriber((name) => {
    const column = frame.columns.find((entry) => entry.name === name);
    return column ? `${column.label}${column.unit ? ` (${column.unit})` : ""}` : name;
  });

  const canvas = useWbCanvas(
    host,
    () => {
      const tops = canvas.tops();
      const start = tops.find((top) => top.type === BLOCK.cohortStart);
      const loose = tops.filter((top) => top.type !== BLOCK.cohortStart).length;
      onReadRef.current(stackToSteps(start, makeId), loose);
    },
    { dark, startScale: 0.85, anchor: "top-left" },
  );

  useEffect(() => {
    onCanvasApi(canvas);
    // Untyped pieces are the fallback when a column changed type since saving.
    let primary: BlockState[] = [];
    try {
      primary = [stepsToStack(steps, schema, startLabel)];
    } catch {
      primary = [];
    }
    canvas.load(primary, [stepsToStack(steps, () => undefined, startLabel)]);
    return () => onCanvasApi(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once per mount; reloads remount via key
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={host} className="absolute inset-0" data-testid="cohort-canvas" />
      <div className="absolute right-2.5 top-2.5 z-[5] flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm">
        {(
          [
            { title: "Undo (⌘Z)", Icon: Undo2, run: canvas.undo },
            { title: "Redo (⇧⌘Z)", Icon: Redo2, run: canvas.redo },
            { title: "Tidy layout", Icon: LayoutTemplate, run: canvas.tidy },
            { title: "Centre", Icon: Crosshair, run: canvas.center },
          ] as const
        ).map(({ title, Icon, run }) => (
          <button
            key={title}
            type="button"
            onClick={run}
            title={title}
            aria-label={title}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg hover:bg-muted"
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
      {steps.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[4] mx-auto max-w-[420px] px-4 text-center text-body leading-relaxed text-muted-fg">
          Add a criterion with the quick bar above, or drag an “Include rows where…” piece under ▶ start and snap a condition into it.
        </div>
      )}
    </div>
  );
}
