/**
 * Re-renders a pinned chart from its stored data. Stored items outlive the
 * code that pinned them, so every shape is checked and anything unexpected
 * degrades to a short note instead of breaking the report.
 */

import { Component, forwardRef, type ReactNode } from "react";

import { AttritionFlow, BarChart, BoxPlot, ForestPlot, Heatmap, LineChart, chartColor } from "../../charts";

type XY = { x: number; y: number };

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isXY = (value: unknown): value is XY => typeof value === "object" && value !== null && isNum((value as XY).x) && isNum((value as XY).y);

class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="m-0 text-cap text-muted-fg">This chart could not be redrawn from its stored data.</p> : this.props.children;
  }
}

export const ReportChart = forwardRef<SVGSVGElement, { type: string; data: unknown; title: string }>(function ReportChart({ type, data, title }, ref) {
  return <ChartBoundary>{render(type, data, title, ref)}</ChartBoundary>;
});

function render(type: string, data: unknown, title: string, ref: React.ForwardedRef<SVGSVGElement>): ReactNode {
  switch (type) {
    case "roc": {
      const points = (data as { points?: unknown[] })?.points?.filter(isXY) ?? [];
      if (points.length < 2) return null;
      return <LineChart ref={ref} title={title} height={240} series={[{ label: "ROC", points }]} xLabel="1 − specificity" yLabel="Sensitivity" xDomain={[0, 1]} yDomain={[0, 1]} diagonal legend={false} />;
    }
    case "power": {
      const points = Array.isArray(data) ? data.filter(isXY) : [];
      if (points.length < 2) return null;
      return <LineChart ref={ref} title={title} height={220} series={[{ label: "Power", points }]} xLabel="Participants per group" yLabel="Power" yDomain={[0, 1]} legend={false} />;
    }
    case "km": {
      const series = Array.isArray(data)
        ? data
            .map((entry, index) => ({ label: String((entry as { label?: unknown }).label ?? `Group ${index + 1}`), color: chartColor(index), points: ((entry as { points?: unknown[] }).points ?? []).filter(isXY), step: true }))
            .filter((entry) => entry.points.length > 1)
        : [];
      if (series.length === 0) return null;
      return <LineChart ref={ref} title={title} height={260} series={series} xLabel="Time" yLabel="Event-free probability" yDomain={[0, 1]} legend={series.length > 1} />;
    }
    case "forest": {
      const spec = Array.isArray(data) ? { rows: data, nullValue: 1, log: true } : (data as { rows?: unknown[]; nullValue?: number; log?: boolean });
      const rows = (spec?.rows ?? [])
        .map((row) => row as { label?: unknown; estimate?: unknown; lower?: unknown; upper?: unknown })
        .filter((row) => isNum(row.estimate) && isNum(row.lower) && isNum(row.upper))
        .map((row) => ({ label: String(row.label ?? ""), estimate: row.estimate as number, lower: row.lower as number, upper: row.upper as number }));
      if (rows.length === 0) return null;
      const log = spec.log ?? true;
      return (
        <ForestPlot
          ref={ref}
          title={title}
          rows={rows}
          nullValue={isNum(spec.nullValue) ? spec.nullValue : log ? 1 : 0}
          log={log}
          xLabel={log ? "Ratio (log scale), 95% CI" : "Coefficient, 95% CI"}
        />
      );
    }
    case "box": {
      const spec = Array.isArray(data) ? { groups: data, yLabel: undefined } : (data as { groups?: unknown[]; yLabel?: string });
      const list = spec?.groups;
      const groups = Array.isArray(list)
        ? list
            .map((entry, index) => {
              const stats = (entry as { stats?: Record<string, unknown> }).stats ?? {};
              return { label: String((entry as { label?: unknown }).label ?? ""), stats: { min: stats.min, q1: stats.q1, median: stats.median, q3: stats.q3, max: stats.max }, color: chartColor(index) };
            })
            .filter((entry) => Object.values(entry.stats).every(isNum))
        : [];
      if (groups.length === 0) return null;
      return <BoxPlot ref={ref} title={title} height={240} groups={groups as never} yLabel={typeof spec.yLabel === "string" ? spec.yLabel : undefined} />;
    }
    case "bar": {
      const bars = Array.isArray(data) ? data.filter((entry) => isNum((entry as { value?: unknown }).value)).map((entry, index) => ({ label: String((entry as { label?: unknown }).label ?? ""), value: (entry as { value: number }).value, color: chartColor(index) })) : [];
      if (bars.length === 0) return null;
      return <BarChart ref={ref} title={title} data={bars} valueFormat={(value) => (Math.abs(value) <= 1 ? `${(value * 100).toFixed(1)}%` : value.toFixed(2))} />;
    }
    case "heatmap": {
      const spec = data as { rows?: unknown[]; cols?: unknown[]; values?: unknown[][] };
      if (!Array.isArray(spec?.rows) || !Array.isArray(spec.cols) || !Array.isArray(spec.values)) return null;
      const values = spec.values.map((row) => (Array.isArray(row) ? row.map((value) => (isNum(value) ? value : null)) : []));
      return <Heatmap ref={ref} title={title} rows={spec.rows.map(String)} cols={spec.cols.map(String)} values={values} domain={[-1, 1]} format={(value) => value.toFixed(2)} />;
    }
    case "attrition": {
      const spec = data as { start?: unknown; steps?: unknown[]; startLabel?: unknown; finalLabel?: unknown };
      if (!isNum(spec?.start) || !Array.isArray(spec.steps)) return null;
      const steps = spec.steps
        .map((step) => step as { label?: unknown; kind?: unknown; remaining?: unknown; excluded?: unknown; missing?: unknown; disabled?: unknown })
        .filter((step) => isNum(step.remaining) && isNum(step.excluded))
        .map((step) => ({
          label: String(step.label ?? ""),
          kind: step.kind === "exclude" ? ("exclude" as const) : ("include" as const),
          remaining: step.remaining as number,
          excluded: step.excluded as number,
          missing: isNum(step.missing) ? step.missing : undefined,
          disabled: step.disabled === true,
        }));
      return <AttritionFlow ref={ref} title={title} start={{ label: String(spec.startLabel ?? "Dataset"), n: spec.start }} steps={steps} final={{ label: String(spec.finalLabel ?? "Final cohort") }} />;
    }
    default:
      return null;
  }
}
