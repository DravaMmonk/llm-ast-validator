import { forwardRef, useMemo, useState } from "react";
import { Grid, XAxis, YAxis, barPath, yAxisWidth } from "./Axes";
import { ChartFrame, useChartShell } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { chartColor } from "./palette";
import { extent, formatTick, formatValue, linearScale, niceDomain, niceTicks } from "./scales";
import { estimateTextWidth } from "./text";

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}
export interface HistogramMarker {
  x: number;
  label: string;
  color?: string;
}
export interface HistogramProps extends ChartBaseProps {
  bins: HistogramBin[];
  xLabel?: string;
  color?: string;
  markers?: HistogramMarker[];
}

const MARKER_ROW = 12;

export const Histogram = forwardRef<SVGSVGElement, HistogramProps>(function Histogram(
  { title, bins, xLabel, color = chartColor(0), markers = [], height = 200, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(
    () => bins.filter((b) => Number.isFinite(b.x0) && Number.isFinite(b.x1) && Number.isFinite(b.count)).sort((a, b) => a.x0 - b.x0),
    [bins],
  );
  const empty = data.length === 0;

  const xExt = extent([...data.flatMap((b) => [b.x0, b.x1]), ...markers.map((m) => m.x)]) ?? [0, 1];
  const maxCount = Math.max(0, ...data.map((b) => b.count));
  const [, yMax] = niceDomain(0, maxCount || 1, 4);
  const yTicks = niceTicks(0, yMax, 4);
  const markerRows = layoutMarkerRows(markers, xExt, width);
  const m = {
    top: 8 + (markers.length ? (Math.max(...markerRows, 0) + 1) * MARKER_ROW : 0),
    right: 12,
    bottom: xLabel ? 36 : 22,
    left: yAxisWidth(yTicks),
  };
  const xs = linearScale(xExt, [m.left, Math.max(m.left + 1, width - m.right)]);
  const ys = linearScale([0, yMax], [height - m.bottom, m.top]);
  const xTicks = niceTicks(xExt[0], xExt[1], Math.max(2, Math.floor((width - m.left - m.right) / 70)));
  const plotH = height - m.bottom - m.top;

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
      actions={actions}
      className={className}
      svgProps={{
        onPointerLeave: () => {
          tooltip.hide();
          setHover(null);
        },
      }}
    >
      <Grid yScale={ys} yTicks={yTicks} x0={m.left} x1={width - m.right} y0={m.top} y1={height - m.bottom} />
      <YAxis scale={ys} ticks={yTicks} x={m.left} />
      {data.map((b, i) => {
        const x = xs(b.x0) + 0.5;
        const w = Math.max(0, xs(b.x1) - xs(b.x0) - 1);
        const y = ys(b.count);
        const h = Math.max(0, height - m.bottom - y);
        const content = (
          <TooltipBody header={`${formatValue(b.x0)} – ${formatValue(b.x1)}`} rows={[{ label: "count", value: formatValue(b.count) }]} />
        );
        return (
          <g key={i} data-mark="bar">
            <path d={barPath(x, y, w, h, Math.min(2, w / 4), "up")} fill={color} opacity={hover === null || hover === i ? 1 : 0.7} />
            <rect
              x={x - 0.5}
              y={m.top}
              width={w + 1}
              height={plotH}
              fill="transparent"
              onPointerMove={(e) => {
                setHover(i);
                tooltip.showAtPointer(e, content);
              }}
            />
          </g>
        );
      })}
      <XAxis scale={xs} ticks={xTicks} y={height - m.bottom} label={xLabel} format={formatTick} />
      {markers.map((mk, i) => {
        const x = Math.round(xs(mk.x)) + 0.5;
        const ly = m.top - 4 - markerRows[i] * MARKER_ROW;
        return (
          <line
            key={`ml${i}`}
            data-mark="marker"
            pointerEvents="none"
            x1={x}
            x2={x}
            y1={ly + 2}
            y2={height - m.bottom}
            stroke={mk.color ?? "var(--fg)"}
            strokeDasharray="3 3"
          />
        );
      })}
      {markers.map((mk, i) => {
        const x = Math.round(xs(mk.x)) + 0.5;
        const ly = m.top - 4 - markerRows[i] * MARKER_ROW;
        const nearRight = x > width - m.right - 60;
        return (
          <text
            key={`mt${i}`}
            pointerEvents="none"
            x={nearRight ? x - 3 : x + 3}
            y={ly}
            textAnchor={nearRight ? "end" : "start"}
            fontSize={10}
            fill="var(--fg)"
            stroke="var(--card)"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {mk.label}
          </text>
        );
      })}
    </ChartFrame>
  );
});

/** Stack marker labels into rows so neighbours never overlap. */
function layoutMarkerRows(markers: HistogramMarker[], dom: [number, number], width: number): number[] {
  const span = dom[1] - dom[0] || 1;
  const rowsRight: number[] = [];
  const order = markers.map((mk, i) => ({ i, px: ((mk.x - dom[0]) / span) * width })).sort((a, b) => a.px - b.px);
  const out = markers.map(() => 0);
  for (const o of order) {
    const w = estimateTextWidth(markers[o.i].label, 10) + 8;
    let row = rowsRight.findIndex((r) => r < o.px);
    if (row === -1) row = rowsRight.length;
    rowsRight[row] = o.px + w;
    out[o.i] = Math.min(row, 2);
  }
  return out;
}
