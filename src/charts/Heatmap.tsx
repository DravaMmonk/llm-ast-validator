import { forwardRef, useState } from "react";
import { ChartFrame, useChartShell, useSvgId } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { divergingColor, divergingInk } from "./palette";
import { clamp, formatValue } from "./scales";
import { estimateTextWidth, truncateText } from "./text";

export interface HeatmapProps extends ChartBaseProps {
  rows: string[];
  cols: string[];
  values: (number | null)[][];
  /** Diverging domain; midpoint is neutral. Default [-1, 1]. */
  domain?: [number, number];
  format?: (v: number) => string;
  onCellClick?: (row: number, col: number) => void;
}

const LABEL = 10;
const MAX_CELL = 44;
const SCALE_H = 30;

const defaultFormat = (v: number) => v.toFixed(2).replace(/^(-?)0\./, "$1.");

export const Heatmap = forwardRef<SVGSVGElement, HeatmapProps>(function Heatmap(
  { title, rows, cols, values, domain = [-1, 1], format = defaultFormat, onCellClick, height, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const hatchId = useSvgId("heat-hatch");
  const gradId = useSvgId("heat-grad");
  const [hover, setHover] = useState<[number, number] | null>(null);
  const empty = rows.length === 0 || cols.length === 0;

  const rowLabelW = Math.min(width * 0.3, Math.max(0, ...rows.map((r) => estimateTextWidth(r, LABEL))) + 8);
  const colLabelLen = Math.min(110, Math.max(0, ...cols.map((c) => estimateTextWidth(c, LABEL))));
  const top = Math.ceil(colLabelLen * 0.71) + 10;
  const left = Math.ceil(rowLabelW);
  const availW = width - left - 8 - colLabelLen * 0.71;
  let cell = clamp(Math.floor(availW / Math.max(1, cols.length)), 4, MAX_CELL);
  if (height) cell = Math.max(4, Math.min(cell, Math.floor((height - top - SCALE_H - 8) / Math.max(1, rows.length))));
  const gap = cell >= 14 ? 2 : 1;
  const gridH = cell * rows.length;
  const h = height ?? top + gridH + SCALE_H + 8;
  const [lo, hi] = domain[0] === domain[1] ? [domain[0] - 1, domain[1] + 1] : domain;
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  const tOf = (v: number) => clamp((v - mid) / half, -1, 1);

  const showText = (s: string) => cell >= 22 && estimateTextWidth(s, 9, true) <= cell - 4;

  const cellTip = (r: number, c: number) => {
    const v = values[r]?.[c];
    return (
      <TooltipBody
        header={`${rows[r]} × ${cols[c]}`}
        rows={[{ label: "value", value: v == null || !Number.isFinite(v) ? "missing" : formatValue(v, 3) }]}
      />
    );
  };

  const hasMissing = rows.some((_, i) => cols.some((__, j) => values[i]?.[j] == null || !Number.isFinite(values[i]?.[j] as number)));
  const scaleY = top + gridH + 12;
  const scaleW = Math.min(180, Math.max(80, cols.length * cell));

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
      <defs>
        <pattern id={hatchId} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={4} height={4} fill="var(--muted)" />
          <line x1={0} y1={0} x2={0} y2={4} stroke="var(--muted-fg)" strokeOpacity={0.45} strokeWidth={1.25} />
        </pattern>
        <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--chart-div-neg)" />
          <stop offset="50%" stopColor="var(--chart-div-mid)" />
          <stop offset="100%" stopColor="var(--chart-div-pos)" />
        </linearGradient>
      </defs>
      {cols.map((c, j) => {
        const x = left + j * cell + cell / 2;
        return (
          <text
            key={`c${j}`}
            transform={`translate(${x},${top - 6}) rotate(-45)`}
            fontSize={LABEL}
            fill={hover?.[1] === j ? "var(--fg-strong)" : "var(--muted-fg)"}
          >
            <title>{c}</title>
            {truncateText(c, 110, LABEL)}
          </text>
        );
      })}
      {rows.map((r, i) => (
        <text
          key={`r${i}`}
          x={left - 6}
          y={top + i * cell + cell / 2}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={LABEL}
          fill={hover?.[0] === i ? "var(--fg-strong)" : "var(--muted-fg)"}
        >
          <title>{r}</title>
          {truncateText(r, rowLabelW - 8, LABEL)}
        </text>
      ))}
      {rows.map((_, i) =>
        cols.map((__, j) => {
          const raw = values[i]?.[j];
          const v = raw == null || !Number.isFinite(raw) ? null : raw;
          const x = left + j * cell;
          const y = top + i * cell;
          const t = v == null ? 0 : tOf(v);
          const label = v == null ? "" : format(v);
          const isHover = hover?.[0] === i && hover?.[1] === j;
          return (
            <g
              key={`${i}-${j}`}
              data-mark="cell"
              tabIndex={onCellClick ? 0 : undefined}
              role={onCellClick ? "button" : undefined}
              aria-label={onCellClick ? `${rows[i]} × ${cols[j]}: ${v == null ? "missing" : label}` : undefined}
              style={{ cursor: onCellClick ? "pointer" : undefined, outline: "none" }}
              onPointerMove={(e) => {
                setHover([i, j]);
                tooltip.showAtPointer(e, cellTip(i, j));
              }}
              onFocus={() => {
                setHover([i, j]);
                tooltip.showAt(x + cell, y + cell, cellTip(i, j));
              }}
              onBlur={() => {
                setHover(null);
                tooltip.hide();
              }}
              onClick={onCellClick ? () => onCellClick(i, j) : undefined}
              onKeyDown={
                onCellClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onCellClick(i, j);
                      }
                    }
                  : undefined
              }
            >
              <rect
                x={x + gap / 2}
                y={y + gap / 2}
                width={Math.max(1, cell - gap)}
                height={Math.max(1, cell - gap)}
                rx={cell >= 14 ? 2 : 0}
                style={{ fill: v == null ? `url(#${hatchId})` : divergingColor(t) }}
                stroke={isHover ? "var(--fg-strong)" : "none"}
                strokeWidth={isHover ? 1.5 : 0}
              />
              {v != null && showText(label) && (
                <text
                  x={x + cell / 2}
                  y={y + cell / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={9}
                  className="ui-mono"
                  fill={divergingInk(t)}
                  pointerEvents="none"
                >
                  {label}
                </text>
              )}
            </g>
          );
        }),
      )}
      <g aria-hidden>
        <rect x={left} y={scaleY} width={scaleW} height={6} rx={3} fill={`url(#${gradId})`} />
        {[lo, mid, hi].map((v, k) => (
          <text
            key={k}
            x={left + (scaleW * k) / 2}
            y={scaleY + 17}
            textAnchor={k === 0 ? "start" : k === 1 ? "middle" : "end"}
            fontSize={9.5}
            className="ui-mono"
            fill="var(--muted-fg)"
          >
            {format(v)}
          </text>
        ))}
        {hasMissing && (
          <>
            <rect x={left + scaleW + 14} y={scaleY - 1} width={8} height={8} rx={1.5} fill={`url(#${hatchId})`} />
            <text x={left + scaleW + 26} y={scaleY + 6} fontSize={9.5} fill="var(--muted-fg)">
              missing
            </text>
          </>
        )}
      </g>
    </ChartFrame>
  );
});
