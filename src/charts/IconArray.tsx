import { forwardRef, useState } from "react";
import { ChartFrame, useChartShell } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { TooltipBody } from "./ChartTooltip";
import { Legend } from "./Legend";

export interface IconGroup {
  count: number;
  label: string;
  color: string;
}
export interface IconArrayProps extends ChartBaseProps {
  /** Default 100. */
  total?: number;
  /** Filled in order, row-major from the top-left; counts are pre-rounded by the caller. */
  groups: IconGroup[];
  /** Default 10. */
  columns?: number;
}

const MAX_ICON = 22;
const REST = "color-mix(in srgb, var(--muted-fg) 40%, transparent)";

/** Person glyph in a 20×20 box: head + shoulders/body. */
const PERSON = "M10 1.6a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8ZM4.2 19v-5.2c0-2.6 2.1-4.4 4.6-4.4h2.4c2.5 0 4.6 1.8 4.6 4.4V19Z";

export const IconArray = forwardRef<SVGSVGElement, IconArrayProps>(function IconArray(
  { title, total = 100, groups, columns = 10, height, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const cols = Math.max(1, Math.floor(columns));
  const rowsN = Math.ceil(n / cols);
  const empty = n === 0 || groups.length === 0;

  // Assign icons to groups in order; anything past `total` is dropped.
  const owner: number[] = [];
  groups.forEach((g, gi) => {
    const c = Math.max(0, Math.round(Number.isFinite(g.count) ? g.count : 0));
    for (let k = 0; k < c && owner.length < n; k++) owner.push(gi);
  });
  const rest = n - owner.length;
  while (owner.length < n) owner.push(-1);

  let cell = Math.min(MAX_ICON + 4, Math.floor((width - 2) / cols));
  if (height) cell = Math.min(cell, Math.floor((height - 2) / Math.max(1, rowsN)));
  cell = Math.max(3, cell);
  const icon = cell - Math.max(1, Math.round(cell * 0.15));
  const person = icon >= 10;
  const h = height ?? rowsN * cell + 2;

  const tipFor = (gi: number) => {
    const label = gi < 0 ? "remaining" : groups[gi].label;
    const count = gi < 0 ? rest : owner.filter((o) => o === gi).length;
    return <TooltipBody rows={[{ label, value: `${count} of ${n}`, color: gi < 0 ? REST : groups[gi].color }]} />;
  };

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
      footer={
        <Legend
          items={[
            ...groups.map((g) => ({ label: `${g.label} · ${Math.max(0, Math.round(g.count))} of ${n}`, color: g.color, shape: "dot" as const })),
            ...(rest > 0 ? [{ label: `remaining · ${rest} of ${n}`, color: REST, shape: "dot" as const }] : []),
          ]}
        />
      }
      svgProps={{
        onPointerLeave: () => {
          setHover(null);
          tooltip.hide();
        },
      }}
    >
      {owner.map((gi, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = 1 + c * cell;
        const y = 1 + r * cell;
        const fill = gi < 0 ? REST : groups[gi].color;
        const dim = hover !== null && hover !== gi;
        return (
          <g
            key={i}
            data-mark="icon"
            opacity={dim ? 0.35 : 1}
            onPointerMove={(e) => {
              setHover(gi);
              tooltip.showAtPointer(e, tipFor(gi));
            }}
          >
            <rect x={x} y={y} width={cell} height={cell} fill="transparent" />
            {person ? (
              <path d={PERSON} transform={`translate(${x + (cell - icon) / 2},${y + (cell - icon) / 2}) scale(${icon / 20})`} fill={fill} />
            ) : (
              <circle cx={x + cell / 2} cy={y + cell / 2} r={icon / 2} fill={fill} />
            )}
          </g>
        );
      })}
    </ChartFrame>
  );
});
