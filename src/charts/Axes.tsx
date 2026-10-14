/*
 * Shared axis + grid rendering. Recessive by design: hairline solid grid in
 * --grid, baseline in --border, tick numerals JetBrains Mono 9.5px in
 * --muted-fg, axis titles 10.5px.
 */
import { formatTick } from "./scales";
import { estimateTextWidth, truncateText } from "./text";

export const TICK_FONT = 9.5;
export const LABEL_FONT = 10.5;
export const TICK_FILL = "var(--muted-fg)";

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type Pos = (v: number) => number;

/** Drop labels that would overlap their neighbours (keeps first & evenly spaced). */
function thinByWidth(ticks: number[], pos: Pos, labels: string[], gap = 6): boolean[] {
  const keep = ticks.map(() => true);
  let lastRight = -Infinity;
  ticks.forEach((t, i) => {
    const w = estimateTextWidth(labels[i], TICK_FONT, true);
    const left = pos(t) - w / 2;
    if (left < lastRight + gap) keep[i] = false;
    else lastRight = left + w;
  });
  return keep;
}

export function XAxis({
  scale,
  ticks,
  y,
  format = formatTick,
  label,
  labelOffset = 30,
  baseline = true,
}: {
  scale: Pos & { range: [number, number] };
  ticks: number[];
  y: number;
  format?: (v: number) => string;
  label?: string;
  labelOffset?: number;
  baseline?: boolean;
}) {
  const [r0, r1] = scale.range;
  const labels = ticks.map(format);
  const keep = thinByWidth(ticks, scale, labels);
  const mid = (r0 + r1) / 2;
  return (
    <g aria-hidden>
      {baseline && <line x1={Math.min(r0, r1)} x2={Math.max(r0, r1)} y1={y + 0.5} y2={y + 0.5} stroke="var(--border)" />}
      {ticks.map((t, i) => {
        const x = Math.round(scale(t)) + 0.5;
        return (
          <g key={`${t}-${i}`}>
            <line x1={x} x2={x} y1={y} y2={y + 4} stroke="var(--border)" />
            {keep[i] && (
              <text x={x} y={y + 14} textAnchor="middle" fontSize={TICK_FONT} className="ui-mono" fill={TICK_FILL}>
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
      {label && (
        <text x={mid} y={y + labelOffset} textAnchor="middle" fontSize={LABEL_FONT} fill={TICK_FILL}>
          {truncateText(label, Math.abs(r1 - r0), LABEL_FONT)}
        </text>
      )}
    </g>
  );
}

export function YAxis({
  scale,
  ticks,
  x,
  format = formatTick,
  label,
  labelOffset,
}: {
  scale: Pos & { range: [number, number] };
  ticks: number[];
  x: number;
  format?: (v: number) => string;
  label?: string;
  /** Distance from the axis to the rotated title; defaults to fit the widest tick. */
  labelOffset?: number;
}) {
  const [r0, r1] = scale.range;
  const labels = ticks.map(format);
  const widest = Math.max(0, ...labels.map((l) => estimateTextWidth(l, TICK_FONT, true)));
  const off = labelOffset ?? widest + 14;
  const mid = (r0 + r1) / 2;
  let lastY = Infinity;
  return (
    <g aria-hidden>
      {ticks.map((t, i) => {
        const yy = scale(t);
        if (Math.abs(lastY - yy) < TICK_FONT + 2) return null;
        lastY = yy;
        return (
          <text
            key={`${t}-${i}`}
            x={x - 6}
            y={yy}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={TICK_FONT}
            className="ui-mono"
            fill={TICK_FILL}
          >
            {labels[i]}
          </text>
        );
      })}
      {label && (
        <text
          transform={`translate(${x - off},${mid}) rotate(-90)`}
          textAnchor="middle"
          fontSize={LABEL_FONT}
          fill={TICK_FILL}
        >
          {truncateText(label, Math.abs(r1 - r0), LABEL_FONT)}
        </text>
      )}
    </g>
  );
}

/** Hairline grid. Pass x ticks for vertical lines, y ticks for horizontal. */
export function Grid({
  xScale,
  xTicks = [],
  yScale,
  yTicks = [],
  x0,
  x1,
  y0,
  y1,
}: {
  xScale?: Pos;
  xTicks?: number[];
  yScale?: Pos;
  yTicks?: number[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}) {
  return (
    <g aria-hidden>
      {yScale &&
        yTicks.map((t, i) => {
          const y = Math.round(yScale(t)) + 0.5;
          return <line key={`y${i}`} x1={x0} x2={x1} y1={y} y2={y} stroke="var(--grid)" />;
        })}
      {xScale &&
        xTicks.map((t, i) => {
          const x = Math.round(xScale(t)) + 0.5;
          return <line key={`x${i}`} x1={x} x2={x} y1={y0} y2={y1} stroke="var(--grid)" />;
        })}
    </g>
  );
}

/** Left margin wide enough for y tick labels (+ rotated title when present). */
export function yAxisWidth(ticks: number[], format: (v: number) => string = formatTick, hasLabel = false): number {
  const widest = Math.max(0, ...ticks.map((t) => estimateTextWidth(format(t), TICK_FONT, true)));
  return Math.ceil(widest + 10 + (hasLabel ? 16 : 0));
}

/**
 * Path for a bar with a rounded data end and a square baseline end.
 * `dir`: which side is the data end.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number, dir: "up" | "down" | "right" | "left"): string {
  if (w <= 0 || h <= 0) return "";
  const rr = Math.max(0, Math.min(r, dir === "up" || dir === "down" ? w / 2 : h / 2, dir === "up" || dir === "down" ? h : w));
  const x2 = x + w;
  const y2 = y + h;
  switch (dir) {
    case "up":
      return `M${x},${y2}V${y + rr}Q${x},${y} ${x + rr},${y}H${x2 - rr}Q${x2},${y} ${x2},${y + rr}V${y2}Z`;
    case "down":
      return `M${x},${y}H${x2}V${y2 - rr}Q${x2},${y2} ${x2 - rr},${y2}H${x + rr}Q${x},${y2} ${x},${y2 - rr}Z`;
    case "right":
      return `M${x},${y}H${x2 - rr}Q${x2},${y} ${x2},${y + rr}V${y2 - rr}Q${x2},${y2} ${x2 - rr},${y2}H${x}Z`;
    case "left":
      return `M${x2},${y}V${y2}H${x + rr}Q${x},${y2} ${x},${y2 - rr}V${y + rr}Q${x},${y} ${x + rr},${y}Z`;
  }
}
