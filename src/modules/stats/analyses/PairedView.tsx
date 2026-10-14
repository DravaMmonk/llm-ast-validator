/** Paired comparison of two measurements on the same rows (e.g. baseline vs follow-up). */

import { useMemo, useRef, useState } from "react";

import { apaP, columnByName } from "../../../../shared/workbench/analysis";
import { histogram, pairedTTest, summarize } from "../../../../shared/stats";
import { ChartActions, Histogram } from "../../../charts";
import { EmptyState, PaneBody } from "../../../shared-console/src";
import { ColumnSelect, Field, ResultTable, Section, StatTile, fixed, formatP } from "../../../workstation/ui";
import { type AnalysisProps, AnalysisError, ConfigBar, ResultActions, attempt, labelOf } from "../common";

export function PairedView({ ctx }: AnalysisProps) {
  const { frame, selection } = ctx;
  const numeric = frame.columns.filter((column) => column.kind === "numeric" && column.error === null && column.role !== "id");
  const [first, setFirst] = useState<string | null>(numeric.find((column) => /baseline|pre|before/i.test(column.name))?.name ?? null);
  const [second, setSecond] = useState<string | null>(numeric.find((column) => /week|post|after|follow/i.test(column.name) && column.role !== "time")?.name ?? null);
  const ref = useRef<SVGSVGElement>(null);
  const a = columnByName(frame, first);
  const b = columnByName(frame, second);

  const pairs = useMemo(() => {
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
    return { x, y, dropped: selection.rows.length - x.length };
  }, [a, b, selection.rows]);

  const result = useMemo(() => (pairs ? attempt(() => pairedTTest(pairs.y, pairs.x)) : null), [pairs]);

  return (
    <>
      <ConfigBar>
        <Field label="First measurement" htmlFor="pair-a">
          <ColumnSelect id="pair-a" frame={frame} value={first} onChange={setFirst} kinds={["numeric"]} ariaLabel="First measurement" />
        </Field>
        <Field label="Second measurement" htmlFor="pair-b">
          <ColumnSelect id="pair-b" frame={frame} value={second} onChange={setSecond} kinds={["numeric"]} filter={(column) => column.name !== first} ariaLabel="Second measurement" />
        </Field>
      </ConfigBar>
      <PaneBody>
        {!a || !b || !pairs || !result ? (
          <EmptyState title="Choose two measurements" hint="The same quantity measured twice on each row — baseline and follow-up, left and right, before and after." />
        ) : result.error ? (
          <AnalysisError error={result.error} />
        ) : (
          (() => {
            const test = result.value!;
            const diffs = pairs.y.map((value, index) => value - pairs.x[index]);
            const sa = summarize(pairs.x);
            const sb = summarize(pairs.y);
            const unit = a.unit ? ` ${a.unit}` : "";
            const summary = `In ${test.n} complete pairs, ${b.label} averaged ${fixed(sb.mean, 2)}${unit} versus ${fixed(sa.mean, 2)}${unit} for ${a.label}: a mean change of ${fixed(test.mean, 2)}${unit} (95% CI ${fixed(test.ci.lower, 2)} to ${fixed(test.ci.upper, 2)}), paired t(${test.df}) = ${fixed(test.statistic, 2)}, ${apaP(test.pValue)}, d = ${fixed(test.cohensD, 2)}.${pairs.dropped ? ` ${pairs.dropped} row(s) lacked one of the measurements and were excluded.` : ""}`;
            return (
              <>
                <ResultActions
                  ctx={ctx}
                  title={`Paired change · ${labelOf(frame, second)} − ${labelOf(frame, first)}`}
                  summary={summary}
                  table={{
                    columns: ["Measure", "n", "Mean", "SD"],
                    rows: [
                      [first!, sa.n, fixed(sa.mean, 2), fixed(sa.sd, 2)],
                      [second!, sb.n, fixed(sb.mean, 2), fixed(sb.sd, 2)],
                      ["Change", test.n, fixed(test.mean, 2), fixed(summarize(diffs).sd, 2)],
                    ],
                  }}
                  extra={{ analysis: "paired", first, second }}
                />
                <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
                  <StatTile label="Mean change" value={`${fixed(test.mean, 2)}${unit}`} sub={`95% CI ${fixed(test.ci.lower, 2)} – ${fixed(test.ci.upper, 2)}`} />
                  <StatTile label="Paired t-test" value={formatP(test.pValue)} sub={`t(${test.df}) = ${fixed(test.statistic, 2)}`} tone={test.pValue < 0.05 ? "var(--primary)" : undefined} />
                  <StatTile label="Complete pairs" value={test.n.toLocaleString("en-US")} sub={`${pairs.dropped} excluded`} />
                </div>
                <Section title="Distribution of the change">
                  <Histogram
                    ref={ref}
                    title={`Change ${second} − ${first}`}
                    height={220}
                    bins={histogram(diffs).bins}
                    xLabel={`${second} − ${first}${unit}`}
                    markers={[
                      { x: 0, label: "no change" },
                      { x: test.mean, label: "mean", color: "var(--primary)" },
                    ]}
                    actions={<ChartActions svgRef={ref} filename="paired-change" />}
                  />
                </Section>
                <Section title="Summary">
                  <ResultTable
                    columns={["Measure", "n", "Mean", "SD", "Median"]}
                    rows={[
                      [first!, sa.n, fixed(sa.mean, 2), fixed(sa.sd, 2), fixed(sa.median, 2)],
                      [second!, sb.n, fixed(sb.mean, 2), fixed(sb.sd, 2), fixed(sb.median, 2)],
                    ]}
                  />
                </Section>
              </>
            );
          })()
        )}
      </PaneBody>
    </>
  );
}
