import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

export interface TooltipState {
  /** Anchor point in the plot container's coordinates (== SVG user units). */
  x: number;
  y: number;
  content: ReactNode;
}

const OFFSET = 12;

/**
 * Hover readout: an absolutely positioned card inside the chart's relative
 * plot container. It follows the anchor, flips to the other side of the
 * pointer near an edge, and is clamped so it never leaves the chart box.
 */
export function ChartTooltip({ tip, width, height }: { tip: TooltipState | null; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = tip.x + OFFSET;
    if (left + w > width) left = tip.x - OFFSET - w;
    left = Math.max(0, Math.min(left, width - w));
    let top = tip.y + OFFSET;
    if (top + h > height) top = tip.y - OFFSET - h;
    top = Math.max(0, Math.min(top, Math.max(0, height - h)));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [tip, width, height]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute z-[31] max-w-[260px] rounded-[10px] border border-border bg-card px-2.5 py-1.5 text-label text-fg"
      style={{ left: 0, top: 0, visibility: "hidden", boxShadow: "var(--chart-tooltip-shadow)" }}
    >
      {tip.content}
    </div>
  );
}

/** Tooltip state + helpers bound to the plot container element. */
export function useChartTooltip(containerRef: RefObject<HTMLElement>) {
  const [tip, setTip] = useState<TooltipState | null>(null);

  /** Show at a pointer event's position. */
  const showAtPointer = useCallback(
    (e: { clientX: number; clientY: number }, content: ReactNode) => {
      const rect = containerRef.current?.getBoundingClientRect();
      setTip({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), content });
    },
    [containerRef],
  );
  /** Show at a fixed point in SVG coordinates (keyboard focus). */
  const showAt = useCallback((x: number, y: number, content: ReactNode) => setTip({ x, y, content }), []);
  const hide = useCallback(() => setTip(null), []);

  return { tip, showAtPointer, showAt, hide };
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  dashed?: boolean;
}

/** Standard tooltip body: optional header, then rows keyed by a short line in the series color. Values lead. */
export function TooltipBody({ header, rows, note }: { header?: ReactNode; rows: TooltipRow[]; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {header != null && <div className="text-cap text-muted-fg">{header}</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 whitespace-nowrap">
          {r.color && (
            <svg width={12} height={4} className="flex-none" aria-hidden>
              <line
                x1={0}
                x2={12}
                y1={2}
                y2={2}
                stroke={r.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={r.dashed ? "3 2" : undefined}
              />
            </svg>
          )}
          <span className="ui-mono font-semibold text-fg-strong">{r.value}</span>
          <span className="min-w-0 truncate text-muted-fg">{r.label}</span>
        </div>
      ))}
      {note != null && <div className="text-cap text-muted-fg">{note}</div>}
    </div>
  );
}
