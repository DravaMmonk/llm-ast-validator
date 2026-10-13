import { forwardRef, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import { Grid, XAxis, YAxis, yAxisWidth } from "./Axes";
import { ChartFrame, useChartShell, useSvgId } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { Legend } from "./Legend";
import { chartColor } from "./palette";
import { extent, formatValue, linearScale, niceDomain, niceTicks } from "./scales";

export interface ScatterPoint {
  x: number;
  y: number;
  group?: string;
}
export interface ScatterPlotProps extends ChartBaseProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  fitLine?: { slope: number; intercept: number };
  /** Deterministic stride downsample above this many points (default 4000). */
  maxPoints?: number;
}

/** Evenly strided, order-preserving sample of at most `max` items. */
export function downsample<T>(items: T[], max: number): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor((i * items.length) / max)]);
  return out;
}

const HIT_RADIUS = 14;

export const ScatterPlot = forwardRef<SVGSVGElement, ScatterPlotProps>(function ScatterPlot(
  { title, points, xLabel, yLabel, fitLine, maxPoints = 4000, height = 280, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const clipId = useSvgId("scatter-clip");
  const [hover, setHover] = useState<number | null>(null);

  const finite = useMemo(() => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), [points]);
  const shown = useMemo(() => downsample(finite, maxPoints), [finite, maxPoints]);
  // Groups keep their slot by first appearance in the FULL data, so sampling never repaints a group.
  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const p of finite) if (p.group != null && !seen.includes(p.group)) seen.push(p.group);
    return seen;
  }, [finite]);
  const colorOf = (g?: string) => chartColor(g == null ? 0 : Math.max(0, groups.indexOf(g)));
  const empty = shown.length === 0;

  const xe = extent(finite.map((p) => p.x)) ?? [0, 1];
  const ye = extent(finite.map((p) => p.y)) ?? [0, 1];
  const xd = niceDomain(xe[0], xe[1], 5);
  const yd = niceDomain(ye[0], ye[1], 5);
  const yTicks = niceTicks(yd[0], yd[1], 5);
  const m = { top: 8, right: 12, bottom: 36, left: yAxisWidth(yTicks, undefined, true) };
  const xs = linearScale(xd, [m.left, Math.max(m.left + 1, width - m.right)]);
  const ys = linearScale(yd, [height - m.bottom, m.top]);
  const xTicks = niceTicks(xd[0], xd[1], Math.max(2, Math.floor((width - m.left - m.right) / 70)));
  const sampled = shown.length < finite.length;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    let best = -1;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < shown.length; i++) {
      const dx = xs(shown[i].x) - px;
      const dy = ys(shown[i].y) - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) {
      setHover(null);
      tooltip.hide();
      return;
    }
    const p = shown[best];
    setHover(best);
    tooltip.showAt(
      xs(p.x),
      ys(p.y),
      <TooltipBody
        header={p.group}
        rows={[
          { label: xLabel, value: formatValue(p.x) },
          { label: yLabel, value: formatValue(p.y) },
        ]}
      />,
    );
  };

  const hp = hover != null ? shown[hover] : null;
  const legend =
    groups.length >= 2 || fitLine ? (
      <Legend
        items={[
          ...(groups.length >= 2 ? groups.map((g, i) => ({ label: g, color: chartColor(i), shape: "dot" as const })) : []),
          ...(fitLine ? [{ label: "fit", color: "var(--fg-strong)", shape: "line" as const }] : []),
        ]}
      />
    ) : null;

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
      header={legend}
      actions={actions}
      className={className}
      footer={
        sampled ? (
          <div className="text-cap text-muted-fg">
            showing <span className="ui-mono">{shown.length.toLocaleString("en-US")}</span> of{" "}
            <span className="ui-mono">{finite.length.toLocaleString("en-US")}</span> points (even sample)
          </div>
        ) : undefined
      }
      svgProps={{
        onPointerMove: onMove,
        onPointerLeave: () => {
          setHover(null);
          tooltip.hide();
        },
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={m.left} y={m.top} width={Math.max(0, width - m.left - m.right)} height={Math.max(0, height - m.top - m.bottom)} />
        </clipPath>
      </defs>
      <Grid
        xScale={xs}
        xTicks={xTicks}
        yScale={ys}
        yTicks={yTicks}
        x0={m.left}
        x1={width - m.right}
        y0={m.top}
        y1={height - m.bottom}
      />
      <YAxis scale={ys} ticks={yTicks} x={m.left} label={yLabel} />
      <XAxis scale={xs} ticks={xTicks} y={height - m.bottom} label={xLabel} />
      <g clipPath={`url(#${clipId})`}>
        <g data-layer="points">
          {shown.map((p, i) => (
            <circle key={i} data-mark="point" cx={xs(p.x)} cy={ys(p.y)} r={3} fill={colorOf(p.group)} fillOpacity={0.55} />
          ))}
        </g>
        {fitLine && Number.isFinite(fitLine.slope) && Number.isFinite(fitLine.intercept) && (
          <line
            x1={xs(xd[0])}
            y1={ys(fitLine.intercept + fitLine.slope * xd[0])}
            x2={xs(xd[1])}
            y2={ys(fitLine.intercept + fitLine.slope * xd[1])}
            stroke="var(--fg-strong)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
        {hp && <circle cx={xs(hp.x)} cy={ys(hp.y)} r={4.5} fill={colorOf(hp.group)} stroke="var(--card)" strokeWidth={2} />}
      </g>
    </ChartFrame>
  );
});
