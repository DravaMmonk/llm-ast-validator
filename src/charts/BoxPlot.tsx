import { forwardRef, useState } from "react";
import { Grid, YAxis, yAxisWidth } from "./Axes";
import { ChartFrame, useChartShell } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { chartColor, wash } from "./palette";
import { extent, formatValue, linearScale, niceDomain, niceTicks } from "./scales";
import { truncateText } from "./text";

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}
export interface BoxGroup {
  label: string;
  stats: BoxStats;
  outliers?: number[];
  points?: number[];
  color?: string;
}
export interface BoxPlotProps extends ChartBaseProps {
  groups: BoxGroup[];
  yLabel?: string;
}

/** Deterministic jitter in [-0.5, 0.5): golden-ratio sequence (no Math.random). */
export function jitter(i: number): number {
  const v = (i + 1) * 0.6180339887498949;
  return v - Math.floor(v) - 0.5;
}

const validStats = (s: BoxStats) => [s.min, s.q1, s.median, s.q3, s.max].every(Number.isFinite);

export const BoxPlot = forwardRef<SVGSVGElement, BoxPlotProps>(function BoxPlot(
  { title, groups, yLabel, height = 240, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const [hover, setHover] = useState<number | null>(null);
  const data = groups.filter((g) => validStats(g.stats));
  const empty = data.length === 0;

  const ext = extent(data.flatMap((g) => [g.stats.min, g.stats.max, ...(g.outliers ?? []), ...(g.points ?? [])])) ?? [0, 1];
  const [d0, d1] = niceDomain(ext[0], ext[1], 5);
  const yTicks = niceTicks(d0, d1, 5);
  const m = { top: 10, right: 8, bottom: 26, left: yAxisWidth(yTicks, formatValue, !!yLabel) };
  const ys = linearScale([d0, d1], [height - m.bottom, m.top]);
  const band = (width - m.left - m.right) / Math.max(1, data.length);
  const boxW = Math.max(6, Math.min(36, band * 0.5));

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
          setHover(null);
          tooltip.hide();
        },
      }}
    >
      <Grid yScale={ys} yTicks={yTicks} x0={m.left} x1={width - m.right} y0={m.top} y1={height - m.bottom} />
      <YAxis scale={ys} ticks={yTicks} x={m.left} label={yLabel} format={formatValue} />
      <line x1={m.left} x2={width - m.right} y1={height - m.bottom + 0.5} y2={height - m.bottom + 0.5} stroke="var(--border)" />
      {data.map((g, i) => {
        const c = g.color ?? chartColor(0);
        const s = g.stats;
        const cx = m.left + band * i + band / 2;
        const x0 = cx - boxW / 2;
        const cap = boxW * 0.4;
        const n = g.points?.length ?? 0;
        const content = (
          <TooltipBody
            header={g.label}
            rows={[
              { label: "max", value: formatValue(s.max) },
              { label: "Q3", value: formatValue(s.q3) },
              { label: "median", value: formatValue(s.median) },
              { label: "Q1", value: formatValue(s.q1) },
              { label: "min", value: formatValue(s.min) },
            ]}
            note={[n ? `${n} points` : "", g.outliers?.length ? `${g.outliers.length} outliers` : ""].filter(Boolean).join(" · ") || undefined}
          />
        );
        return (
          <g
            key={i}
            data-mark="box"
            tabIndex={0}
            aria-label={`${g.label}: median ${formatValue(s.median)}, IQR ${formatValue(s.q1)}–${formatValue(s.q3)}`}
            style={{ outline: "none" }}
            onPointerMove={(e) => {
              setHover(i);
              tooltip.showAtPointer(e, content);
            }}
            onFocus={() => {
              setHover(i);
              tooltip.showAt(cx + boxW / 2, ys(s.q3), content);
            }}
            onBlur={() => {
              setHover(null);
              tooltip.hide();
            }}
          >
            <rect x={m.left + band * i} y={m.top} width={band} height={height - m.top - m.bottom} fill={hover === i ? "var(--muted)" : "transparent"} />
            {g.points?.map((p, j) =>
              Number.isFinite(p) ? (
                <circle key={`p${j}`} cx={cx + jitter(j) * boxW * 1.4} cy={ys(p)} r={1.6} fill={c} opacity={0.3} />
              ) : null,
            )}
            <line x1={cx} x2={cx} y1={ys(s.max)} y2={ys(s.q3)} stroke="var(--fg)" />
            <line x1={cx} x2={cx} y1={ys(s.q1)} y2={ys(s.min)} stroke="var(--fg)" />
            <line x1={cx - cap / 2} x2={cx + cap / 2} y1={ys(s.max)} y2={ys(s.max)} stroke="var(--fg)" />
            <line x1={cx - cap / 2} x2={cx + cap / 2} y1={ys(s.min)} y2={ys(s.min)} stroke="var(--fg)" />
            <rect
              x={x0}
              y={ys(s.q3)}
              width={boxW}
              height={Math.max(1, ys(s.q1) - ys(s.q3))}
              rx={2}
              fill={wash(c, 18)}
              stroke={c}
              strokeWidth={1.5}
            />
            <line x1={x0} x2={x0 + boxW} y1={ys(s.median)} y2={ys(s.median)} stroke={c} strokeWidth={2.5} />
            {g.outliers?.map((o, j) =>
              Number.isFinite(o) ? (
                <circle key={`o${j}`} cx={cx} cy={ys(o)} r={2.5} fill="var(--card)" stroke={c} strokeWidth={1.25} />
              ) : null,
            )}
            <text x={cx} y={height - m.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--fg)">
              <title>{g.label}</title>
              {truncateText(g.label, band - 4, 10)}
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
});
