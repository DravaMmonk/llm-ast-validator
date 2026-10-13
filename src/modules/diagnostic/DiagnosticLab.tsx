/**
 * Diagnostic Lab — accuracy of a test, from four angles that share one state:
 * the 2×2 table (with Wilson and log-method intervals), a ROC explorer on the
 * active dataset with a live threshold, Fagan's nomogram for Bayesian updating,
 * and a natural-frequency pictograph for explaining the result to anyone.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { columnByName } from "../../../shared/workbench/analysis";
import { binaryValue, isBinaryColumn } from "../../../shared/workbench/dataset";
import {
  aucDeLong,
  confusionAt,
  diagnostic2x2,
  postTestProbability,
  rocCurve,
  youdenOptimal,
} from "../../../shared/stats";
import { ChartActions, FaganNomogram, IconArray, LineChart, chartColor } from "../../charts";
import { EmptyState, Page, Pane, PaneBody, PaneHeader, TabBar, ghostBtn, inputSmCls, pillBtn, primaryBtn } from "../../shared-console/src";
import { provenanceOf, useActiveDataset, useFrame, usePinToReport, useRowSelection } from "../../workstation/data";
import { Callout, ColumnSelect, Field, PinButton, ResultTable, Section, StatTile, fixed, fmt, pct } from "../../workstation/ui";

type Tool = "two-by-two" | "roc" | "fagan" | "frequencies";

interface Shared {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  preTest: number;
}

export default function DiagnosticLab() {
  const { tool = "two-by-two" } = useParams<{ tool: Tool }>();
  const navigate = useNavigate();
  // A worked example: a test with ~90% sensitivity and ~80% specificity at 10% prevalence.
  const [shared, setShared] = useState<Shared>({ tp: 90, fp: 180, fn: 10, tn: 720, preTest: 0.1 });
  const metrics = useMemo(() => diagnostic2x2(shared.tp, shared.fp, shared.fn, shared.tn), [shared]);
  const go = (next: Tool) => navigate(`/diagnostic/${next}`);
  return (
    <Page>
      <Pane>
        <TabBar
          value={tool as Tool}
          onChange={go}
          grow={false}
          options={[
            { v: "two-by-two", label: "2×2 accuracy" },
            { v: "roc", label: "ROC explorer" },
            { v: "fagan", label: "Fagan nomogram" },
            { v: "frequencies", label: "Natural frequencies" },
          ]}
        />
        {tool === "roc" ? (
          <RocExplorerForDataset onUseCounts={(counts) => { setShared((current) => ({ ...current, ...counts, preTest: (counts.tp + counts.fn) / Math.max(1, counts.tp + counts.fn + counts.fp + counts.tn) })); go("two-by-two"); }} />
        ) : tool === "fagan" ? (
          <FaganTool shared={shared} setShared={setShared} metrics={metrics} />
        ) : tool === "frequencies" ? (
          <FrequencyTool shared={shared} metrics={metrics} setShared={setShared} />
        ) : (
          <TwoByTwo shared={shared} setShared={setShared} metrics={metrics} onNext={go} />
        )}
      </Pane>
    </Page>
  );
}

function CountInput({ label, value, onChange, tone }: { label: string; value: number; onChange: (v: number) => void; tone: string }) {
  return (
    <label className="flex flex-col gap-1 rounded-md border p-2.5" style={{ borderColor: `color-mix(in srgb, ${tone} 40%, var(--border))`, background: `color-mix(in srgb, ${tone} 7%, transparent)` }}>
      <span className="text-cap font-semibold uppercase tracking-[0.06em]" style={{ color: tone }}>
        {label}
      </span>
      <input
        inputMode="numeric"
        className={`${inputSmCls} ui-num h-8 text-md`}
        value={String(value)}
        onChange={(event) => {
          const parsed = Number(event.target.value.replace(/[^0-9]/g, ""));
          onChange(Number.isFinite(parsed) ? Math.min(parsed, 10_000_000) : 0);
        }}
        aria-label={label}
      />
    </label>
  );
}

function ci(estimate: { estimate: number | null; lower: number | null; upper: number | null }, asPct = true, digits = 1): string {
  if (estimate.estimate === null) return "—";
  const f = (v: number | null) => (v === null ? "—" : asPct ? `${(v * 100).toFixed(digits)}%` : v.toFixed(2));
  return `${f(estimate.estimate)} (${f(estimate.lower)} – ${f(estimate.upper)})`;
}

function TwoByTwo({
  shared,
  setShared,
  metrics,
  onNext,
}: {
  shared: Shared;
  setShared: (updater: (s: Shared) => Shared) => void;
  metrics: ReturnType<typeof diagnostic2x2>;
  onNext: (tool: Tool) => void;
}) {
  const pin = usePinToReport();
  const set = (key: keyof Shared) => (value: number) => setShared((current) => ({ ...current, [key]: value }));
  const total = shared.tp + shared.fp + shared.fn + shared.tn;
  const rows: [string, string][] = [
    ["Sensitivity", ci(metrics.sensitivity)],
    ["Specificity", ci(metrics.specificity)],
    ["Positive predictive value", ci(metrics.ppv)],
    ["Negative predictive value", ci(metrics.npv)],
    ["Accuracy", ci(metrics.accuracy)],
    ["Prevalence (in this table)", ci(metrics.prevalence)],
    ["Positive likelihood ratio", ci(metrics.lrPositive, false)],
    ["Negative likelihood ratio", ci(metrics.lrNegative, false)],
    ["Diagnostic odds ratio", ci(metrics.diagnosticOddsRatio, false)],
  ];
  const summary = `Of ${total.toLocaleString("en-US")} people, the test had sensitivity ${ci(metrics.sensitivity)} and specificity ${ci(metrics.specificity)} (95% Wilson CIs); LR+ ${ci(metrics.lrPositive, false)} and LR− ${ci(metrics.lrNegative, false)}. At the table's prevalence of ${pct(metrics.prevalence.estimate)}, PPV was ${pct(metrics.ppv.estimate)} and NPV ${pct(metrics.npv.estimate)}.`;
  return (
    <PaneBody>
      <div className="mx-auto w-full max-w-[920px] px-4 py-4">
        <h2 className="m-0 text-[17px] font-semibold text-fg-strong">Accuracy from a 2×2 table</h2>
        <p className="m-0 mt-1 text-ui text-muted-fg">Enter the counts of index-test results against the reference standard.</p>
        <div className="mt-4 grid grid-cols-[110px_1fr_1fr] items-stretch gap-2 mobile:grid-cols-[80px_1fr_1fr]">
          <div />
          <div className="text-center text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Condition present</div>
          <div className="text-center text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Condition absent</div>
          <div className="flex items-center text-label font-semibold text-fg">Test positive</div>
          <CountInput label="True positive" value={shared.tp} onChange={set("tp")} tone="var(--risk-low)" />
          <CountInput label="False positive" value={shared.fp} onChange={set("fp")} tone="var(--warn)" />
          <div className="flex items-center text-label font-semibold text-fg">Test negative</div>
          <CountInput label="False negative" value={shared.fn} onChange={set("fn")} tone="var(--bad)" />
          <CountInput label="True negative" value={shared.tn} onChange={set("tn")} tone="var(--info)" />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 mobile:grid-cols-2">
          <StatTile label="Sensitivity" value={pct(metrics.sensitivity.estimate)} sub={`${pct(metrics.sensitivity.lower)} – ${pct(metrics.sensitivity.upper)}`} />
          <StatTile label="Specificity" value={pct(metrics.specificity.estimate)} sub={`${pct(metrics.specificity.lower)} – ${pct(metrics.specificity.upper)}`} />
          <StatTile label="LR+" value={fixed(metrics.lrPositive.estimate, 2)} sub={`${fixed(metrics.lrPositive.lower, 2)} – ${fixed(metrics.lrPositive.upper, 2)}`} />
          <StatTile label="LR−" value={fixed(metrics.lrNegative.estimate, 2)} sub={`${fixed(metrics.lrNegative.lower, 2)} – ${fixed(metrics.lrNegative.upper, 2)}`} />
        </div>
        <div className="mt-3">
          <ResultTable columns={["Measure", "Estimate (95% CI)"]} rows={rows} />
        </div>
        {total === 0 && <Callout tone="info" className="mt-2">Enter counts to compute accuracy.</Callout>}
        <p className="m-0 mt-2 text-cap leading-relaxed text-muted-fg">
          Proportions use Wilson score intervals; likelihood ratios use the log method (Simel 1991). PPV and NPV depend on prevalence — use the Fagan nomogram to apply another pre-test probability.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={`${pillBtn} flex items-center gap-1`} onClick={() => onNext("fagan")}>
            Apply to a patient (Fagan) <ArrowRight size={13} aria-hidden />
          </button>
          <button type="button" className={`${pillBtn} flex items-center gap-1`} onClick={() => onNext("frequencies")}>
            Explain with natural frequencies <ArrowRight size={13} aria-hidden />
          </button>
          <PinButton
            busy={pin.isPending}
            disabled={total === 0}
            onClick={() =>
              pin.mutate({
                title: "Diagnostic accuracy (2×2)",
                datasetId: null,
                payload: {
                  module: "diagnostic",
                  summary,
                  table: { columns: ["Measure", "Estimate (95% CI)"], rows: [["TP / FP / FN / TN", `${shared.tp} / ${shared.fp} / ${shared.fn} / ${shared.tn}`], ...rows] },
                  chart: null,
                  provenance: { source: "manual 2×2 entry", generated_at: new Date().toISOString() },
                  notes: "",
                },
              })
            }
          />
        </div>
      </div>
    </PaneBody>
  );
}

function FaganTool({
  shared,
  setShared,
  metrics,
}: {
  shared: Shared;
  setShared: (updater: (s: Shared) => Shared) => void;
  metrics: ReturnType<typeof diagnostic2x2>;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [lrPos, setLrPos] = useState<string>(() => (metrics.lrPositive.estimate !== null ? metrics.lrPositive.estimate.toFixed(2) : "4"));
  const [lrNeg, setLrNeg] = useState<string>(() => (metrics.lrNegative.estimate !== null ? metrics.lrNegative.estimate.toFixed(2) : "0.2"));
  const lrP = Number(lrPos);
  const lrN = Number(lrNeg);
  const validP = Number.isFinite(lrP) && lrP > 0;
  const validN = Number.isFinite(lrN) && lrN > 0;
  const postPos = validP ? postTestProbability(shared.preTest, lrP) : null;
  const postNeg = validN ? postTestProbability(shared.preTest, lrN) : null;
  return (
    <PaneBody>
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[1fr_300px] gap-4 px-4 py-4 mobile:grid-cols-1">
        <div>
          <h2 className="m-0 text-[17px] font-semibold text-fg-strong">Fagan nomogram</h2>
          <p className="m-0 mt-1 text-ui text-muted-fg">Drag the pre-test marker (or use the arrow keys) to see how a test result updates the probability of disease.</p>
          <div className="mt-3">
            <FaganNomogram
              ref={ref}
              title="Fagan nomogram"
              height={520}
              preTest={shared.preTest}
              lrPositive={validP ? lrP : null}
              lrNegative={validN ? lrN : null}
              onPreTestChange={(p) => setShared((current) => ({ ...current, preTest: p }))}
              actions={<ChartActions svgRef={ref} filename="fagan-nomogram" />}
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-10">
          <Field label="Pre-test probability" htmlFor="fagan-pre">
            <div className="flex items-center gap-2">
              <input
                id="fagan-pre"
                type="range"
                min={0.001}
                max={0.999}
                step={0.001}
                value={shared.preTest}
                onChange={(event) => setShared((current) => ({ ...current, preTest: Number(event.target.value) }))}
                className="min-w-0 flex-1 accent-[var(--primary)]"
              />
              <span className="ui-mono w-[52px] text-right text-ui text-fg">{pct(shared.preTest)}</span>
            </div>
          </Field>
          <Field label="Positive likelihood ratio (LR+)" htmlFor="fagan-lrp">
            <input id="fagan-lrp" className={`${inputSmCls} ui-num h-8`} inputMode="decimal" value={lrPos} onChange={(event) => setLrPos(event.target.value)} style={!validP ? { borderColor: "var(--bad)" } : undefined} />
          </Field>
          <Field label="Negative likelihood ratio (LR−)" htmlFor="fagan-lrn">
            <input id="fagan-lrn" className={`${inputSmCls} ui-num h-8`} inputMode="decimal" value={lrNeg} onChange={(event) => setLrNeg(event.target.value)} style={!validN ? { borderColor: "var(--bad)" } : undefined} />
          </Field>
          <button
            type="button"
            className={ghostBtn}
            onClick={() => {
              if (metrics.lrPositive.estimate !== null) setLrPos(metrics.lrPositive.estimate.toFixed(2));
              if (metrics.lrNegative.estimate !== null) setLrNeg(metrics.lrNegative.estimate.toFixed(2));
            }}
          >
            Use LRs from the 2×2 table
          </button>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="If positive" value={pct(postPos)} tone="var(--bad)" />
            <StatTile label="If negative" value={pct(postNeg)} tone="var(--info)" />
          </div>
          <p className="m-0 text-cap leading-relaxed text-muted-fg">Post-test odds = pre-test odds × LR. LR+ above 10 or LR− below 0.1 usually shifts decisions; values near 1 barely change anything.</p>
        </div>
      </div>
    </PaneBody>
  );
}

function FrequencyTool({
  shared,
  setShared,
  metrics,
}: {
  shared: Shared;
  setShared: (updater: (s: Shared) => Shared) => void;
  metrics: ReturnType<typeof diagnostic2x2>;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [population, setPopulation] = useState<100 | 1000>(100);
  const sens = metrics.sensitivity.estimate ?? 0;
  const spec = metrics.specificity.estimate ?? 0;
  const prev = shared.preTest;
  // Largest-remainder rounding so the four groups always sum to the population.
  const raw = [prev * sens, prev * (1 - sens), (1 - prev) * (1 - spec), (1 - prev) * spec].map((share) => share * population);
  const counts = raw.map(Math.floor);
  let remainder = population - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac);
  for (const { index } of order) {
    if (remainder <= 0) break;
    counts[index] += 1;
    remainder -= 1;
  }
  const [tp, fn, fp, tn] = counts;
  const ppv = tp + fp ? tp / (tp + fp) : null;
  return (
    <PaneBody>
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[1fr_320px] gap-5 px-4 py-4 mobile:grid-cols-1">
        <div>
          <h2 className="m-0 text-[17px] font-semibold text-fg-strong">What a positive result really means</h2>
          <p className="m-0 mt-1 text-ui text-muted-fg">
            Natural frequencies make Bayes' theorem intuitive: imagine {population.toLocaleString("en-US")} people like your patient being tested.
          </p>
          <div className="mt-3">
            <IconArray
              ref={ref}
              title="Natural frequency pictograph"
              total={population}
              columns={population === 100 ? 10 : 40}
              groups={[
                { count: tp, label: "Ill, test positive (true positive)", color: "var(--bad)" },
                { count: fn, label: "Ill, test negative (missed)", color: chartColor(3) },
                { count: fp, label: "Healthy, test positive (false alarm)", color: "var(--warn)" },
                { count: tn, label: "Healthy, test negative", color: "color-mix(in srgb, var(--muted-fg) 45%, transparent)" },
              ]}
              actions={<ChartActions svgRef={ref} filename="natural-frequencies" />}
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-10">
          <Field label="Prevalence / pre-test probability" htmlFor="freq-prev">
            <div className="flex items-center gap-2">
              <input
                id="freq-prev"
                type="range"
                min={0.001}
                max={0.999}
                step={0.001}
                value={prev}
                onChange={(event) => setShared((current) => ({ ...current, preTest: Number(event.target.value) }))}
                className="min-w-0 flex-1 accent-[var(--primary)]"
              />
              <span className="ui-mono w-[52px] text-right text-ui text-fg">{pct(prev)}</span>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Sensitivity" value={pct(sens)} />
            <StatTile label="Specificity" value={pct(spec)} />
          </div>
          <div className="flex gap-1.5">
            {([100, 1000] as const).map((size) => (
              <button key={size} type="button" className={size === population ? primaryBtn : pillBtn} onClick={() => setPopulation(size)}>
                {size.toLocaleString("en-US")} people
              </button>
            ))}
          </div>
          <div className="rounded-[10px] border border-border bg-card-2 p-3 text-ui leading-relaxed text-fg">
            Of {population.toLocaleString("en-US")} people, <b>{tp + fn}</b> have the condition; the test finds <b>{tp}</b> of them and misses <b>{fn}</b>. Of the{" "}
            <b>{fp + tn}</b> without it, <b>{fp}</b> still test positive. So of <b>{tp + fp}</b> positive results, only <b>{tp}</b> are real —{" "}
            <b style={{ color: "var(--bad)" }}>{pct(ppv, 0)}</b>.
          </div>
          <p className="m-0 text-cap leading-relaxed text-muted-fg">Sensitivity and specificity come from the 2×2 tab; counts are rounded so the groups add up.</p>
        </div>
      </div>
    </PaneBody>
  );
}

/** Remounts the explorer per dataset so marker choices never outlive their columns. */
function RocExplorerForDataset(props: { onUseCounts: (counts: { tp: number; fp: number; fn: number; tn: number }) => void }) {
  const { datasetId } = useActiveDataset();
  return <RocExplorer key={datasetId ?? "none"} {...props} />;
}

function RocExplorer({ onUseCounts }: { onUseCounts: (counts: { tp: number; fp: number; fn: number; tn: number }) => void }) {
  const { datasetId } = useActiveDataset();
  const { frame } = useFrame(datasetId);
  const navigate = useNavigate();
  const pin = usePinToReport();
  const selection = useRowSelection(frame, null);
  const [reference, setReference] = useState<string | null>(() => null);
  const [markers, setMarkers] = useState<(string | null)[]>([null, null]);
  const [cut, setCut] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const referenceName = reference ?? frame?.columns.find((column) => column.role === "outcome" && isBinaryColumn(column))?.name ?? null;
  const primaryName = markers[0] ?? frame?.columns.find((column) => column.kind === "numeric" && !isBinaryColumn(column) && column.role === "none")?.name ?? null;

  const curves = useMemo(() => {
    if (!frame || !referenceName) return [];
    const refColumn = columnByName(frame, referenceName);
    if (!refColumn) return [];
    return [primaryName, markers[1]]
      .filter((name): name is string => Boolean(name && columnByName(frame, name)))
      .map((name) => {
        const column = columnByName(frame, name)!;
        const scores: number[] = [];
        const labels: (0 | 1)[] = [];
        for (const row of selection.rows) {
          const value = column.values[row];
          const label = binaryValue(refColumn.values[row]);
          if (typeof value === "number" && label !== null) {
            scores.push(value);
            labels.push(label);
          }
        }
        try {
          const raw = rocCurve(scores, labels);
          // Orient each marker so that it discriminates in its natural direction.
          const lowerIsWorse = raw.auc < 0.5;
          const oriented = lowerIsWorse ? scores.map((v) => -v) : scores;
          return {
            name,
            column,
            scores,
            labels,
            direction: lowerIsWorse ? ("lower" as const) : ("higher" as const),
            roc: rocCurve(oriented, labels),
            auc: aucDeLong(oriented, labels),
            youden: youdenOptimal(oriented, labels),
            error: null as string | null,
          };
        } catch (error) {
          return { name, column, scores, labels, direction: "higher" as const, roc: null, auc: null, youden: null, error: error instanceof Error ? error.message : "ROC failed" };
        }
      });
  }, [frame, referenceName, primaryName, markers, selection.rows]);

  const main = curves[0];
  const sorted = useMemo(() => (main ? [...main.scores].sort((a, b) => a - b) : []), [main]);
  const cuts = useMemo(() => sorted.filter((value, index) => index === 0 || value !== sorted[index - 1]), [sorted]);

  if (!frame) {
    return (
      <PaneBody>
        <EmptyState
          title="No active dataset"
          hint="The ROC explorer evaluates a numeric marker against a 0/1 reference standard in your data."
          action={
            <button type="button" className={pillBtn} onClick={() => navigate("/")}>
              Go to Overview
            </button>
          }
        />
      </PaneBody>
    );
  }
  const threshold = main?.youden ? cut ?? (main.direction === "lower" ? -main.youden.threshold : main.youden.threshold) : null;
  const counts = main && threshold !== null ? confusionAt(main.scores, main.labels, threshold, main.direction) : null;
  const metrics = counts ? diagnostic2x2(counts.tp, counts.fp, counts.fn, counts.tn) : null;
  const operating = counts ? { x: counts.fp / Math.max(1, counts.fp + counts.tn), y: counts.tp / Math.max(1, counts.tp + counts.fn) } : undefined;
  const summary = main?.auc
    ? `${main.name} discriminated ${referenceName} with an AUC of ${fixed(main.auc.auc, 3)} (95% DeLong CI ${fixed(main.auc.lower, 3)}–${fixed(main.auc.upper, 3)}; ${main.auc.nPositive} positives, ${main.auc.nNegative} negatives)${main.direction === "lower" ? ", with lower values indicating the condition" : ""}. At a cut-off of ${fmt(threshold)}, sensitivity was ${pct(metrics?.sensitivity.estimate)} and specificity ${pct(metrics?.specificity.estimate)}.${curves[1]?.auc ? ` ${curves[1].name} had an AUC of ${fixed(curves[1].auc.auc, 3)} (${fixed(curves[1].auc.lower, 3)}–${fixed(curves[1].auc.upper, 3)}).` : ""}`
    : "";

  return (
    <PaneBody>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5 border-b border-border-2 bg-card-2 px-[11px] py-2.5">
        <Field label="Reference standard (0/1)" htmlFor="roc-ref">
          <ColumnSelect id="roc-ref" frame={frame} value={referenceName} onChange={(name) => { setReference(name); setCut(null); }} filter={isBinaryColumn} ariaLabel="Reference standard" />
        </Field>
        <Field label="Marker" htmlFor="roc-m1">
          <ColumnSelect id="roc-m1" frame={frame} value={primaryName} onChange={(name) => { setMarkers([name, markers[1]]); setCut(null); }} kinds={["numeric"]} filter={(c) => c.name !== referenceName} ariaLabel="Marker" />
        </Field>
        <Field label="Compare with (optional)" htmlFor="roc-m2">
          <ColumnSelect id="roc-m2" frame={frame} value={markers[1]} onChange={(name) => setMarkers([markers[0], name])} kinds={["numeric"]} filter={(c) => c.name !== referenceName && c.name !== primaryName} allowNone ariaLabel="Second marker" />
        </Field>
      </div>
      {!referenceName || !main ? (
        <EmptyState title="Choose a reference standard and a marker" hint="For the sepsis sample: sepsis as reference, pct_ng_ml or lactate_mmol as markers." />
      ) : main.error || !main.roc || !main.auc ? (
        <div className="px-[11px] py-3">
          <Callout tone="bad">{main.error ?? "ROC could not be computed."}</Callout>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_340px] gap-0 mobile:grid-cols-1">
          <div className="border-r border-border-2 mobile:border-r-0">
            <Section title="ROC curves">
              <LineChart
                ref={ref}
                title="ROC curves"
                height={340}
                series={curves.filter((curve) => curve.roc).map((curve, index) => ({
                  label: `${curve.name} · AUC ${fixed(curve.auc!.auc, 3)}`,
                  color: chartColor(index),
                  points: curve.roc!.points.map((p) => ({ x: p.fpr, y: p.tpr })),
                }))}
                xLabel="1 − specificity (false-positive rate)"
                yLabel="Sensitivity"
                xDomain={[0, 1]}
                yDomain={[0, 1]}
                diagonal
                highlight={operating ? { ...operating, label: `cut ${fmt(threshold)}` } : undefined}
                legend
                actions={<ChartActions svgRef={ref} filename="roc-explorer" />}
              />
            </Section>
            <div className="border-b border-border-2 px-[11px] py-2.5">
              <div className="mb-1 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Results, in words</div>
              <p className="m-0 rounded-md border border-border-2 bg-card-2 px-2.5 py-2 text-body leading-relaxed text-fg">{summary}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PinButton
                  busy={pin.isPending}
                  onClick={() =>
                    pin.mutate({
                      title: `ROC · ${main.column?.label || main.name} for ${frame.columns.find((column) => column.name === referenceName)?.label || referenceName}`,
                      datasetId: frame.datasetId,
                      payload: {
                        module: "diagnostic",
                        summary,
                        table: {
                          columns: ["Marker", "AUC", "95% CI", "Youden cut-off", "Sensitivity", "Specificity"],
                          rows: curves.filter((curve) => curve.auc && curve.youden).map((curve) => [
                            curve.name,
                            fixed(curve.auc!.auc, 3),
                            `${fixed(curve.auc!.lower, 3)} – ${fixed(curve.auc!.upper, 3)}`,
                            fmt(curve.direction === "lower" ? -curve.youden!.threshold : curve.youden!.threshold),
                            pct(curve.youden!.sensitivity),
                            pct(curve.youden!.specificity),
                          ]),
                        },
                        chart: { type: "roc", data: { points: main.roc!.points.map((p) => ({ x: p.fpr, y: p.tpr })), auc: main.auc!.auc } },
                        provenance: { ...provenanceOf(frame, selection), reference: referenceName, marker: main.name },
                        notes: "",
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>
          <div>
            <Section
              title={`Threshold on ${main.name}`}
              actions={
                <button type="button" className={ghostBtn} onClick={() => setCut(null)}>
                  Youden
                </button>
              }
            >
              <input
                type="range"
                aria-label="Marker threshold"
                aria-valuetext={`cut ${fmt(threshold)} · sensitivity ${pct(metrics?.sensitivity.estimate)} · specificity ${pct(metrics?.specificity.estimate)}`}
                className="w-full accent-[var(--primary)]"
                min={0}
                max={Math.max(0, cuts.length - 1)}
                step={1}
                value={(() => {
                  const found = cuts.findIndex((value) => value >= (threshold ?? 0));
                  return found === -1 ? Math.max(0, cuts.length - 1) : found;
                })()}
                onChange={(event) => setCut(cuts[Number(event.target.value)])}
              />
              <div className="ui-mono mt-1 text-center text-label text-fg">
                positive when {main.name} {main.direction === "higher" ? "≥" : "≤"} {fmt(threshold)}
                {main.column.unit ? ` ${main.column.unit}` : ""}
              </div>
              {counts && metrics && (
                <>
                  <div className="mt-2">
                    <ResultTable dense columns={["", "Ref +", "Ref −"]} rows={[["Test +", counts.tp, counts.fp], ["Test −", counts.fn, counts.tn]]} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <StatTile label="Sensitivity" value={pct(metrics.sensitivity.estimate)} sub={`${pct(metrics.sensitivity.lower)}–${pct(metrics.sensitivity.upper)}`} />
                    <StatTile label="Specificity" value={pct(metrics.specificity.estimate)} sub={`${pct(metrics.specificity.lower)}–${pct(metrics.specificity.upper)}`} />
                    <StatTile label="PPV" value={pct(metrics.ppv.estimate)} />
                    <StatTile label="NPV" value={pct(metrics.npv.estimate)} />
                    <StatTile label="LR+" value={fixed(metrics.lrPositive.estimate, 2)} />
                    <StatTile label="LR−" value={fixed(metrics.lrNegative.estimate, 2)} />
                  </div>
                  <button type="button" className={`${pillBtn} mt-2.5 flex items-center gap-1`} onClick={() => onUseCounts(counts)}>
                    Use these counts in the 2×2 tab <ArrowRight size={13} aria-hidden />
                  </button>
                </>
              )}
            </Section>
            <div className="px-[11px] py-2">
              <Callout tone="warn">An optimal cut-off chosen on these rows is optimistic; confirm it in independent data.</Callout>
            </div>
          </div>
        </div>
      )}
    </PaneBody>
  );
}
