import { LINE_CHART_MARGIN } from "./LineChart";
import { chartColor } from "./palette";
import { useElementWidth } from "./useElementWidth";

export interface NumberAtRiskGroup {
  label: string;
  color?: string;
  /** One count per entry in `times`. */
  counts: number[];
}
export interface NumberAtRiskTableProps {
  times: number[];
  groups: NumberAtRiskGroup[];
  /**
   * The KM chart's x domain. When given, counts are positioned on the same
   * x scale as the chart above (use the same `inset` as the chart's margin).
   * Without it, times are spaced evenly.
   */
  xDomain?: [number, number];
  /** Plot insets of the chart above; defaults to LineChart's default margin. */
  inset?: { left: number; right: number };
  title?: string;
  className?: string;
}

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");

/** "Number at risk" rows aligned under a Kaplan–Meier chart. */
export function NumberAtRiskTable({
  times,
  groups,
  xDomain,
  inset = { left: LINE_CHART_MARGIN.left, right: LINE_CHART_MARGIN.right },
  title = "Number at risk",
  className = "",
}: NumberAtRiskTableProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const plotW = Math.max(1, width - inset.left - inset.right);
  const xAt = (t: number, i: number) => {
    if (xDomain && xDomain[1] !== xDomain[0]) return inset.left + ((t - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
    return inset.left + (times.length <= 1 ? plotW / 2 : (i / (times.length - 1)) * plotW);
  };

  return (
    <div ref={ref} className={`w-full min-w-0 ${className}`}>
      {/* The visible heading sits outside the table role: ARIA tables may not own a caption div. */}
      <div className="text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg" aria-hidden>
        {title}
      </div>
      {times.length === 0 || groups.length === 0 ? (
        <div className="text-ui text-muted-fg">No data</div>
      ) : (
        <div role="table" aria-label={title}>
        <div role="rowgroup">
          <div role="row" className="sr-only">
            <span role="columnheader">Group</span>
            {times.map((t, i) => (
              <span role="columnheader" key={i}>
                {`t = ${t}`}
              </span>
            ))}
          </div>
          {groups.map((g, gi) => (
            <div key={gi} role="row" className="relative h-4" style={{ width }}>
              <span
                role="rowheader"
                className="absolute left-0 top-0 flex h-4 items-center gap-1 overflow-hidden text-cap text-muted-fg"
                style={{ width: Math.max(0, inset.left - 6) }}
                title={g.label}
              >
                <span className="h-[2px] w-2 flex-none rounded-full" style={{ background: g.color ?? chartColor(gi) }} />
                <span className="truncate">{g.label}</span>
              </span>
              {times.map((t, i) => (
                <span
                  key={i}
                  role="cell"
                  className="ui-mono absolute top-0 -translate-x-1/2 text-fine leading-4 text-fg"
                  style={{ left: xAt(t, i) }}
                >
                  {fmt(g.counts[i])}
                </span>
              ))}
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
