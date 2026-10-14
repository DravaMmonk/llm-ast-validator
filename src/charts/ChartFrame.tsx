import { forwardRef, useId, useRef } from "react";
import type { ReactNode, RefObject, SVGProps } from "react";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import type { TooltipState } from "./ChartTooltip";
import { useElementWidth } from "./useElementWidth";

/** Props every chart accepts. */
export interface ChartBaseProps {
  /** Accessible name (aria-label + <title>). Required. */
  title: string;
  /** Plot height in px including axes. */
  height?: number;
  /** Header slot, right-aligned (e.g. <ChartActions/>). */
  actions?: ReactNode;
  className?: string;
}

/** Width tracking + tooltip state shared by every chart. */
export function useChartShell() {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const plotRef = useRef<HTMLDivElement>(null);
  const tooltip = useChartTooltip(plotRef);
  return { wrapRef, plotRef, width, tooltip };
}

/** A sanitized React id usable in url(#…) references. */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

interface ChartFrameProps {
  title: string;
  width: number;
  height: number;
  wrapRef: RefObject<HTMLDivElement>;
  plotRef: RefObject<HTMLDivElement>;
  tip: TooltipState | null;
  empty?: boolean;
  /** Rendered left of the actions in the header row (usually a Legend). */
  header?: ReactNode;
  actions?: ReactNode;
  /** Rendered under the plot (HTML). */
  footer?: ReactNode;
  className?: string;
  svgProps?: SVGProps<SVGSVGElement>;
  children?: ReactNode;
}

/**
 * Chart anatomy: [header: legend · actions] / relative plot box (svg + tooltip) / footer.
 * The SVG is the forwarded ref so ChartActions can export it.
 */
export const ChartFrame = forwardRef<SVGSVGElement, ChartFrameProps>(function ChartFrame(
  { title, width, height, wrapRef, plotRef, tip, empty, header, actions, footer, className = "", svgProps, children },
  ref,
) {
  const showHeader = (!empty && header) || actions;
  return (
    <div ref={wrapRef} className={`flex w-full min-w-0 flex-col gap-1.5 ${className}`}>
      {showHeader && (
        <div className="flex min-h-[22px] items-center gap-2">
          <div className="min-w-0 flex-1">{!empty && header}</div>
          {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
        </div>
      )}
      <div ref={plotRef} className="relative" style={{ width, height }}>
        <svg
          ref={ref}
          role="img"
          aria-label={title}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block", userSelect: "none" }}
          {...(empty ? {} : svgProps)}
        >
          <title>{title}</title>
          {empty ? (
            <text
              x={width / 2}
              y={height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={12}
              className="text-ui"
              fill="var(--muted-fg)"
            >
              No data
            </text>
          ) : (
            children
          )}
        </svg>
        {!empty && <ChartTooltip tip={tip} width={width} height={height} />}
      </div>
      {!empty && footer}
    </div>
  );
});
