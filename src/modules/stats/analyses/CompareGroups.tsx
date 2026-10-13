/**
 * Compare groups — the outcome's type and the number of groups pick the test:
 * numbers get a parametric and a rank-based test side by side (so a skewed
 * outcome is never silently t-tested), categories get χ² or Fisher's exact
 * test, and a binary-by-binary table adds OR, RR, and risk difference.
 */

import { useMemo, useRef, useState } from "react";

import { apaP, columnByName, crossTab, isGroupingColumn, splitByGroup } from "../../../../shared/workbench/analysis";
import { isBinaryColumn } from "../../../../shared/workbench/dataset";
import {
  chiSquareTest,
  fisherExact2x2,
  kruskalWallis,
  mannWhitneyU,
  oddsRatio2x2,
  oneWayAnova,
  quantile,
  riskDifference2x2,
  riskRatio2x2,
  summarize,
  welchTTest,
} from "../../../../shared/stats";
import { BarChart, BoxPlot, ChartActions, chartColor } from "../../../charts";
import { EmptyState, PaneBody } from "../../../shared-console/src";
import { Callout, ColumnSelect, plural, Field, ResultTable, Section, StatTile, fixed, fmt, formatP, pct } from "../../../workstation/ui";
import { type AnalysisProps, AnalysisError, ConfigBar, ResultActions, attempt } from "../common";

export function CompareGroups({ ctx }: AnalysisProps) {
  const { frame, selection } = ctx;
  const [outcome, setOutcome] = useState<string | null>(
    () => frame.columns.find((column) => column.role === "outcome" && column.error === null)?.name ?? null,
  );
  const [group, setGroup] = useState<string | null>(
    () => frame.columns.find((column) => (column.role === "group" || column.role === "exposure") && isGroupingColumn(column))?.name ?? null,
  );
  const outcomeColumn = columnByName(frame, outcome);
  const groupColumn = columnByName(frame, group);

  return (
    <>
      <ConfigBar>
        <Field label="Outcome" htmlFor="cg-outcome">
          <ColumnSelect id="cg-outcome" frame={frame} value={outcome} onChange={setOutcome} filter={(column) => column.name !== group} filterKey={`cgo:${group}`} ariaLabel="Outcome" />
        </Field>
        <Field label="Groups" htmlFor="cg-group">
          <ColumnSelect
            id="cg-group"
            frame={frame}
            value={group}
            onChange={setGroup}
            filter={(column) => column.name !== outcome && isGroupingColumn(column, selection.rows)}
            filterKey={`cg:${outcome}:${selection.cohort?.id ?? "all"}`}
            ariaLabel="Grouping variable"
          />
        </Field>
      </ConfigBar>
      <PaneBody>
        {!outcomeColumn || !groupColumn || outcomeColumn.name === groupColumn.name ? (
          <EmptyState title="Choose an outcome and a grouping variable" hint="For example sbp by sex, or incident_diabetes by smoking." />
        ) : outcomeColumn.kind === "numeric" && !isBinaryColumn(outcomeColumn) ? (
          <NumericComparison ctx={ctx} outcome={outcomeColumn.name} group={groupColumn.name} />
        ) : (
          <CategoricalComparison ctx={ctx} outcome={outcomeColumn.name} group={groupColumn.name} />
        )}
      </PaneBody>
    </>
  );
}

function NumericComparison({ ctx, outcome, group }: AnalysisProps & { outcome: string; group: string }) {
  const { frame, selection } = ctx;
  const ref = useRef<SVGSVGElement>(null);
  const outcomeColumn = columnByName(frame, outcome)!;
  const groupColumn = columnByName(frame, group)!;
  const split = useMemo(() => splitByGroup(outcomeColumn, groupColumn, selection.rows), [outcomeColumn, groupColumn, selection.rows]);
  const usable = useMemo(
    () => split.levels.map((level, index) => ({ level, values: split.values[index] })).filter((entry) => entry.values.length >= 2),
    [split],
  );

  const result = useMemo(
    () =>
      attempt(() => {
        if (usable.length < 2) throw new Error("At least two groups need two or more observations each.");
        if (usable.length === 2) {
          return { kind: "two" as const, t: welchTTest(usable[0].values, usable[1].values), u: mannWhitneyU(usable[0].values, usable[1].values) };
        }
        return { kind: "many" as const, anova: oneWayAnova(usable.map((g) => g.values)), kw: kruskalWallis(usable.map((g) => g.values)) };
      }),
    [usable],
  );

  const summaries = useMemo(() => usable.map((entry) => ({ level: entry.level, summary: summarize(entry.values), values: entry.values })), [usable]);
  const unit = outcomeColumn.unit ? ` ${outcomeColumn.unit}` : "";
  const skewed = summaries.some((entry) => entry.summary.skewness !== null && Math.abs(entry.summary.skewness) > 1);
  const small = summaries.some((entry) => entry.summary.n < 15);

  if (result.error) return <AnalysisError error={result.error} />;
  const value = result.value!;
  let summary: string;
  let primaryP: number;
  if (value.kind === "two") {
    const [a, b] = summaries;
    summary = `${outcomeColumn.label} was ${fixed(a.summary.mean, 2)}${unit} (SD ${fixed(a.summary.sd, 2)}) in ${a.level} (n = ${a.summary.n.toLocaleString("en-US")}) and ${fixed(b.summary.mean, 2)}${unit} (SD ${fixed(b.summary.sd, 2)}) in ${b.level} (n = ${b.summary.n.toLocaleString("en-US")}); mean difference ${fixed(value.t.meanDiff, 2)}${unit}, 95% CI ${fixed(value.t.ci.lower, 2)} to ${fixed(value.t.ci.upper, 2)}, Welch t(${fixed(value.t.df, 1)}) = ${fixed(value.t.statistic, 2)}, ${apaP(value.t.pValue)}, Cohen's d = ${fixed(value.t.cohensD, 2)}. The Mann–Whitney test gave ${apaP(value.u.pValue)} (rank-biserial r = ${fixed(value.u.rankBiserial, 2)}).`;
    primaryP = skewed ? value.u.pValue : value.t.pValue;
  } else {
    summary = `${outcomeColumn.label} differed across ${usable.length} levels of ${groupColumn.label}: one-way ANOVA F(${value.anova.df1}, ${value.anova.df2}) = ${fixed(value.anova.statistic, 2)}, ${apaP(value.anova.pValue)}, η² = ${fixed(value.anova.etaSquared, 3)}; Kruskal–Wallis H(${value.kw.df}) = ${fixed(value.kw.statistic, 2)}, ${apaP(value.kw.pValue)}.`;
    primaryP = skewed ? value.kw.pValue : value.anova.pValue;
  }

  const tableRows = summaries.map((entry) => [
    entry.level,
    entry.summary.n,
    fixed(entry.summary.mean, 2),
    fixed(entry.summary.sd, 2),
    fixed(entry.summary.median, 2),
    `${fixed(entry.summary.q1, 2)}–${fixed(entry.summary.q3, 2)}`,
  ]);

  return (
    <>
      <ResultActions
        ctx={ctx}
        title={`${outcomeColumn.label} by ${groupColumn.label}`}
        summary={summary}
        table={{ columns: ["Group", "n", "Mean", "SD", "Median", "IQR"], rows: tableRows }}
        chart={{
          type: "box",
          data: { yLabel: `${outcomeColumn.label}${unit}`, groups: summaries.map((entry) => {
            const sorted = [...entry.values].sort((x, y) => x - y);
            return { label: entry.level, stats: { min: sorted[0], q1: quantile(sorted, 0.25), median: quantile(sorted, 0.5), q3: quantile(sorted, 0.75), max: sorted[sorted.length - 1] } };
          }) },
        }}
        extra={{ analysis: "compare-numeric", outcome, group }}
      />
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        {value.kind === "two" ? (
          <>
            <StatTile label="Mean difference" value={`${fixed(value.t.meanDiff, 2)}${unit}`} sub={`95% CI ${fixed(value.t.ci.lower, 2)} – ${fixed(value.t.ci.upper, 2)}`} />
            <StatTile label="Welch t-test" value={formatP(value.t.pValue)} sub={`t = ${fixed(value.t.statistic, 2)}, d = ${fixed(value.t.cohensD, 2)}`} tone={value.t.pValue < 0.05 ? "var(--primary)" : undefined} />
            <StatTile label="Mann–Whitney U" value={formatP(value.u.pValue)} sub={`r = ${fixed(value.u.rankBiserial, 2)}`} tone={value.u.pValue < 0.05 ? "var(--primary)" : undefined} />
          </>
        ) : (
          <>
            <StatTile label="Groups" value={usable.length} sub={`${split.excluded} rows excluded`} />
            <StatTile label="ANOVA" value={formatP(value.anova.pValue)} sub={`F = ${fixed(value.anova.statistic, 2)}, η² = ${fixed(value.anova.etaSquared, 3)}`} tone={value.anova.pValue < 0.05 ? "var(--primary)" : undefined} />
            <StatTile label="Kruskal–Wallis" value={formatP(value.kw.pValue)} sub={`H = ${fixed(value.kw.statistic, 2)}`} tone={value.kw.pValue < 0.05 ? "var(--primary)" : undefined} />
          </>
        )}
      </div>
      {(skewed || small) && (
        <div className="px-[11px] pt-2">
          <Callout tone="info">
            {skewed ? "At least one group is clearly skewed (|skewness| > 1) — prefer the rank-based test. " : ""}
            {small ? "Some groups have fewer than 15 observations; normal-theory tests are fragile at this size." : ""}
            {` Reported p (primary): ${formatP(primaryP)}.`}
          </Callout>
        </div>
      )}
      <Section title="Distribution by group">
        <BoxPlot
          ref={ref}
          title={`${outcome} by ${group}`}
          height={260}
          yLabel={`${outcomeColumn.label}${unit}`}
          groups={summaries.map((entry, index) => {
            const sorted = [...entry.values].sort((x, y) => x - y);
            const q1 = quantile(sorted, 0.25);
            const q3 = quantile(sorted, 0.75);
            const iqr = q3 - q1;
            const inside = sorted.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
            return {
              label: `${entry.level} (n=${entry.summary.n})`,
              stats: { min: inside[0], q1, median: quantile(sorted, 0.5), q3, max: inside[inside.length - 1] },
              outliers: sorted.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr),
              points: sorted.length <= 600 ? sorted : undefined,
              color: chartColor(index),
            };
          })}
          actions={<ChartActions svgRef={ref} filename={`${outcome}-by-${group}`} />}
        />
      </Section>
      <Section title="Summary by group">
        <ResultTable columns={["Group", "n", "Mean", "SD", "Median", "IQR"]} rows={tableRows} />
        {split.excluded > 0 && <p className="m-0 mt-1.5 text-cap text-muted-fg">{plural(split.excluded, "row")} with a missing outcome or group {split.excluded === 1 ? "was" : "were"} excluded.</p>}
      </Section>
    </>
  );
}

function CategoricalComparison({ ctx, outcome, group }: AnalysisProps & { outcome: string; group: string }) {
  const { frame, selection } = ctx;
  const ref = useRef<SVGSVGElement>(null);
  const outcomeColumn = columnByName(frame, outcome)!;
  const groupColumn = columnByName(frame, group)!;
  const tab = useMemo(() => crossTab(outcomeColumn, groupColumn, selection.rows), [outcomeColumn, groupColumn, selection.rows]);
  const nonEmptyRows = useMemo(
    () => tab.table.map((row, index) => ({ row, level: tab.rowLevels[index] })).filter((entry) => entry.row.some((count) => count > 0)),
    [tab],
  );

  const result = useMemo(
    () =>
      attempt(() => {
        if (nonEmptyRows.length < 2 || tab.colLevels.length < 2) throw new Error("Both variables need at least two observed levels.");
        const table = nonEmptyRows.map((entry) => entry.row);
        const chi = chiSquareTest(table, { yates: false });
        const twoByTwo = table.length === 2 && tab.colLevels.length === 2;
        // Orient so that the "event" column is the 1 / yes level when present.
        const eventIndex = Math.max(0, tab.colLevels.findIndex((level) => level === "1" || level === "yes"));
        const otherIndex = eventIndex === 0 ? 1 : 0;
        if (!twoByTwo) return { chi, fisher: null, effects: null, eventIndex, otherIndex };
        // Exposed = second group level vs reference = first.
        const [ref0, exp0] = table;
        const a = exp0[eventIndex];
        const b = exp0[otherIndex];
        const c = ref0[eventIndex];
        const d = ref0[otherIndex];
        const fisher = fisherExact2x2(a, b, c, d);
        const effects = attempt(() => ({ or: oddsRatio2x2(a, b, c, d), rr: riskRatio2x2(a, b, c, d), rd: riskDifference2x2(a, b, c, d) })).value;
        return { chi, fisher, effects, eventIndex, otherIndex };
      }),
    [nonEmptyRows, tab.colLevels],
  );

  if (result.error) return <AnalysisError error={result.error} />;
  const value = result.value!;
  const useFisher = value.fisher !== null && value.chi.lowExpectedWarning;
  const p = useFisher ? value.fisher!.pValue : value.chi.pValue;
  const eventLevel = tab.colLevels[value.eventIndex];
  const rowsOut = nonEmptyRows.map((entry) => {
    const total = entry.row.reduce((sum, count) => sum + count, 0);
    return [entry.level, total, ...entry.row.map((count) => `${count} (${pct(total ? count / total : null)})`)];
  });
  const levels = nonEmptyRows.map((entry) => entry.level);
  const rates = nonEmptyRows.map((entry) => {
    const total = entry.row.reduce((sum, count) => sum + count, 0);
    return total ? entry.row[value.eventIndex] / total : 0;
  });
  const effectText = value.effects
    ? ` Compared with ${levels[0]}, ${levels[1]} had an odds ratio of ${fixed(value.effects.or.oddsRatio, 2)} (95% CI ${fixed(value.effects.or.ci.lower, 2)}–${fixed(value.effects.or.ci.upper, 2)}), a risk ratio of ${fixed(value.effects.rr.riskRatio, 2)} (${fixed(value.effects.rr.ci.lower, 2)}–${fixed(value.effects.rr.ci.upper, 2)}) and a risk difference of ${fixed(value.effects.rd.riskDifference * 100, 1)} percentage points (${fixed(value.effects.rd.ci.lower * 100, 1)} to ${fixed(value.effects.rd.ci.upper * 100, 1)}).`
    : "";
  const summary = `The proportion with ${outcomeColumn.label} = ${eventLevel} was ${levels.map((level, i) => `${pct(rates[i])} in ${level}`).join(", ")} (${useFisher ? "Fisher's exact test" : `χ²(${value.chi.df}) = ${fixed(value.chi.statistic, 2)}`}, ${apaP(p)}; Cramér's V = ${fixed(value.chi.cramersV, 2)}).${effectText}`;

  return (
    <>
      <ResultActions
        ctx={ctx}
        title={`${outcomeColumn.label} by ${groupColumn.label}`}
        summary={summary}
        table={{ columns: [group, "n", ...tab.colLevels.map((level) => `${outcome} = ${level}`)], rows: rowsOut }}
        chart={{ type: "bar", data: levels.map((level, i) => ({ label: level, value: rates[i] })) }}
        extra={{ analysis: "compare-categorical", outcome, group }}
      />
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label={useFisher ? "Fisher's exact" : "Chi-square test"} value={formatP(p)} sub={useFisher ? "sparse table" : `χ² = ${fixed(value.chi.statistic, 2)}, df ${value.chi.df}`} tone={p < 0.05 ? "var(--primary)" : undefined} />
        <StatTile label="Cramér's V" value={fixed(value.chi.cramersV, 3)} />
        {value.effects ? (
          <StatTile label="Odds ratio" value={fixed(value.effects.or.oddsRatio, 2)} sub={`95% CI ${fixed(value.effects.or.ci.lower, 2)}–${fixed(value.effects.or.ci.upper, 2)}`} />
        ) : (
          <StatTile label="Table" value={`${nonEmptyRows.length} × ${tab.colLevels.length}`} />
        )}
      </div>
      {value.chi.lowExpectedWarning && !useFisher && (
        <div className="px-[11px] pt-2">
          <Callout tone="warn">Some expected counts are below 5, so the χ² approximation may be poor. Consider merging sparse levels.</Callout>
        </div>
      )}
      <Section title={`Share with ${outcome} = ${eventLevel}`}>
        <BarChart
          ref={ref}
          title={`Proportion with ${outcome} = ${eventLevel} by ${group}`}
          data={levels.map((level, i) => ({ label: level, value: rates[i], color: chartColor(i), detail: `${nonEmptyRows[i].row[value.eventIndex]} of ${nonEmptyRows[i].row.reduce((s, c) => s + c, 0)}` }))}
          valueFormat={(v) => `${(v * 100).toFixed(1)}%`}
          tickFormat={(v) => `${Math.round(v * 1000) / 10}%`}
          actions={<ChartActions svgRef={ref} filename={`${outcome}-by-${group}`} />}
        />
      </Section>
      <Section title="Contingency table (row %)">
        <ResultTable columns={[group, "n", ...tab.colLevels]} rows={rowsOut} />
        {value.effects && (
          <div className="mt-2">
            <ResultTable
              columns={["Effect", `${levels[1]} vs ${levels[0]}`, "95% CI"]}
              rows={[
                ["Odds ratio", fixed(value.effects.or.oddsRatio, 2), `${fixed(value.effects.or.ci.lower, 2)} – ${fixed(value.effects.or.ci.upper, 2)}`],
                ["Risk ratio", fixed(value.effects.rr.riskRatio, 2), `${fixed(value.effects.rr.ci.lower, 2)} – ${fixed(value.effects.rr.ci.upper, 2)}`],
                ["Risk difference", `${fixed(value.effects.rd.riskDifference * 100, 1)} pp`, `${fixed(value.effects.rd.ci.lower * 100, 1)} – ${fixed(value.effects.rd.ci.upper * 100, 1)}`],
              ]}
            />
            {(value.effects.or.corrected || value.effects.rr.corrected) && <p className="m-0 mt-1 text-cap text-muted-fg">A zero cell was present; 0.5 was added to every cell (Haldane–Anscombe).</p>}
          </div>
        )}
        {tab.excluded > 0 && <p className="m-0 mt-1.5 text-cap text-muted-fg">{plural(tab.excluded, "row")} with a missing value {tab.excluded === 1 ? "was" : "were"} excluded.</p>}
      </Section>
    </>
  );
}
