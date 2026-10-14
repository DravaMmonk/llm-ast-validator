export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
  /** Swatch mirrors the mark: `line` for lines, `rect` for bars/areas (default), `dot` for points. */
  shape?: "line" | "rect" | "dot";
}

/** One-row (wrapping) legend. Text stays in muted ink; the swatch carries identity. */
export function Legend({ items, className = "" }: { items: LegendItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={`m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-0.5 p-0 ${className}`}>
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="inline-flex min-w-0 items-center gap-1.5 text-cap text-muted-fg">
          <Swatch {...it} />
          <span className="truncate" title={it.label}>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Swatch({ color, dashed, shape = "rect" }: LegendItem) {
  if (shape === "line" || dashed) {
    return (
      <svg width={14} height={6} className="flex-none" aria-hidden>
        <line
          x1={1}
          x2={13}
          y1={3}
          y2={3}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={dashed ? "3 2.5" : undefined}
        />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={`h-2 w-2 flex-none ${shape === "dot" ? "rounded-full" : "rounded-[2px]"}`}
      style={{ background: color }}
    />
  );
}
