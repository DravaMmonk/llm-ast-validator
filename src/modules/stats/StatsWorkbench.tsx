/**
 * Statistics — a rail of analyses over a shared data source (the active
 * dataset, optionally restricted to a saved cohort). Every analysis reports
 * its numbers, a chart, and a results paragraph you can copy or pin.
 */

import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Compass, GitCompareArrows, Grid3x3, LineChart as LineIcon, Repeat, Table2, TrendingUp } from "lucide-react";

import { EmptyState, LoadingState, Page, Pane, PaneBody, PaneHeader, capSm, primaryBtn, selectSmCls, toast, useMobile } from "../../shared-console/src";
import type { CohortPayload } from "../../../shared/workbench/documents";
import { wbApi } from "../../workstation/api";
import { useActiveDataset, useFrame, useRowSelection } from "../../workstation/data";
import { needsDatasetHint } from "../../workstation/ui";
import { CompareGroups } from "./analyses/CompareGroups";
import { CorrelationView } from "./analyses/CorrelationView";
import { PairedView } from "./analyses/PairedView";
import { type ModelKind, RegressionView } from "./analyses/RegressionView";
import { SurvivalView } from "./analyses/SurvivalView";
import { Table1View } from "./analyses/Table1View";
import { TestFinder } from "./analyses/TestFinder";
import type { AnalysisContext } from "./common";

interface AnalysisEntry {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  group: string;
}

const ANALYSES: AnalysisEntry[] = [
  { id: "finder", label: "Test finder", hint: "Answer a few questions, get the method", icon: Compass, group: "Guide" },
  { id: "table1", label: "Table 1", hint: "Baseline characteristics by group", icon: Table2, group: "Describe" },
  { id: "compare", label: "Compare groups", hint: "t, Mann–Whitney, ANOVA, χ², Fisher", icon: GitCompareArrows, group: "Compare" },
  { id: "paired", label: "Paired change", hint: "Before vs after on the same rows", icon: Repeat, group: "Compare" },
  { id: "correlation", label: "Correlation", hint: "Matrix and scatter drill-down", icon: Grid3x3, group: "Relate" },
  { id: "regression", label: "Regression", hint: "Linear, logistic, Cox", icon: TrendingUp, group: "Model" },
  { id: "survival", label: "Kaplan–Meier", hint: "Survival curves and log-rank", icon: LineIcon, group: "Model" },
];

export default function StatsWorkbench() {
  const { analysis = "finder" } = useParams<{ analysis: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cohortId = params.get("cohort");
  const model = params.get("model") as ModelKind | null;
  const { datasetId, setDatasetId, isLoading: listLoading } = useActiveDataset();
  const { frame, isLoading } = useFrame(datasetId);
  const selection = useRowSelection(frame, cohortId);
  const current = ANALYSES.find((entry) => entry.id === analysis) ?? ANALYSES[0];
  const mobile = useMobile();

  // A cohort link from another dataset switches to that dataset (once); a link to
  // a cohort that no longer exists is dropped from the URL.
  const resolved = useRef<string | null>(null);
  useEffect(() => {
    if (!cohortId || !frame || !selection.cohortsLoaded || selection.cohort || resolved.current === cohortId) return;
    resolved.current = cohortId;
    const drop = () => {
      const next = new URLSearchParams(params);
      next.delete("cohort");
      setParams(next, { replace: true });
    };
    wbApi
      .getDocument<CohortPayload>(cohortId)
      .then((doc) => {
        if (doc.kind === "cohort" && doc.status === "active" && doc.dataset_id && doc.dataset_id !== frame.datasetId) {
          setDatasetId(doc.dataset_id);
          toast(`Switched to the dataset of cohort “${doc.title}”`);
        } else drop();
      })
      .catch(drop);
  }, [cohortId, frame, selection.cohort, selection.cohortsLoaded, params, setParams, setDatasetId]);

  const ctx = useMemo<AnalysisContext | null>(() => (frame ? { frame, selection } : null), [frame, selection]);
  const groups = [...new Set(ANALYSES.map((entry) => entry.group))];

  return (
    <Page>
      {mobile ? (
        <div className="flex flex-none items-center gap-2 border-b border-border bg-card px-3 py-2">
          <span className="text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Analysis</span>
          <select
            aria-label="Analysis"
            className={`${selectSmCls} h-8 min-w-0 flex-1`}
            value={current.id}
            onChange={(event) => navigate(`/stats/${event.target.value}${cohortId ? `?cohort=${cohortId}` : ""}`)}
          >
            {ANALYSES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.group} · {entry.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
      <Pane w={232} side="r">
        <PaneHeader label="Analyses" />
        <PaneBody>
          {groups.map((group) => (
            <div key={group} className="pb-1">
              <div className={`${capSm} px-[11px] pb-1 pt-2.5`}>{group}</div>
              {ANALYSES.filter((entry) => entry.group === group).map((entry) => {
                const Icon = entry.icon;
                const active = entry.id === current.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate(`/stats/${entry.id}${cohortId ? `?cohort=${cohortId}` : ""}`)}
                    className="flex w-full cursor-pointer items-start gap-2 border-0 border-b border-border-2 bg-transparent px-[11px] py-2 text-left hover:bg-muted"
                    style={active ? { background: "var(--muted)", boxShadow: "inset 3px 0 0 var(--primary)" } : undefined}
                  >
                    <Icon size={15} className="mt-px flex-none" style={{ color: active ? "var(--primary)" : "var(--muted-fg)" }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-fg">{entry.label}</span>
                      <span className="block truncate text-cap text-muted-fg">{entry.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </PaneBody>
      </Pane>
      )}
      <Pane>
        <PaneHeader label={current.label}>
          {frame && current.id !== "finder" && (
            <>
              <span className="text-cap text-muted-fg">Rows</span>
              <select
                aria-label="Rows to analyse"
                className={`${selectSmCls} max-w-[260px] mobile:max-w-[140px]`}
                value={selection.cohort?.id ?? ""}
                onChange={(event) => {
                  const next = new URLSearchParams(params);
                  if (event.target.value) next.set("cohort", event.target.value);
                  else next.delete("cohort");
                  setParams(next);
                }}
              >
                <option value="">All rows ({frame.rowCount.toLocaleString("en-US")})</option>
                {selection.cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    Cohort: {cohort.title}
                  </option>
                ))}
              </select>
              <span className="ui-mono rounded-[9px] bg-muted px-[7px] py-px text-cap font-semibold text-fg">n = {selection.rows.length.toLocaleString("en-US")}</span>
              {selection.result && !selection.result.valid && <span className="text-cap" style={{ color: "var(--bad)" }}>cohort has invalid steps</span>}
            </>
          )}
        </PaneHeader>
        {current.id === "finder" ? (
          <TestFinder />
        ) : listLoading || isLoading ? (
          <PaneBody>
            <LoadingState label="Loading dataset…" />
          </PaneBody>
        ) : !ctx ? (
          <PaneBody>
            <EmptyState
              title="No dataset to analyse"
              hint={needsDatasetHint()}
              action={
                <button type="button" className={primaryBtn} onClick={() => navigate("/")}>
                  Go to Overview
                </button>
              }
            />
          </PaneBody>
        ) : ctx.selection.rows.length === 0 ? (
          <PaneBody>
            <EmptyState title="No rows selected" hint="The chosen cohort excludes every row. Pick another cohort or loosen its criteria." />
          </PaneBody>
        ) : (
          <AnalysisBody key={`${current.id}:${ctx.frame.datasetId}`} id={current.id} ctx={ctx} model={model} />
        )}
      </Pane>
    </Page>
  );
}

function AnalysisBody({ id, ctx, model }: { id: string; ctx: AnalysisContext; model: ModelKind | null }) {
  switch (id) {
    case "table1":
      return <Table1View ctx={ctx} />;
    case "compare":
      return <CompareGroups ctx={ctx} />;
    case "paired":
      return <PairedView ctx={ctx} />;
    case "correlation":
      return <CorrelationView ctx={ctx} />;
    case "regression":
      return <RegressionView ctx={ctx} initialKind={model ?? undefined} />;
    case "survival":
      return <SurvivalView ctx={ctx} />;
    default:
      return (
        <PaneBody>
          <EmptyState title="Unknown analysis" />
        </PaneBody>
      );
  }
}

