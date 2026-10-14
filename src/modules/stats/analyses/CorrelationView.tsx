/** Correlation matrix (heatmap) with a drill-down scatter for any pair. */

import { useMemo, useRef, useState } from "react";

import { apaP, columnByName } from "../../../../shared/workbench/analysis";
import { linearRegression, pearson, spearman } from "../../../../shared/stats";
import { ChartActions, Heatmap, ScatterPlot } from "../../../charts";
import { EmptyState, PaneBody, SegTabs } from "../../../shared-console/src";
import { Field, Section, StatTile, fixed, formatP } from "../../../workstation/ui";
import { type AnalysisProps, ConfigBar, ResultActions, attempt } from "../common";
import { VariablePicker } from "../VariablePicker";

type Method = "pearson" | "spearman";

export function CorrelationView({ ctx }: AnalysisProps) {
  const { frame, selection } = ctx;
  const numeric = frame.columns.filter((column) => column.kind === "numeric" && column.error === null && !["id", "time", "event"].includes(column.role));
  const [variables, setVariables] = useState<string[]>(() => numeric.slice(0, 8).map((column) => column.name));
  const [method, setMethod] = useState<Method>("pearson");
  const [pair, setPair] = useState<[number, number] | null>(null);
  const heatRef = useRef<SVGSVGElement>(null);
  const scatterRef = useRef<SVGSVGElement>(null);

  const matrix = useMemo(() => {
    const columns = variables.map((name) => columnByName(frame, name)).filter((column) => column !== null);
    const values: (number | null)[][] = columns.map(() => columns.map(() => null));
    const pvalues: (number | null)[][] = columns.map(() => columns.map(() => null));
    const counts: number[][] = columns.map(() => columns.map(() => 0));
    for (let i = 0; i < columns.length; i += 1) {
      for (let j = i; j < columns.length; j += 1) {
        const x: number[] = [];
        const y: number[] = [];
        for (const row of selection.rows) {
          const a = columns[i]!.values[row];
          const b = columns[j]!.values[row];
          if (typeof a === "number" && typeof b === "number") {
            x.push(a);
            y.push(b);
          }
        }
        counts[i][j] = counts[j][i] = x.length;
        if (i === j) {
          values[i][j] = 1;
          continue;
        }
        const result = attempt(() => (method === "pearson" ? pearson(x, y) : spearman(x, y)));
        if (result.value) {
          const r = "r" in result.value ? result.value.r : result.value.rho;
          values[i][j] = values[j][i] = r;
          pvalues[i][j] = pvalues[j][i] = result.value.pValue;
        }
      }
    }
    return { columns: columns.map((column) => column!.name), values, pvalues, counts };
  }, [variables, frame, selection.rows, method]);

  const strongest = useMemo(() => {
    let best: { i: number; j: number; r: number } | null = null;
    for (let i = 0; i < matrix.columns.length; i += 1) {
      for (let j = i + 1; j < matrix.columns.length; j += 1) {
        const r = matrix.values[i][j];
        if (r !== null && (!best || Math.abs(r) > Math.abs(best.r))) best = { i, j, r };
      }
    }
    return best;
  }, [matrix]);

  const active = pair ?? (strongest ? [strongest.i, strongest.j] : null);
  const detail = useMemo(() => {
    if (!active) return null;
    const [i, j] = active;
    const a = columnByName(frame, matrix.columns[i]);
    const b = columnByName(frame, matrix.columns[j]);
    if (!a || !b) return null;
    const x: number[] = [];
    const y: number[] = [];
    for (const row of selection.rows) {
      const va = a.values[row];
      const vb = b.values[row];
      if (typeof va === "number" && typeof vb === "number") {
        x.push(va);
        y.push(vb);
      }
    }
    const fit = attempt(() => linearRegression(x.map((v) => [v]), y, [a.name]));
    const p = attempt(() => pearson(x, y));
    const s = attempt(() => spearman(x, y));
    return { a, b, x, y, fit: fit.value, p: p.value, s: s.value };
  }, [active, frame, matrix.columns, selection.rows]);

  const label = method === "pearson" ? "Pearson r" : "Spearman rho";
  const summary = strongest
    ? `Across ${matrix.columns.length} variables${selection.cohort ? ` (cohort “${selection.cohort.title}”)` : ""}, the strongest ${method === "pearson" ? "Pearson" : "Spearman"} correlation was between ${matrix.columns[strongest.i]} and ${matrix.columns[strongest.j]} (${method === "pearson" ? "r" : "ρ"} = ${fixed(strongest.r, 2)}, ${apaP(matrix.pvalues[strongest.i][strongest.j])}, n = ${matrix.counts[strongest.i][strongest.j].toLocaleString("en-US")}). Correlations use pairwise-complete rows.`
    : "Select at least two numeric variables.";

  return (
    <>
      <ConfigBar>
        <Field label="Variables (2–16)">
          <VariablePicker frame={frame} value={variables} onChange={(next) => { setVariables(next); setPair(null); }} label="Correlation variables" filter={(column) => column.kind === "numeric"} max={16} />
        </Field>
        <Field label="Method">
          <SegTabs value={method} onChange={setMethod} options={[{ v: "pearson", label: "Pearson" }, { v: "spearman", label: "Spearman" }]} />
        </Field>
      </ConfigBar>
      <PaneBody>
        {matrix.columns.length < 2 ? (
          <EmptyState title="Pick at least two numeric variables" />
        ) : (
          <>
            <ResultActions
              ctx={ctx}
              title={`Correlation matrix (${label})`}
              summary={summary}
              table={{
                columns: ["", ...matrix.columns],
                rows: matrix.columns.map((name, i) => [name, ...matrix.values[i].map((value) => (value === null ? null : Number(value.toFixed(3))))]),
              }}
              chart={{ type: "heatmap", data: { rows: matrix.columns, cols: matrix.columns, values: matrix.values } }}
              extra={{ analysis: "correlation", method }}
            />
            <Section title={`${label} matrix · click a cell to inspect the pair`}>
              <Heatmap
                ref={heatRef}
                title={`${label} correlation matrix`}
                rows={matrix.columns}
                cols={matrix.columns}
                values={matrix.values}
                domain={[-1, 1]}
                format={(value) => value.toFixed(2)}
                onCellClick={(r, c) => r !== c && setPair([r, c])}
                height={Math.max(220, matrix.columns.length * 34 + 60)}
                actions={<ChartActions svgRef={heatRef} filename="correlation-matrix" />}
              />
            </Section>
            {detail && (
              <Section title={`${detail.a.name} × ${detail.b.name}`}>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  <StatTile label="Pearson r" value={fixed(detail.p?.r ?? null, 3)} sub={detail.p?.ci ? `95% CI ${fixed(detail.p.ci.lower, 2)} – ${fixed(detail.p.ci.upper, 2)}` : undefined} />
                  <StatTile label="Spearman rho" value={fixed(detail.s?.rho ?? null, 3)} sub={`p ${formatP(detail.s?.pValue)}`} />
                  <StatTile label="Pairs" value={detail.x.length.toLocaleString("en-US")} sub={`p ${formatP(detail.p?.pValue)}`} />
                </div>
                <ScatterPlot
                  ref={scatterRef}
                  title={`${detail.b.name} against ${detail.a.name}`}
                  height={280}
                  points={detail.x.map((value, index) => ({ x: value, y: detail.y[index] }))}
                  xLabel={`${detail.a.label}${detail.a.unit ? ` (${detail.a.unit})` : ""}`}
                  yLabel={`${detail.b.label}${detail.b.unit ? ` (${detail.b.unit})` : ""}`}
                  fitLine={detail.fit ? { intercept: detail.fit.coefficients[0].estimate, slope: detail.fit.coefficients[1].estimate } : undefined}
                  actions={<ChartActions svgRef={scatterRef} filename={`${detail.a.name}-${detail.b.name}`} />}
                />
              </Section>
            )}
          </>
        )}
      </PaneBody>
    </>
  );
}
