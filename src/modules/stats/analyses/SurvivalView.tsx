/** Kaplan–Meier curves with confidence bands, censor marks, numbers at risk, and the log-rank test. */

import { useMemo, useRef, useState } from "react";

import { apaP, columnByName, groupLevels, isGroupingColumn } from "../../../../shared/workbench/analysis";
import { binaryValue, displayValue, isBinaryColumn } from "../../../../shared/workbench/dataset";
import { type KaplanMeierResult, kaplanMeier, logRankTest } from "../../../../shared/stats";
import { ChartActions, LineChart, NumberAtRiskTable, chartColor, niceTicks } from "../../../charts";
import { EmptyState, PaneBody } from "../../../shared-console/src";
import { Callout, ColumnSelect, plural, Field, ResultTable, Section, StatTile, fixed, formatP } from "../../../workstation/ui";
import { type AnalysisProps, AnalysisError, ConfigBar, ResultActions, attempt, labelOf } from "../common";

const MARGIN_LEFT = 64;

interface Curve {
  label: string;
  km: KaplanMeierResult;
  times: number[];
  events: (0 | 1)[];
}

function atRisk(curve: Curve, at: number): number {
  return curve.times.filter((time) => time >= at).length;
}

export function SurvivalView({ ctx }: AnalysisProps) {
  const { frame, selection } = ctx;
  const role = (r: string) => frame.columns.find((column) => column.role === r && column.error === null)?.name ?? null;
  const [time, setTime] = useState<string | null>(role("time"));
  const [event, setEvent] = useState<string | null>(role("event"));
  const [group, setGroup] = useState<string | null>(null);
  const [fullAxis, setFullAxis] = useState(false);
  const chartRef = useRef<SVGSVGElement>(null);
  const timeColumn = columnByName(frame, time);
  const eventColumn = columnByName(frame, event);
  const groupColumn = columnByName(frame, group);

  const computed = useMemo(() => {
    if (!timeColumn || !eventColumn) return null;
    return attempt(() => {
      const rows = selection.rows.filter((row) => {
        const t = timeColumn.values[row];
        return typeof t === "number" && t >= 0 && binaryValue(eventColumn.values[row]) !== null && (!groupColumn || groupColumn.values[row] !== null);
      });
      const excluded = selection.rows.length - rows.length;
      const levels = groupColumn ? groupLevels(groupColumn, rows).map((entry) => entry.level) : ["All"];
      const curves: Curve[] = levels.map((level) => {
        const subset = groupColumn ? rows.filter((row) => displayValue(groupColumn.values[row]) === level) : rows;
        const times = subset.map((row) => timeColumn.values[row] as number);
        const events = subset.map((row) => binaryValue(eventColumn.values[row])!) as (0 | 1)[];
        return { label: level, km: kaplanMeier(times, events), times, events };
      });
      const logRank = groupColumn && levels.length >= 2
        ? logRankTest(
            rows.map((row) => timeColumn.values[row] as number),
            rows.map((row) => binaryValue(eventColumn.values[row])!) as (0 | 1)[],
            rows.map((row) => displayValue(groupColumn.values[row])),
          )
        : null;
      return { curves, logRank, excluded, maxTime: rows.reduce((max, row) => Math.max(max, timeColumn.values[row] as number), 0) };
    });
  }, [timeColumn, eventColumn, groupColumn, selection.rows]);

  return (
    <>
      <ConfigBar>
        <Field label="Follow-up time" htmlFor="km-time">
          <ColumnSelect id="km-time" frame={frame} value={time} onChange={setTime} kinds={["numeric"]} ariaLabel="Follow-up time" />
        </Field>
        <Field label="Event (1 = event, 0 = censored)" htmlFor="km-event">
          <ColumnSelect id="km-event" frame={frame} value={event} onChange={setEvent} filter={isBinaryColumn} ariaLabel="Event indicator" />
        </Field>
        <Field label="Compare groups" htmlFor="km-group">
          <ColumnSelect
            id="km-group"
            frame={frame}
            value={group}
            onChange={setGroup}
            allowNone
            noneLabel="— single curve —"
            filter={(column) => column.name !== event && isGroupingColumn(column, selection.rows)}
            filterKey={`km:${event}:${selection.cohort?.id ?? "all"}`}
            ariaLabel="Group"
          />
        </Field>
      </ConfigBar>
      <PaneBody>
        {!computed ? (
          <EmptyState title="Choose follow-up time and event" hint="Mark the columns with the Time and Event roles in Data Studio to have them preselected." />
        ) : computed.error ? (
          <AnalysisError error={computed.error} />
        ) : (
          (() => {
            const { curves, logRank, excluded, maxTime } = computed.value!;
            const ticks = niceTicks(0, maxTime, 6).filter((tick) => tick <= maxTime);
            const unit = timeColumn!.unit ? ` ${timeColumn!.unit}` : "";
            const medians = curves.map((curve) => `${curve.label}: ${curve.km.median === null ? "not reached" : `${fixed(curve.km.median, 2)}${unit}`}`);
            const summary = `Kaplan–Meier analysis of ${eventColumn!.label} over ${timeColumn!.label} (${curves.reduce((s, c) => s + c.km.n, 0).toLocaleString("en-US")} participants, ${curves.reduce((s, c) => s + c.km.events, 0).toLocaleString("en-US")} events). Median time to event — ${medians.join("; ")}.${
              logRank ? ` Log-rank χ²(${logRank.df}) = ${fixed(logRank.statistic, 2)}, ${apaP(logRank.pValue)}.` : ""
            }`;
            const series = curves.map((curve, index) => {
              const points = [{ x: 0, y: 1 }, ...curve.km.steps.map((step) => ({ x: step.time, y: step.survival }))];
              const band = [
                { x: 0, lower: 1, upper: 1 },
                ...curve.km.steps.filter((step) => step.lower !== null && step.upper !== null).map((step) => ({ x: step.time, lower: step.lower!, upper: step.upper! })),
              ];
              const marks = curve.km.steps.filter((step) => step.nCensor > 0).map((step) => ({ x: step.time, y: step.survival }));
              // Dense censoring turns tick marks into noise; show them only when readable.
              return { label: curve.label, color: chartColor(index), points, step: true, band, marks: marks.length <= 120 ? marks : undefined };
            });
            // A loop, not a spread: step lists can exceed the engine's argument limit on large data.
            let lowest = 1;
            for (const curve of curves) for (const step of curve.km.steps) lowest = Math.min(lowest, step.lower ?? step.survival);
            const yMin = fullAxis ? 0 : Math.max(0, Math.floor((lowest - 0.05) * 10) / 10);
            const tableRows = curves.map((curve) => [
              curve.label,
              curve.km.n,
              curve.km.events,
              curve.km.median === null ? "not reached" : fixed(curve.km.median, 2),
              curve.km.medianLower === null ? "—" : `${fixed(curve.km.medianLower, 2)} – ${curve.km.medianUpper === null ? "NR" : fixed(curve.km.medianUpper, 2)}`,
              ...[0.25, 0.5, 0.75].map((fraction) => {
                const at = maxTime * fraction;
                const step = [...curve.km.steps].reverse().find((entry) => entry.time <= at);
                return fixed(step ? step.survival : 1, 3);
              }),
            ]);
            return (
              <>
                <ResultActions
                  ctx={ctx}
                  title={`Kaplan–Meier · ${labelOf(frame, event)}${group ? ` by ${labelOf(frame, group)}` : ""}`}
                  module="stats"
                  summary={summary}
                  table={{ columns: ["Group", "n", "Events", "Median", "95% CI", `S(${fixed(maxTime * 0.25, 1)})`, `S(${fixed(maxTime * 0.5, 1)})`, `S(${fixed(maxTime * 0.75, 1)})`], rows: tableRows }}
                  chart={{ type: "km", data: series.map((s) => ({ label: s.label, points: s.points })) }}
                  extra={{ analysis: "kaplan-meier", time, event, group }}
                />
                {excluded > 0 && (
                  <div className="px-[11px] pt-2">
                    <Callout tone="info">{plural(excluded, "row")} with missing or negative time, or a missing event/group, were excluded.</Callout>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
                  <StatTile label="Participants" value={curves.reduce((s, c) => s + c.km.n, 0).toLocaleString("en-US")} />
                  <StatTile label="Events" value={curves.reduce((s, c) => s + c.km.events, 0).toLocaleString("en-US")} />
                  <StatTile label="Log-rank" value={logRank ? formatP(logRank.pValue) : "—"} sub={logRank ? `χ² = ${fixed(logRank.statistic, 2)}, df ${logRank.df}` : "single curve"} tone={logRank && logRank.pValue < 0.05 ? "var(--primary)" : undefined} />
                </div>
                <Section
                  title="Survival curves"
                  actions={
                    <label className="flex cursor-pointer items-center gap-1.5 text-label text-muted-fg">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={fullAxis} onChange={(event) => setFullAxis(event.target.checked)} />
                      Full 0–1 axis
                    </label>
                  }
                >
                  <LineChart
                    ref={chartRef}
                    title="Kaplan–Meier survival curves"
                    height={300}
                    series={series}
                    xLabel={`${timeColumn!.label}${unit}`}
                    yLabel="Event-free probability"
                    xDomain={[0, maxTime]}
                    yDomain={[yMin, 1]}
                    margin={{ left: MARGIN_LEFT }}
                    legend={curves.length > 1}
                    actions={<ChartActions svgRef={chartRef} filename="kaplan-meier" />}
                  />
                  <NumberAtRiskTable
                    times={ticks}
                    xDomain={[0, maxTime]}
                    inset={{ left: MARGIN_LEFT, right: 16 }}
                    groups={curves.map((curve, index) => ({ label: curve.label, color: chartColor(index), counts: ticks.map((tick) => atRisk(curve, tick)) }))}
                  />
                </Section>
                <Section title="Median survival and survival probabilities">
                  <ResultTable
                    columns={["Group", "n", "Events", `Median${unit}`, "95% CI", `S at ${fixed(maxTime * 0.25, 1)}`, `S at ${fixed(maxTime * 0.5, 1)}`, `S at ${fixed(maxTime * 0.75, 1)}`]}
                    rows={tableRows}
                  />
                  {logRank && (
                    <div className="mt-2">
                      <ResultTable
                        columns={["Group", "n", "Observed", "Expected", "O/E"]}
                        rows={logRank.groups.map((entry) => [entry.group, entry.n, entry.observed, fixed(entry.expected, 1), fixed(entry.observed / entry.expected, 2)])}
                      />
                    </div>
                  )}
                  <p className="m-0 mt-1.5 text-cap text-muted-fg">Bands are pointwise 95% CIs (log transformation, as R’s survfit default). Ticks mark censored observations when few enough to read.{yMin > 0 ? " The y-axis is zoomed; tick “Full 0–1 axis” for the conventional scale." : ""}</p>
                </Section>
              </>
            );
          })()
        )}
      </PaneBody>
    </>
  );
}
