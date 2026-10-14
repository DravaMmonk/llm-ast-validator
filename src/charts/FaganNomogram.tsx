import { forwardRef, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ChartFrame, useChartShell, useSvgId } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { clamp, formatPercent, logit, postTestProbability, sigmoid, thinTicks } from "./scales";

export interface FaganNomogramProps extends ChartBaseProps {
  /** Pre-test probability, 0..1. */
  preTest: number;
  lrPositive?: number | null;
  lrNegative?: number | null;
  /** When given, the pre-test marker becomes a draggable / keyboard slider. */
  onPreTestChange?: (p: number) => void;
}

const P_MIN = 0.001;
const P_MAX = 0.999;
const L_MAX = logit(P_MAX);
const PROB_TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 99, 99.5, 99.8, 99.9];
const LR_TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const probPriority = (v: number) => ([0.1, 1, 10, 50, 90, 99, 99.9].includes(v) ? 0 : [0.5, 5, 95, 99.5, 20, 80].includes(v) ? 1 : 2);
const lrPriority = (v: number) => {
  const m = Number((v / 10 ** Math.floor(Math.log10(v))).toPrecision(3));
  return m === 1 ? 0 : m === 5 ? 1 : 2;
};
const fmtLR = (v: number) => String(Number(v.toPrecision(3)));
const roundP = (p: number) => clamp(Math.round(p * 1000) / 1000, P_MIN, P_MAX);

/** Keyboard step: 1 point, 0.1 point in the tails. */
function stepFor(p: number, dir: 1 | -1): number {
  const tail = dir > 0 ? p < 0.02 || p >= 0.98 : p <= 0.02 || p > 0.98;
  return tail ? 0.001 : 0.01;
}

export const FaganNomogram = forwardRef<SVGSVGElement, FaganNomogramProps>(function FaganNomogram(
  { title, preTest, lrPositive, lrNegative, onPreTestChange, height = 380, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const clipId = useSvgId("fagan-clip");
  const dragging = useRef(false);
  const empty = !Number.isFinite(preTest);
  const pre = clamp(Number.isFinite(preTest) ? preTest : 0.5, P_MIN, P_MAX);

  const top = 34;
  const bottom = height - 12;
  const y0 = (top + bottom) / 2;
  const k = (bottom - top) / 2 / L_MAX;
  const xL = Math.max(54, Math.round(width * 0.16));
  const xR = width - Math.max(64, Math.round(width * 0.16));
  const xM = (xL + xR) / 2;
  const yPre = (p: number) => y0 + k * logit(p);
  const yLR = (lr: number) => y0 - (k * Math.log(lr)) / 2;
  const yPost = (p: number) => y0 - k * logit(p);
  const pFromY = (y: number) => roundP(sigmoid((y - y0) / k));

  const lines = [
    { key: "pos", lr: lrPositive, color: "var(--bad)", name: "LR+", above: true },
    { key: "neg", lr: lrNegative, color: "var(--info)", name: "LR−", above: false },
  ]
    .filter((l): l is typeof l & { lr: number } => l.lr != null && Number.isFinite(l.lr) && l.lr > 0)
    .map((l) => ({ ...l, post: postTestProbability(pre, l.lr) }));

  const interactive = !!onPreTestChange;
  const commit = (p: number) => {
    const next = roundP(p);
    if (next !== roundP(pre)) onPreTestChange?.(next);
  };
  const localY = (e: PointerEvent) => e.clientY - (plotRef.current?.getBoundingClientRect().top ?? 0);
  const onDown = (e: PointerEvent<SVGGElement>) => {
    if (!interactive) return;
    dragging.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    commit(pFromY(localY(e)));
  };
  const onMove = (e: PointerEvent<SVGGElement>) => {
    if (dragging.current) commit(pFromY(localY(e)));
  };
  const onUp = (e: PointerEvent<SVGGElement>) => {
    dragging.current = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (!interactive) return;
    let next: number | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = pre + stepFor(pre, 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = pre - stepFor(pre, -1);
    else if (e.key === "PageUp") next = pre + 0.1;
    else if (e.key === "PageDown") next = pre - 0.1;
    else if (e.key === "Home") next = P_MIN;
    else if (e.key === "End") next = P_MAX;
    if (next == null) return;
    e.preventDefault();
    commit(next);
  };

  const probLabels = thinTicks(PROB_TICKS, (v) => yPre(v / 100), 11, probPriority);
  const lrLabels = thinTicks(LR_TICKS, yLR, 11, lrPriority);

  const axis = (x: number, ticks: number[], labels: number[], pos: (v: number) => number, side: "left" | "right", fmt: (v: number) => string) => (
    <g aria-hidden>
      <line x1={x + 0.5} x2={x + 0.5} y1={top} y2={bottom} stroke="var(--border)" />
      {ticks.map((t) => {
        const y = Math.round(pos(t)) + 0.5;
        const labelled = labels.includes(t);
        const len = labelled ? 5 : 3;
        return (
          <g key={t}>
            <line x1={side === "left" ? x - len : x} x2={side === "left" ? x : x + len} y1={y} y2={y} stroke="var(--border)" />
            {labelled && (
              <text
                x={side === "left" ? x - 8 : x + 8}
                y={y}
                textAnchor={side === "left" ? "end" : "start"}
                dominantBaseline="middle"
                fontSize={9.5}
                className="ui-mono"
                fill="var(--muted-fg)"
              >
                {fmt(t)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );

  const fmtPct = (v: number) => String(v);

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
      // It contains a focusable slider, so it is a labelled group, not a flat image.
      svgProps={onPreTestChange ? { role: "group" } : undefined}
      footer={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-cap text-muted-fg">
          <span>
            pre-test <span className="ui-mono font-semibold text-fg-strong">{formatPercent(pre)}</span>
          </span>
          {lines.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1" data-testid={`fagan-post-${l.key}`}>
              <svg width={12} height={4} aria-hidden>
                <line x1={0} x2={12} y1={2} y2={2} stroke={l.color} strokeWidth={2} />
              </svg>
              {l.name} <span className="ui-mono">{fmtLR(l.lr)}</span> → post-test{" "}
              <span className="ui-mono font-semibold text-fg-strong">{formatPercent(l.post)}</span>
            </span>
          ))}
        </div>
      }
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={xL} y={top} width={Math.max(0, xR - xL)} height={Math.max(0, bottom - top)} />
        </clipPath>
      </defs>
      <g aria-hidden fontSize={10.5} fill="var(--muted-fg)" textAnchor="middle">
        <text x={xL} y={14}>
          Pre-test (%)
        </text>
        <text x={xM} y={14}>
          Likelihood ratio
        </text>
        <text x={xR} y={14}>
          Post-test (%)
        </text>
      </g>
      {axis(xL, PROB_TICKS, probLabels, (v) => yPre(v / 100), "left", fmtPct)}
      {axis(xM, LR_TICKS, lrLabels, yLR, "left", fmtLR)}
      {axis(xR, [...PROB_TICKS].reverse(), probLabels, (v) => yPost(v / 100), "right", fmtPct)}
      <g clipPath={`url(#${clipId})`}>
        {lines.map((l) => (
          <g key={l.key} data-mark="fagan-line">
            <line x1={xL} y1={yPre(pre)} x2={xR} y2={yPost(clamp(l.post, 1e-6, 1 - 1e-6))} stroke={l.color} strokeWidth={2} strokeLinecap="round" />
            <circle cx={xM} cy={yLR(l.lr)} r={3} fill={l.color} stroke="var(--card)" strokeWidth={1.5} />
          </g>
        ))}
      </g>
      {labelPositions(
        lines.map((l) => ({ ...l, yr: clamp(yPost(clamp(l.post, P_MIN, P_MAX)), top, bottom) })),
        yPre(pre),
      ).map((l) => {
        const yr = l.yr;
        return (
          <g key={`lab-${l.key}`}>
            <circle cx={xR} cy={yr} r={4} fill={l.color} stroke="var(--card)" strokeWidth={2} />
            <text
              x={xR - 9}
              y={l.labelY}
              textAnchor="end"
              fontSize={10}
              className="ui-mono"
              fill="var(--fg-strong)"
              fontWeight={600}
              stroke="var(--card)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {`${l.name} ${fmtLR(l.lr)} → ${formatPercent(l.post)}`}
            </text>
          </g>
        );
      })}
      <g
        data-mark="pretest"
        role={interactive ? "slider" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? "Pre-test probability" : undefined}
        aria-valuemin={interactive ? P_MIN * 100 : undefined}
        aria-valuemax={interactive ? P_MAX * 100 : undefined}
        aria-valuenow={interactive ? Math.round(pre * 1000) / 10 : undefined}
        aria-valuetext={interactive ? formatPercent(pre) : undefined}
        style={{ cursor: interactive ? "ns-resize" : undefined, touchAction: interactive ? "none" : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        {interactive && <rect x={xL - 14} y={top - 6} width={28} height={bottom - top + 12} fill="transparent" />}
        <circle cx={xL} cy={yPre(pre)} r={5} fill="var(--fg-strong)" stroke="var(--card)" strokeWidth={2} />
        <text
          x={xL + 9}
          y={yPre(pre) + (yPre(pre) < top + 14 ? 12 : -7)}
          fontSize={10}
          className="ui-mono"
          fill="var(--fg-strong)"
          fontWeight={600}
          stroke="var(--card)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {formatPercent(pre)}
        </text>
      </g>
    </ChartFrame>
  );
});

/**
 * Puts each post-test label on the side its line does not run through: a line
 * that falls towards the post-test axis approaches from above, so its label
 * goes below the end point, and vice versa. If the two labels would then
 * collide, the fixed layout (LR+ above, LR− below) is used instead.
 */
function labelPositions<T extends { yr: number; above: boolean }>(lines: T[], yStart: number): (T & { labelY: number })[] {
  const placed = lines.map((l) => ({ ...l, labelY: l.yr + (l.yr > yStart ? 13 : -7) }));
  const collide = placed.some((a, i) => placed.some((b, j) => i < j && Math.abs(a.labelY - b.labelY) < 13));
  return collide ? lines.map((l) => ({ ...l, labelY: l.yr + (l.above ? -7 : 13) })) : placed;
}
