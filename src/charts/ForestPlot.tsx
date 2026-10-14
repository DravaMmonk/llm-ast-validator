import { forwardRef, useState } from "react";
import { Grid, XAxis } from "./Axes";
import { ChartFrame, useChartShell } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { chartColor } from "./palette";
import {
  extent,
  formatP,
  formatValue,
  linearScale,
  logScale,
  logTicks,
  niceDomain,
  niceLogDomain,
  niceTicks,
} from "./scales";
import { estimateTextWidth, truncateText } from "./text";

export interface ForestRow {
  label: string;
  estimate: number;
  lower: number;
  upper: number;
  /** Right-column text, e.g. "1.82 (1.20–2.75)". */
  detail?: string;
  p?: number | null;
}
export interface ForestPlotProps extends ChartBaseProps {
  rows: ForestRow[];
  /** Reference line (no effect). Default 1. */
  nullValue?: number;
  /** Log x axis (ratios). Default true. */
  log?: boolean;
  xLabel?: string;
}

const ROW_H = 24;
const HEADER_H = 20;
/** How far bounds may extend past the estimates before being clamped (×/÷ on log, × span on linear). */
const LOG_REACH = 20;
const LIN_REACH = 3;

export const ForestPlot = forwardRef<SVGSVGElement, ForestPlotProps>(function ForestPlot(
  { title, rows, nullValue = 1, log = true, xLabel, height, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const [hover, setHover] = useState<number | null>(null);
  const empty = rows.length === 0;

  const ok = (v: number) => Number.isFinite(v) && (!log || v > 0);
  const core = extent([...rows.map((r) => r.estimate).filter(ok), ...(ok(nullValue) ? [nullValue] : [])]) ?? (log ? [0.5, 2] : [-1, 1]);
  const bounds = extent([...rows.flatMap((r) => [r.lower, r.upper]).filter(ok), core[0], core[1]]) ?? core;
  let domain: [number, number];
  if (log) {
    domain = niceLogDomain(Math.max(bounds[0], core[0] / LOG_REACH), Math.min(bounds[1], core[1] * LOG_REACH));
  } else {
    const span = core[1] - core[0] || Math.abs(core[0]) || 1;
    domain = niceDomain(Math.max(bounds[0], core[0] - LIN_REACH * span), Math.min(bounds[1], core[1] + LIN_REACH * span), 5);
  }

  const hasDetail = rows.some((r) => r.detail);
  const hasP = rows.some((r) => r.p != null);
  const pW = hasP ? 44 : 0;
  let labelW = Math.min(width * 0.32, 240, Math.max(60, ...rows.map((r) => estimateTextWidth(r.label, 11) + 12)));
  let detailW = hasDetail ? Math.max(96, ...rows.map((r) => estimateTextWidth(r.detail ?? "", 9.5, true))) + 14 : 0;
  // Keep at least 40% of the width for the plot: shrink the label column, then the detail column.
  let deficit = width * 0.4 - (width - labelW - detailW - pW - 18);
  if (deficit > 0) {
    const cut = Math.min(deficit, Math.max(0, labelW - Math.max(64, width * 0.22)));
    labelW -= cut;
    deficit -= cut;
  }
  if (deficit > 0 && hasDetail) detailW = Math.max(64, detailW - deficit);
  const top = hasDetail || hasP ? HEADER_H : 6;
  const plotX0 = labelW + 8;
  const plotX1 = Math.max(plotX0 + 40, width - detailW - pW - 10);
  const bottomAxis = top + rows.length * ROW_H;
  const h = height ?? bottomAxis + (xLabel ? 40 : 26);
  const xs = log ? logScale(domain, [plotX0, plotX1]) : linearScale(domain, [plotX0, plotX1]);
  const ticks = (log ? logTicks(domain[0], domain[1]) : niceTicks(domain[0], domain[1], 5)).slice();
  if (ok(nullValue) && nullValue >= domain[0] && nullValue <= domain[1] && !ticks.includes(nullValue)) {
    ticks.push(nullValue);
    ticks.sort((a, b) => a - b);
  }
  const color = chartColor(0);

  const rowTip = (r: ForestRow) => (
    <TooltipBody
      header={r.label}
      rows={[
        { label: "estimate", value: formatValue(r.estimate, 3) },
        { label: "95% CI", value: `${formatValue(r.lower, 3)} – ${formatValue(r.upper, 3)}` },
        ...(r.p != null ? [{ label: "p", value: formatP(r.p) }] : []),
      ]}
    />
  );

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
      {(hasDetail || hasP) && (
        <g aria-hidden fontSize={9} fill="var(--muted-fg)" style={{ letterSpacing: "0.06em" }}>
          {hasDetail && (
            <text x={plotX1 + 10} y={12} fontWeight={600}>
              ESTIMATE (95% CI)
            </text>
          )}
          {hasP && (
            <text x={width - 4} y={12} textAnchor="end" fontWeight={600}>
              P
            </text>
          )}
        </g>
      )}
      <Grid xScale={xs} xTicks={ticks} x0={plotX0} x1={plotX1} y0={top} y1={bottomAxis} />
      {ok(nullValue) && nullValue >= domain[0] && nullValue <= domain[1] && (
        <line
          x1={Math.round(xs(nullValue)) + 0.5}
          x2={Math.round(xs(nullValue)) + 0.5}
          y1={top}
          y2={bottomAxis}
          stroke="var(--muted-fg)"
          strokeDasharray="4 3"
        />
      )}
      {rows.map((r, i) => {
        const cy = top + i * ROW_H + ROW_H / 2;
        const validEst = ok(r.estimate);
        const loRaw = ok(r.lower) ? r.lower : -Infinity;
        const hiRaw = ok(r.upper) ? r.upper : Infinity;
        const clipLo = loRaw < domain[0];
        const clipHi = hiRaw > domain[1];
        const xl = xs(Math.max(domain[0], Math.min(domain[1], loRaw)));
        const xr = xs(Math.min(domain[1], Math.max(domain[0], hiRaw)));
        const hasCI = Number.isFinite(r.lower) || Number.isFinite(r.upper);
        const xe = validEst ? xs(r.estimate) : null;
        const sig = r.p != null && r.p < 0.05;
        const shownDetail = truncateText(r.detail ?? "", detailW - 14, 9.5, true);
        return (
          <g
            key={i}
            data-mark="forest-row"
            tabIndex={0}
            aria-label={`${r.label}: ${r.detail ?? `${formatValue(r.estimate, 3)} (${formatValue(r.lower, 3)}–${formatValue(r.upper, 3)})`}${r.p != null ? `, p ${formatP(r.p)}` : ""}`}
            style={{ outline: "none" }}
            onPointerMove={(e) => {
              setHover(i);
              tooltip.showAtPointer(e, rowTip(r));
            }}
            onFocus={() => {
              setHover(i);
              tooltip.showAt(xe ?? plotX0, cy, rowTip(r));
            }}
            onBlur={() => {
              setHover(null);
              tooltip.hide();
            }}
          >
            <rect x={0} y={cy - ROW_H / 2} width={width} height={ROW_H} rx={3} fill={hover === i ? "var(--muted)" : "transparent"} />
            <text x={0} y={cy} dominantBaseline="middle" fontSize={11} fill="var(--fg)">
              <title>{r.label}</title>
              {truncateText(r.label, labelW - 8, 11)}
            </text>
            {hasCI && validEst && (
              <>
                <line x1={xl} x2={xr} y1={cy} y2={cy} stroke="var(--fg)" strokeWidth={1.5} />
                {clipLo ? (
                  <path d={`M${xl},${cy}l6,-3.5v7z`} fill="var(--fg)" data-clip="lower" />
                ) : (
                  <line x1={xl} x2={xl} y1={cy - 3} y2={cy + 3} stroke="var(--fg)" />
                )}
                {clipHi ? (
                  <path d={`M${xr},${cy}l-6,-3.5v7z`} fill="var(--fg)" data-clip="upper" />
                ) : (
                  <line x1={xr} x2={xr} y1={cy - 3} y2={cy + 3} stroke="var(--fg)" />
                )}
              </>
            )}
            {xe != null && <rect x={xe - 4} y={cy - 4} width={8} height={8} fill={color} stroke="var(--card)" strokeWidth={1} />}
            {hasDetail && (
              <text x={plotX1 + 10} y={cy} dominantBaseline="middle" fontSize={9.5} className="ui-mono" fill="var(--fg)">
                {shownDetail !== r.detail && <title>{r.detail}</title>}
                {shownDetail}
              </text>
            )}
            {hasP && (
              <text
                x={width - 4}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9.5}
                className="ui-mono"
                fill={sig ? "var(--fg-strong)" : "var(--muted-fg)"}
                fontWeight={sig ? 600 : 400}
              >
                {formatP(r.p)}
              </text>
            )}
          </g>
        );
      })}
      <XAxis scale={xs} ticks={ticks} y={bottomAxis} label={xLabel} labelOffset={30} />
    </ChartFrame>
  );
});
