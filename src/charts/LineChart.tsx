import { forwardRef, useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Grid, XAxis, YAxis, yAxisWidth } from "./Axes";
import type { Margin } from "./Axes";
import { ChartFrame, useChartShell, useSvgId } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import type { TooltipRow } from "./ChartTooltip";
import { Legend } from "./Legend";
import { chartColor, wash } from "./palette";
import { extent, formatTick, formatValue, linearScale, niceDomain, niceTicks } from "./scales";
import { estimateTextWidth } from "./text";

export interface XY {
  x: number;
  y: number;
}
export interface BandPoint {
  x: number;
  lower: number;
  upper: number;
}
export interface LineSeries {
  label: string;
  color?: string;
  points: XY[];
  /** Post-step interpolation: the value holds until the next x (survival curves). */
  step?: boolean;
  dashed?: boolean;
  /** Confidence band, drawn as a ~12% wash (stepped when `step`). */
  band?: BandPoint[];
  /** Small vertical ticks, e.g. censoring times on a Kaplan–Meier curve. */
  marks?: XY[];
}
export interface RefLine {
  label?: string;
}
export interface LineChartProps extends ChartBaseProps {
  series: LineSeries[];
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Dashed y = x reference (ROC chance line) across the domain corners. */
  diagonal?: boolean;
  /** Emphasised point, e.g. a ROC operating point. */
  highlight?: XY & { label?: string };
  vLines?: (RefLine & { x: number })[];
  hLines?: (RefLine & { y: number })[];
  /** Defaults to true when there are ≥ 2 series. */
  legend?: boolean;
  onHoverX?: (x: number | null) => void;
  /** Override plot margins (pass the same left/right to NumberAtRiskTable to align columns). */
  margin?: Partial<Margin>;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
}

export const LINE_CHART_MARGIN: Margin = { top: 12, right: 16, bottom: 36, left: 48 };

const finitePts = (pts: XY[]) => pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);

/** Expand to the post-step polyline: each value holds until the next x. */
export function stepPoints<T extends { x: number }>(pts: T[], get: (p: T) => number): [number, number][] {
  const out: [number, number][] = [];
  pts.forEach((p, i) => {
    out.push([p.x, get(p)]);
    if (i < pts.length - 1) out.push([pts[i + 1].x, get(p)]);
  });
  return out;
}

/** Index of the last element with x <= target, or -1. Assumes ascending x. */
function lastAtOrBefore<T extends { x: number }>(pts: T[], x: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Value of a series at x: held (step) or linearly interpolated; null outside the series' range. */
export function valueAt<T extends { x: number }>(pts: T[], x: number, get: (p: T) => number, step: boolean): number | null {
  if (pts.length === 0) return null;
  const i = lastAtOrBefore(pts, x);
  if (i < 0) return null;
  if (step) return get(pts[i]);
  if (i === pts.length - 1) return pts[i].x === x ? get(pts[i]) : null;
  const a = pts[i];
  const b = pts[i + 1];
  const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
  return get(a) + t * (get(b) - get(a));
}

/** Index of the value in an ascending array nearest to x. */
export function nearestIndex(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(sorted[lo - 1] - x) <= Math.abs(sorted[lo] - x) ? lo - 1 : lo;
}

const toPath = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");

export const LineChart = forwardRef<SVGSVGElement, LineChartProps>(function LineChart(
  {
    title,
    series,
    xLabel,
    yLabel,
    xDomain,
    yDomain,
    diagonal,
    highlight,
    vLines = [],
    hLines = [],
    legend,
    onHoverX,
    margin,
    xFormat = formatTick,
    yFormat = formatTick,
    height = 260,
    actions,
    className,
  },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const clipId = useSvgId("line-clip");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const prepared = useMemo(
    () =>
      series.map((s, i) => ({
        ...s,
        color: s.color ?? chartColor(i),
        points: finitePts(s.points),
        band: (s.band ?? [])
          .filter((b) => Number.isFinite(b.x) && Number.isFinite(b.lower) && Number.isFinite(b.upper))
          .sort((a, b) => a.x - b.x),
        marks: (s.marks ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      })),
    [series],
  );
  const allX = useMemo(() => {
    const set = new Set<number>();
    for (const s of prepared) for (const p of s.points) set.add(p.x);
    return [...set].sort((a, b) => a - b);
  }, [prepared]);
  const empty = allX.length === 0;

  const xe = extent(prepared.flatMap((s) => [...s.points.map((p) => p.x), ...s.band.map((b) => b.x)])) ?? [0, 1];
  const ye = extent(prepared.flatMap((s) => [...s.points.map((p) => p.y), ...s.band.flatMap((b) => [b.lower, b.upper])])) ?? [0, 1];
  const xd = xDomain ?? niceDomain(xe[0], xe[1], 5);
  const yd = yDomain ?? niceDomain(ye[0], ye[1], 5);
  const yTicks = niceTicks(yd[0], yd[1], 5);
  const m: Margin = {
    ...LINE_CHART_MARGIN,
    left: Math.max(LINE_CHART_MARGIN.left, yAxisWidth(yTicks, yFormat, true)),
    ...margin,
  };
  const x1 = Math.max(m.left + 1, width - m.right);
  const y1 = height - m.bottom;
  const xs = linearScale(xd, [m.left, x1]);
  const ys = linearScale(yd, [y1, m.top]);
  const xTicks = niceTicks(xd[0], xd[1], Math.max(2, Math.floor((x1 - m.left) / 70)));
  const showLegend = legend ?? prepared.length >= 2;

  const setIdx = (i: number | null) => {
    setHoverIdx(i);
    onHoverX?.(i == null ? null : allX[i]);
    if (i == null) {
      tooltip.hide();
      return;
    }
    const x = allX[i];
    const rows: TooltipRow[] = [];
    for (const s of prepared) {
      const v = valueAt(s.points, x, (p) => p.y, !!s.step);
      if (v == null) continue;
      const lo = valueAt(s.band, x, (b) => b.lower, !!s.step);
      const hi = valueAt(s.band, x, (b) => b.upper, !!s.step);
      const ci = lo != null && hi != null ? ` (${formatValue(lo, 3)}–${formatValue(hi, 3)})` : "";
      rows.push({ label: s.label, value: `${formatValue(v, 3)}${ci}`, color: s.color, dashed: s.dashed });
    }
    tooltip.showAt(xs(x), m.top + 4, <TooltipBody header={`${xLabel} ${formatValue(x)}`} rows={rows} />);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    if (px < m.left - 8 || px > x1 + 8 || allX.length === 0) return setIdx(null);
    const x = xs.invert(px);
    const i = nearestIndex(allX, x);
    if (i !== hoverIdx) setIdx(i);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (allX.length === 0) return;
    const cur = hoverIdx ?? -1;
    if (e.key === "ArrowRight") setIdx(Math.min(allX.length - 1, cur + 1));
    else if (e.key === "ArrowLeft") setIdx(Math.max(0, cur < 0 ? 0 : cur - 1));
    else if (e.key === "Home") setIdx(0);
    else if (e.key === "End") setIdx(allX.length - 1);
    else if (e.key === "Escape") setIdx(null);
    else return;
    e.preventDefault();
  };

  const hx = hoverIdx != null ? allX[hoverIdx] : null;

  return (
    <ChartFrame
      ref={ref}
      title={title}
      width={width}
      height={height}
      wrapRef={wrapRef}
      plotRef={plotRef}
      tip={tooltip.tip}
      empty={empty}
      header={showLegend ? <Legend items={prepared.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed, shape: "line" }))} /> : null}
      actions={actions}
      className={className}
      svgProps={{
        tabIndex: 0,
        onPointerMove: onMove,
        onPointerLeave: () => setIdx(null),
        onKeyDown: onKey,
        onBlur: () => setIdx(null),
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={m.left} y={m.top - 2} width={Math.max(0, x1 - m.left)} height={Math.max(0, y1 - m.top + 4)} />
        </clipPath>
      </defs>
      <Grid xScale={xs} xTicks={xTicks} yScale={ys} yTicks={yTicks} x0={m.left} x1={x1} y0={m.top} y1={y1} />
      <YAxis scale={ys} ticks={yTicks} x={m.left} label={yLabel} format={yFormat} />
      <XAxis scale={xs} ticks={xTicks} y={y1} label={xLabel} format={xFormat} />
      <g clipPath={`url(#${clipId})`}>
        {diagonal && (
          <line
            x1={xs(xd[0])}
            y1={ys(yd[0])}
            x2={xs(xd[1])}
            y2={ys(yd[1])}
            stroke="var(--muted-fg)"
            strokeOpacity={0.6}
            strokeDasharray="4 4"
          />
        )}
        {hLines.map((l, i) => (
          <line key={`h${i}`} x1={m.left} x2={x1} y1={ys(l.y)} y2={ys(l.y)} stroke="var(--muted-fg)" strokeDasharray="3 3" />
        ))}
        {vLines.map((l, i) => (
          <line key={`v${i}`} x1={xs(l.x)} x2={xs(l.x)} y1={m.top} y2={y1} stroke="var(--muted-fg)" strokeDasharray="3 3" />
        ))}
        {prepared.map((s, i) =>
          s.band.length > 1 ? (
            <path
              key={`b${i}`}
              d={
                toPath([
                  ...(s.step ? stepPoints(s.band, (b) => b.upper) : s.band.map((b): [number, number] => [b.x, b.upper])),
                  ...(s.step ? stepPoints(s.band, (b) => b.lower) : s.band.map((b): [number, number] => [b.x, b.lower])).reverse(),
                ].map(([x, y]): [number, number] => [xs(x), ys(y)])) + "Z"
              }
              fill={wash(s.color, 12)}
              stroke="none"
            />
          ) : null,
        )}
        {prepared.map((s, i) => (
          <g key={`s${i}`} data-mark="series">
            <path
              d={toPath(
                (s.step ? stepPoints(s.points, (p) => p.y) : s.points.map((p): [number, number] => [p.x, p.y])).map(
                  ([x, y]): [number, number] => [xs(x), ys(y)],
                ),
              )}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
            {s.points.length === 1 && <circle cx={xs(s.points[0].x)} cy={ys(s.points[0].y)} r={3} fill={s.color} />}
            {s.marks.map((p, j) => (
              <line key={j} x1={xs(p.x)} x2={xs(p.x)} y1={ys(p.y) - 4} y2={ys(p.y) + 4} stroke={s.color} strokeWidth={1.25} />
            ))}
          </g>
        ))}
      </g>
      {vLines.map((l, i) =>
        l.label ? (
          <text key={`vl${i}`} x={xs(l.x) + 3} y={m.top + 8} fontSize={9.5} fill="var(--muted-fg)">
            {l.label}
          </text>
        ) : null,
      )}
      {hLines.map((l, i) =>
        l.label ? (
          <text key={`hl${i}`} x={x1 - 3} y={ys(l.y) - 4} textAnchor="end" fontSize={9.5} fill="var(--muted-fg)">
            {l.label}
          </text>
        ) : null,
      )}
      {highlight && Number.isFinite(highlight.x) && Number.isFinite(highlight.y) && (
        <g data-mark="highlight">
          <circle cx={xs(highlight.x)} cy={ys(highlight.y)} r={4.5} fill="var(--fg-strong)" stroke="var(--card)" strokeWidth={2} />
          {highlight.label &&
            (() => {
              const w = estimateTextWidth(highlight.label, 10);
              const right = xs(highlight.x) + 8 + w < x1;
              return (
                <text
                  x={xs(highlight.x) + (right ? 8 : -8)}
                  y={ys(highlight.y) + (ys(highlight.y) < m.top + 12 ? 12 : -6)}
                  textAnchor={right ? "start" : "end"}
                  fontSize={10}
                  fill="var(--fg)"
                >
                  {highlight.label}
                </text>
              );
            })()}
        </g>
      )}
      {hx != null && (
        <g pointerEvents="none" data-layer="crosshair">
          <line x1={xs(hx) + 0.5} x2={xs(hx) + 0.5} y1={m.top} y2={y1} stroke="var(--muted-fg)" strokeOpacity={0.6} />
          {prepared.map((s, i) => {
            const v = valueAt(s.points, hx, (p) => p.y, !!s.step);
            return v == null ? null : (
              <circle key={i} cx={xs(hx)} cy={ys(v)} r={3.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
            );
          })}
        </g>
      )}
    </ChartFrame>
  );
});
