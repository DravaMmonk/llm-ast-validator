import { forwardRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { Grid, LABEL_FONT, TICK_FONT, XAxis, YAxis, barPath, yAxisWidth } from "./Axes";
import { ChartFrame, useChartShell } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { chartColor } from "./palette";
import { formatValue, linearScale, niceDomain, niceTicks } from "./scales";
import { estimateTextWidth, truncateText } from "./text";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  detail?: string;
}
export interface BarChartProps extends ChartBaseProps {
  data: BarDatum[];
  orientation?: "vertical" | "horizontal";
  valueFormat?: (v: number) => string;
  /** Axis tick text; defaults to the compact tick formatter. */
  tickFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
}

const MAX_THICK = 24;
const ROW = 22;

export const BarChart = forwardRef<SVGSVGElement, BarChartProps>(function BarChart(
  { title, data, orientation = "horizontal", valueFormat = formatValue, tickFormat, xLabel, yLabel, height, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.filter((d) => Number.isFinite(d.value));
  const empty = rows.length === 0;
  const horizontal = orientation === "horizontal";

  const lo = Math.min(0, ...rows.map((d) => d.value));
  const hi = Math.max(0, ...rows.map((d) => d.value));
  const [d0, d1] = lo === hi ? [0, 1] : niceDomain(lo, hi, 4);
  const valueLabelW = Math.max(0, ...rows.map((d) => estimateTextWidth(valueFormat(d.value), TICK_FONT, true))) + 8;

  const h = height ?? (horizontal ? Math.max(120, rows.length * ROW + (xLabel ? 44 : 30)) : 220);
  const fg = "var(--fg)";

  const tip = (d: BarDatum) => (
    <TooltipBody header={d.label} rows={[{ label: "value", value: valueFormat(d.value) }]} note={d.detail} />
  );
  const events = (i: number, d: BarDatum, cx: number, cy: number) => ({
    tabIndex: 0,
    role: "graphics-symbol" as const,
    "aria-label": `${d.label}: ${valueFormat(d.value)}`,
    onPointerMove: (e: PointerEvent) => {
      setHover(i);
      tooltip.showAtPointer(e, tip(d));
    },
    onFocus: () => {
      setHover(i);
      tooltip.showAt(cx, cy, tip(d));
    },
    onBlur: () => {
      setHover(null);
      tooltip.hide();
    },
  });

  let body: ReactNode = null;
  if (!empty && horizontal) {
    // Room for the widest label plus the 12px gutter the truncation reserves.
    const labelW = Math.min(Math.max(60, width * 0.35), Math.max(28, Math.max(...rows.map((d) => estimateTextWidth(d.label, 10.5))) + 16));
    const m = { top: 4, right: valueLabelW + 4, bottom: xLabel ? 40 : 24, left: labelW };
    const xs = linearScale([d0, d1], [m.left, Math.max(m.left + 1, width - m.right)]);
    const band = (h - m.top - m.bottom) / rows.length;
    const thick = Math.max(2, Math.min(MAX_THICK, band * 0.72));
    const ticks = niceTicks(d0, d1, Math.max(2, Math.min(8, Math.floor((width - m.left - m.right) / 90))));
    const zero = xs(0);
    body = (
      <>
        <Grid xScale={xs} xTicks={ticks} x0={m.left} x1={width - m.right} y0={m.top} y1={h - m.bottom} />
        {rows.map((d, i) => {
          const cy = m.top + band * i + band / 2;
          const x = Math.min(zero, xs(d.value));
          const w = Math.abs(xs(d.value) - zero);
          const neg = d.value < 0;
          const valueX = neg ? x - 4 : x + w + 4;
          return (
            <g key={i} data-mark="bar" {...events(i, d, xs(d.value), cy)} style={{ outline: "none" }}>
              <rect x={0} y={m.top + band * i} width={width} height={band} fill={hover === i ? "var(--muted)" : "transparent"} />
              <text x={m.left - 8} y={cy} textAnchor="end" dominantBaseline="middle" fontSize={10.5} fill={fg}>
                <title>{d.label}</title>
                {truncateText(d.label, labelW - 12, 10.5)}
              </text>
              <path d={barPath(x, cy - thick / 2, w, thick, 4, neg ? "left" : "right")} fill={d.color ?? chartColor(0)} />
              <text
                x={valueX}
                y={cy}
                textAnchor={neg ? "end" : "start"}
                dominantBaseline="middle"
                fontSize={TICK_FONT}
                className="ui-mono"
                fill="var(--muted-fg)"
              >
                {valueFormat(d.value)}
              </text>
            </g>
          );
        })}
        <line x1={Math.round(zero) + 0.5} x2={Math.round(zero) + 0.5} y1={m.top} y2={h - m.bottom} stroke="var(--border)" />
        <XAxis scale={xs} ticks={ticks} y={h - m.bottom} label={xLabel} baseline={false} format={tickFormat} />
        {yLabel && (
          <text x={4} y={m.top + 2} dominantBaseline="hanging" fontSize={LABEL_FONT} fill="var(--muted-fg)">
            {yLabel}
          </text>
        )}
      </>
    );
  } else if (!empty) {
    const yTicks = niceTicks(d0, d1, 4);
    const m = { top: 14, right: 8, bottom: xLabel ? 42 : 26, left: yAxisWidth(yTicks, undefined, !!yLabel) };
    const ys = linearScale([d0, d1], [h - m.bottom, m.top]);
    const band = (width - m.left - m.right) / rows.length;
    const thick = Math.max(2, Math.min(MAX_THICK, band * 0.72));
    const zero = ys(0);
    body = (
      <>
        <Grid yScale={ys} yTicks={yTicks} x0={m.left} x1={width - m.right} y0={m.top} y1={h - m.bottom} />
        <YAxis scale={ys} ticks={yTicks} x={m.left} label={yLabel} format={tickFormat} />
        {rows.map((d, i) => {
          const cx = m.left + band * i + band / 2;
          const y = Math.min(zero, ys(d.value));
          const bh = Math.abs(ys(d.value) - zero);
          const neg = d.value < 0;
          const fits = estimateTextWidth(valueFormat(d.value), TICK_FONT, true) <= band - 2;
          return (
            <g key={i} data-mark="bar" {...events(i, d, cx, ys(d.value))} style={{ outline: "none" }}>
              <rect x={m.left + band * i} y={m.top} width={band} height={h - m.top - m.bottom} fill={hover === i ? "var(--muted)" : "transparent"} />
              <path d={barPath(cx - thick / 2, y, thick, bh, 4, neg ? "down" : "up")} fill={d.color ?? chartColor(0)} />
              {fits && (
                <text
                  x={cx}
                  y={neg ? y + bh + 10 : y - 4}
                  textAnchor="middle"
                  fontSize={TICK_FONT}
                  className="ui-mono"
                  fill="var(--muted-fg)"
                >
                  {valueFormat(d.value)}
                </text>
              )}
              <text x={cx} y={h - m.bottom + 13} textAnchor="middle" fontSize={10} fill={fg}>
                <title>{d.label}</title>
                {truncateText(d.label, band - 4, 10)}
              </text>
            </g>
          );
        })}
        <line x1={m.left} x2={width - m.right} y1={Math.round(zero) + 0.5} y2={Math.round(zero) + 0.5} stroke="var(--border)" />
        {xLabel && (
          <text x={(m.left + width - m.right) / 2} y={h - 6} textAnchor="middle" fontSize={LABEL_FONT} fill="var(--muted-fg)">
            {xLabel}
          </text>
        )}
      </>
    );
  }

  return (
    <ChartFrame
      ref={ref}
      title={title}
      width={width}
      height={h}
      wrapRef={wrapRef}
      plotRef={plotRef}
      tip={tooltip.tip}
      empty={empty}
      actions={actions}
      className={className}
      svgProps={{
        onPointerLeave: () => {
          setHover(null);
          tooltip.hide();
        },
      }}
    >
      {body}
    </ChartFrame>
  );
});
